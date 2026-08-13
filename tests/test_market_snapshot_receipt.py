from __future__ import annotations

from dataclasses import replace
import hashlib
from io import BytesIO
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import market_snapshot_receipt
from market_snapshot import build_snapshot
from tests.test_market_snapshot import fixture_build_input

from market_snapshot_receipt import (
    ARCHIVE_DIGEST_FILE_NAME,
    ARCHIVE_FILE_NAME,
    PREDICATE_TYPE,
    RECEIPT_FILE_NAME,
    ReceiptValidationError,
    contract_digest,
    create_receipt,
    verify_artifact,
    write_archive_digest,
    write_receipt,
)


SOURCE_COMMIT = "a" * 40
VALIDATOR_COMMIT = "b" * 40


def canonical_json_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode("utf-8")


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def write_regular_member(tar: tarfile.TarFile, name: str, payload: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(payload)
    info.mode = 0o644
    tar.addfile(info, fileobj=BytesIO(payload))


def snapshot_payloads() -> tuple[dict[str, bytes], dict[str, object]]:
    """建立最小但符合快速驗證資料邊界的 archive 內容。"""

    # 股票內容刻意不是完整語意快照。快速 seam 只能驗證已簽內容的配對，不能重跑完整 validator。
    stock_payload = b'{"not":"a full market validator fixture"}\n'
    stock_digest = digest(stock_payload)
    stock_path = f"data/stocks/2330.{stock_digest[:12]}.json"
    manifest: dict[str, object] = {
        "schemaVersion": 1,
        "snapshotVersion": 4,
        "sourceCommit": SOURCE_COMMIT,
        "generatedAt": "2026-08-13T18:00:00+08:00",
        "markets": {
            "TPEx": {"cutoffDate": "2026-08-13"},
            "TWSE": {"cutoffDate": "2026-08-13"},
        },
        "symbols": [
            {
                "code": "2330",
                "dataPath": stock_path,
                "digest": stock_digest,
                "size": len(stock_payload),
            }
        ],
    }
    manifest["snapshotHash"] = digest(canonical_json_bytes(manifest))
    provenance = {
        "schemaVersion": 1,
        "snapshotVersion": 4,
        "sourceCommit": SOURCE_COMMIT,
        "snapshotHash": manifest["snapshotHash"],
        "markets": {
            "TPEx": {"cutoffDate": "2026-08-13"},
            "TWSE": {"cutoffDate": "2026-08-13"},
        },
    }
    payloads = {
        "manifest.json": canonical_json_bytes(manifest),
        "provenance.json": canonical_json_bytes(provenance),
        stock_path: stock_payload,
    }
    payloads["SHA256SUMS"] = (
        "\n".join(f"{digest(payloads[path])}  {path}" for path in sorted(payloads)) + "\n"
    ).encode("utf-8")
    return payloads, manifest


def write_snapshot_archive(
    root: Path,
    payloads: dict[str, bytes] | None = None,
    extra_members: tuple[callable, ...] = (),
) -> tuple[Path, dict[str, object], dict[str, bytes]]:
    files, manifest = snapshot_payloads() if payloads is None else (payloads, json.loads(payloads["manifest.json"]))
    archive = root / ARCHIVE_FILE_NAME
    with tarfile.open(archive, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(files):
            write_regular_member(tar, path, files[path])
        for add_member in extra_members:
            add_member(tar)
    return archive, manifest, files


def write_artifact(root: Path, *, repository_root: Path = ROOT) -> tuple[dict[str, object], dict[str, bytes]]:
    archive, manifest, payloads = write_snapshot_archive(root)
    receipt = create_receipt(
        archive,
        market_source_commit=SOURCE_COMMIT,
        validator_source_commit=VALIDATOR_COMMIT,
        repository_root=repository_root,
    )
    write_receipt(receipt, root / RECEIPT_FILE_NAME)
    write_archive_digest(archive)
    return manifest, payloads


def update_receipt_archive_digest(root: Path) -> None:
    receipt_path = root / RECEIPT_FILE_NAME
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["snapshot"]["archiveSha256"] = digest((root / ARCHIVE_FILE_NAME).read_bytes())
    write_receipt(receipt, receipt_path)


class MarketSnapshotReceiptTests(unittest.TestCase):
    def test_create_receipt_uses_canonical_v1_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive, manifest, _ = write_snapshot_archive(root)
            archive_digest = digest(archive.read_bytes())

            receipt = create_receipt(
                archive,
                market_source_commit=SOURCE_COMMIT,
                validator_source_commit=VALIDATOR_COMMIT,
                repository_root=ROOT,
            )
            receipt_path = root / RECEIPT_FILE_NAME
            write_receipt(receipt, receipt_path)

            self.assertEqual(canonical_json_bytes(receipt), receipt_path.read_bytes())

        self.assertEqual(1, receipt["receiptVersion"])
        self.assertEqual(PREDICATE_TYPE, receipt["predicateType"])
        self.assertEqual(archive_digest, receipt["snapshot"]["archiveSha256"])
        self.assertEqual(manifest["snapshotHash"], receipt["snapshot"]["snapshotHash"])
        self.assertEqual("2026-08-13", receipt["snapshot"]["cutoffDate"])
        self.assertEqual(SOURCE_COMMIT, receipt["marketData"]["sourceCommit"])
        self.assertEqual(VALIDATOR_COMMIT, receipt["validation"]["validatorSourceCommit"])
        self.assertEqual("passed", receipt["validation"]["result"])

    def test_contract_digest_has_stable_sorted_allowlist_and_detects_content_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "a.txt").write_text("第一版\n", encoding="utf-8")
            (root / "b.txt").write_text("固定內容\n", encoding="utf-8")

            first = contract_digest(root, ("b.txt", "a.txt"))
            self.assertEqual(first, contract_digest(root, ("a.txt", "b.txt")))

            (root / "a.txt").write_text("第二版\n", encoding="utf-8")
            self.assertNotEqual(first, contract_digest(root, ("a.txt", "b.txt")))

    def test_verify_accepts_trusted_artifact_without_full_market_validator(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, _ = write_artifact(root)

            verified = verify_artifact(root, repository_root=ROOT)

        self.assertEqual(manifest["snapshotHash"], verified.snapshot_hash)
        self.assertEqual("2026-08-13", verified.cutoff_date)
        self.assertEqual(SOURCE_COMMIT, verified.market_source_sha)
        self.assertFalse(hasattr(market_snapshot_receipt, "validate_snapshot"))
        source = Path(market_snapshot_receipt.__file__).read_text(encoding="utf-8")
        self.assertNotIn("from market_snapshot import", source)
        self.assertNotIn("import market_snapshot", source)

    def test_create_and_verify_accept_the_real_v4_snapshot_archive_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            snapshot = root / "snapshot"
            artifact = root / "artifact"
            artifact.mkdir()
            build_input = replace(fixture_build_input(), source_commit=SOURCE_COMMIT)
            manifest = build_snapshot(None, build_input, snapshot)
            archive = artifact / ARCHIVE_FILE_NAME
            shutil.copy2(snapshot / ARCHIVE_FILE_NAME, archive)
            receipt = create_receipt(
                archive,
                market_source_commit=SOURCE_COMMIT,
                validator_source_commit=VALIDATOR_COMMIT,
                repository_root=ROOT,
            )
            write_receipt(receipt, artifact / RECEIPT_FILE_NAME)
            write_archive_digest(archive)

            verified = verify_artifact(artifact, repository_root=ROOT)

        self.assertEqual(manifest.snapshot_hash, verified.snapshot_hash)

    def test_verify_bounds_compressed_archive_and_streams_tar_members(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_artifact(root)
            archive_size = (root / ARCHIVE_FILE_NAME).stat().st_size

            with patch.object(market_snapshot_receipt, "MAX_SNAPSHOT_ARCHIVE_BYTES", archive_size - 1):
                with self.assertRaisesRegex(ReceiptValidationError, "大小超過安全上限"):
                    verify_artifact(root, repository_root=ROOT)

            with patch.object(tarfile.TarFile, "getmembers", side_effect=AssertionError("不可全量讀取 tar header")):
                verified = verify_artifact(root, repository_root=ROOT)

        self.assertEqual(SOURCE_COMMIT, verified.market_source_sha)

    def test_verify_rejects_noncanonical_receipt_and_unknown_security_fields(self) -> None:
        cases = (
            ("noncanonical", lambda receipt: json.dumps(receipt, indent=2, ensure_ascii=False).encode("utf-8"), "canonical"),
            ("unknown-version", lambda receipt: canonical_json_bytes({**receipt, "receiptVersion": 2}), "未知版本"),
            (
                "unknown-result",
                lambda receipt: canonical_json_bytes(
                    {**receipt, "validation": {**receipt["validation"], "result": "pending"}}
                ),
                "result",
            ),
            ("unknown-field", lambda receipt: canonical_json_bytes({**receipt, "extra": True}), "欄位"),
            (
                "wrong-type",
                lambda receipt: canonical_json_bytes(
                    {**receipt, "snapshot": {**receipt["snapshot"], "stockCount": True}}
                ),
                "stockCount",
            ),
        )
        for name, render, message in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                write_artifact(root)
                receipt_path = root / RECEIPT_FILE_NAME
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                receipt_path.write_bytes(render(receipt))

                with self.assertRaisesRegex(ReceiptValidationError, message):
                    verify_artifact(root, repository_root=ROOT)

    def test_verify_rejects_archive_and_inner_digest_tampering(self) -> None:
        for target in (ARCHIVE_FILE_NAME, "manifest.json", "provenance.json", "SHA256SUMS"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                _, payloads = write_artifact(root)
                archive = root / ARCHIVE_FILE_NAME
                if target == ARCHIVE_FILE_NAME:
                    archive.write_bytes(archive.read_bytes() + b"tampered")
                else:
                    tampered = dict(payloads)
                    tampered[target] = tampered[target] + b" "
                    write_snapshot_archive(root, tampered)
                    update_receipt_archive_digest(root)
                if target != ARCHIVE_FILE_NAME:
                    write_archive_digest(archive)

                with self.assertRaises(ReceiptValidationError):
                    verify_artifact(root, repository_root=ROOT)

    def test_verify_rejects_tampered_external_archive_digest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_artifact(root)
            (root / ARCHIVE_DIGEST_FILE_NAME).write_text(
                f"{'0' * 64}  {ARCHIVE_FILE_NAME}\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ReceiptValidationError, "snapshot.tar.gz.sha256"):
                verify_artifact(root, repository_root=ROOT)

    def test_verify_rejects_unsafe_archive_members_and_unknown_files(self) -> None:
        def add_traversal(tar: tarfile.TarFile) -> None:
            write_regular_member(tar, "../escape.json", b"bad")

        def add_absolute(tar: tarfile.TarFile) -> None:
            write_regular_member(tar, "/escape.json", b"bad")

        def add_windows_absolute(tar: tarfile.TarFile) -> None:
            write_regular_member(tar, "C:/escape.json", b"bad")

        def add_symlink(tar: tarfile.TarFile) -> None:
            info = tarfile.TarInfo("data/stocks/link.json")
            info.type = tarfile.SYMTYPE
            info.linkname = "../manifest.json"
            tar.addfile(info)

        def add_hard_link(tar: tarfile.TarFile) -> None:
            info = tarfile.TarInfo("data/stocks/hard-link.json")
            info.type = tarfile.LNKTYPE
            info.linkname = "manifest.json"
            tar.addfile(info)

        def add_device(tar: tarfile.TarFile) -> None:
            info = tarfile.TarInfo("device")
            info.type = tarfile.CHRTYPE
            info.devmajor = 1
            info.devminor = 3
            tar.addfile(info)

        def add_duplicate(tar: tarfile.TarFile) -> None:
            write_regular_member(tar, "manifest.json", b"{}")

        def add_unknown(tar: tarfile.TarFile) -> None:
            write_regular_member(tar, "unexpected.json", b"{}")

        cases = (
            ("path-traversal", add_traversal),
            ("absolute", add_absolute),
            ("windows-absolute", add_windows_absolute),
            ("symlink", add_symlink),
            ("hard-link", add_hard_link),
            ("device", add_device),
            ("duplicate", add_duplicate),
            ("unknown", add_unknown),
        )
        for name, member in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                _, payloads = write_artifact(root)
                archive = root / ARCHIVE_FILE_NAME
                write_snapshot_archive(root, payloads, (member,))
                update_receipt_archive_digest(root)
                write_archive_digest(archive)

                with self.assertRaises(ReceiptValidationError):
                    verify_artifact(root, repository_root=ROOT)

    def test_verify_rejects_changed_contract_digest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            repository_root = root / "repository"
            repository_root.mkdir()
            (repository_root / "generator.txt").write_text("第一版\n", encoding="utf-8")
            (repository_root / "validator.txt").write_text("第一版\n", encoding="utf-8")
            artifact = root / "artifact"
            artifact.mkdir()
            with patch.object(market_snapshot_receipt, "GENERATOR_CONTRACT_FILES", ("generator.txt",)), patch.object(
                market_snapshot_receipt, "VALIDATOR_CONTRACT_FILES", ("validator.txt",)
            ):
                write_artifact(artifact, repository_root=repository_root)
                (repository_root / "generator.txt").write_text("第二版\n", encoding="utf-8")

                with self.assertRaisesRegex(ReceiptValidationError, "生成契約已改變"):
                    verify_artifact(artifact, repository_root=repository_root)

    def test_verify_checks_deployment_market_fields_and_can_extract_only_verified_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            artifact = root / "artifact"
            artifact.mkdir()
            manifest, _ = write_artifact(artifact)
            deployment = root / "deployment.json"
            deployment.write_bytes(
                canonical_json_bytes(
                    {
                        "deploymentVersion": 2,
                        "websiteSourceCommit": VALIDATOR_COMMIT,
                        "marketDataSourceCommit": SOURCE_COMMIT,
                        "snapshotHash": manifest["snapshotHash"],
                        "cutoffDate": "2026-08-13",
                        "marketArtifactId": 123,
                        "marketArtifactDigest": f"sha256:{'d' * 64}",
                        "strategy": "snapshot-reuse",
                    }
                )
            )
            extracted = root / "extracted"

            verified = verify_artifact(
                artifact,
                repository_root=ROOT,
                deployment_metadata=deployment,
                extract_to=extracted,
            )

            self.assertEqual(manifest["snapshotHash"], verified.snapshot_hash)
            self.assertTrue((extracted / "manifest.json").is_file())
            self.assertTrue((extracted / "provenance.json").is_file())
            self.assertTrue((extracted / "SHA256SUMS").is_file())

            invalid = json.loads(deployment.read_text(encoding="utf-8"))
            invalid["snapshotHash"] = "0" * 64
            deployment.write_bytes(canonical_json_bytes(invalid))
            with self.assertRaisesRegex(ReceiptValidationError, "市場欄位不一致"):
                verify_artifact(artifact, repository_root=ROOT, deployment_metadata=deployment)

    def test_cli_create_and_verify_emit_machine_readable_snapshot_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            artifact = Path(temporary_directory)
            archive, manifest, _ = write_snapshot_archive(artifact)
            command = [sys.executable, str(ROOT / "tools" / "market_snapshot_receipt.py")]
            create = subprocess.run(
                [
                    *command,
                    "create",
                    "--archive",
                    str(archive),
                    "--output",
                    str(artifact / RECEIPT_FILE_NAME),
                    "--market-source-commit",
                    SOURCE_COMMIT,
                    "--validator-source-commit",
                    VALIDATOR_COMMIT,
                    "--repository-root",
                    str(ROOT),
                ],
                cwd=ROOT,
                capture_output=True,
                check=False,
                text=True,
            )
            expected = {
                "snapshot_hash": manifest["snapshotHash"],
                "cutoff_date": "2026-08-13",
                "market_source_sha": SOURCE_COMMIT,
            }
            self.assertEqual(0, create.returncode, create.stderr)
            self.assertEqual(canonical_json_bytes(expected).decode("utf-8"), create.stdout)
            self.assertEqual("", create.stderr)
            self.assertTrue((artifact / ARCHIVE_DIGEST_FILE_NAME).is_file())

            verify = subprocess.run(
                [
                    *command,
                    "verify",
                    "--artifact-dir",
                    str(artifact),
                    "--repository-root",
                    str(ROOT),
                ],
                cwd=ROOT,
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(0, verify.returncode, verify.stderr)
            self.assertEqual(canonical_json_bytes(expected).decode("utf-8"), verify.stdout)
            self.assertEqual("", verify.stderr)


if __name__ == "__main__":
    unittest.main()
