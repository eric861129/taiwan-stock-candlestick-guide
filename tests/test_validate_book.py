from pathlib import Path
import shutil
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

from validate_book import validate_book


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "valid_lesson.md"
LESSON_PATH = Path("chapters/01-what-candlesticks-can-and-cannot-answer.md")


class ValidateBookTests(unittest.TestCase):
    def _write_valid_lesson(self, root: Path) -> Path:
        lesson_path = root / LESSON_PATH
        lesson_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(FIXTURE_PATH, lesson_path)
        return lesson_path

    def _rules(self, root: Path, mode: str = "draft") -> set[str]:
        return {issue.rule for issue in validate_book(root, mode)}

    def test_valid_lesson_has_no_issues(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            self._write_valid_lesson(root)

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
