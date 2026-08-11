"""查詢可安全重用的 GitHub Actions 市場快照 artifact。"""

from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
import re
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


MAX_ARTIFACT_PAGES = 10
MARKET_SNAPSHOT_PREFIX = "market-snapshot-"


class GitHubArtifactQueryError(RuntimeError):
    """GitHub artifact API 回應不完整、無法驗證或超過安全分頁上限。"""


@dataclass(frozen=True)
class SuccessfulMarketSnapshot:
    """已確認所屬 workflow 成功的市場快照 artifact 識別資料。"""

    artifact_id: int
    workflow_run_id: int
    created_at: datetime


PageFetcher = Callable[[str], tuple[object, object]]
RunFetcher = Callable[[int], object]


def find_latest_successful_market_snapshot(
    fetch_page: PageFetcher,
    fetch_run: RunFetcher,
    first_page_url: str,
    *,
    max_pages: int = MAX_ARTIFACT_PAGES,
) -> SuccessfulMarketSnapshot | None:
    """沿 GitHub Link 分頁尋找最新可用成功市場快照，否則回傳 None。

    API 宣告仍有下一頁但超過上限、回應結構不完整、或 Link 改變 API
    origin/path 時一律失敗，不把「無法完整查詢」誤當成「沒有舊快照」。
    所有頁面都掃描後才依 artifact created_at 選出最新成功快照。
    """
    if max_pages < 1:
        raise ValueError("max_pages 必須至少為 1。")

    _validate_page_url(first_page_url, first_page_url)
    next_page_url: str | None = first_page_url
    seen_page_urls: set[str] = set()
    scanned_artifact_count = 0
    declared_total_count: int | None = None
    latest_snapshot: SuccessfulMarketSnapshot | None = None

    for _ in range(max_pages):
        if next_page_url is None:
            return None
        if next_page_url in seen_page_urls:
            raise GitHubArtifactQueryError("artifact Link pagination 出現重複頁面，拒絕回退到 bootstrap。")
        seen_page_urls.add(next_page_url)

        response, headers = fetch_page(next_page_url)
        total_count, artifacts = _validate_artifact_page(response)
        if declared_total_count is None:
            declared_total_count = total_count
        elif total_count != declared_total_count:
            raise GitHubArtifactQueryError("artifact API total_count 前後不一致，拒絕使用不完整查詢結果。")

        scanned_artifact_count += len(artifacts)
        for artifact in artifacts:
            candidate = _successful_snapshot_from_artifact(artifact, fetch_run)
            if candidate is not None and (
                latest_snapshot is None
                or (candidate.created_at, candidate.artifact_id)
                > (latest_snapshot.created_at, latest_snapshot.artifact_id)
            ):
                latest_snapshot = candidate

        following_page_url = _next_page_url(headers)
        if following_page_url is None:
            if declared_total_count is not None and scanned_artifact_count != declared_total_count:
                raise GitHubArtifactQueryError("artifact API 清單總數不一致，拒絕使用不完整清單。")
            return latest_snapshot
        _validate_page_url(first_page_url, following_page_url)
        next_page_url = following_page_url

    raise GitHubArtifactQueryError(
        f"artifact Link pagination 超過 {max_pages} 頁上限，拒絕回退到 bootstrap。"
    )


def query_successful_market_snapshot(
    api_url: str,
    repository: str,
    token: str,
    *,
    max_pages: int = MAX_ARTIFACT_PAGES,
) -> SuccessfulMarketSnapshot | None:
    """以 GitHub REST API 查詢上一個有效成功快照。"""
    if not token:
        raise GitHubArtifactQueryError("缺少 GitHub API token。")
    base_url = api_url.rstrip("/")
    _validate_api_base_url(base_url)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise GitHubArtifactQueryError("GitHub repository 格式無效。")

    first_page_url = f"{base_url}/repos/{repository}/actions/artifacts?per_page=100"

    def fetch_page(url: str) -> tuple[object, object]:
        return _fetch_json(url, token)

    def fetch_run(run_id: int) -> object:
        response, _ = _fetch_json(f"{base_url}/repos/{repository}/actions/runs/{run_id}", token)
        return response

    return find_latest_successful_market_snapshot(fetch_page, fetch_run, first_page_url, max_pages=max_pages)


def _validate_artifact_page(response: object) -> tuple[int, list[Mapping[str, object]]]:
    if not isinstance(response, Mapping):
        raise GitHubArtifactQueryError("artifact API 回應必須是 JSON object。")
    total_count = response.get("total_count")
    artifacts = response.get("artifacts")
    if isinstance(total_count, bool) or not isinstance(total_count, int) or total_count < 0:
        raise GitHubArtifactQueryError("artifact API 缺少有效 total_count。")
    if not isinstance(artifacts, list) or len(artifacts) > 100:
        raise GitHubArtifactQueryError("artifact API 缺少有效 artifacts 分頁。")
    checked_artifacts: list[Mapping[str, object]] = []
    for artifact in artifacts:
        if not isinstance(artifact, Mapping):
            raise GitHubArtifactQueryError("artifact API 清單含有非 object 項目。")
        checked_artifacts.append(artifact)
    return total_count, checked_artifacts


def _successful_snapshot_from_artifact(
    artifact: Mapping[str, object], fetch_run: RunFetcher
) -> SuccessfulMarketSnapshot | None:
    name = artifact.get("name")
    expired = artifact.get("expired")
    if not isinstance(name, str) or not isinstance(expired, bool):
        raise GitHubArtifactQueryError("artifact API 清單缺少 name 或 expired 欄位。")
    if expired or not name.startswith(MARKET_SNAPSHOT_PREFIX):
        return None

    artifact_id = _positive_integer(artifact.get("id"), "artifact ID")
    workflow_run = artifact.get("workflow_run")
    if not isinstance(workflow_run, Mapping):
        raise GitHubArtifactQueryError("市場 snapshot artifact 缺少 workflow_run。")
    workflow_run_id = _positive_integer(workflow_run.get("id"), "workflow run ID")
    created_at = _parse_created_at(artifact.get("created_at"))

    run = fetch_run(workflow_run_id)
    if not isinstance(run, Mapping):
        raise GitHubArtifactQueryError("市場 snapshot workflow run 回應必須是 JSON object。")
    conclusion = run.get("conclusion")
    if not isinstance(conclusion, str):
        raise GitHubArtifactQueryError("市場 snapshot workflow run 缺少 conclusion。")
    if conclusion != "success":
        return None
    return SuccessfulMarketSnapshot(
        artifact_id=artifact_id,
        workflow_run_id=workflow_run_id,
        created_at=created_at,
    )


def _positive_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise GitHubArtifactQueryError(f"{label} 必須是正整數。")
    return value


def _parse_created_at(value: object) -> datetime:
    if not isinstance(value, str):
        raise GitHubArtifactQueryError("市場 snapshot artifact 缺少 created_at。")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise GitHubArtifactQueryError("市場 snapshot artifact 的 created_at 格式無效。") from error
    if parsed.tzinfo is None:
        raise GitHubArtifactQueryError("市場 snapshot artifact 的 created_at 必須包含時區。")
    return parsed.astimezone(timezone.utc)


def _next_page_url(headers: object) -> str | None:
    if not isinstance(headers, Mapping):
        raise GitHubArtifactQueryError("artifact API response headers 無法讀取。")
    link_value: object | None = None
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == "link":
            link_value = value
            break
    if link_value is None:
        return None
    if not isinstance(link_value, str):
        raise GitHubArtifactQueryError("artifact API Link header 格式無效。")

    next_url: str | None = None
    for item in link_value.split(","):
        match = re.fullmatch(r'\s*<([^>]+)>\s*;\s*rel="([^"]+)"\s*', item)
        if match is None:
            raise GitHubArtifactQueryError("artifact API Link header 格式無效。")
        if "next" in match.group(2).split():
            if next_url is not None:
                raise GitHubArtifactQueryError("artifact API Link header 含有多個 next 頁面。")
            next_url = match.group(1)
    return next_url


def _validate_api_base_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise GitHubArtifactQueryError("GitHub API URL 必須是乾淨的 HTTPS base URL。")


def _validate_page_url(first_page_url: str, candidate_url: str) -> None:
    first = urlsplit(first_page_url)
    candidate = urlsplit(candidate_url)
    if (
        candidate.scheme != "https"
        or candidate.scheme != first.scheme
        or candidate.netloc != first.netloc
        or candidate.path != first.path
        or not candidate.query
        or candidate.fragment
    ):
        raise GitHubArtifactQueryError("artifact pagination Link 離開預期 GitHub API endpoint。")


def _fetch_json(url: str, token: str) -> tuple[object, dict[str, str]]:
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "taiwan-stock-candlestick-guide",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:  # nosec B310: URL 已驗證為 GitHub API endpoint
            payload = json.loads(response.read().decode("utf-8"))
            headers = {str(key): str(value) for key, value in response.headers.items()}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GitHubArtifactQueryError("GitHub artifact API 無法取得或不是有效 JSON。") from error
    return payload, headers


def main(argv: list[str] | None = None) -> int:
    """CLI：將有效 artifact ID 寫為 GitHub Actions step outputs。"""
    parser = argparse.ArgumentParser(description="查詢上一個可用的 GitHub Actions 市場快照 artifact")
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--max-pages", type=int, default=MAX_ARTIFACT_PAGES)
    arguments = parser.parse_args(argv)
    try:
        result = query_successful_market_snapshot(
            arguments.api_url,
            arguments.repository,
            os.environ.get("GITHUB_TOKEN", ""),
            max_pages=arguments.max_pages,
        )
    except (GitHubArtifactQueryError, ValueError) as error:
        parser.exit(1, f"錯誤：{error}\n")

    if result is None:
        print("artifact_id=")
        print("artifact_run_id=")
    else:
        print(f"artifact_id={result.artifact_id}")
        print(f"artifact_run_id={result.workflow_run_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
