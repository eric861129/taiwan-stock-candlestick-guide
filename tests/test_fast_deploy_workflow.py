"""Pages 快速部署、簽署快照與 rollback 信任鏈契約測試。"""

from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-pages.yml"


def workflow_text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


class FastDeployWorkflowTests(unittest.TestCase):
    def test_market_artifact_is_bound_by_id_digest_receipt_and_attestation(self) -> None:
        text = workflow_text()

        self.assertIn("market_artifact_id:", text)
        self.assertIn("market_artifact_digest:", text)
        self.assertIn("market_artifact_source_sha:", text)
        self.assertIn("market_artifact_workflow_path:", text)
        self.assertIn("market_artifact_signer_workflow_path:", text)
        self.assertIn("snapshot_reason:", text)
        self.assertIn("validator_contract_digest:", text)
        self.assertIn("--allow-in-progress-run-id \"$GITHUB_RUN_ID\"", text)
        self.assertNotIn("market_artifact_workflow_path=.github/workflows/deploy-pages.yml", text)
        self.assertIn("python .workflow-helper/tools/market_artifact_archive.py", text)
        self.assertIn("gh attestation verify", text)
        self.assertIn("--predicate-type", text)
        self.assertIn("verify-receipt-predicate", text)
        self.assertIn("market_snapshot_receipt.py verify", text)
        self.assertNotIn("name: ${{ needs.source-snapshot.outputs.candidate_artifact_name }}", text)

    def test_rebuild_validates_once_then_receipts_attests_and_uploads_three_files(self) -> None:
        text = workflow_text()
        source = text.split("  source-snapshot:", 1)[1].split("\n  build-pages:", 1)[0]

        update = source.index("market_snapshot.py update")
        receipt = source.index("market_snapshot_receipt.py create")
        attest = source.index("uses: actions/attest@")
        upload = source.index("id: upload-market-snapshot")
        self.assertLess(update, receipt)
        self.assertLess(receipt, attest)
        self.assertLess(attest, upload)
        self.assertNotIn("market_snapshot.py validate", source)
        self.assertNotIn("validate_snapshot(", source)
        self.assertIn("snapshot.tar.gz\n", source)
        self.assertIn("snapshot.tar.gz.sha256\n", source)
        self.assertIn("validation-receipt.json", source)

    def test_reuse_and_build_never_run_full_snapshot_validator(self) -> None:
        text = workflow_text()
        build = text.split("  build-pages:", 1)[1].split("\n  deploy:", 1)[0]

        self.assertNotIn("market_snapshot.py validate", build)
        self.assertNotIn("validate_snapshot(", build)
        self.assertIn("--deployment-metadata", build)
        self.assertIn("deploymentVersion", build)
        self.assertIn("MARKET_ARTIFACT_ID:", build)
        self.assertIn("MARKET_ARTIFACT_DIGEST:", build)

    def test_rollback_resolves_a_deployment_record_before_market_download(self) -> None:
        text = workflow_text()
        resolve = text.split("  resolve-source:", 1)[1].split("\n  verify:", 1)[0]

        self.assertIn("--deployment-record-id", resolve)
        self.assertIn("--allow-kind deployment-record-v2", resolve)
        self.assertIn("load_deployment_record", resolve)
        self.assertIn("rollback_market_artifact_id", resolve)
        self.assertIn("rollback_market_artifact_digest", resolve)
        self.assertIn("rollbackSourceDeploymentRecordId", text)
        self.assertNotIn("actions/download-artifact", resolve)

    def test_successful_deploy_publishes_only_a_small_record_and_runs_public_smoke(self) -> None:
        text = workflow_text()

        self.assertIn("  verify-public:", text)
        self.assertIn("deployment-version.json", text)
        self.assertIn('"$base/analyzer"', text)
        self.assertIn("id: upload-deployment-record", text)
        self.assertNotIn("  publish-successful-snapshot:", text)
        record = text.split("id: upload-deployment-record", 1)[1]
        self.assertIn("deployment.json", record)
        self.assertNotIn("snapshot.tar.gz", record)

    def test_new_attestations_are_bound_to_the_workflow_main_sha(self) -> None:
        text = workflow_text()
        resolve = text.split("  resolve-source:", 1)[1].split("\n  verify:", 1)[0]

        self.assertIn("WORKFLOW_SOURCE_SHA: ${{ github.sha }}", resolve)
        self.assertIn("WORKFLOW_REF: ${{ github.ref }}", resolve)
        self.assertIn('"$WORKFLOW_REF" != "refs/heads/main"', resolve)
        self.assertIn('"$REQUESTED_SOURCE_SHA" != "$WORKFLOW_SOURCE_SHA"', resolve)
        source_job = text.split("  source-snapshot:", 1)[1].split("\n  build-pages:", 1)[0]
        self.assertIn('"$DEPLOY_MODE" == "update"', source_job)
        self.assertIn("git merge-base --is-ancestor", source_job)
        scheduler = (ROOT / ".github" / "workflows" / "update-market-data.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("WORKFLOW_SOURCE_SHA: ${{ github.sha }}", scheduler)
        self.assertNotIn("git ls-remote", scheduler)

    def test_rebuild_consumes_the_receipt_verified_manifest_without_revalidating_old_snapshot(self) -> None:
        text = workflow_text()
        source = text.split("  source-snapshot:", 1)[1].split("\n  build-pages:", 1)[0]

        self.assertIn(
            '--verified-previous-manifest "$RUNNER_TEMP/previous-snapshot/manifest.json"',
            source,
        )
        self.assertNotIn("--allow-kind legacy-market-v0", source)
        self.assertNotIn("id: legacy-identity", source)
        self.assertIn("snapshot_reason=$reason", source)
        self.assertIn("分類原因", source)
        self.assertIn("Validator contract digest", source)

    def test_summary_records_all_timing_stages_and_enforces_the_fast_path_gate(self) -> None:
        text = workflow_text()

        for field in (
            "artifact_find_seconds",
            "artifact_download_seconds",
            "archive_verify_seconds",
            "fast_verify_seconds",
            "full_validator_count",
            "full_validator_seconds",
            "website_build_seconds",
            "deploy_seconds",
            "Time-to-public",
            "Workflow complete",
        ):
            self.assertIn(field, text)
        self.assertIn('"$SNAPSHOT_STRATEGY" == "snapshot-reuse"', text)
        self.assertIn("time_to_public > 300", text)
        self.assertIn("workflow_complete > 300", text)


if __name__ == "__main__":
    unittest.main()
