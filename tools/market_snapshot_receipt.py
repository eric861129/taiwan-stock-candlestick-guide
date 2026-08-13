"""建立與快速驗證市場快照 validation receipt。"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date
import hashlib
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
from typing import Any, Iterable, Mapping


RECEIPT_VERSION = 1
PREDICATE_TYPE = "https://eric861129.github.io/attestations/market-snapshot-validation/v1"
SNAPSHOT_VERSION = 4
ARCHIVE_FILE_NAME = "snapshot.tar.gz"
ARCHIVE_DIGEST_FILE_NAME = "snapshot.tar.gz.sha256"
RECEIPT_FILE_NAME = "validation-receipt.json"
INTERNAL_CHECKSUM_FILE_NAME = "SHA256SUMS"
MAX_SNAPSHOT_PAYLOAD_BYTES = 400 * 1024 * 1024
MAX_SNAPSHOT_ARCHIVE_BYTES = 400 * 1024 * 1024
MAX_SNAPSHOT_MEMBER_COUNT = 20_000
MAX_METADATA_BYTES = 1024 * 1024

# 這些清單是收據契約的一部分。新增、移除或變更其中任一檔案都會令舊收據無法重用。
GENERATOR_CONTRACT_FILES = (
    ".github/workflows/bootstrap-market-history.yml",
    ".github/workflows/update-market-data.yml",
    "data/company-action-overrides.json",
    "data/emergency-market-closures.json",
    "data/suspension-intervals.json",
    "tools/market_snapshot.py",
    "tools/market_sources.py",
)
VALIDATOR_CONTRACT_FILES = (
    "tools/market_snapshot.py",
    "tools/market_snapshot_receipt.py",
    "tools/market_sources.py",
)

_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_ARTIFACT_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_CHECKSUM_LINE_PATTERN = re.compile(r"^([0-9a-f]{64})  ([^\r\n]+)$")


class ReceiptValidationError(ValueError):
    """收據、封存檔或快速驗證契約不可信時停止後續部署。"""


@dataclass(frozen=True, slots=True)
class VerifiedSnapshot:
    """快速驗證完成後，可安全交給部署流程使用的快照識別資訊。"""

    snapshot_hash: str
    cutoff_date: str
    market_source_sha: str
    receipt: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class _SnapshotMetadata:
    """從 archive 讀出的最小配對欄位，不重跑市場資料語意規則。"""

    snapshot_hash: str
    cutoff_date: str
    market_source_sha: str
    snapshot_version: int
    stock_count: int
    manifest_sha256: str
    provenance_sha256: str
    checksums_sha256: str
    files: Mapping[str, bytes]


def canonical_json_bytes(value: object) -> bytes:
    """輸出收據使用的版本化 canonical JSON bytes。"""

    try:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ReceiptValidationError("收據 JSON 無法 canonical 化。") from error
    return (text + "\n").encode("utf-8")


def create_receipt(
    archive: Path,
    *,
    market_source_commit: str,
    validator_source_commit: str,
    repository_root: Path,
) -> dict[str, Any]:
    """從已完成完整驗證的 archive 建立 canonical receipt v1。"""

    _require_git_sha(market_source_commit, "市場資料來源 commit")
    _require_git_sha(validator_source_commit, "validator 來源 commit")
    metadata = _read_snapshot_archive(archive)
    if metadata.market_source_sha != market_source_commit:
        raise ReceiptValidationError("市場資料來源 commit 與 manifest／provenance 不一致。")

    return {
        "receiptVersion": RECEIPT_VERSION,
        "predicateType": PREDICATE_TYPE,
        "snapshot": {
            "archiveSha256": _sha256(
                _read_regular_file(
                    archive,
                    "snapshot archive",
                    max_bytes=MAX_SNAPSHOT_ARCHIVE_BYTES,
                )
            ),
            "snapshotHash": metadata.snapshot_hash,
            "snapshotVersion": metadata.snapshot_version,
            "cutoffDate": metadata.cutoff_date,
            "manifestSha256": metadata.manifest_sha256,
            "provenanceSha256": metadata.provenance_sha256,
            "checksumsSha256": metadata.checksums_sha256,
            "stockCount": metadata.stock_count,
        },
        "marketData": {
            "sourceCommit": market_source_commit,
            "generatorContractDigest": contract_digest(repository_root, GENERATOR_CONTRACT_FILES),
            "validatorContractDigest": contract_digest(repository_root, VALIDATOR_CONTRACT_FILES),
        },
        "validation": {
            "validatorSourceCommit": validator_source_commit,
            "result": "passed",
        },
    }


def write_receipt(receipt: Mapping[str, Any], output: Path) -> None:
    """以 canonical JSON 寫入明確指定的收據檔案。"""

    if output.name != RECEIPT_FILE_NAME:
        raise ReceiptValidationError(f"收據檔名必須是 {RECEIPT_FILE_NAME}。")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(canonical_json_bytes(receipt))


def write_archive_digest(archive: Path, output: Path | None = None) -> Path:
    """寫出 Artifact 對 archive 的獨立 SHA-256 檔，避免收據循環相依。"""

    if archive.name != ARCHIVE_FILE_NAME:
        raise ReceiptValidationError(f"snapshot archive 檔名必須是 {ARCHIVE_FILE_NAME}。")
    destination = output or archive.with_name(ARCHIVE_DIGEST_FILE_NAME)
    if destination.name != ARCHIVE_DIGEST_FILE_NAME:
        raise ReceiptValidationError(f"archive digest 檔名必須是 {ARCHIVE_DIGEST_FILE_NAME}。")
    payload = _read_regular_file(
        archive,
        "snapshot archive",
        max_bytes=MAX_SNAPSHOT_ARCHIVE_BYTES,
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(f"{_sha256(payload)}  {ARCHIVE_FILE_NAME}\n", encoding="utf-8", newline="\n")
    return destination


def contract_digest(repository_root: Path, allowlist: Iterable[str]) -> str:
    """以排序後的明確相對路徑與原始 bytes 計算可重現的契約 digest。"""

    normalized_paths = tuple(sorted(set(allowlist)))
    if not normalized_paths:
        raise ReceiptValidationError("契約 allowlist 不可為空白。")
    root = repository_root.resolve()
    digest = hashlib.sha256()
    digest.update(b"market-snapshot-contract-v1\0")
    for relative_path in normalized_paths:
        _require_safe_contract_path(relative_path)
        path = root / relative_path
        if not path.is_file() or path.is_symlink():
            raise ReceiptValidationError(f"契約檔案不存在或不是一般檔案：{relative_path}。")
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
        digest.update(b"\n")
    return digest.hexdigest()


def verify_artifact(
    artifact_directory: Path,
    *,
    repository_root: Path,
    deployment_metadata: Path | None = None,
    extract_to: Path | None = None,
) -> VerifiedSnapshot:
    """快速驗證 Artifact、receipt 與 archive；絕不執行完整市場資料 validator。"""

    artifact_root = artifact_directory.resolve()
    _validate_artifact_file_set(artifact_root)
    archive = artifact_root / ARCHIVE_FILE_NAME
    archive_bytes = _read_regular_file(
        archive,
        "snapshot archive",
        max_bytes=MAX_SNAPSHOT_ARCHIVE_BYTES,
    )
    receipt = _load_canonical_json_object(artifact_root / RECEIPT_FILE_NAME, "validation receipt")
    _validate_receipt_schema(receipt)
    _validate_archive_digest_file(
        artifact_root / ARCHIVE_DIGEST_FILE_NAME,
        expected_archive_sha256=_sha256(archive_bytes),
    )
    if receipt["snapshot"]["archiveSha256"] != _sha256(archive_bytes):
        raise ReceiptValidationError("收據 archiveSha256 與 snapshot archive 不一致。")

    metadata = _read_snapshot_archive_bytes(archive_bytes)
    _validate_receipt_matches_snapshot(receipt, metadata, repository_root)
    if deployment_metadata is not None:
        _validate_deployment_metadata(deployment_metadata, receipt)
    if extract_to is not None:
        _extract_verified_files(metadata.files, extract_to)
    return VerifiedSnapshot(
        snapshot_hash=metadata.snapshot_hash,
        cutoff_date=metadata.cutoff_date,
        market_source_sha=metadata.market_source_sha,
        receipt=receipt,
    )


def _validate_artifact_file_set(artifact_root: Path) -> None:
    if not artifact_root.is_dir() or artifact_root.is_symlink():
        raise ReceiptValidationError("市場 Artifact 根目錄不存在或不安全。")
    expected = {ARCHIVE_FILE_NAME, ARCHIVE_DIGEST_FILE_NAME, RECEIPT_FILE_NAME}
    actual: set[str] = set()
    for child in artifact_root.iterdir():
        if child.is_symlink() or not child.is_file():
            raise ReceiptValidationError("市場 Artifact 含有非一般檔案。")
        actual.add(child.name)
    if actual != expected:
        raise ReceiptValidationError("市場 Artifact 檔案集合不符合固定契約。")


def _read_snapshot_archive(archive: Path) -> _SnapshotMetadata:
    if archive.name != ARCHIVE_FILE_NAME:
        raise ReceiptValidationError(f"snapshot archive 檔名必須是 {ARCHIVE_FILE_NAME}。")
    return _read_snapshot_archive_bytes(
        _read_regular_file(
            archive,
            "snapshot archive",
            max_bytes=MAX_SNAPSHOT_ARCHIVE_BYTES,
        )
    )


def _read_snapshot_archive_bytes(archive_bytes: bytes) -> _SnapshotMetadata:
    files: dict[str, bytes] = {}
    total_size = 0
    try:
        # 串流模式不會先把所有 TarInfo 保留在記憶體；member 數量可在上限處立即中止。
        with tarfile.open(fileobj=BytesIO(archive_bytes), mode="r|gz") as archive:
            member_count = 0
            for member in archive:
                member_count += 1
                if member_count > MAX_SNAPSHOT_MEMBER_COUNT:
                    raise ReceiptValidationError("snapshot archive 檔案數量超過安全上限。")
                name = _safe_archive_member_name(member)
                if name in files:
                    raise ReceiptValidationError("snapshot archive 含有重複檔案。")
                total_size += member.size
                if total_size > MAX_SNAPSHOT_PAYLOAD_BYTES:
                    raise ReceiptValidationError("snapshot archive 解壓後大小超過安全上限。")
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise ReceiptValidationError("snapshot archive 檔案無法讀取。")
                payload = extracted.read()
                if len(payload) != member.size:
                    raise ReceiptValidationError("snapshot archive 檔案大小不一致。")
                files[name] = payload
    except ReceiptValidationError:
        raise
    except (OSError, EOFError, tarfile.TarError) as error:
        raise ReceiptValidationError("snapshot archive 無法解壓或讀取。") from error

    metadata = _snapshot_metadata_from_files(files)
    return _SnapshotMetadata(
        **metadata,
        files=files,
    )


def _safe_archive_member_name(member: tarfile.TarInfo) -> str:
    if not member.isfile() or member.issym() or member.islnk():
        raise ReceiptValidationError("snapshot archive 含有不安全檔案類型。")
    name = member.name
    if not name or "\\" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        raise ReceiptValidationError("snapshot archive 含有不安全檔案路徑。")
    path = PurePosixPath(name)
    if (
        path.is_absolute()
        or ".." in path.parts
        or any(part in {"", "."} for part in path.parts)
        or path.as_posix() != name
    ):
        raise ReceiptValidationError("snapshot archive 含有不安全檔案路徑。")
    return path.as_posix()


def _snapshot_metadata_from_files(files: Mapping[str, bytes]) -> dict[str, Any]:
    required_metadata = {"manifest.json", "provenance.json", INTERNAL_CHECKSUM_FILE_NAME}
    if not required_metadata.issubset(files):
        raise ReceiptValidationError("snapshot archive 缺少必要 metadata 檔案。")
    manifest = _load_json_object_bytes(files["manifest.json"], "manifest.json")
    provenance = _load_json_object_bytes(files["provenance.json"], "provenance.json")

    if _require_exact_int(manifest.get("schemaVersion"), "manifest schemaVersion") != 1:
        raise ReceiptValidationError("snapshot archive 使用未支援的 manifest schemaVersion。")
    snapshot_version = _require_exact_int(manifest.get("snapshotVersion"), "manifest snapshotVersion")
    if snapshot_version != SNAPSHOT_VERSION:
        raise ReceiptValidationError("snapshot archive 使用未支援的 snapshotVersion。")
    snapshot_hash = _require_sha256(manifest.get("snapshotHash"), "manifest snapshotHash")
    market_source_sha = _require_git_sha(manifest.get("sourceCommit"), "manifest sourceCommit")
    manifest_without_hash = dict(manifest)
    manifest_without_hash.pop("snapshotHash", None)
    if _sha256(canonical_json_bytes(manifest_without_hash)) != snapshot_hash:
        raise ReceiptValidationError("manifest snapshotHash 驗證失敗。")

    cutoff_date = _cutoff_date_from_markets(manifest.get("markets"), "manifest")
    stock_paths = _stock_paths_from_manifest(manifest.get("symbols"), files)
    expected_files = {"manifest.json", "provenance.json", INTERNAL_CHECKSUM_FILE_NAME, *stock_paths}
    if set(files) != expected_files:
        raise ReceiptValidationError("snapshot archive 檔案集合不符合固定契約。")
    _validate_internal_checksums(files)

    if _require_exact_int(provenance.get("schemaVersion"), "provenance schemaVersion") != 1:
        raise ReceiptValidationError("snapshot archive 使用未支援的 provenance schemaVersion。")
    provenance_version = _require_exact_int(provenance.get("snapshotVersion"), "provenance snapshotVersion")
    provenance_hash = _require_sha256(provenance.get("snapshotHash"), "provenance snapshotHash")
    provenance_source = _require_git_sha(provenance.get("sourceCommit"), "provenance sourceCommit")
    provenance_cutoff = _cutoff_date_from_markets(provenance.get("markets"), "provenance")
    if (
        provenance_version != snapshot_version
        or provenance_hash != snapshot_hash
        or provenance_source != market_source_sha
        or provenance_cutoff != cutoff_date
    ):
        raise ReceiptValidationError("provenance.json 與 manifest 不一致。")

    return {
        "snapshot_hash": snapshot_hash,
        "cutoff_date": cutoff_date,
        "market_source_sha": market_source_sha,
        "snapshot_version": snapshot_version,
        "stock_count": len(stock_paths),
        "manifest_sha256": _sha256(files["manifest.json"]),
        "provenance_sha256": _sha256(files["provenance.json"]),
        "checksums_sha256": _sha256(files[INTERNAL_CHECKSUM_FILE_NAME]),
    }


def _cutoff_date_from_markets(value: object, label: str) -> str:
    if not isinstance(value, dict) or set(value) != {"TWSE", "TPEx"}:
        raise ReceiptValidationError(f"{label} markets 欄位無效。")
    cutoffs: set[str] = set()
    for market in ("TWSE", "TPEx"):
        market_value = value[market]
        if not isinstance(market_value, dict):
            raise ReceiptValidationError(f"{label} {market} cutoffDate 欄位無效。")
        cutoff = _require_iso_date(market_value.get("cutoffDate"), f"{label} {market} cutoffDate")
        cutoffs.add(cutoff)
    if len(cutoffs) != 1:
        raise ReceiptValidationError(f"{label} 兩個市場的 cutoffDate 不一致。")
    return next(iter(cutoffs))


def _stock_paths_from_manifest(value: object, files: Mapping[str, bytes]) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ReceiptValidationError("manifest symbols 欄位無效。")
    paths: list[str] = []
    for entry in value:
        if not isinstance(entry, dict):
            raise ReceiptValidationError("manifest symbols 包含無效項目。")
        code = entry.get("code")
        data_path = entry.get("dataPath")
        declared_digest = entry.get("digest")
        declared_size = entry.get("size")
        if not isinstance(code, str) or not code or "/" in code or "\\" in code:
            raise ReceiptValidationError("manifest 股票代號無效。")
        digest = _require_sha256(declared_digest, "manifest 股票 digest")
        if not isinstance(data_path, str) or data_path != f"data/stocks/{code}.{digest[:12]}.json":
            raise ReceiptValidationError("manifest 股票 dataPath 不符合固定契約。")
        if not isinstance(declared_size, int) or isinstance(declared_size, bool) or declared_size < 0:
            raise ReceiptValidationError("manifest 股票 size 無效。")
        payload = files.get(data_path)
        if payload is None or len(payload) != declared_size or _sha256(payload) != digest:
            raise ReceiptValidationError("manifest 股票內容與 digest 不一致。")
        paths.append(data_path)
    if len(paths) != len(set(paths)):
        raise ReceiptValidationError("manifest 股票 dataPath 重複。")
    return tuple(sorted(paths))


def _validate_internal_checksums(files: Mapping[str, bytes]) -> None:
    payload = files[INTERNAL_CHECKSUM_FILE_NAME]
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ReceiptValidationError("snapshot archive 內嵌 SHA256SUMS 不是 UTF-8。") from error
    if not text.endswith("\n") or "\r" in text:
        raise ReceiptValidationError("snapshot archive 內嵌 SHA256SUMS 格式無效。")
    expected_paths = sorted(path for path in files if path != INTERNAL_CHECKSUM_FILE_NAME)
    actual_paths: list[str] = []
    for line in text.splitlines():
        match = _CHECKSUM_LINE_PATTERN.fullmatch(line)
        if match is None:
            raise ReceiptValidationError("snapshot archive 內嵌 SHA256SUMS 格式無效。")
        expected_digest, path = match.groups()
        if path not in files or path == INTERNAL_CHECKSUM_FILE_NAME or _sha256(files[path]) != expected_digest:
            raise ReceiptValidationError("snapshot archive 內嵌 SHA256SUMS 驗證失敗。")
        actual_paths.append(path)
    if actual_paths != expected_paths:
        raise ReceiptValidationError("snapshot archive 內嵌 SHA256SUMS 未完整列出固定檔案集合。")


def _validate_receipt_schema(receipt: Mapping[str, Any]) -> None:
    if set(receipt) != {"receiptVersion", "predicateType", "snapshot", "marketData", "validation"}:
        raise ReceiptValidationError("validation receipt 欄位不符合 v1 契約。")
    if _require_exact_int(receipt.get("receiptVersion"), "receiptVersion") != RECEIPT_VERSION:
        raise ReceiptValidationError("validation receipt 使用未知版本。")
    if receipt.get("predicateType") != PREDICATE_TYPE:
        raise ReceiptValidationError("validation receipt predicateType 不受支援。")
    snapshot = _require_object(receipt.get("snapshot"), "snapshot")
    if set(snapshot) != {
        "archiveSha256",
        "snapshotHash",
        "snapshotVersion",
        "cutoffDate",
        "manifestSha256",
        "provenanceSha256",
        "checksumsSha256",
        "stockCount",
    }:
        raise ReceiptValidationError("validation receipt snapshot 欄位不符合 v1 契約。")
    for name in ("archiveSha256", "snapshotHash", "manifestSha256", "provenanceSha256", "checksumsSha256"):
        _require_sha256(snapshot.get(name), f"snapshot {name}")
    if _require_exact_int(snapshot.get("snapshotVersion"), "snapshotVersion") != SNAPSHOT_VERSION:
        raise ReceiptValidationError("validation receipt 使用未支援的 snapshotVersion。")
    _require_iso_date(snapshot.get("cutoffDate"), "snapshot cutoffDate")
    stock_count = snapshot.get("stockCount")
    if not isinstance(stock_count, int) or isinstance(stock_count, bool) or stock_count < 0:
        raise ReceiptValidationError("snapshot stockCount 欄位無效。")

    market_data = _require_object(receipt.get("marketData"), "marketData")
    if set(market_data) != {"sourceCommit", "generatorContractDigest", "validatorContractDigest"}:
        raise ReceiptValidationError("validation receipt marketData 欄位不符合 v1 契約。")
    _require_git_sha(market_data.get("sourceCommit"), "marketData sourceCommit")
    _require_sha256(market_data.get("generatorContractDigest"), "marketData generatorContractDigest")
    _require_sha256(market_data.get("validatorContractDigest"), "marketData validatorContractDigest")

    validation = _require_object(receipt.get("validation"), "validation")
    if set(validation) != {"validatorSourceCommit", "result"}:
        raise ReceiptValidationError("validation receipt validation 欄位不符合 v1 契約。")
    _require_git_sha(validation.get("validatorSourceCommit"), "validation validatorSourceCommit")
    if validation.get("result") != "passed":
        raise ReceiptValidationError("validation receipt result 必須是 passed。")


def _validate_receipt_matches_snapshot(
    receipt: Mapping[str, Any],
    metadata: _SnapshotMetadata,
    repository_root: Path,
) -> None:
    snapshot = receipt["snapshot"]
    if (
        snapshot["snapshotHash"] != metadata.snapshot_hash
        or snapshot["snapshotVersion"] != metadata.snapshot_version
        or snapshot["cutoffDate"] != metadata.cutoff_date
        or snapshot["stockCount"] != metadata.stock_count
        or snapshot["manifestSha256"] != metadata.manifest_sha256
        or snapshot["provenanceSha256"] != metadata.provenance_sha256
        or snapshot["checksumsSha256"] != metadata.checksums_sha256
    ):
        raise ReceiptValidationError("validation receipt 與 snapshot 內容不一致。")
    market_data = receipt["marketData"]
    if market_data["sourceCommit"] != metadata.market_source_sha:
        raise ReceiptValidationError("validation receipt 市場資料來源 commit 不一致。")
    if market_data["generatorContractDigest"] != contract_digest(repository_root, GENERATOR_CONTRACT_FILES):
        raise ReceiptValidationError("市場資料生成契約已改變，舊收據不可重用。")
    if market_data["validatorContractDigest"] != contract_digest(repository_root, VALIDATOR_CONTRACT_FILES):
        raise ReceiptValidationError("市場資料驗證契約已改變，舊收據不可重用。")


def _validate_deployment_metadata(path: Path, receipt: Mapping[str, Any]) -> None:
    deployment = _load_canonical_json_object(path, "deployment metadata")
    required = {
        "deploymentVersion",
        "websiteSourceCommit",
        "marketDataSourceCommit",
        "snapshotHash",
        "cutoffDate",
        "marketArtifactId",
        "marketArtifactDigest",
        "strategy",
    }
    keys = set(deployment)
    rollback_key = "rollbackSourceDeploymentRecordId"
    if keys != required and keys != required | {rollback_key}:
        raise ReceiptValidationError("deployment metadata 欄位不符合固定契約。")
    if _require_exact_int(deployment.get("deploymentVersion"), "deploymentVersion") != 2:
        raise ReceiptValidationError("deployment metadata 使用未知版本。")
    _require_git_sha(deployment.get("websiteSourceCommit"), "websiteSourceCommit")
    _require_git_sha(deployment.get("marketDataSourceCommit"), "marketDataSourceCommit")
    _require_sha256(deployment.get("snapshotHash"), "deployment snapshotHash")
    _require_iso_date(deployment.get("cutoffDate"), "deployment cutoffDate")
    if not isinstance(deployment.get("marketArtifactId"), (int, str)) or isinstance(
        deployment.get("marketArtifactId"), bool
    ):
        raise ReceiptValidationError("deployment metadata marketArtifactId 欄位無效。")
    _require_artifact_digest(deployment.get("marketArtifactDigest"), "marketArtifactDigest")
    if deployment.get("strategy") not in {"snapshot-reuse", "snapshot-rebuild"}:
        raise ReceiptValidationError("deployment metadata strategy 不受支援。")
    rollback_source_id = deployment.get(rollback_key)
    if rollback_source_id is not None and (
        type(rollback_source_id) is not int
        or rollback_source_id < 1
        or deployment.get("strategy") != "snapshot-reuse"
    ):
        raise ReceiptValidationError("deployment metadata rollback 來源無效。")
    snapshot = receipt["snapshot"]
    if (
        deployment["marketDataSourceCommit"] != receipt["marketData"]["sourceCommit"]
        or deployment["snapshotHash"] != snapshot["snapshotHash"]
        or deployment["cutoffDate"] != snapshot["cutoffDate"]
    ):
        raise ReceiptValidationError("deployment metadata 與 validation receipt 市場欄位不一致。")


def _extract_verified_files(files: Mapping[str, bytes], output: Path) -> None:
    destination = output.resolve()
    if destination.exists():
        raise ReceiptValidationError("安全解壓目錄已存在，拒絕覆寫。")
    created_files: list[Path] = []
    created_directories: list[Path] = []
    try:
        destination.mkdir(parents=True)
        created_directories.append(destination)
        for relative_path, payload in sorted(files.items()):
            path = destination / relative_path
            parent = path.parent
            for ancestor in _missing_directories(destination, parent):
                ancestor.mkdir()
                created_directories.append(ancestor)
            path.write_bytes(payload)
            created_files.append(path)
    except OSError as error:
        _cleanup_created_files(created_files, created_directories)
        raise ReceiptValidationError("安全解壓 snapshot archive 時無法寫入。") from error


def _missing_directories(root: Path, target: Path) -> tuple[Path, ...]:
    relative = target.relative_to(root)
    current = root
    missing: list[Path] = []
    for part in relative.parts:
        current /= part
        if current.exists():
            if not current.is_dir() or current.is_symlink():
                raise ReceiptValidationError("安全解壓目的路徑不安全。")
            continue
        missing.append(current)
    return tuple(missing)


def _cleanup_created_files(files: Iterable[Path], directories: Iterable[Path]) -> None:
    for path in reversed(tuple(files)):
        try:
            if path.is_file() and not path.is_symlink():
                path.unlink()
        except OSError:
            pass
    for path in sorted(set(directories), key=lambda item: len(item.parts), reverse=True):
        try:
            if path.is_dir() and not path.is_symlink():
                path.rmdir()
        except OSError:
            pass


def _load_canonical_json_object(path: Path, label: str) -> dict[str, Any]:
    payload = _read_regular_file(path, label, max_bytes=MAX_METADATA_BYTES)
    value = _load_json_object_bytes(payload, label)
    if canonical_json_bytes(value) != payload:
        raise ReceiptValidationError(f"{label} 必須是 canonical JSON。")
    return value


def _load_json_object_bytes(payload: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=_reject_non_finite_json,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ReceiptValidationError) as error:
        raise ReceiptValidationError(f"{label} 不是有效 JSON 物件。") from error
    if not isinstance(value, dict):
        raise ReceiptValidationError(f"{label} 必須是 JSON 物件。")
    return value


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ReceiptValidationError("JSON 不可包含重複欄位。")
        value[key] = item
    return value


def _reject_non_finite_json(value: str) -> None:
    raise ReceiptValidationError(f"JSON 不可使用 {value}。")


def _read_regular_file(path: Path, label: str, *, max_bytes: int | None = None) -> bytes:
    if not path.is_file() or path.is_symlink():
        raise ReceiptValidationError(f"{label} 不存在或不是一般檔案。")
    try:
        with path.open("rb") as handle:
            if max_bytes is None:
                return handle.read()
            payload = handle.read(max_bytes + 1)
            if len(payload) > max_bytes:
                raise ReceiptValidationError(f"{label} 大小超過安全上限。")
            return payload
    except ReceiptValidationError:
        raise
    except OSError as error:
        raise ReceiptValidationError(f"{label} 無法讀取。") from error


def _validate_archive_digest_file(path: Path, *, expected_archive_sha256: str) -> None:
    payload = _read_regular_file(path, "snapshot archive digest", max_bytes=1024)
    expected = f"{expected_archive_sha256}  {ARCHIVE_FILE_NAME}\n".encode("utf-8")
    if payload != expected:
        raise ReceiptValidationError("snapshot.tar.gz.sha256 與 snapshot archive 不一致。")


def _require_object(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ReceiptValidationError(f"{label} 必須是 JSON 物件。")
    return value


def _require_exact_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ReceiptValidationError(f"{label} 必須是整數。")
    return value


def _require_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise ReceiptValidationError(f"{label} 必須是小寫 SHA-256。")
    return value


def _require_git_sha(value: object, label: str) -> str:
    if not isinstance(value, str) or _GIT_SHA_PATTERN.fullmatch(value) is None:
        raise ReceiptValidationError(f"{label} 必須是完整小寫 Git SHA。")
    return value


def _require_artifact_digest(value: object, label: str) -> str:
    """接受 GitHub REST 的 `sha256:<hex>` 與 workflow output 的純 SHA-256。"""

    if not isinstance(value, str) or (
        _SHA256_PATTERN.fullmatch(value) is None and _ARTIFACT_DIGEST_PATTERN.fullmatch(value) is None
    ):
        raise ReceiptValidationError(f"{label} 必須是 SHA-256 或 sha256:SHA-256。")
    return value


def _require_iso_date(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ReceiptValidationError(f"{label} 必須是 ISO 日期。")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ReceiptValidationError(f"{label} 必須是 ISO 日期。") from error
    if parsed.isoformat() != value:
        raise ReceiptValidationError(f"{label} 必須是 ISO 日期。")
    return value


def _require_safe_contract_path(relative_path: str) -> None:
    path = PurePosixPath(relative_path)
    if (
        not relative_path
        or "\\" in relative_path
        or path.is_absolute()
        or ".." in path.parts
        or any(part in {"", "."} for part in path.parts)
        or path.as_posix() != relative_path
    ):
        raise ReceiptValidationError("契約 allowlist 包含不安全路徑。")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="建立或快速驗證市場快照 validation receipt")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create", help="建立 canonical validation receipt 與 archive digest")
    create.add_argument("--archive", type=Path, required=True)
    create.add_argument("--output", type=Path, required=True)
    create.add_argument("--market-source-commit", required=True)
    create.add_argument("--validator-source-commit", required=True)
    create.add_argument("--repository-root", type=Path, required=True)

    verify = commands.add_parser("verify", help="快速驗證不可變市場 Artifact")
    verify.add_argument("--artifact-dir", type=Path, required=True)
    verify.add_argument("--repository-root", type=Path, required=True)
    verify.add_argument("--deployment-metadata", type=Path)
    verify.add_argument("--extract-to", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """提供 workflow 可呼叫的 create／verify CLI，stdout 僅輸出機器可解析摘要。"""

    try:
        args = _parse_args(argv)
        if args.command == "create":
            receipt = create_receipt(
                args.archive,
                market_source_commit=args.market_source_commit,
                validator_source_commit=args.validator_source_commit,
                repository_root=args.repository_root,
            )
            write_receipt(receipt, args.output)
            write_archive_digest(args.archive)
            verified = VerifiedSnapshot(
                snapshot_hash=receipt["snapshot"]["snapshotHash"],
                cutoff_date=receipt["snapshot"]["cutoffDate"],
                market_source_sha=receipt["marketData"]["sourceCommit"],
                receipt=receipt,
            )
        else:
            verified = verify_artifact(
                args.artifact_dir,
                repository_root=args.repository_root,
                deployment_metadata=args.deployment_metadata,
                extract_to=args.extract_to,
            )
        sys.stdout.write(
            canonical_json_bytes(
                {
                    "snapshot_hash": verified.snapshot_hash,
                    "cutoff_date": verified.cutoff_date,
                    "market_source_sha": verified.market_source_sha,
                    "receipt_version": verified.receipt["receiptVersion"],
                    "validator_contract_digest": verified.receipt["marketData"][
                        "validatorContractDigest"
                    ],
                }
            ).decode("utf-8")
        )
        return 0
    except (ReceiptValidationError, OSError) as error:
        print(f"市場快照收據驗證失敗：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
