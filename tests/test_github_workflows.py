"""GitHub Actions 發布契約測試；只讀取本機 workflow，絕不連線。"""

from __future__ import annotations

from pathlib import Path
import re
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
sys.path.insert(0, str(ROOT / "tools"))

from github_actions_artifacts import (  # noqa: E402
    GitHubArtifactQueryError,
    find_latest_successful_market_snapshot,
)


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


def shell_run_blocks(text: str) -> tuple[str, ...]:
    """取出 workflow steps 的 shell body，檢查未信任 context 不會直接進 shell。"""
    lines = text.splitlines()
    blocks: list[str] = []
    for index, line in enumerate(lines):
        if line != "        run: |":
            continue
        body: list[str] = []
        for following in lines[index + 1 :]:
            indentation = len(following) - len(following.lstrip())
            if following and indentation <= 8:
                break
            body.append(following)
        blocks.append("\n".join(body))
    return tuple(blocks)


class GitHubArtifactPaginationTests(unittest.TestCase):
    """以可控 GitHub API 回應驗證快照查詢不會漏掉下一頁。"""

    def test_follows_link_pagination_before_falling_back_to_bootstrap(self) -> None:
        """若只讀第一頁，下一頁可用快照會被誤判遺失並觸發 bootstrap。"""
        first_page = "https://api.github.com/repos/example/guide/actions/artifacts?per_page=100"
        second_page = f"{first_page}&page=2"
        first_page_artifacts = [
            {
                "id": artifact_id,
                "name": f"candidate-market-snapshot-{artifact_id}",
                "expired": False,
                "workflow_run": {"id": artifact_id + 1_000},
            }
            for artifact_id in range(1, 101)
        ]
        calls: list[str] = []

        def fetch_page(url: str) -> tuple[object, object]:
            calls.append(url)
            if url == first_page:
                return (
                    {"total_count": 101, "artifacts": first_page_artifacts},
                    {"Link": f'<{second_page}>; rel="next"'},
                )
            if url == second_page:
                return (
                    {
                        "total_count": 101,
                        "artifacts": [
                            {
                                "id": 901,
                                "name": "market-snapshot-2026-08-11-502ff8be2321",
                                "expired": False,
                                "created_at": "2026-08-11T12:00:00Z",
                                "workflow_run": {"id": 1_901},
                            }
                        ],
                    },
                    {},
                )
            raise AssertionError(f"未預期的 API page：{url}")

        artifact = find_latest_successful_market_snapshot(
            fetch_page,
            lambda run_id: {"conclusion": "success"} if run_id == 1_901 else {"conclusion": "failure"},
            first_page,
            max_pages=10,
        )

        self.assertIsNotNone(artifact)
        assert artifact is not None
        self.assertEqual(901, artifact.artifact_id)
        self.assertEqual(1_901, artifact.workflow_run_id)
        self.assertEqual([first_page, second_page], calls)

    def test_pagination_limit_fails_closed_instead_of_bootstrapping(self) -> None:
        """若 API 聲稱還有下一頁卻超過上限，流程必須失敗而不是誤建基準快照。"""
        first_page = "https://api.github.com/repos/example/guide/actions/artifacts?per_page=100"

        with self.assertRaisesRegex(GitHubArtifactQueryError, "上限"):
            find_latest_successful_market_snapshot(
                lambda url: (
                    {
                        "total_count": 101,
                        "artifacts": [
                            {
                                "id": 1,
                                "name": "candidate-market-snapshot-1",
                                "expired": False,
                                "workflow_run": {"id": 1_001},
                            }
                        ],
                    },
                    {"Link": f'<{first_page}&page=2>; rel="next"'},
                ),
                lambda run_id: {"conclusion": "success"},
                first_page,
                max_pages=1,
            )

    def test_keeps_paging_to_select_the_newest_successful_snapshot(self) -> None:
        """若在第一個成功 artifact 停止，未知排序的 API 回應會選到較舊快照。"""
        first_page = "https://api.github.com/repos/example/guide/actions/artifacts?per_page=100"
        second_page = f"{first_page}&page=2"
        calls: list[str] = []

        def fetch_page(url: str) -> tuple[object, object]:
            calls.append(url)
            if url == first_page:
                return (
                    {
                        "total_count": 2,
                        "artifacts": [
                            {
                                "id": 500,
                                "name": "market-snapshot-2026-08-09-old",
                                "expired": False,
                                "created_at": "2026-08-09T12:00:00Z",
                                "workflow_run": {"id": 1_500},
                            }
                        ],
                    },
                    {"Link": f'<{second_page}>; rel="next"'},
                )
            if url == second_page:
                return (
                    {
                        "total_count": 2,
                        "artifacts": [
                            {
                                "id": 501,
                                "name": "market-snapshot-2026-08-10-new",
                                "expired": False,
                                "created_at": "2026-08-10T12:00:00Z",
                                "workflow_run": {"id": 1_501},
                            }
                        ],
                    },
                    {},
                )
            raise AssertionError(f"未預期的 API page：{url}")

        artifact = find_latest_successful_market_snapshot(
            fetch_page,
            lambda run_id: {"conclusion": "success"},
            first_page,
            max_pages=10,
        )

        self.assertIsNotNone(artifact)
        assert artifact is not None
        self.assertEqual(501, artifact.artifact_id)
        self.assertEqual([first_page, second_page], calls)

    def test_malformed_workflow_run_response_fails_closed(self) -> None:
        """若成功快照的 workflow run 回應不完整，不得降級成「沒有舊快照」。"""
        first_page = "https://api.github.com/repos/example/guide/actions/artifacts?per_page=100"
        response = {
            "total_count": 1,
            "artifacts": [
                {
                    "id": 700,
                    "name": "market-snapshot-2026-08-11-incomplete-run",
                    "expired": False,
                    "created_at": "2026-08-11T12:00:00Z",
                    "workflow_run": {"id": 1_700},
                }
            ],
        }

        with self.assertRaisesRegex(GitHubArtifactQueryError, "conclusion"):
            find_latest_successful_market_snapshot(
                lambda url: (response, {}),
                lambda run_id: {},
                first_page,
                max_pages=10,
            )

    def test_changed_total_count_between_pages_fails_closed(self) -> None:
        """分頁期間資料集改變時，不能把可能遺漏的資料當成完整快照清單。"""
        first_page = "https://api.github.com/repos/example/guide/actions/artifacts?per_page=100"
        second_page = f"{first_page}&page=2"

        def fetch_page(url: str) -> tuple[object, object]:
            if url == first_page:
                return (
                    {
                        "total_count": 101,
                        "artifacts": [
                            {
                                "id": 800,
                                "name": "candidate-market-snapshot-800",
                                "expired": False,
                                "workflow_run": {"id": 1_800},
                            }
                        ],
                    },
                    {"Link": f'<{second_page}>; rel="next"'},
                )
            if url == second_page:
                return (
                    {
                        "total_count": 102,
                        "artifacts": [
                            {
                                "id": 801,
                                "name": "market-snapshot-2026-08-11-mutated-list",
                                "expired": False,
                                "created_at": "2026-08-11T12:00:00Z",
                                "workflow_run": {"id": 1_801},
                            }
                        ],
                    },
                    {},
                )
            raise AssertionError(f"未預期的 API page：{url}")

        with self.assertRaisesRegex(GitHubArtifactQueryError, "total_count"):
            find_latest_successful_market_snapshot(
                fetch_page,
                lambda run_id: {"conclusion": "success"},
                first_page,
                max_pages=10,
            )

    def test_terminal_page_with_more_artifacts_than_total_count_fails_closed(self) -> None:
        """終頁超出 API 宣告總數時，不得將過量資料視為完整清單。"""
        first_page = "https://api.github.com/repos/example/guide/actions/artifacts?per_page=100"
        response = {
            "total_count": 1,
            "artifacts": [
                {
                    "id": 810,
                    "name": "candidate-market-snapshot-810",
                    "expired": False,
                    "workflow_run": {"id": 1_810},
                },
                {
                    "id": 811,
                    "name": "candidate-market-snapshot-811",
                    "expired": False,
                    "workflow_run": {"id": 1_811},
                },
            ],
        }

        with self.assertRaisesRegex(GitHubArtifactQueryError, "完整清單"):
            find_latest_successful_market_snapshot(
                lambda url: (response, {}),
                lambda run_id: {"conclusion": "success"},
                first_page,
                max_pages=10,
            )

    def test_terminal_page_with_fewer_artifacts_than_total_count_fails_closed(self) -> None:
        """終頁少於 API 宣告總數時，既有 fail-closed 行為必須保留。"""
        first_page = "https://api.github.com/repos/example/guide/actions/artifacts?per_page=100"
        response = {
            "total_count": 2,
            "artifacts": [
                {
                    "id": 812,
                    "name": "candidate-market-snapshot-812",
                    "expired": False,
                    "workflow_run": {"id": 1_812},
                }
            ],
        }

        with self.assertRaisesRegex(GitHubArtifactQueryError, "完整清單"):
            find_latest_successful_market_snapshot(
                lambda url: (response, {}),
                lambda run_id: {"conclusion": "success"},
                first_page,
                max_pages=10,
            )


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
        self.assertIn("id: validate-source", text)
        self.assertIn("REQUESTED_SOURCE_SHA: ${{ inputs.source_sha || github.sha }}", text)
        self.assertIn("ref: ${{ steps.validate-source.outputs.source_sha }}", text)
        self.assertIn("VALIDATED_SOURCE_SHA: ${{ steps.validate-source.outputs.source_sha }}", text)
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

    def test_workflow_shells_receive_dynamic_values_only_through_environment(self) -> None:
        """若把 inputs、needs 或 API output 直接展開到 shell，動態字串可改變 shell 語意。"""
        for name in ("verify.yml", "deploy-pages.yml", "update-market-data.yml"):
            for shell_body in shell_run_blocks(read_workflow(name)):
                self.assertNotRegex(
                    shell_body,
                    r"\$\{\{",
                    msg=f"{name} 的 shell 動態值必須先經 env 邊界傳入。",
                )

    def test_rollback_artifact_input_is_validated_before_action_consumes_it(self) -> None:
        """若 download action 直接吃手動輸入，驗證 step 無法成為唯一輸入邊界。"""
        text = read_workflow("deploy-pages.yml")
        validate_rollback = text.split("      - id: validate-rollback", 1)[1].split(
            "\n      - name: Download selected rollback metadata", 1
        )[0]
        self.assertIn('output.write(f"rollback_artifact_id={artifact_id}\\n")', validate_rollback)
        self.assertIn(
            "artifact-ids: ${{ steps.validate-rollback.outputs.rollback_artifact_id }}",
            text,
        )
        self.assertIn(
            "ROLLBACK_ARTIFACT_ID: ${{ steps.validate-rollback.outputs.rollback_artifact_id || '' }}",
            text,
        )

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
        self.assertIn("python .workflow-helper/tools/github_actions_artifacts.py", text)
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

    def test_deploy_workflow_paginates_previous_snapshots_and_same_cutoff_skips_pages(self) -> None:
        """若漏掃 Link 後頁或 no-op 後繼續 bootstrap，會重複部署或遺失舊快照。"""
        text = read_workflow("deploy-pages.yml")
        find_previous = text.split("      - id: find-previous", 1)[1].split(
            "\n      - name: Download selected rollback snapshot", 1
        )[0]
        self.assertIn("python .workflow-helper/tools/github_actions_artifacts.py", find_previous)
        self.assertIn("--max-pages 10", find_previous)
        self.assertNotIn("actions/artifacts?per_page=100", find_previous)

        same_cutoff_start = text.index('if [[ "$SKIP_IF_SAME_CUTOFF" == "true" ]]')
        same_cutoff_exit = text.index("exit 0", same_cutoff_start)
        fallback_bootstrap = text.index("重建 source-bound 基準快照", same_cutoff_start)
        self.assertLess(same_cutoff_exit, fallback_bootstrap)
        self.assertIn('echo "should_deploy=false"', text[same_cutoff_start:same_cutoff_exit])
        self.assertIn("if: ${{ needs.source-snapshot.outputs.should_deploy == 'true' }}", text)
        self.assertIn("needs.source-snapshot.outputs.should_deploy == 'true'", text)

    def test_pagination_helper_is_available_for_a_historical_source_sha(self) -> None:
        """歷史 source SHA 未含新 helper 時，工作流程仍需能查詢舊市場快照。"""
        text = read_workflow("deploy-pages.yml")
        helper_checkout = text.split("      - name: Checkout workflow helper", 1)[1].split(
            "\n      - id: find-previous", 1
        )[0]
        find_previous = text.split("      - id: find-previous", 1)[1].split(
            "\n      - name: Download selected rollback snapshot", 1
        )[0]
        self.assertIn("ref: ${{ github.sha }}", helper_checkout)
        self.assertIn("path: .workflow-helper", helper_checkout)
        self.assertIn("python .workflow-helper/tools/github_actions_artifacts.py", find_previous)

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
