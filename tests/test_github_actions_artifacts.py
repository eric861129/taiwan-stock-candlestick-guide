"""GitHub Actions 市場 Artifact provenance 與 immutable selection 契約測試。"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from github_actions_artifacts import (  # noqa: E402
    GitHubArtifactQueryError,
    find_latest_successful_market_snapshot,
    query_selected_deployment_record,
    query_selected_market_snapshot,
    validate_selected_market_snapshot,
)


REPOSITORY = "example/guide"
FIRST_PAGE = f"https://api.github.com/repos/{REPOSITORY}/actions/artifacts?per_page=100"
DIGEST_A = f"sha256:{'a' * 64}"
DIGEST_B = f"sha256:{'b' * 64}"


def artifact(
    artifact_id: int,
    digest: str = DIGEST_A,
    *,
    name: str = "market-snapshot-abc",
    expired: bool = False,
    created_at: str = "2026-08-13T12:00:00Z",
    run_id: int = 8_001,
) -> dict[str, object]:
    return {
        "id": artifact_id,
        "name": name,
        "digest": digest,
        "expired": expired,
        "created_at": created_at,
        "workflow_run": {"id": run_id, "head_sha": "c" * 40},
    }


def trusted_run(*, path: str = ".github/workflows/update-market-data.yml") -> dict[str, object]:
    return {
        "conclusion": "success",
        "path": path,
        "head_branch": "main",
        "head_repository": {"full_name": REPOSITORY},
        "head_sha": "c" * 40,
    }


class MarketArtifactSelectionTests(unittest.TestCase):
    """測試選取結果能被 ID 與 digest 唯一鎖定，而非以名稱重新查找。"""

    def test_finder_returns_digest_together_with_selected_artifact_id(self) -> None:
        result = find_latest_successful_market_snapshot(
            lambda _: ({"total_count": 1, "artifacts": [artifact(981_337)]}, {}),
            lambda _: trusted_run(),
            FIRST_PAGE,
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(981_337, result.artifact_id)
        self.assertEqual(DIGEST_A, result.artifact_digest)
        self.assertEqual(".github/workflows/update-market-data.yml", result.workflow_path)
        self.assertEqual(".github/workflows/deploy-pages.yml", result.signer_workflow_path)
        self.assertEqual("c" * 40, result.source_sha)
        self.assertEqual(datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc), result.created_at)

    def test_cli_accepts_the_gh_token_name_used_by_github_cli_steps(self) -> None:
        with (
            patch.dict("os.environ", {"GH_TOKEN": "gh-token", "GITHUB_TOKEN": ""}),
            patch(
                "github_actions_artifacts.query_successful_market_snapshot",
                return_value=None,
            ) as query,
        ):
            from github_actions_artifacts import main

            exit_code = main(
                [
                    "--api-url",
                    "https://api.github.com",
                    "--repository",
                    REPOSITORY,
                ]
            )

        self.assertEqual(0, exit_code)
        self.assertEqual("gh-token", query.call_args.args[2])

    def test_missing_or_invalid_digest_fails_closed_before_a_candidate_can_be_reused(self) -> None:
        for digest in (None, "sha256:not-a-digest", f"sha512:{'a' * 64}"):
            with self.subTest(digest=digest):
                candidate = artifact(981_337)
                if digest is None:
                    candidate.pop("digest")
                else:
                    candidate["digest"] = digest
                with self.assertRaisesRegex(GitHubArtifactQueryError, "digest"):
                    find_latest_successful_market_snapshot(
                        lambda _: ({"total_count": 1, "artifacts": [candidate]}, {}),
                        lambda _: trusted_run(),
                        FIRST_PAGE,
                    )

    def test_finder_rejects_a_page_url_from_a_different_repository(self) -> None:
        with self.assertRaisesRegex(GitHubArtifactQueryError, "repository"):
            find_latest_successful_market_snapshot(
                lambda _: ({"total_count": 1, "artifacts": [artifact(981_337)]}, {}),
                lambda _: trusted_run(),
                FIRST_PAGE,
                expected_repository="official/guide",
            )

    def test_selected_artifact_rejects_matching_name_when_its_id_or_digest_differs(self) -> None:
        selected = artifact(981_337, DIGEST_A)

        with self.assertRaisesRegex(GitHubArtifactQueryError, "Artifact ID"):
            validate_selected_market_snapshot(
                selected,
                lambda _: trusted_run(),
                expected_repository=REPOSITORY,
                expected_artifact_id=981_338,
                expected_artifact_digest=DIGEST_A,
            )
        with self.assertRaisesRegex(GitHubArtifactQueryError, "digest"):
            validate_selected_market_snapshot(
                selected,
                lambda _: trusted_run(),
                expected_repository=REPOSITORY,
                expected_artifact_id=981_337,
                expected_artifact_digest=DIGEST_B,
            )

    def test_selected_artifact_applies_the_same_repository_branch_workflow_and_success_boundary(self) -> None:
        selected = artifact(981_337, DIGEST_A)
        untrusted_runs = (
            {**trusted_run(), "conclusion": "failure"},
            {**trusted_run(), "head_branch": "feature/unsafe"},
            {**trusted_run(), "path": ".github/workflows/verify.yml"},
            {**trusted_run(), "head_repository": {"full_name": "fork/guide"}},
        )

        for run in untrusted_runs:
            with self.subTest(run=run):
                with self.assertRaisesRegex(GitHubArtifactQueryError, "信任邊界"):
                    validate_selected_market_snapshot(
                        selected,
                        lambda _: run,
                        expected_repository=REPOSITORY,
                        expected_artifact_id=981_337,
                        expected_artifact_digest=DIGEST_A,
                    )

    def test_selected_artifact_rejects_expired_snapshot_without_name_based_fallback(self) -> None:
        with self.assertRaisesRegex(GitHubArtifactQueryError, "信任邊界"):
            validate_selected_market_snapshot(
                artifact(981_337, DIGEST_A, expired=True),
                lambda _: trusted_run(),
                expected_repository=REPOSITORY,
                expected_artifact_id=981_337,
                expected_artifact_digest=DIGEST_A,
            )

    def test_artifact_and_run_source_sha_must_match(self) -> None:
        selected = artifact(981_337, DIGEST_A)
        with self.assertRaisesRegex(GitHubArtifactQueryError, "source SHA"):
            validate_selected_market_snapshot(
                selected,
                lambda _: {**trusted_run(), "head_sha": "d" * 40},
                expected_repository=REPOSITORY,
                expected_artifact_id=981_337,
                expected_artifact_digest=DIGEST_A,
            )

    def test_direct_query_uses_the_recorded_id_without_listing_or_name_search(self) -> None:
        with patch(
            "github_actions_artifacts._fetch_json",
            side_effect=[(artifact(981_337, DIGEST_A), {}), (trusted_run(), {})],
        ) as fetch_json:
            result = query_selected_market_snapshot(
                "https://api.github.com",
                REPOSITORY,
                "test-token",
                artifact_id=981_337,
                artifact_digest=DIGEST_A,
            )

        self.assertEqual(981_337, result.artifact_id)
        self.assertEqual(
            [
                (f"https://api.github.com/repos/{REPOSITORY}/actions/artifacts/981337", "test-token"),
                (f"https://api.github.com/repos/{REPOSITORY}/actions/runs/8001", "test-token"),
            ],
            [call.args for call in fetch_json.call_args_list],
        )

    def test_deployment_record_query_trusts_direct_and_scheduled_pages_runs(self) -> None:
        record = artifact(77_001, DIGEST_B, name="deployment-record-release")
        for workflow_path in (
            ".github/workflows/deploy-pages.yml",
            ".github/workflows/update-market-data.yml",
        ):
            with (
                self.subTest(workflow_path=workflow_path),
                patch(
                    "github_actions_artifacts._fetch_json",
                    side_effect=[(record, {}), (trusted_run(path=workflow_path), {})],
                ),
            ):
                result = query_selected_deployment_record(
                    "https://api.github.com",
                    REPOSITORY,
                    "test-token",
                    artifact_id=77_001,
                )

                self.assertEqual(77_001, result.artifact_id)
                self.assertEqual(DIGEST_B, result.artifact_digest)

        with patch(
            "github_actions_artifacts._fetch_json",
            side_effect=[
                (record, {}),
                (trusted_run(path=".github/workflows/bootstrap-market-history.yml"), {}),
            ],
        ):
            with self.assertRaisesRegex(GitHubArtifactQueryError, "信任邊界"):
                query_selected_deployment_record(
                    "https://api.github.com",
                    REPOSITORY,
                    "test-token",
                    artifact_id=77_001,
                )

    def test_bootstrap_and_reusable_runs_map_to_the_actual_attestation_signer(self) -> None:
        for run_path, signer_path in (
            (".github/workflows/bootstrap-market-history.yml", ".github/workflows/bootstrap-market-history.yml"),
            (".github/workflows/deploy-pages.yml", ".github/workflows/deploy-pages.yml"),
            (".github/workflows/update-market-data.yml", ".github/workflows/deploy-pages.yml"),
        ):
            with self.subTest(run_path=run_path):
                result = validate_selected_market_snapshot(
                    artifact(981_337, DIGEST_A),
                    lambda _: trusted_run(path=run_path),
                    expected_repository=REPOSITORY,
                    expected_artifact_id=981_337,
                    expected_artifact_digest=DIGEST_A,
                )
                self.assertEqual(signer_path, result.signer_workflow_path)

    def test_current_workflow_artifact_can_be_verified_before_the_run_finishes(self) -> None:
        selected = artifact(981_337, DIGEST_A, run_id=8_001)
        in_progress = {**trusted_run(path=".github/workflows/deploy-pages.yml"), "conclusion": None}

        result = validate_selected_market_snapshot(
            selected,
            lambda _: in_progress,
            expected_repository=REPOSITORY,
            expected_artifact_id=981_337,
            expected_artifact_digest=DIGEST_A,
            allow_in_progress_run_id=8_001,
        )
        self.assertEqual(981_337, result.artifact_id)

        with self.assertRaisesRegex(GitHubArtifactQueryError, "conclusion"):
            validate_selected_market_snapshot(
                selected,
                lambda _: in_progress,
                expected_repository=REPOSITORY,
                expected_artifact_id=981_337,
                expected_artifact_digest=DIGEST_A,
                allow_in_progress_run_id=8_002,
            )


if __name__ == "__main__":
    unittest.main()
