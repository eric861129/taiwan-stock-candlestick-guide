from __future__ import annotations

from io import BytesIO
from pathlib import Path
import hashlib
import stat
import sys
import tempfile
import unittest
import zipfile
from collections.abc import Callable


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from market_artifact_archive import (  # noqa: E402
    ArtifactArchiveError,
    verify_and_extract_artifact_zip,
)


MARKET_FILES = {
    "snapshot.tar.gz": b"snapshot",
    "snapshot.tar.gz.sha256": b"digest  snapshot.tar.gz\n",
    "validation-receipt.json": b"{}\n",
}


def write_zip(path: Path, files: dict[str, bytes]) -> str:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in files.items():
            archive.writestr(name, payload)
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


class MarketArtifactArchiveTests(unittest.TestCase):
    def test_market_snapshot_zip_is_digest_bound_and_extracts_only_three_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive = root / "artifact.zip"
            digest = write_zip(archive, MARKET_FILES)
            output = root / "output"

            result = verify_and_extract_artifact_zip(
                archive,
                expected_digest=digest,
                destination=output,
                allowed_kinds=("signed-market-v1",),
            )

            self.assertEqual("signed-market-v1", result.kind)
            self.assertEqual(set(MARKET_FILES), {path.name for path in output.iterdir()})

    def test_legacy_market_zip_is_classified_but_never_accepted_as_signed(self) -> None:
        legacy_files = {
            "snapshot.tar.gz": b"snapshot",
            "manifest.json": b"{}\n",
            "provenance.json": b"{}\n",
            "SHA256SUMS": b"checksums\n",
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive = root / "artifact.zip"
            digest = write_zip(archive, legacy_files)

            with self.assertRaisesRegex(ArtifactArchiveError, "不允許"):
                verify_and_extract_artifact_zip(
                    archive,
                    expected_digest=digest,
                    destination=root / "signed-only",
                    allowed_kinds=("signed-market-v1",),
                )

            result = verify_and_extract_artifact_zip(
                archive,
                expected_digest=digest,
                destination=root / "migration",
                allowed_kinds=("legacy-market-v0",),
            )
            self.assertEqual("legacy-market-v0", result.kind)

    def test_deployment_record_zip_has_an_independent_fixed_file_set(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive = root / "artifact.zip"
            digest = write_zip(archive, {"deployment.json": b"{}\n"})
            result = verify_and_extract_artifact_zip(
                archive,
                expected_digest=digest,
                destination=root / "record",
                allowed_kinds=("deployment-record-v2",),
            )
            self.assertEqual("deployment-record-v2", result.kind)

    def test_digest_mismatch_unknown_files_links_and_traversal_fail_before_publish(self) -> None:
        cases: list[tuple[str, Callable[[Path], None]]] = []

        def wrong_digest(root: Path) -> None:
            archive = root / "artifact.zip"
            write_zip(archive, MARKET_FILES)
            verify_and_extract_artifact_zip(
                archive,
                expected_digest=f"sha256:{'0' * 64}",
                destination=root / "output",
                allowed_kinds=("signed-market-v1",),
            )

        cases.append(("digest", wrong_digest))

        for name, entry_name in (("unknown", "extra.txt"), ("traversal", "../escape.txt")):
            def invalid_name(root: Path, entry_name: str = entry_name) -> None:
                archive = root / "artifact.zip"
                files = {**MARKET_FILES, entry_name: b"bad"}
                digest = write_zip(archive, files)
                verify_and_extract_artifact_zip(
                    archive,
                    expected_digest=digest,
                    destination=root / "output",
                    allowed_kinds=("signed-market-v1",),
                )

            cases.append((name, invalid_name))

        def symlink(root: Path) -> None:
            archive = root / "artifact.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                for entry_name, payload in MARKET_FILES.items():
                    info = zipfile.ZipInfo(entry_name)
                    if entry_name == "snapshot.tar.gz":
                        info.create_system = 3
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    zipped.writestr(info, payload)
            digest = f"sha256:{hashlib.sha256(archive.read_bytes()).hexdigest()}"
            verify_and_extract_artifact_zip(
                archive,
                expected_digest=digest,
                destination=root / "output",
                allowed_kinds=("signed-market-v1",),
            )

        cases.append(("symlink", symlink))

        for name, action in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary_directory:
                with self.assertRaises(ArtifactArchiveError):
                    action(Path(temporary_directory))


if __name__ == "__main__":
    unittest.main()
