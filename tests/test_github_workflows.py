"""GitHub Actions 發布契約測試；只讀取本機 workflow，絕不連線。"""

from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"


ACTION_PINS = {
    "actions/checkout": "11bd71901bbe5b1630ceea73d27597364c9af683",  # v4.2.2
    "actions/setup-python": "a26af69be951a213d495a4c3e4e4022e16d87065",  # v5.6.0
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",  # v4.4.0
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",  # v4.6.2
    "actions/download-artifact": "d3f86a106a0bac45b974a628896c90dbdf5c8093",  # v4.3.0
    "actions/configure-pages": "983d7736d9b0ae728b81ab479565c72886d7745b",  # v5.0.0
    "actions/upload-pages-artifact": "56afc609e74202658d3ffba0e8f6dda462b719fa",  # v3.0.1
    "actions/deploy-pages": "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",  # v4.0.5
}


def read_workflow(name: str) -> str:
    path = WORKFLOWS / name
    if not path.is_file():
        raise AssertionError(f"缺少 workflow：{path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


class GitHubWorkflowContractTests(unittest.TestCase):
    """防止 CI、快照與 Pages 發布流程在重構時失去原子性。"""

    def assert_pinned_actions(self, text: str, *actions: str) -> None:
        for action in actions:
            pin = ACTION_PINS[action]
            self.assertIn(f"uses: {action}@{pin}", text)
            self.assertRegex(text, rf"uses: {re.escape(action)}@{pin}\s+# v\d+\.\d+\.\d+")

    def test_verify_workflow_runs_all_offline_release_gates_from_the_requested_sha(self) -> None:
        """若 verify 漏檢、改用浮動 ref 或連線抓行情，部署前驗證就不可信。"""
        text = read_workflow("verify.yml")

        self.assertIn("pull_request:", text)
        self.assertIn("workflow_call:", text)
        self.assertIn("source_sha:", text)
        self.assertIn("ref: ${{ inputs.source_sha || github.sha }}", text)
        self.assertIn("git rev-parse HEAD", text)
        self.assertIn("source SHA checkout mismatch", text)
        self.assertIn('python-version: "3.13"', text)
        self.assertIn('node-version: "22"', text)
        self.assertIn("cache: npm", text)
        for command in (
            "python -m unittest discover -s tests",
            "python tools/validate_book.py",
            "python tools/render_glossary.py --source CONTEXT.md --output chapters/appendix-d-glossary.md --check",
            "npm ci",
            "npm run lint",
            "npm run typecheck",
            "npm run test:unit:coverage",
            "npm run build",
        ):
            self.assertIn(command, text)
        self.assert_pinned_actions(text, "actions/checkout", "actions/setup-python", "actions/setup-node")

    def test_deploy_workflow_binds_one_verified_snapshot_to_one_pages_artifact(self) -> None:
        """若資料、source 或 artifact 可任意混搭，rollback 可能發布不一致站台。"""
        text = read_workflow("deploy-pages.yml")

        self.assertIn("push:", text)
        self.assertIn("workflow_call:", text)
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("source_sha:", text)
        self.assertIn("rollback_artifact_id:", text)
        self.assertIn("skip_if_same_cutoff:", text)
        self.assertGreaterEqual(text.count("skip_if_same_cutoff:"), 2)
        self.assertIn("concurrency:", text)
        self.assertIn("cancel-in-progress: false", text)
        self.assertIn("source SHA checkout mismatch", text)
        self.assertIn("sourceCommit", text)
        self.assertIn("SHA256SUMS", text)
        self.assertIn("snapshot.tar.gz", text)
        self.assertIn("manifest.json", text)
        self.assertIn("provenance.json", text)
        self.assertIn("market-snapshot-", text)
        self.assertIn("retention-days: 30", text)
        self.assertIn("actions/artifacts", text)
        self.assertIn('run.get("conclusion") == "success"', text)
        self.assertIn("rollback_run_id", text)
        self.assertIn("artifact_run_id", text)
        self.assertGreaterEqual(text.count("run-id:"), 3)
        self.assertIn("python tools/market_snapshot.py bootstrap", text)
        self.assertIn("python tools/market_snapshot.py update", text)
        self.assertIn("python tools/market_snapshot.py validate", text)
        self.assertIn("should_deploy", text)
        self.assertIn("needs.build-pages.result == 'success'", text)
        self.assertEqual(1, text.count("actions/upload-pages-artifact@"))
        self.assertEqual(1, text.count("pages: write"))
        self.assertEqual(1, text.count("id-token: write"))
        resolve_section = text.split("  resolve-source:", 1)[1].split("\n  verify:", 1)[0]
        self.assertIn("actions/setup-python@", resolve_section)
        self.assertIn('python-version: "3.13"', resolve_section)
        published_section = text.split("  publish-successful-snapshot:", 1)[1]
        self.assertIn("      - resolve-source", published_section)
        self.assertIn("actions/checkout@", published_section)
        self.assertIn("ref: ${{ needs.resolve-source.outputs.source_sha }}", published_section)
        self.assertIn("git rev-parse HEAD", published_section)
        self.assertIn("actions/setup-python@", published_section)
        self.assertIn('python-version: "3.13"', published_section)
        self.assert_pinned_actions(
            text,
            "actions/checkout",
            "actions/setup-python",
            "actions/setup-node",
            "actions/upload-artifact",
            "actions/download-artifact",
            "actions/configure-pages",
            "actions/upload-pages-artifact",
            "actions/deploy-pages",
        )

    def test_market_scheduler_resolves_main_once_at_taipei_after_hours(self) -> None:
        """若排程重新解析分支或時區錯誤，資料可能配上另一版程式。"""
        text = read_workflow("update-market-data.yml")

        self.assertIn('cron: "30 9 * * 1-5"', text)
        self.assertIn('cron: "30 12 * * 1-5"', text)
        self.assertIn("refs/heads/main", text)
        self.assertIn("source_sha", text)
        self.assertIn("uses: ./.github/workflows/deploy-pages.yml", text)
        self.assertIn("skip_if_same_cutoff: true", text)
        self.assertRegex(text, r"git ls-remote[^\n]*refs/heads/main")
        self.assertIn("同一日期", text)

    def test_readme_documents_local_gates_and_manual_rollback_without_claiming_a_live_release(self) -> None:
        """若公開說明遺漏驗證或 rollback，維護者容易跳過原子發布流程。"""
        text = (ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("npm run verify", text)
        self.assertIn("python -m unittest discover -s tests", text)
        self.assertIn("GitHub Pages", text)
        self.assertIn("rollback_artifact_id", text)
        self.assertIn("尚未宣告公開部署完成", text)


if __name__ == "__main__":
    unittest.main()
