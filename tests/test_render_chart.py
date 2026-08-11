from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

from chart_spec import parse_figure_spec
from market_data import OhlcvBar
from render_chart import render_svg


class RenderChartTests(unittest.TestCase):
    def setUp(self) -> None:
        self.bars = (
            OhlcvBar(date(2024, 1, 2), Decimal("100"), Decimal("105"), Decimal("99"), Decimal("103"), 1000),
            OhlcvBar(date(2024, 1, 3), Decimal("103"), Decimal("104"), Decimal("98"), Decimal("100"), 2000),
            OhlcvBar(date(2024, 1, 4), Decimal("100"), Decimal("102"), Decimal("98"), Decimal("100"), 1500),
        )

    def raw_spec(self) -> dict[str, object]:
        return {
            "id": "renderer-basic",
            "kind": "synthetic",
            "title": "測試圖",
            "alt_text": "可讀的繁體中文替代文字，包含上漲與下跌 K 線。",
            "output": "assets/figures/renderer-basic.svg",
            "bars": [
                {"date": "2024-01-02", "open": "100", "high": "105", "low": "99", "close": "103", "volume": 1000},
                {"date": "2024-01-03", "open": "103", "high": "104", "low": "98", "close": "100", "volume": 2000},
                {"date": "2024-01-04", "open": "100", "high": "102", "low": "98", "close": "100", "volume": 1500},
            ],
        }

    def parse(self, raw: dict[str, object] | None = None):
        return parse_figure_spec(raw or self.raw_spec(), Path("chapters/example.md"))

    def test_svg_has_accessible_title_description_and_direction_encoding(self):
        svg = render_svg(self.parse(), self.bars)

        self.assertIn('<title id="chart-title">測試圖</title>', svg)
        self.assertIn('<desc id="chart-desc">可讀的繁體中文替代文字，包含上漲與下跌 K 線。</desc>', svg)
        self.assertIn('class="chart-heading"', svg)
        self.assertNotIn("測試圖表：", svg)
        self.assertIn('role="img"', svg)
        self.assertIn('aria-labelledby="chart-title chart-desc"', svg)
        self.assertIn('data-direction="up"', svg)
        self.assertIn('data-direction="down"', svg)
        self.assertIn('class="candle-body up hollow"', svg)
        self.assertIn('class="candle-body down solid"', svg)

    def test_svg_defines_doji_as_a_cross_with_its_own_direction(self):
        svg = render_svg(self.parse(), self.bars)

        self.assertIn('data-direction="doji"', svg)
        self.assertIn('class="candle-body doji cross"', svg)
        self.assertIn('class="legend-doji cross"', svg)

    def test_svg_is_deterministic_sorts_annotations_and_escapes_text(self):
        raw = self.raw_spec()
        raw["title"] = "測試 <圖>"
        raw["alt_text"] = "可讀的繁體中文替代文字，含有 < 與 & 符號。"
        annotations = [
            {"type": "label", "date": "2024-01-04", "price": "100", "label": "<收盤&平盤>"},
            {"type": "zone", "start": "2024-01-02", "end": "2024-01-03", "low": "99", "high": "104", "label": "支撐區"},
        ]
        raw["annotations"] = annotations
        reverse_raw = self.raw_spec()
        reverse_raw["title"] = raw["title"]
        reverse_raw["alt_text"] = raw["alt_text"]
        reverse_raw["annotations"] = list(reversed(annotations))

        first_svg = render_svg(self.parse(raw), self.bars)
        second_svg = render_svg(self.parse(reverse_raw), self.bars)

        self.assertEqual(first_svg, second_svg)
        self.assertIn('<title id="chart-title">測試 &lt;圖&gt;</title>', first_svg)
        self.assertIn('&lt;收盤&amp;平盤&gt;', first_svg)
        root_tag = first_svg.split(">", 1)[0]
        attributes = re.findall(r'([\w:-]+)="[^"]*"', root_tag)
        self.assertEqual(sorted(attributes), attributes)

    def test_svg_renders_price_volume_axes_legend_and_each_annotation_type(self):
        raw = self.raw_spec()
        raw["annotations"] = [
            {"type": "zone", "start": "2024-01-02", "end": "2024-01-03", "low": "99", "high": "104", "label": "支撐區"},
            {"type": "line", "start": "2024-01-02", "end": "2024-01-03", "start_price": "99", "end_price": "104", "label": "趨勢線"},
            {"type": "arrow", "start": "2024-01-03", "end": "2024-01-04", "start_price": "104", "end_price": "100", "label": "轉弱"},
            {"type": "label", "date": "2024-01-04", "price": "100", "label": "平盤"},
        ]

        svg = render_svg(self.parse(raw), self.bars)

        self.assertIn('class="price-candles"', svg)
        self.assertIn('class="volume-bar up"', svg)
        self.assertIn('class="axes"', svg)
        self.assertIn('class="legend"', svg)
        self.assertIn("2024-01-02", svg)
        self.assertIn("2024-01-04", svg)
        self.assertIn("圖例：紅色空心＝上漲；綠色實心＝下跌；灰色十字＝平盤", svg)
        for annotation_type in ("zone", "line", "arrow", "label"):
            self.assertIn(f'data-annotation="{annotation_type}"', svg)

    def test_svg_renders_each_supported_indicator(self):
        bars = tuple(
            OhlcvBar(
                date(2024, 1, index + 1),
                Decimal(100 + index),
                Decimal(102 + index),
                Decimal(99 + index),
                Decimal(101 + index),
                1000 + index * 100,
            )
            for index in range(30)
        )
        raw = self.raw_spec()
        raw["indicators"] = [
            {"type": "sma", "period": 3},
            {"type": "ema", "period": 3},
            {"type": "atr", "period": 3},
            {"type": "rsi", "period": 3},
            {"type": "kd", "period": 3, "smooth_k": 2, "smooth_d": 2},
            {"type": "macd", "fast": 3, "slow": 6, "signal": 2},
            {"type": "bollinger", "period": 3, "deviations": "2"},
        ]

        svg = render_svg(self.parse(raw), bars)

        for indicator in ("sma", "ema", "atr", "rsi", "kd", "macd", "bollinger"):
            self.assertIn(f'data-indicator="{indicator}"', svg)

    def test_flat_price_and_zero_volume_have_finite_two_decimal_geometry(self):
        bars = (
            OhlcvBar(date(2024, 1, 2), Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), 0),
            OhlcvBar(date(2024, 1, 3), Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), 0),
        )

        svg = render_svg(self.parse(), bars)

        self.assertNotIn("NaN", svg)
        self.assertNotIn("Infinity", svg)
        coordinates = re.findall(r'\b(?:x|y|x1|x2|y1|y2)="([^"]+)"', svg)
        self.assertTrue(coordinates)
        self.assertTrue(all(re.fullmatch(r"-?\d+\.\d{2}", coordinate) for coordinate in coordinates))

    def test_svg_rejects_invalid_bar_data_with_named_errors(self):
        invalid_cases = (
            ((), "bars"),
            ((OhlcvBar(date(2024, 1, 2), Decimal("NaN"), Decimal("1"), Decimal("0"), Decimal("1"), 0),), "bars[0].open"),
            ((OhlcvBar(date(2024, 1, 2), Decimal("1"), Decimal("2"), Decimal("2"), Decimal("1"), 0),), "bars[0].low"),
            ((OhlcvBar(date(2024, 1, 2), Decimal("1"), Decimal("2"), Decimal("0"), Decimal("1"), -1),), "bars[0].volume"),
        )
        for bars, field in invalid_cases:
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, re.escape(field)):
                    render_svg(self.parse(), bars)

    def test_svg_is_utf8_standalone_and_has_no_script_resource(self):
        svg = render_svg(self.parse(), self.bars)

        self.assertEqual(svg, svg.encode("utf-8").decode("utf-8"))
        self.assertNotIn("<script", svg)
        self.assertNotIn("<image", svg)

    def test_cli_renders_a_synthetic_chapter_figure(self):
        from render_chapter_figures import main

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            chapter = root / "chapters" / "example.md"
            chapter.parent.mkdir()
            chapter.write_text(
                "<!-- figure-spec\n"
                + json.dumps(self.raw_spec(), ensure_ascii=False)
                + "\n-->",
                encoding="utf-8",
            )

            exit_code = main(["--chapter", "chapters/example.md", "--root", str(root)])

            output = root / "assets" / "figures" / "renderer-basic.svg"
            self.assertEqual(0, exit_code)
            self.assertTrue(output.is_file())
            self.assertIn('<svg ', output.read_text(encoding="utf-8"))
            first_bytes = output.read_bytes()
            self.assertEqual(0, main(["--chapter", "chapters/example.md", "--root", str(root)]))
            self.assertEqual(first_bytes, output.read_bytes())

    def test_cli_does_not_publish_any_figure_when_later_data_fetch_fails(self):
        from render_chapter_figures import main

        synthetic = self.raw_spec()
        synthetic["id"] = "published-only-if-all-pass"
        synthetic["output"] = "assets/figures/good.svg"
        historical = {
            "id": "failing-history",
            "kind": "historical",
            "market": "TWSE",
            "symbol": "2330",
            "start": "2024-01-02",
            "end": "2024-01-31",
            "timeframe": "1d",
            "price_mode": "raw",
            "source_url": "https://www.twse.com.tw/zh/trading/historical/stock-day.html",
            "checked_on": "2026-08-10",
            "corporate_actions": [],
            "title": "失敗歷史案例",
            "alt_text": "可讀的繁體中文替代文字，歷史資料尚未取得。",
            "output": "assets/figures/failing.svg",
        }
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            chapter = root / "chapters" / "example.md"
            chapter.parent.mkdir()
            chapter.write_text(
                "\n".join(
                    (
                        "<!-- figure-spec",
                        json.dumps(synthetic, ensure_ascii=False),
                        "-->",
                        "<!-- figure-spec",
                        json.dumps(historical, ensure_ascii=False),
                        "-->",
                    )
                ),
                encoding="utf-8",
            )

            with patch("render_chapter_figures.fetch_range", side_effect=RuntimeError("official data unavailable")):
                exit_code = main(["--chapter", "chapters/example.md", "--root", str(root)])

            self.assertEqual(1, exit_code)
            self.assertFalse((root / "assets" / "figures" / "good.svg").exists())
            self.assertFalse((root / "assets" / "figures" / "failing.svg").exists())

    def test_cli_preflights_invalid_output_target_before_publishing(self):
        from render_chapter_figures import main

        first = self.raw_spec()
        first["id"] = "first-output"
        first["output"] = "assets/figures/good.svg"
        second = self.raw_spec()
        second["id"] = "invalid-target"
        second["output"] = "assets/figures/failing.svg"

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            chapter = root / "chapters" / "example.md"
            chapter.parent.mkdir()
            chapter.write_text(
                "\n".join(
                    (
                        "<!-- figure-spec",
                        json.dumps(first, ensure_ascii=False),
                        "-->",
                        "<!-- figure-spec",
                        json.dumps(second, ensure_ascii=False),
                        "-->",
                    )
                ),
                encoding="utf-8",
            )
            failing_target = root / "assets" / "figures" / "failing.svg"
            failing_target.mkdir(parents=True)

            exit_code = main(["--chapter", "chapters/example.md", "--root", str(root)])

            self.assertEqual(1, exit_code)
            self.assertFalse((root / "assets" / "figures" / "good.svg").exists())
            self.assertTrue(failing_target.is_dir())

    def test_cli_rolls_back_existing_outputs_when_later_publish_fails(self):
        import render_chapter_figures

        first = self.raw_spec()
        first["id"] = "first-output"
        first["output"] = "assets/figures/first.svg"
        first["title"] = "新的第一張圖"
        second = self.raw_spec()
        second["id"] = "second-output"
        second["output"] = "assets/figures/second.svg"
        second["title"] = "新的第二張圖"

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            chapter = root / "chapters" / "example.md"
            chapter.parent.mkdir()
            chapter.write_text(
                "\n".join(
                    (
                        "<!-- figure-spec",
                        json.dumps(first, ensure_ascii=False),
                        "-->",
                        "<!-- figure-spec",
                        json.dumps(second, ensure_ascii=False),
                        "-->",
                    )
                ),
                encoding="utf-8",
            )
            figure_root = root / "assets" / "figures"
            figure_root.mkdir(parents=True)
            first_output = figure_root / "first.svg"
            second_output = figure_root / "second.svg"
            first_output.write_text("old first", encoding="utf-8")
            second_output.write_text("old second", encoding="utf-8")

            original_replace = render_chapter_figures._replace_path

            def fail_second_publish(source: Path, destination: Path) -> None:
                if source.suffix == ".tmp" and destination.name == "second.svg":
                    raise OSError("simulated second publish failure")
                original_replace(source, destination)

            with patch("render_chapter_figures._replace_path", side_effect=fail_second_publish):
                exit_code = render_chapter_figures.main(
                    ["--chapter", "chapters/example.md", "--root", str(root)]
                )

            self.assertEqual(1, exit_code)
            self.assertEqual("old first", first_output.read_text(encoding="utf-8"))
            self.assertEqual("old second", second_output.read_text(encoding="utf-8"))
            self.assertEqual([], list(figure_root.glob("*.tmp")))
            self.assertEqual([], list(figure_root.glob("*.bak")))

    def test_cli_uses_historical_fetch_range_with_the_ignored_cache(self):
        from render_chapter_figures import main

        historical = {
            "id": "historical-cli",
            "kind": "historical",
            "market": "TWSE",
            "symbol": "2330",
            "start": "2024-01-02",
            "end": "2024-01-04",
            "timeframe": "1d",
            "price_mode": "raw",
            "source_url": "https://www.twse.com.tw/zh/trading/historical/stock-day.html",
            "checked_on": "2026-08-10",
            "corporate_actions": [],
            "title": "歷史 CLI 案例",
            "alt_text": "可讀的繁體中文替代文字，使用官方歷史日 K 資料。",
            "output": "assets/figures/historical-cli.svg",
        }
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            chapter = root / "chapters" / "example.md"
            chapter.parent.mkdir()
            chapter.write_text(
                "<!-- figure-spec\n" + json.dumps(historical, ensure_ascii=False) + "\n-->",
                encoding="utf-8",
            )

            with patch("render_chapter_figures.fetch_range", return_value=self.bars) as fetch_range:
                exit_code = main(["--chapter", "chapters/example.md", "--root", str(root)])

            self.assertEqual(0, exit_code)
            self.assertTrue((root / "assets" / "figures" / "historical-cli.svg").is_file())
            self.assertEqual(1, fetch_range.call_count)
            market, symbol, start, end, cache_directory = fetch_range.call_args.args
            self.assertEqual(("TWSE", "2330", date(2024, 1, 2), date(2024, 1, 4)), (market, symbol, start, end))
            self.assertEqual((root / ".cache" / "market-data").resolve(), cache_directory.resolve())

    def test_cli_uses_only_visible_specs_and_rejects_duplicate_outputs(self):
        from render_chapter_figures import main

        visible = self.raw_spec()
        visible["id"] = "visible-spec"
        visible["output"] = "assets/figures/visible.svg"
        duplicate = self.raw_spec()
        duplicate["id"] = "duplicate-output"
        duplicate["output"] = "assets/figures/visible.svg"
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            chapter = root / "chapters" / "example.md"
            chapter.parent.mkdir()
            chapter.write_text(
                "\n".join(
                    (
                        "```json",
                        "<!-- figure-spec",
                        '{"id":"fenced-example","kind":"synthetic"}',
                        "-->",
                        "```",
                        "<!-- figure-spec",
                        json.dumps(visible, ensure_ascii=False),
                        "-->",
                    )
                ),
                encoding="utf-8",
            )

            self.assertEqual(0, main(["--chapter", "chapters/example.md", "--root", str(root)]))
            self.assertTrue((root / "assets" / "figures" / "visible.svg").is_file())
            chapter.write_text(
                "\n".join(
                    (
                        "<!-- figure-spec",
                        json.dumps(visible, ensure_ascii=False),
                        "-->",
                        "<!-- figure-spec",
                        json.dumps(duplicate, ensure_ascii=False),
                        "-->",
                    )
                ),
                encoding="utf-8",
            )

            self.assertEqual(1, main(["--chapter", "chapters/example.md", "--root", str(root)]))
            self.assertFalse((root / "assets" / "figures" / "duplicate-output.svg").exists())

    def test_cli_rejects_chapter_outside_root_and_invalid_utf8(self):
        from render_chapter_figures import main

        with TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            root = workspace / "root"
            root.mkdir()
            outside = workspace / "outside.md"
            outside.write_text("outside", encoding="utf-8")

            self.assertEqual(1, main(["--chapter", str(outside), "--root", str(root)]))

            invalid = root / "chapters" / "invalid.md"
            invalid.parent.mkdir()
            invalid.write_bytes(b"\xff")
            self.assertEqual(1, main(["--chapter", "chapters/invalid.md", "--root", str(root)]))


if __name__ == "__main__":
    unittest.main()
