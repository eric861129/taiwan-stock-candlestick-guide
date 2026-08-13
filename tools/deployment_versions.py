"""網站程式版本與市場資料版本的部署 metadata 契約。"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from collections.abc import Mapping
import json
import re


FULL_GIT_SHA = re.compile(r"[0-9a-f]{40}")
SNAPSHOT_HASH = re.compile(r"[0-9a-f]{64}")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
DEPLOYMENT_KEYS = frozenset(
    {
        "deploymentVersion",
        "websiteSourceCommit",
        "marketDataSourceCommit",
        "snapshotStrategy",
        "snapshotHash",
        "cutoffDate",
    }
)
SNAPSHOT_STRATEGIES = frozenset({"reuse", "rebuild", "refresh", "rollback"})


class DeploymentVersionError(ValueError):
    """部署 metadata 無法與已驗證 snapshot 建立唯一配對。"""


@dataclass(frozen=True)
class DeploymentVersion:
    """一份 Pages artifact 綁定的網站與市場資料版本。"""

    deployment_version: int
    website_source_commit: str
    market_data_source_commit: str
    snapshot_strategy: str
    snapshot_hash: str
    cutoff_date: str
    legacy: bool = False

    def to_document(self) -> dict[str, object]:
        """輸出公開 deployment.json 的穩定 camelCase 契約。"""
        document = asdict(self)
        document.pop("legacy")
        return {
            "deploymentVersion": document["deployment_version"],
            "websiteSourceCommit": document["website_source_commit"],
            "marketDataSourceCommit": document["market_data_source_commit"],
            "snapshotStrategy": document["snapshot_strategy"],
            "snapshotHash": document["snapshot_hash"],
            "cutoffDate": document["cutoff_date"],
        }


def validate_deployment_version(
    manifest_document: object,
    deployment_document: object | None,
) -> DeploymentVersion:
    """驗證 deployment metadata 與 snapshot manifest 的完整配對。

    `deployment_document=None` 只用於讀取功能上線前的四檔舊 artifact；
    其網站版本沿用市場資料 `sourceCommit`，後續重新發布就會升級為 v1。
    """
    market_data_source, snapshot_hash, cutoff = _manifest_identity(manifest_document)
    if deployment_document is None:
        return DeploymentVersion(
            deployment_version=0,
            website_source_commit=market_data_source,
            market_data_source_commit=market_data_source,
            snapshot_strategy="legacy",
            snapshot_hash=snapshot_hash,
            cutoff_date=cutoff,
            legacy=True,
        )
    if not isinstance(deployment_document, Mapping):
        raise DeploymentVersionError("deployment metadata 必須是 JSON object。")
    if set(deployment_document) != DEPLOYMENT_KEYS:
        raise DeploymentVersionError("deployment metadata 欄位集合無效。")
    if type(deployment_document.get("deploymentVersion")) is not int or deployment_document.get(
        "deploymentVersion"
    ) != 1:
        raise DeploymentVersionError("deploymentVersion 必須是 1。")

    website_source = deployment_document.get("websiteSourceCommit")
    deployment_market_source = deployment_document.get("marketDataSourceCommit")
    strategy = deployment_document.get("snapshotStrategy")
    deployment_hash = deployment_document.get("snapshotHash")
    deployment_cutoff = deployment_document.get("cutoffDate")
    if not isinstance(website_source, str) or FULL_GIT_SHA.fullmatch(website_source) is None:
        raise DeploymentVersionError("websiteSourceCommit 無效。")
    if deployment_market_source != market_data_source:
        raise DeploymentVersionError("marketDataSourceCommit 與 manifest 不一致。")
    if not isinstance(strategy, str) or strategy not in SNAPSHOT_STRATEGIES:
        raise DeploymentVersionError("snapshotStrategy 無效。")
    if deployment_hash != snapshot_hash:
        raise DeploymentVersionError("snapshotHash 與 manifest 不一致。")
    if deployment_cutoff != cutoff:
        raise DeploymentVersionError("cutoffDate 與 manifest 不一致。")
    return DeploymentVersion(
        deployment_version=1,
        website_source_commit=website_source,
        market_data_source_commit=market_data_source,
        snapshot_strategy=str(strategy),
        snapshot_hash=snapshot_hash,
        cutoff_date=cutoff,
    )


def create_deployment_version(
    manifest_document: object,
    *,
    website_source_commit: str,
    market_data_source_commit: str,
    snapshot_strategy: str,
) -> DeploymentVersion:
    """建立後立即用同一契約自我驗證，避免寫出不可 rollback 的 artifact。"""
    _, snapshot_hash, cutoff = _manifest_identity(manifest_document)
    return validate_deployment_version(
        manifest_document,
        {
            "deploymentVersion": 1,
            "websiteSourceCommit": website_source_commit,
            "marketDataSourceCommit": market_data_source_commit,
            "snapshotStrategy": snapshot_strategy,
            "snapshotHash": snapshot_hash,
            "cutoffDate": cutoff,
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


def write_deployment_version(path: Path, version: DeploymentVersion) -> None:
    """以穩定 JSON 格式寫入候選目錄內的 deployment metadata。"""
    if version.legacy or version.deployment_version != 1:
        raise DeploymentVersionError("舊版 deployment metadata 不可重新寫入 artifact。")
    path.write_text(
        json.dumps(version.to_document(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
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
