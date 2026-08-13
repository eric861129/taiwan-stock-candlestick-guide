"""網站版本與市場資料版本分流的公開契約測試。"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from deployment_snapshot_mode import (  # noqa: E402
    SnapshotModeError,
    classify_snapshot_mode,
)


class DeploymentSnapshotModeTests(unittest.TestCase):
    """以真正的 Git 歷史驗證 workflow 可安全重用既有市場快照。"""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repository = Path(self.temporary_directory.name)
        self._git("init", "--initial-branch=main")
        self._git("config", "user.name", "測試使用者")
        self._git("config", "user.email", "test@example.com")
        self._write("src/app.ts", "export const title = '初版';\n")
        self._write("tools/market_snapshot.py", "SNAPSHOT_VERSION = 4\n")
        self._write("data/emergency-market-closures.json", "[]\n")
        self.market_data_sha = self._commit("建立市場資料版本")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_reuses_verified_snapshot_across_multiple_frontend_commits(self) -> None:
        self._write("src/app.ts", "export const title = '新版介面';\n")
        self._commit("調整前端")
        self._write("docs/index.md", "# 初學者首頁\n")
        website_sha = self._commit("調整教材")

        decision = classify_snapshot_mode(self.repository, self.market_data_sha, website_sha)

        self.assertEqual("reuse", decision.mode)
        self.assertEqual("non-market-only", decision.reason)
        self.assertEqual((), decision.data_impact_paths)
        self.assertEqual(("docs/index.md", "src/app.ts"), decision.changed_paths)

    def test_reuses_snapshot_for_the_real_markdown_learning_content(self) -> None:
        self._write("chapters/01-basics.md", "# K 線基礎\n")
        self._write("pattern-cards/double-top.md", "# 雙重頂\n")
        self._write("index.md", "# 學習首頁\n")
        self._write("assets/learning-map.svg", "<svg></svg>\n")
        website_sha = self._commit("更新教材")

        decision = classify_snapshot_mode(self.repository, self.market_data_sha, website_sha)

        self.assertEqual("reuse", decision.mode)
        self.assertEqual("non-market-only", decision.reason)
        self.assertEqual((), decision.data_impact_paths)

    def test_rebuilds_when_market_program_changes(self) -> None:
        self._write("tools/market_sources.py", "OFFICIAL_SOURCE = 'TWSE'\n")
        website_sha = self._commit("調整市場資料來源")

        decision = classify_snapshot_mode(self.repository, self.market_data_sha, website_sha)

        self.assertEqual("rebuild", decision.mode)
        self.assertEqual("market-contract:tools/market_sources.py", decision.reason)
        self.assertEqual(("tools/market_sources.py",), decision.data_impact_paths)

    def test_unknown_new_helper_fails_safe_to_rebuild(self) -> None:
        self._write("tools/nonmarket_helper.py", "VALUE = 1\n")
        website_sha = self._commit("新增未知工具")

        decision = classify_snapshot_mode(self.repository, self.market_data_sha, website_sha)

        self.assertEqual("rebuild", decision.mode)
        self.assertEqual(("tools/nonmarket_helper.py",), decision.data_impact_paths)

    def test_unknown_workflow_fails_safe_to_rebuild(self) -> None:
        self._write(".github/workflows/new-pipeline.yml", "name: unknown\n")
        website_sha = self._commit("新增未知 workflow")

        decision = classify_snapshot_mode(self.repository, self.market_data_sha, website_sha)

        self.assertEqual("rebuild", decision.mode)
        self.assertEqual((".github/workflows/new-pipeline.yml",), decision.data_impact_paths)

    def test_market_deploy_or_schedule_workflow_change_rebuilds(self) -> None:
        self._write(".github/workflows/deploy-pages.yml", "name: faster pages\n")
        pages_sha = self._commit("加速 Pages")

        pages_decision = classify_snapshot_mode(self.repository, self.market_data_sha, pages_sha)

        self.assertEqual("rebuild", pages_decision.mode)
        self.assertEqual(
            (".github/workflows/deploy-pages.yml",),
            pages_decision.data_impact_paths,
        )
        self._write(".github/workflows/update-market-data.yml", "name: refresh market data\n")
        market_workflow_sha = self._commit("調整市場排程")

        market_decision = classify_snapshot_mode(
            self.repository,
            self.market_data_sha,
            market_workflow_sha,
        )

        self.assertEqual("rebuild", market_decision.mode)
        self.assertEqual(
            (
                ".github/workflows/deploy-pages.yml",
                ".github/workflows/update-market-data.yml",
            ),
            market_decision.data_impact_paths,
        )

    def test_rebuilds_when_official_evidence_or_frontend_changes_together(self) -> None:
        self._write("data/emergency-market-closures.json", '["2026-08-13"]\n')
        self._write("src/app.ts", "export const title = '同步更新';\n")
        website_sha = self._commit("同步資料與介面")

        decision = classify_snapshot_mode(self.repository, self.market_data_sha, website_sha)

        self.assertEqual("rebuild", decision.mode)
        self.assertEqual(("data/emergency-market-closures.json",), decision.data_impact_paths)

    def test_market_file_rename_cannot_bypass_rebuild(self) -> None:
        self._git("mv", "tools/market_snapshot.py", "tools/market_snapshot_v2.py")
        website_sha = self._commit("重新命名市場資料程式")

        decision = classify_snapshot_mode(self.repository, self.market_data_sha, website_sha)

        self.assertEqual("rebuild", decision.mode)
        self.assertEqual(
            ("tools/market_snapshot.py", "tools/market_snapshot_v2.py"),
            decision.data_impact_paths,
        )

    def test_rejects_unrelated_history_instead_of_reusing_snapshot(self) -> None:
        self._git("switch", "--orphan", "other")
        self._write("src/other.ts", "export const other = true;\n")
        unrelated_sha = self._commit("另一條歷史")

        with self.assertRaisesRegex(SnapshotModeError, "祖先"):
            classify_snapshot_mode(self.repository, self.market_data_sha, unrelated_sha)

    def test_rejects_missing_commit_instead_of_guessing(self) -> None:
        missing_sha = "f" * 40

        with self.assertRaisesRegex(SnapshotModeError, "不存在"):
            classify_snapshot_mode(self.repository, self.market_data_sha, missing_sha)

    def _write(self, relative_path: str, content: str) -> None:
        path = self.repository / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def _commit(self, message: str) -> str:
        self._git("add", "--all")
        self._git("commit", "-m", message)
        return self._git("rev-parse", "HEAD").stdout.strip()

    def _git(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ("git", *arguments),
            cwd=self.repository,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
