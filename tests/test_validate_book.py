from pathlib import Path
import json
import shutil
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

from validate_book import validate_book


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "valid_lesson.md"
LESSON_PATH = Path("chapters/01-what-candlesticks-can-and-cannot-answer.md")
CAPSTONE_PATH = Path("chapters/20-capstone-ten-cases.md")
REPLAY_LAB_PATH = Path("chapters/19-progressive-chart-replay-lab.md")


class ValidateBookTests(unittest.TestCase):
    def _write_valid_lesson(self, root: Path) -> Path:
        lesson_path = root / LESSON_PATH
        lesson_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(FIXTURE_PATH, lesson_path)
        return lesson_path

    def _rules(self, root: Path, mode: str = "draft") -> set[str]:
        return {issue.rule for issue in validate_book(root, mode)}

    def _write_lab(self, root: Path, path: Path, case_content: str, scoring_content: str = "評分內容。") -> Path:
        lab_path = root / path
        lab_path.parent.mkdir(parents=True, exist_ok=True)
        lab_path.write_text(
            "\n".join(
                (
                    "# 測試實驗室",
                    "",
                    "## 學習指示",
                    "",
                    "依序完成判讀。",
                    "",
                    "## 案例",
                    "",
                    case_content,
                    "",
                    "## 評分",
                    "",
                    scoring_content,
                    "",
                    "## 來源",
                    "",
                    "官方資料來源。",
                    "",
                )
            ),
            encoding="utf-8",
        )
        return lab_path

    def _capstone_spec(self, output: str, alt_text: str, figure_id: str = "capstone-case") -> str:
        specification = {
            "id": figure_id,
            "kind": "synthetic",
            "title": "十題練習圖",
            "alt_text": alt_text,
            "output": output,
        }
        return f"<!-- figure-spec\n{json.dumps(specification, ensure_ascii=False)}\n-->"

    def test_valid_lesson_has_no_issues(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_valid_lesson(root)

            issues = validate_book(root, "draft")

        self.assertEqual([], issues)

    def test_ignored_workspace_directories_are_not_scanned(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_valid_lesson(root)
            for directory in (".cache", ".git", ".superpowers", ".worktrees"):
                ignored_markdown = root / directory / "invalid.md"
                ignored_markdown.parent.mkdir(parents=True)
                ignored_markdown.write_bytes(b"\xff")

            issues = validate_book(root, "draft")

        self.assertEqual([], issues)

    def test_replacement_character_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            lesson_path.write_text(lesson_path.read_text(encoding="utf-8") + "\n\uFFFD", encoding="utf-8")

            rules = self._rules(root)

        self.assertIn("replacement-character", rules)

    def test_missing_required_section_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            lesson_path.write_text(
                lesson_path.read_text(encoding="utf-8").replace("## 練習\n\n請列出觀察、解釋與失效條件。\n\n", ""),
                encoding="utf-8",
            )

            rules = self._rules(root)

        self.assertIn("required-section", rules)

    def test_empty_image_alt_text_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            image_path = root / "assets" / "figures" / "example.svg"
            image_path.parent.mkdir(parents=True)
            image_path.write_text("<svg />", encoding="utf-8")
            lesson_path.write_text(
                lesson_path.read_text(encoding="utf-8") + "\n![](../assets/figures/example.svg)\n",
                encoding="utf-8",
            )

            rules = self._rules(root)

        self.assertIn("empty-image-alt-text", rules)

    def test_missing_local_link_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            lesson_path.write_text(
                lesson_path.read_text(encoding="utf-8") + "\n[延伸閱讀](missing-reference.md)\n",
                encoding="utf-8",
            )

            rules = self._rules(root)

        self.assertIn("missing-local-link", rules)

    def test_release_mode_requires_readme_all_chapters_and_appendices(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)

            issues = validate_book(root, "release")

        missing_paths = {issue.path for issue in issues if issue.rule == "release-completeness"}
        self.assertIn("README.md", missing_paths)
        self.assertIn("chapters/01-what-candlesticks-can-and-cannot-answer.md", missing_paths)
        self.assertIn("chapters/appendix-d-glossary.md", missing_paths)

    def test_duplicate_figure_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            figure_specs = '''
<!-- figure-spec
{"id":"same-id","kind":"synthetic","title":"圖例一","alt_text":"第一張圖","output":"assets/figures/one.svg"}
-->
<!-- figure-spec
{"id":"same-id","kind":"synthetic","title":"圖例二","alt_text":"第二張圖","output":"assets/figures/two.svg"}
-->
'''
            lesson_path.write_text(lesson_path.read_text(encoding="utf-8") + figure_specs, encoding="utf-8")

            rules = self._rules(root)

        self.assertIn("duplicate-figure-id", rules)

    def test_figure_specs_inside_fenced_code_do_not_define_book_metadata(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            example = '''
```markdown
<!-- figure-spec
{"id":"historical-example","kind":"historical"}
-->
```
'''
            lesson_path.write_text(lesson_path.read_text(encoding="utf-8") + example, encoding="utf-8")

            rules = self._rules(root)

        self.assertNotIn("historical-figure-provenance", rules)

    def test_fenced_heading_does_not_satisfy_required_section(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            markdown = lesson_path.read_text(encoding="utf-8").replace(
                "## 練習\n\n請列出觀察、解釋與失效條件。\n\n",
                "```markdown\n## 練習\n\n這只是格式範例。\n```\n\n",
            )
            lesson_path.write_text(markdown, encoding="utf-8")

            rules = self._rules(root)

        self.assertIn("required-section", rules)

    def test_fenced_markdown_link_is_not_validated(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            lesson_path.write_text(
                lesson_path.read_text(encoding="utf-8")
                + "\n```markdown\n![格式範例](missing.svg)\n```\n",
                encoding="utf-8",
            )

            rules = self._rules(root)

        self.assertNotIn("missing-local-link", rules)

    def test_historical_figure_requires_provenance_fields(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            figure_spec = '''
<!-- figure-spec
{"id":"historical-1","kind":"historical","title":"歷史圖例","alt_text":"歷史走勢","output":"assets/figures/history.svg"}
-->
'''
            lesson_path.write_text(lesson_path.read_text(encoding="utf-8") + figure_spec, encoding="utf-8")

            rules = self._rules(root)

        self.assertIn("historical-figure-provenance", rules)

    def test_canonical_historical_figure_provenance_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            specification = {
                "id": "historical-complete",
                "kind": "historical",
                "market": "TWSE",
                "symbol": "2330",
                "start": "2024-01-02",
                "end": "2024-03-29",
                "timeframe": "1d",
                "price_mode": "raw",
                "source_url": "https://www.twse.com.tw/zh/trading/historical/stock-day.html",
                "checked_on": "2026-08-10",
                "corporate_actions": [],
                "title": "完整歷史圖例",
                "alt_text": "歷史日 K 圖。",
                "output": "assets/figures/history.svg",
            }
            figure_spec = f"\n<!-- figure-spec\n{json.dumps(specification, ensure_ascii=False)}\n-->\n"
            lesson_path.write_text(lesson_path.read_text(encoding="utf-8") + figure_spec, encoding="utf-8")

            rules = self._rules(root)

        self.assertNotIn("historical-figure-provenance", rules)

    def test_each_canonical_historical_provenance_field_is_required(self):
        canonical_specification = {
            "id": "historical-complete",
            "kind": "historical",
            "market": "TWSE",
            "symbol": "2330",
            "start": "2024-01-02",
            "end": "2024-03-29",
            "timeframe": "1d",
            "price_mode": "raw",
            "source_url": "https://www.twse.com.tw/zh/trading/historical/stock-day.html",
            "checked_on": "2026-08-10",
            "corporate_actions": [],
        }

        for field_name in (
            "market",
            "symbol",
            "start",
            "end",
            "timeframe",
            "price_mode",
            "source_url",
            "checked_on",
            "corporate_actions",
        ):
            with self.subTest(field_name=field_name), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                lesson_path = self._write_valid_lesson(root)
                specification = canonical_specification | {"id": f"missing-{field_name}"}
                del specification[field_name]
                figure_spec = f"\n<!-- figure-spec\n{json.dumps(specification)}\n-->\n"
                lesson_path.write_text(
                    lesson_path.read_text(encoding="utf-8") + figure_spec,
                    encoding="utf-8",
                )

                rules = self._rules(root)

            self.assertIn("historical-figure-provenance", rules)

    def test_lab_requires_nonempty_learning_instructions_cases_scoring_and_sources(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lab_path = root / "chapters" / "19-progressive-chart-replay-lab.md"
            lab_path.parent.mkdir(parents=True)
            lab_path.write_text(
                """# 實驗室

## 學習指示

依序完成判讀。

## 案例

案例內容。

## 評分

評分規則。

## 來源

資料來源。
""",
                encoding="utf-8",
            )

            self.assertEqual([], validate_book(root, "draft"))

            lab_path.write_text(
                lab_path.read_text(encoding="utf-8").replace("## 來源\n\n資料來源。\n", ""),
                encoding="utf-8",
            )
            rules = self._rules(root)

        self.assertIn("required-section", rules)

    def test_draft_marker_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            lesson_path = self._write_valid_lesson(root)
            lesson_path.write_text(lesson_path.read_text(encoding="utf-8") + "\n" + "t" "OdO\n", encoding="utf-8")

            rules = self._rules(root)

        self.assertIn("draft-marker", rules)

    def test_capstone_answer_leakage_rejects_each_token_in_output_and_alt_text(self):
        forbidden_tokens = ("result", "winner", "failed", "profit", "loss", "上漲", "下跌")

        for field_name in ("output", "alt_text"):
            for token in forbidden_tokens:
                with self.subTest(field_name=field_name, token=token), tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    output = "assets/figures/ch20-case-01.svg"
                    alt_text = "十題練習圖，右端停在決策日。"
                    if field_name == "output":
                        output = f"assets/figures/ch20-{token}-case.svg"
                    else:
                        alt_text = f"十題練習圖，{token} 不應在題目前揭露。"
                    self._write_lab(root, CAPSTONE_PATH, self._capstone_spec(output, alt_text))

                    issues = validate_book(root, "draft")

                leakage_issues = [issue for issue in issues if issue.rule == "capstone-answer-leakage"]
                self.assertEqual(1, len(leakage_issues))
                self.assertIn(field_name, leakage_issues[0].message)
                self.assertIn(token, leakage_issues[0].message)

    def test_capstone_answer_leakage_is_case_insensitive_for_english_tokens(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_lab(
                root,
                CAPSTONE_PATH,
                self._capstone_spec("assets/figures/ch20-Result.svg", "十題練習圖，右端停在決策日。"),
            )

            issues = validate_book(root, "draft")

        leakage_issues = [issue for issue in issues if issue.rule == "capstone-answer-leakage"]
        self.assertEqual(1, len(leakage_issues))
        self.assertIn("result", leakage_issues[0].message.casefold())

    def test_capstone_answer_leakage_allows_result_discussion_after_scoring_heading(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_lab(
                root,
                CAPSTONE_PATH,
                self._capstone_spec("assets/figures/ch20-case-01.svg", "十題練習圖，右端停在決策日。"),
                "答案可以討論 result、profit 或下跌，但不改變題目評分。",
            )

            issues = validate_book(root, "draft")

        self.assertEqual([], issues)

    def test_capstone_answer_leakage_ignores_figure_specs_inside_fenced_code(self):
        fenced_specification = self._capstone_spec(
            "assets/figures/ch20-result-case.svg",
            "十題練習圖，題目前不應顯示 result。",
        )
        safe_specification = self._capstone_spec(
            "assets/figures/ch20-case-01.svg",
            "十題練習圖，右端停在決策日。",
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_lab(root, CAPSTONE_PATH, f"```markdown\n{fenced_specification}\n```\n\n{safe_specification}")

            issues = validate_book(root, "draft")

        self.assertEqual([], issues)

    def test_capstone_answer_leakage_does_not_apply_to_replay_lab(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_lab(
                root,
                REPLAY_LAB_PATH,
                self._capstone_spec("assets/figures/ch19-result-case.svg", "回放練習圖，可能出現 result。"),
            )

            issues = validate_book(root, "draft")

        self.assertEqual([], issues)

    def test_capstone_answer_leakage_accepts_safe_ten_case_names_and_alt_text(self):
        specifications = "\n\n".join(
            self._capstone_spec(
                f"assets/figures/ch20-case-{index:02d}.svg",
                f"第 {index} 題原始日 K 線，圖表終點為決策日，不含右側資料。",
                f"capstone-case-{index:02d}",
            )
            for index in range(1, 11)
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_lab(root, CAPSTONE_PATH, specifications)

            issues = validate_book(root, "draft")

        self.assertEqual([], issues)
