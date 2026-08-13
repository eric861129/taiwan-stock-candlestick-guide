"""判定 Pages 部署應重用既有市場快照，或由資料流程重建。"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re
import subprocess


FULL_GIT_SHA = re.compile(r"[0-9a-f]{40}")
MARKET_WORKFLOWS = frozenset(
    {
        ".github/workflows/bootstrap-market-history.yml",
        ".github/workflows/deploy-pages.yml",
        ".github/workflows/update-market-data.yml",
    }
)


class SnapshotModeError(RuntimeError):
    """Git 歷史不足或來源不可信，無法安全決定 snapshot 策略。"""


@dataclass(frozen=True)
class SnapshotModeDecision:
    """網站版本相對於市場資料版本的可稽核分流結果。"""

    mode: str
    market_data_source_sha: str
    website_source_sha: str
    changed_paths: tuple[str, ...]
    data_impact_paths: tuple[str, ...]


def classify_snapshot_mode(
    repository: Path,
    market_data_source_sha: str,
    website_source_sha: str,
) -> SnapshotModeDecision:
    """依兩個 commit 間的實際變更判定可否重用已驗證市場快照。

    市場資料版本必須是網站版本的祖先，避免把不同歷史的 artifact
    混入目前站台。只有市場資料程式、官方證據資料或資料部署契約改變
    才回傳 ``rebuild``；其他教材與前端修改回傳 ``reuse``。
    """
    repository = repository.resolve()
    if not repository.is_dir():
        raise SnapshotModeError(f"Git repository 不存在：{repository}")
    _validate_sha(market_data_source_sha, "市場資料 source SHA")
    _validate_sha(website_source_sha, "網站 source SHA")
    _require_commit(repository, market_data_source_sha, "市場資料 source SHA")
    _require_commit(repository, website_source_sha, "網站 source SHA")

    ancestry = _run_git(
        repository,
        "merge-base",
        "--is-ancestor",
        market_data_source_sha,
        website_source_sha,
        check=False,
    )
    if ancestry.returncode == 1:
        raise SnapshotModeError("市場資料版本不是網站版本的祖先，拒絕重用 snapshot。")
    if ancestry.returncode != 0:
        raise SnapshotModeError(f"無法驗證 Git 祖先關係：{_stderr(ancestry)}")

    diff = _run_git(
        repository,
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        market_data_source_sha,
        website_source_sha,
    )
    changed_paths = tuple(
        sorted(
            {
                path
                for path in diff.stdout.split("\0")
                if path and _is_safe_repository_path(path)
            }
        )
    )
    data_impact_paths = tuple(path for path in changed_paths if _affects_market_data(path))
    return SnapshotModeDecision(
        mode="rebuild" if data_impact_paths else "reuse",
        market_data_source_sha=market_data_source_sha,
        website_source_sha=website_source_sha,
        changed_paths=changed_paths,
        data_impact_paths=data_impact_paths,
    )


def _affects_market_data(path: str) -> bool:
    normalized = PurePosixPath(path).as_posix()
    return (
        normalized.startswith("data/")
        or (
            normalized.startswith("tools/market_")
            and normalized.endswith(".py")
            and "/" not in normalized.removeprefix("tools/")
        )
        or normalized in MARKET_WORKFLOWS
    )


def _is_safe_repository_path(path: str) -> bool:
    candidate = PurePosixPath(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise SnapshotModeError("Git diff 回傳 repository 外路徑，拒絕判定 snapshot 策略。")
    return True


def _validate_sha(value: str, label: str) -> None:
    if FULL_GIT_SHA.fullmatch(value) is None:
        raise SnapshotModeError(f"{label} 必須是完整的小寫 Git commit SHA。")


def _require_commit(repository: Path, sha: str, label: str) -> None:
    result = _run_git(repository, "cat-file", "-e", f"{sha}^{{commit}}", check=False)
    if result.returncode != 0:
        raise SnapshotModeError(f"{label} 在目前 Git 歷史中不存在。")


def _run_git(
    repository: Path,
    *arguments: str,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ("git", "-C", str(repository), *arguments),
            check=check,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except (OSError, subprocess.CalledProcessError) as error:
        detail = ""
        if isinstance(error, subprocess.CalledProcessError):
            detail = _stderr(error)
        raise SnapshotModeError(f"無法讀取 Git 歷史：{detail or error}") from error


def _stderr(result: subprocess.CompletedProcess[str] | subprocess.CalledProcessError) -> str:
    stderr = result.stderr if isinstance(result.stderr, str) else ""
    return stderr.strip() or "git command failed"


def main(argv: list[str] | None = None) -> int:
    """CLI：輸出可直接附加至 GitHub Actions GITHUB_OUTPUT 的欄位。"""
    parser = argparse.ArgumentParser(description="判定 Pages 部署的市場 snapshot 策略")
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--market-data-source-sha", required=True)
    parser.add_argument("--website-source-sha", required=True)
    arguments = parser.parse_args(argv)
    try:
        decision = classify_snapshot_mode(
            arguments.repository,
            arguments.market_data_source_sha,
            arguments.website_source_sha,
        )
    except SnapshotModeError as error:
        parser.exit(1, f"錯誤：{error}\n")

    print(f"snapshot_strategy={decision.mode}")
    print(f"market_data_source_sha={decision.market_data_source_sha}")
    print(f"website_source_sha={decision.website_source_sha}")
    print(f"changed_path_count={len(decision.changed_paths)}")
    print(f"data_impact_path_count={len(decision.data_impact_paths)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
