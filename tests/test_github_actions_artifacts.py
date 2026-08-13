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
        "workflow_run": {"id": run_id},
    }


def trusted_run(*, path: str = ".github/workflows/update-market-data.yml") -> dict[str, object]:
    return {
        "conclusion": "success",
        "path": path,
        "head_branch": "main",
        "head_repository": {"full_name": REPOSITORY},
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
        self.assertEqual(datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc), result.created_at)

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


if __name__ == "__main__":
    unittest.main()
