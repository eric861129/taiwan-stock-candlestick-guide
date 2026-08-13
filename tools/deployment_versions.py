"""網站程式版本與市場資料版本的部署 metadata 契約。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from collections.abc import Mapping
import json
import re


FULL_GIT_SHA = re.compile(r"[0-9a-f]{40}")
SNAPSHOT_HASH = re.compile(r"[0-9a-f]{64}")
ARTIFACT_DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
DEPLOYMENT_KEYS = frozenset(
    {
        "deploymentVersion",
        "websiteSourceCommit",
        "marketDataSourceCommit",
        "snapshotHash",
        "cutoffDate",
        "marketArtifactId",
        "marketArtifactDigest",
        "strategy",
    }
)
ROLLBACK_SOURCE_KEY = "rollbackSourceDeploymentRecordId"
SNAPSHOT_STRATEGIES = frozenset({"snapshot-reuse", "snapshot-rebuild"})


class DeploymentVersionError(ValueError):
    """部署 metadata 無法與已驗證 snapshot 建立唯一配對。"""


@dataclass(frozen=True)
class DeploymentVersion:
    """一份 Pages artifact 綁定的網站與市場資料版本。"""

    deployment_version: int
    website_source_commit: str
    market_data_source_commit: str
    snapshot_hash: str
    cutoff_date: str
    market_artifact_id: int
    market_artifact_digest: str
    strategy: str
    rollback_source_deployment_record_id: int | None = None
    legacy: bool = False

    def to_document(self) -> dict[str, object]:
        """輸出公開 deployment.json 的穩定 camelCase 契約。"""
        document: dict[str, object] = {
            "deploymentVersion": self.deployment_version,
            "websiteSourceCommit": self.website_source_commit,
            "marketDataSourceCommit": self.market_data_source_commit,
            "snapshotHash": self.snapshot_hash,
            "cutoffDate": self.cutoff_date,
            "marketArtifactId": self.market_artifact_id,
            "marketArtifactDigest": self.market_artifact_digest,
            "strategy": self.strategy,
        }
        if self.rollback_source_deployment_record_id is not None:
            document[ROLLBACK_SOURCE_KEY] = self.rollback_source_deployment_record_id
        return document


def validate_deployment_version(
    manifest_document: object,
    deployment_document: object | None,
) -> DeploymentVersion:
    """驗證 deployment metadata 與 snapshot manifest 的完整配對。

    `deployment_document=None` 只用於讀取功能上線前的舊 artifact；
    它沒有 immutable Artifact 配對，不可作為 v2 rollback 的輸入。
    """
    market_data_source, snapshot_hash, cutoff = _manifest_identity(manifest_document)
    if deployment_document is None:
        return DeploymentVersion(
            deployment_version=0,
            website_source_commit=market_data_source,
            market_data_source_commit=market_data_source,
            snapshot_hash=snapshot_hash,
            cutoff_date=cutoff,
            market_artifact_id=0,
            market_artifact_digest="",
            strategy="legacy",
            legacy=True,
        )
    version = parse_deployment_record(deployment_document)
    if version.market_data_source_commit != market_data_source:
        raise DeploymentVersionError("marketDataSourceCommit 與 manifest 不一致。")
    if version.snapshot_hash != snapshot_hash:
        raise DeploymentVersionError("snapshotHash 與 manifest 不一致。")
    if version.cutoff_date != cutoff:
        raise DeploymentVersionError("cutoffDate 與 manifest 不一致。")
    return version


def parse_deployment_record(deployment_document: object) -> DeploymentVersion:
    """不依賴市場快照，先嚴格解析 rollback deployment record。"""

    if not isinstance(deployment_document, Mapping):
        raise DeploymentVersionError("deployment metadata 必須是 JSON object。")
    keys = set(deployment_document)
    if keys != DEPLOYMENT_KEYS and keys != DEPLOYMENT_KEYS | {ROLLBACK_SOURCE_KEY}:
        raise DeploymentVersionError("deployment metadata 欄位集合無效。")
    if type(deployment_document.get("deploymentVersion")) is not int or deployment_document.get(
        "deploymentVersion"
    ) != 2:
        raise DeploymentVersionError("deploymentVersion 必須是 2。")

    website_source = deployment_document.get("websiteSourceCommit")
    deployment_market_source = deployment_document.get("marketDataSourceCommit")
    deployment_hash = deployment_document.get("snapshotHash")
    deployment_cutoff = deployment_document.get("cutoffDate")
    artifact_id = deployment_document.get("marketArtifactId")
    artifact_digest = deployment_document.get("marketArtifactDigest")
    strategy = deployment_document.get("strategy")
    rollback_source_id = deployment_document.get(ROLLBACK_SOURCE_KEY)
    if not isinstance(website_source, str) or FULL_GIT_SHA.fullmatch(website_source) is None:
        raise DeploymentVersionError("websiteSourceCommit 無效。")
    if not isinstance(deployment_market_source, str) or FULL_GIT_SHA.fullmatch(
        deployment_market_source
    ) is None:
        raise DeploymentVersionError("marketDataSourceCommit 無效。")
    if not isinstance(deployment_hash, str) or SNAPSHOT_HASH.fullmatch(deployment_hash) is None:
        raise DeploymentVersionError("snapshotHash 無效。")
    if not isinstance(deployment_cutoff, str) or ISO_DATE.fullmatch(deployment_cutoff) is None:
        raise DeploymentVersionError("cutoffDate 無效。")
    try:
        date.fromisoformat(deployment_cutoff)
    except ValueError as error:
        raise DeploymentVersionError("cutoffDate 無效。") from error
    if type(artifact_id) is not int or artifact_id < 1:
        raise DeploymentVersionError("marketArtifactId 無效。")
    if not isinstance(artifact_digest, str) or ARTIFACT_DIGEST.fullmatch(artifact_digest) is None:
        raise DeploymentVersionError("marketArtifactDigest 無效。")
    if not isinstance(strategy, str) or strategy not in SNAPSHOT_STRATEGIES:
        raise DeploymentVersionError("strategy 無效。")
    if rollback_source_id is not None and (
        type(rollback_source_id) is not int
        or rollback_source_id < 1
        or strategy != "snapshot-reuse"
    ):
        raise DeploymentVersionError("rollbackSourceDeploymentRecordId 無效。")
    return DeploymentVersion(
        deployment_version=2,
        website_source_commit=website_source,
        market_data_source_commit=deployment_market_source,
        snapshot_hash=deployment_hash,
        cutoff_date=deployment_cutoff,
        market_artifact_id=artifact_id,
        market_artifact_digest=artifact_digest,
        strategy=str(strategy),
        rollback_source_deployment_record_id=rollback_source_id,
    )


def create_deployment_version(
    manifest_document: object,
    *,
    website_source_commit: str,
    market_data_source_commit: str,
    market_artifact_id: int,
    market_artifact_digest: str,
    strategy: str,
    rollback_source_deployment_record_id: int | None = None,
) -> DeploymentVersion:
    """建立後立即用同一契約自我驗證，避免寫出不可 rollback 的 artifact。"""
    _, snapshot_hash, cutoff = _manifest_identity(manifest_document)
    return validate_deployment_version(
        manifest_document,
        {
            "deploymentVersion": 2,
            "websiteSourceCommit": website_source_commit,
            "marketDataSourceCommit": market_data_source_commit,
            "snapshotHash": snapshot_hash,
            "cutoffDate": cutoff,
            "marketArtifactId": market_artifact_id,
            "marketArtifactDigest": market_artifact_digest,
            "strategy": strategy,
            **(
                {ROLLBACK_SOURCE_KEY: rollback_source_deployment_record_id}
                if rollback_source_deployment_record_id is not None
                else {}
            ),
        },
    )


def load_deployment_version(
    manifest_path: Path,
    deployment_path: Path | None,
) -> DeploymentVersion:
    """由 artifact 外層檔案載入並驗證版本配對。"""
    manifest = _read_json(manifest_path, "manifest")
    deployment = _read_json(deployment_path, "deployment metadata") if deployment_path else None
    return validate_deployment_version(manifest, deployment)


def load_deployment_record(deployment_path: Path) -> DeploymentVersion:
    """載入獨立部署紀錄，並拒絕非 canonical JSON 或舊版格式。"""

    try:
        raw = deployment_path.read_bytes()
        deployment = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeploymentVersionError("deployment metadata 無法讀取或不是有效 JSON。") from error
    version = parse_deployment_record(deployment)
    expected = (
        json.dumps(version.to_document(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")
    if raw != expected:
        raise DeploymentVersionError("deployment metadata 必須是 canonical JSON。")
    return version


def write_deployment_version(path: Path, version: DeploymentVersion) -> None:
    """以穩定 JSON 格式寫入候選目錄內的 deployment metadata。"""
    if version.legacy or version.deployment_version != 2:
        raise DeploymentVersionError("舊版 deployment metadata 不可重新寫入 artifact。")
    path.write_bytes(
        (
            json.dumps(
                version.to_document(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            + "\n"
        ).encode("utf-8")
    )


def _manifest_identity(manifest_document: object) -> tuple[str, str, str]:
    if not isinstance(manifest_document, Mapping):
        raise DeploymentVersionError("manifest 必須是 JSON object。")
    source = manifest_document.get("sourceCommit")
    snapshot_hash = manifest_document.get("snapshotHash")
    markets = manifest_document.get("markets")
    if not isinstance(source, str) or FULL_GIT_SHA.fullmatch(source) is None:
        raise DeploymentVersionError("manifest sourceCommit 無效。")
    if not isinstance(snapshot_hash, str) or SNAPSHOT_HASH.fullmatch(snapshot_hash) is None:
        raise DeploymentVersionError("manifest snapshotHash 無效。")
    if not isinstance(markets, Mapping) or not markets:
        raise DeploymentVersionError("manifest markets 無效。")
    if any(not isinstance(value, Mapping) for value in markets.values()):
        raise DeploymentVersionError("manifest markets 含有無效市場資料。")
    cutoffs = {
        value.get("cutoffDate")
        for value in markets.values()
        if isinstance(value, Mapping)
    }
    if len(cutoffs) != 1:
        raise DeploymentVersionError("manifest 市場 cutoff 不一致。")
    cutoff = next(iter(cutoffs))
    if not isinstance(cutoff, str) or ISO_DATE.fullmatch(cutoff) is None:
        raise DeploymentVersionError("manifest cutoffDate 無效。")
    try:
        date.fromisoformat(cutoff)
    except ValueError as error:
        raise DeploymentVersionError("manifest cutoffDate 無效。") from error
    return source, snapshot_hash, cutoff


def _read_json(path: Path, label: str) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeploymentVersionError(f"{label} 無法讀取或不是有效 JSON。") from error
