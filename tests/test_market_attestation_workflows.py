"""市場快照簽署 workflow 的離線契約測試。"""

from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
ATTEST_ACTION_PIN = "1e69f48acb82d1966a394da916b4c1698aa569d6"
PREDICATE_TYPE = "https://eric861129.github.io/attestations/market-snapshot-validation/v1"


def read_workflow(name: str) -> str:
    """讀取受測 workflow；測試不會連線或執行市場資料流程。"""

    return (WORKFLOWS / name).read_text(encoding="utf-8")


class MarketSnapshotAttestationWorkflowTests(unittest.TestCase):
    """鎖住完整驗證、receipt、Attestation 與市場 Artifact 的信任順序。"""

    def test_bootstrap_creates_receipt_and_attestation_only_after_the_single_validator_path(self) -> None:
        """十年基準完成完整驗證後，才可簽署固定三檔市場 Artifact。"""

        text = read_workflow("bootstrap-market-history.yml")

        build_index = text.index("      - name: Build and validate the ten-year baseline")
        receipt_index = text.index("      - id: create-validation-receipt")
        attestation_index = text.index("      - id: attest-market-snapshot")
        upload_index = text.index("      - id: upload-market-snapshot")

        self.assertLess(build_index, receipt_index)
        self.assertLess(receipt_index, attestation_index)
        self.assertLess(attestation_index, upload_index)
        build_section = text[build_index:receipt_index]
        self.assertIn("python tools/market_snapshot.py bootstrap", build_section)
        self.assertIn("MARKET_VALIDATOR_TIMING_OUTPUT", build_section)
        self.assertIn("fullValidatorCount", build_section)
        self.assertNotIn("python tools/market_snapshot.py validate", build_section)
        self.assertNotIn("python tools/market_snapshot.py validate", text)

        receipt_section = text[receipt_index:attestation_index]
        self.assertNotIn("if: ${{ always() }}", receipt_section)
        self.assertIn("python tools/market_snapshot_receipt.py create", receipt_section)
        self.assertIn("--archive \"$RUNNER_TEMP/bootstrap-snapshot/snapshot.tar.gz\"", receipt_section)
        self.assertIn("--output \"$RUNNER_TEMP/bootstrap-snapshot/validation-receipt.json\"", receipt_section)
        self.assertIn("--market-source-commit \"$SOURCE_SHA\"", receipt_section)
        self.assertIn("--validator-source-commit \"$VALIDATOR_SOURCE_SHA\"", receipt_section)

        attestation_section = text[attestation_index:upload_index]
        self.assertNotIn("if: ${{ always() }}", attestation_section)
        self.assertIn(f"uses: actions/attest@{ATTEST_ACTION_PIN}", attestation_section)
        self.assertIn("subject-path: ${{ runner.temp }}/bootstrap-snapshot/snapshot.tar.gz", attestation_section)
        self.assertIn(f"predicate-type: {PREDICATE_TYPE}", attestation_section)
        self.assertIn("predicate-path: ${{ runner.temp }}/bootstrap-snapshot/validation-receipt.json", attestation_section)
        self.assertNotIn("subject-checksums:", attestation_section)
        self.assertNotIn("subject-digest:", attestation_section)

        upload_section = text[upload_index:].split("\n      - id: market-artifact-provenance", 1)[0]
        self.assertNotIn("if: ${{ always() }}", upload_section)
        uploaded_paths = upload_section.split("          path: |\n", 1)[1].split("\n          if-no-files-found:", 1)[0]
        self.assertEqual(
            [
                "${{ runner.temp }}/bootstrap-snapshot/snapshot.tar.gz",
                "${{ runner.temp }}/bootstrap-snapshot/snapshot.tar.gz.sha256",
                "${{ runner.temp }}/bootstrap-snapshot/validation-receipt.json",
            ],
            [line.strip() for line in uploaded_paths.splitlines() if line.strip()],
        )
        provenance_section = text.split("      - id: market-artifact-provenance", 1)[1]
        self.assertIn("steps.upload-market-snapshot.outputs.artifact-id", provenance_section)
        self.assertIn("steps.upload-market-snapshot.outputs.artifact-digest", provenance_section)
        self.assertIn("python tools/market_snapshot_attestation.py normalize-artifact-digest", provenance_section)
        self.assertIn("artifact_digest=$ARTIFACT_DIGEST", provenance_section)
        self.assertIn("fullValidatorSeconds", provenance_section)

    def test_bootstrap_signing_job_uses_the_required_minimum_permissions(self) -> None:
        """簽署 job 只取得讀取 source、OIDC 與 Attestation 的必要權限。"""

        text = read_workflow("bootstrap-market-history.yml")
        bootstrap_job = text.split("  bootstrap:", 1)[1]
        permission_section = bootstrap_job.split("    steps:", 1)[0]

        self.assertIn("      contents: read", permission_section)
        self.assertIn("      id-token: write", permission_section)
        self.assertIn("      attestations: write", permission_section)
        self.assertNotIn("      write-all", permission_section)

    def test_bootstrap_refuses_to_sign_a_source_outside_main_history(self) -> None:
        """手動輸入 feature commit 時，不能讓正式 workflow 產生可混淆的簽章。"""

        text = read_workflow("bootstrap-market-history.yml")
        resolve_section = text.split("  resolve-source:", 1)[1].split("\n  verify:", 1)[0]
        checkout_section = text.split("      - name: Checkout locked source", 1)[1].split(
            "\n      - name: Confirm immutable source checkout", 1
        )[0]
        confirmation_section = text.split("      - name: Confirm immutable source checkout", 1)[1].split(
            "\n      - name: Setup Python 3.13", 1
        )[0]

        self.assertIn("WORKFLOW_REF: ${{ github.ref }}", resolve_section)
        self.assertIn('[[ "$WORKFLOW_REF" != "refs/heads/main" ]]', resolve_section)
        self.assertIn("fetch-depth: 1", checkout_section)
        self.assertIn("git fetch --no-tags", confirmation_section)
        self.assertIn("refs/heads/main:refs/remotes/origin/main", confirmation_section)
        self.assertIn("git merge-base --is-ancestor \"$EXPECTED_SOURCE_SHA\" origin/main", confirmation_section)

    def test_scheduled_market_caller_forwards_attestation_permission_to_reusable_deployment(self) -> None:
        """排程更新透過 reusable deployment 時，不可遺失簽署所需權限。"""

        text = read_workflow("update-market-data.yml")
        deploy_job = text.split("  deploy:", 1)[1]
        permission_section = deploy_job.split("    permissions:", 1)[1]

        self.assertIn("      contents: read", permission_section)
        self.assertIn("      attestations: write", permission_section)
        self.assertIn("      id-token: write", permission_section)
        self.assertNotIn("      write-all", permission_section)


if __name__ == "__main__":
    unittest.main()
