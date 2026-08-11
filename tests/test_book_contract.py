from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

from book_contract import EXPECTED_CHAPTERS, extract_figure_specs


class BookContractTests(unittest.TestCase):
    def test_manifest_has_twenty_numbered_lessons_and_four_appendices(self):
        numbered = [item.number for item in EXPECTED_CHAPTERS if item.number is not None]
        appendices = [item for item in EXPECTED_CHAPTERS if item.kind == "appendix"]
        appendix_paths = [item.path for item in appendices]

        self.assertEqual(list(range(1, 21)), numbered)
        self.assertEqual(4, len(appendices))
        self.assertEqual(
            [
                "chapters/appendix-a-pattern-reference.md",
                "chapters/appendix-b-formulas-and-worksheets.md",
                "chapters/appendix-c-taiwan-market-rules.md",
                "chapters/appendix-d-glossary.md",
            ],
            appendix_paths,
        )

    def test_extract_figure_specs_reads_json_comment(self):
        markdown = '''<!-- figure-spec
{"id":"synthetic-1","kind":"synthetic","title":"測試","alt_text":"可讀圖說","output":"assets/figures/test.svg"}
-->'''

        specs = extract_figure_specs(markdown)

        self.assertEqual("synthetic-1", specs[0]["id"])
        self.assertEqual("可讀圖說", specs[0]["alt_text"])

    def test_extract_figure_specs_ignores_fenced_examples(self):
        markdown = '''```markdown
<!-- figure-spec
{"id":"example-only","kind":"synthetic"}
-->
```
<!-- figure-spec
{"id":"published","kind":"synthetic"}
-->'''

        specs = extract_figure_specs(markdown)

        self.assertEqual(("published",), tuple(spec["id"] for spec in specs))
