"""網站與市場資料部署版本契約測試。"""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from deployment_versions import (  # noqa: E402
    DeploymentVersionError,
    create_deployment_version,
    load_deployment_record,
    validate_deployment_version,
    write_deployment_version,
)


MARKET_SHA = "1" * 40
WEBSITE_SHA = "2" * 40
SNAPSHOT_HASH = "a" * 64


def manifest() -> dict[str, object]:
    return {
        "sourceCommit": MARKET_SHA,
        "snapshotHash": SNAPSHOT_HASH,
        "markets": {
            "TWSE": {"cutoffDate": "2026-08-12"},
            "TPEx": {"cutoffDate": "2026-08-12"},
        },
    }


def deployment() -> dict[str, object]:
    return {
        "deploymentVersion": 2,
        "websiteSourceCommit": WEBSITE_SHA,
        "marketDataSourceCommit": MARKET_SHA,
        "snapshotHash": SNAPSHOT_HASH,
        "cutoffDate": "2026-08-12",
        "marketArtifactId": 981_337,
        "marketArtifactDigest": f"sha256:{'c' * 64}",
        "strategy": "snapshot-reuse",
    }


class DeploymentVersionTests(unittest.TestCase):
    def test_accepts_two_distinct_versions_bound_to_one_snapshot(self) -> None:
        version = validate_deployment_version(manifest(), deployment())

        self.assertEqual(WEBSITE_SHA, version.website_source_commit)
        self.assertEqual(MARKET_SHA, version.market_data_source_commit)
        self.assertEqual("snapshot-reuse", version.strategy)
        self.assertEqual(981_337, version.market_artifact_id)
        self.assertEqual(f"sha256:{'c' * 64}", version.market_artifact_digest)

    def test_legacy_artifact_uses_manifest_source_for_both_versions(self) -> None:
        version = validate_deployment_version(manifest(), None)

        self.assertTrue(version.legacy)
        self.assertEqual(MARKET_SHA, version.website_source_commit)
        self.assertEqual(MARKET_SHA, version.market_data_source_commit)

    def test_rejects_each_tampered_pairing_field(self) -> None:
        mutations = {
            "marketDataSourceCommit": "3" * 40,
            "snapshotHash": "b" * 64,
            "cutoffDate": "2026-08-11",
            "marketArtifactId": 0,
            "marketArtifactDigest": "sha256:untrusted",
            "strategy": "untrusted",
        }
        for field, value in mutations.items():
            with self.subTest(field=field):
                candidate = deepcopy(deployment())
                candidate[field] = value
                with self.assertRaises(DeploymentVersionError):
                    validate_deployment_version(manifest(), candidate)

    def test_rejects_unknown_fields_and_invalid_website_sha(self) -> None:
        with_unknown = {**deployment(), "untrusted": True}
        with self.assertRaisesRegex(DeploymentVersionError, "欄位集合"):
            validate_deployment_version(manifest(), with_unknown)

        invalid_website = {**deployment(), "websiteSourceCommit": "main"}
        with self.assertRaisesRegex(DeploymentVersionError, "websiteSourceCommit"):
            validate_deployment_version(manifest(), invalid_website)

        boolean_version = {**deployment(), "deploymentVersion": True}
        with self.assertRaisesRegex(DeploymentVersionError, "deploymentVersion"):
            validate_deployment_version(manifest(), boolean_version)

    def test_rejects_incomplete_market_map_and_impossible_cutoff(self) -> None:
        incomplete = manifest()
        incomplete["markets"] = {
            "TWSE": {"cutoffDate": "2026-08-12"},
            "TPEx": None,
        }
        with self.assertRaisesRegex(DeploymentVersionError, "markets"):
            validate_deployment_version(incomplete, deployment())

        impossible = manifest()
        impossible["markets"] = {
            "TWSE": {"cutoffDate": "2026-99-99"},
            "TPEx": {"cutoffDate": "2026-99-99"},
        }
        bad_deployment = {**deployment(), "cutoffDate": "2026-99-99"}
        with self.assertRaisesRegex(DeploymentVersionError, "cutoffDate"):
            validate_deployment_version(impossible, bad_deployment)

    def test_creator_refuses_market_sha_that_differs_from_manifest(self) -> None:
        with self.assertRaisesRegex(DeploymentVersionError, "marketDataSourceCommit"):
            create_deployment_version(
                manifest(),
                website_source_commit=WEBSITE_SHA,
                market_data_source_commit="4" * 40,
                market_artifact_id=981_337,
                market_artifact_digest=f"sha256:{'c' * 64}",
                strategy="snapshot-rebuild",
            )

    def test_creator_binds_the_selected_immutable_artifact(self) -> None:
        version = create_deployment_version(
            manifest(),
            website_source_commit=WEBSITE_SHA,
            market_data_source_commit=MARKET_SHA,
            market_artifact_id=981_337,
            market_artifact_digest=f"sha256:{'c' * 64}",
            strategy="snapshot-rebuild",
        )

        self.assertEqual(deployment() | {"strategy": "snapshot-rebuild"}, version.to_document())

    def test_rollback_record_preserves_the_source_deployment_record_id(self) -> None:
        version = create_deployment_version(
            manifest(),
            website_source_commit=WEBSITE_SHA,
            market_data_source_commit=MARKET_SHA,
            market_artifact_id=981_337,
            market_artifact_digest=f"sha256:{'c' * 64}",
            strategy="snapshot-reuse",
            rollback_source_deployment_record_id=77_001,
        )

        self.assertEqual(77_001, version.rollback_source_deployment_record_id)
        self.assertEqual(77_001, version.to_document()["rollbackSourceDeploymentRecordId"])

        invalid = deployment() | {
            "strategy": "snapshot-rebuild",
            "rollbackSourceDeploymentRecordId": 77_001,
        }
        with self.assertRaisesRegex(DeploymentVersionError, "rollbackSource"):
            validate_deployment_version(manifest(), invalid)

    def test_loads_canonical_deployment_record_before_snapshot_download(self) -> None:
        version = create_deployment_version(
            manifest(),
            website_source_commit=WEBSITE_SHA,
            market_data_source_commit=MARKET_SHA,
            market_artifact_id=981_337,
            market_artifact_digest=f"sha256:{'c' * 64}",
            strategy="snapshot-reuse",
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deployment.json"
            write_deployment_version(path, version)

            loaded = load_deployment_record(path)

        self.assertEqual(version, loaded)

    def test_rejects_noncanonical_or_tampered_standalone_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deployment.json"
            path.write_text(json.dumps(deployment(), indent=2) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(DeploymentVersionError, "canonical"):
                load_deployment_record(path)

            tampered = deployment() | {"marketDataSourceCommit": "main"}
            path.write_text(
                json.dumps(tampered, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(DeploymentVersionError, "marketDataSourceCommit"):
                load_deployment_record(path)


if __name__ == "__main__":
    unittest.main()
