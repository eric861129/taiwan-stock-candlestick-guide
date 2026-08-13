"""驗證 GitHub Actions Artifact ZIP digest 並依固定契約安全解壓。"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from typing import Iterable
import zipfile


MAX_ARTIFACT_ARCHIVE_BYTES = 400 * 1024 * 1024
MAX_ARTIFACT_PAYLOAD_BYTES = 400 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
SIGNED_MARKET_FILES = frozenset(
    {"snapshot.tar.gz", "snapshot.tar.gz.sha256", "validation-receipt.json"}
)
LEGACY_MARKET_FILE_SETS = (
    frozenset({"snapshot.tar.gz", "manifest.json", "provenance.json", "SHA256SUMS"}),
    frozenset(
        {"snapshot.tar.gz", "manifest.json", "provenance.json", "SHA256SUMS", "deployment.json"}
    ),
)
DEPLOYMENT_RECORD_FILES = frozenset({"deployment.json"})
SUPPORTED_KINDS = frozenset({"signed-market-v1", "legacy-market-v0", "deployment-record-v2"})
_DIGEST_PATTERN = re.compile(r"^sha256:([0-9a-f]{64})$")


class ArtifactArchiveError(ValueError):
    """Artifact ZIP 不符合不可變 digest 或固定檔案契約時停止。"""


@dataclass(frozen=True, slots=True)
class ExtractedArtifact:
    """完成 digest 與固定檔案集合驗證後的 Artifact。"""

    kind: str
    destination: Path


def verify_and_extract_artifact_zip(
    archive: Path,
    *,
    expected_digest: str,
    destination: Path,
    allowed_kinds: Iterable[str],
) -> ExtractedArtifact:
    """在解壓前驗 GitHub ZIP digest，再以固定白名單逐檔安全寫出。"""

    allowed = frozenset(allowed_kinds)
    if not allowed or not allowed.issubset(SUPPORTED_KINDS):
        raise ArtifactArchiveError("Artifact kind allowlist 無效。")
    digest_match = _DIGEST_PATTERN.fullmatch(expected_digest)
    if digest_match is None:
        raise ArtifactArchiveError("Artifact digest 必須是 canonical sha256 digest。")
    archive = archive.resolve()
    if not archive.is_file() or archive.is_symlink():
        raise ArtifactArchiveError("Artifact ZIP 不存在或不是一般檔案。")
    if archive.stat().st_size > MAX_ARTIFACT_ARCHIVE_BYTES:
        raise ArtifactArchiveError("Artifact ZIP 超過 400 MiB 安全上限。")
    if _file_sha256(archive) != digest_match.group(1):
        raise ArtifactArchiveError("Artifact ZIP digest 與 GitHub provenance 不一致。")

    files: dict[str, zipfile.ZipInfo] = {}
    total_size = 0
    try:
        with zipfile.ZipFile(archive, "r") as zipped:
            for info in zipped.infolist():
                name = _safe_member_name(info)
                if name in files:
                    raise ArtifactArchiveError("Artifact ZIP 含有重複檔案。")
                total_size += info.file_size
                if total_size > MAX_ARTIFACT_PAYLOAD_BYTES:
                    raise ArtifactArchiveError("Artifact ZIP 解壓後超過 400 MiB 安全上限。")
                files[name] = info
            kind = _artifact_kind(frozenset(files))
            if kind not in allowed:
                raise ArtifactArchiveError(f"Artifact 類型 {kind} 不允許用於此流程。")
            _extract_files(zipped, files, destination.resolve())
    except ArtifactArchiveError:
        raise
    except (OSError, EOFError, zipfile.BadZipFile, RuntimeError) as error:
        raise ArtifactArchiveError("Artifact ZIP 無法安全讀取或解壓。") from error
    return ExtractedArtifact(kind=kind, destination=destination.resolve())


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_member_name(info: zipfile.ZipInfo) -> str:
    name = info.filename
    path = PurePosixPath(name)
    unix_mode = info.external_attr >> 16
    file_type = stat.S_IFMT(unix_mode)
    if (
        info.is_dir()
        or info.flag_bits & 0x1
        or file_type not in {0, stat.S_IFREG}
        or not name
        or "\\" in name
        or name.startswith("/")
        or re.match(r"^[A-Za-z]:", name)
        or path.is_absolute()
        or len(path.parts) != 1
        or path.parts[0] in {"", ".", ".."}
        or path.as_posix() != name
    ):
        raise ArtifactArchiveError("Artifact ZIP 含有不安全檔案路徑或型態。")
    return name


def _artifact_kind(names: frozenset[str]) -> str:
    if names == SIGNED_MARKET_FILES:
        return "signed-market-v1"
    if names in LEGACY_MARKET_FILE_SETS:
        return "legacy-market-v0"
    if names == DEPLOYMENT_RECORD_FILES:
        return "deployment-record-v2"
    raise ArtifactArchiveError("Artifact ZIP 檔案集合不符合固定契約。")


def _extract_files(
    zipped: zipfile.ZipFile,
    files: dict[str, zipfile.ZipInfo],
    destination: Path,
) -> None:
    if destination.exists():
        raise ArtifactArchiveError("Artifact 解壓目錄已存在，拒絕覆寫。")
    created: list[Path] = []
    try:
        destination.mkdir(parents=True)
        for name, info in sorted(files.items()):
            target = destination / name
            written = 0
            created.append(target)
            with zipped.open(info, "r") as source, target.open("xb") as output:
                while chunk := source.read(CHUNK_SIZE):
                    written += len(chunk)
                    if written > info.file_size:
                        raise ArtifactArchiveError("Artifact ZIP 檔案大小超出宣告值。")
                    output.write(chunk)
            if written != info.file_size:
                raise ArtifactArchiveError("Artifact ZIP 檔案大小與宣告值不一致。")
    except Exception:
        for target in reversed(created):
            try:
                target.unlink()
            except OSError:
                pass
        try:
            destination.rmdir()
        except OSError:
            pass
        raise


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="驗證並安全解壓 GitHub Actions Artifact ZIP")
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--expected-digest", required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--allow-kind", action="append", required=True, choices=sorted(SUPPORTED_KINDS))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parse_args(argv)
        result = verify_and_extract_artifact_zip(
            args.archive,
            expected_digest=args.expected_digest,
            destination=args.destination,
            allowed_kinds=args.allow_kind,
        )
        print(json.dumps({"artifact_kind": result.kind}, separators=(",", ":"), sort_keys=True))
        return 0
    except ArtifactArchiveError as error:
        print(f"Artifact ZIP 驗證失敗：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
