from dataclasses import FrozenInstanceError
from decimal import Decimal
from pathlib import Path
import re
import sys
import unittest


sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

from chart_spec import (
    ArrowAnnotation,
    FigureSpec,
    LabelAnnotation,
    LineAnnotation,
    ZoneAnnotation,
    parse_figure_spec,
    validate_unique_figure_specs,
)


class ChartSpecTests(unittest.TestCase):
    chapter_path = Path("chapters/example.md")

    def synthetic_raw(self) -> dict[str, object]:
        return {
            "id": "synthetic-basic",
            "kind": "synthetic",
            "title": "人工 K 線示意圖",
            "alt_text": "可讀的繁體中文替代文字，說明一根上漲 K 線。",
            "output": "assets/figures/synthetic-basic.svg",
            "bars": [
                {
                    "date": "2024-01-02",
                    "open": "100",
                    "high": "105",
                    "low": "99",
                    "close": "103",
                    "volume": 1000,
                }
            ],
        }

    def historical_raw(self) -> dict[str, object]:
        return {
            "id": "historical-basic",
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
            "title": "歷史 K 線案例",
            "alt_text": "可讀的繁體中文替代文字，說明歷史日 K 的價格與成交量。",
            "output": "assets/figures/historical-basic.svg",
        }

    def assert_invalid(self, raw: dict[str, object], field: str) -> None:
        with self.assertRaisesRegex(ValueError, re.escape(field)):
            parse_figure_spec(raw, self.chapter_path)

    def test_parses_synthetic_spec_into_frozen_figure_spec(self):
        spec = parse_figure_spec(self.synthetic_raw(), self.chapter_path)

        self.assertIsInstance(spec, FigureSpec)
        self.assertEqual("synthetic-basic", spec.id)
        self.assertEqual("2024-01-02", spec.bars[0].trading_date.isoformat())
        with self.assertRaises(FrozenInstanceError):
            spec.id = "changed"  # type: ignore[misc]

    def test_requires_safe_common_metadata_with_named_errors(self):
        cases = (
            ("id", ""),
            ("kind", "unsupported"),
            ("title", "  "),
            ("alt_text", "English-only chart description"),
            ("output", "assets/figures/not-svg.png"),
            ("output", "assets/figures/../outside.svg"),
            ("output", "C:\\temp\\outside.svg"),
            ("output", "assets/figures/C:/outside.svg"),
            ("output", "assets/figures/con.svg"),
            ("output", "assets/figures/chart:stream.svg"),
        )

        for field, value in cases:
            with self.subTest(field=field, value=value):
                raw = self.synthetic_raw()
                raw[field] = value
                self.assert_invalid(raw, field)

    def test_synthetic_requires_non_empty_bars_and_rejects_provenance(self):
        missing_bars = self.synthetic_raw()
        del missing_bars["bars"]
        self.assert_invalid(missing_bars, "bars")

        empty_bars = self.synthetic_raw()
        empty_bars["bars"] = []
        self.assert_invalid(empty_bars, "bars")

        for field, value in (
            ("market", "TWSE"),
            ("symbol", "2330"),
            ("start", "2024-01-02"),
            ("end", "2024-01-03"),
            ("timeframe", "1d"),
            ("price_mode", "raw"),
            ("source_url", "https://example.test/source"),
            ("checked_on", "2026-08-10"),
            ("corporate_actions", []),
        ):
            with self.subTest(field=field):
                raw = self.synthetic_raw()
                raw[field] = value
                self.assert_invalid(raw, field)

    def test_synthetic_bars_require_finite_ohlc_invariants_and_non_negative_volume(self):
        cases = (
            ("open", "NaN"),
            ("close", "106"),
            ("volume", -1),
            ("date", "not-a-date"),
        )
        for field, value in cases:
            with self.subTest(field=field):
                raw = self.synthetic_raw()
                bars = raw["bars"]
                assert isinstance(bars, list)
                bar = bars[0]
                assert isinstance(bar, dict)
                bar[field] = value
                self.assert_invalid(raw, f"bars[0].{field}")

    def test_parses_historical_canonical_provenance(self):
        spec = parse_figure_spec(self.historical_raw(), self.chapter_path)

        self.assertEqual("historical", spec.kind)
        self.assertEqual("TWSE", spec.market)
        self.assertEqual("2330", spec.symbol)
        self.assertEqual("2024-01-02", spec.start.isoformat())
        self.assertEqual("2024-01-31", spec.end.isoformat())
        self.assertEqual((), spec.bars)

    def test_historical_provenance_values_are_strictly_validated(self):
        cases = (
            ("market", "NYSE"),
            ("symbol", "  "),
            ("start", "2024/01/02"),
            ("end", "2024-01-01"),
            ("timeframe", "1w"),
            ("price_mode", "adjusted"),
            ("source_url", "ftp://example.test/source"),
            ("checked_on", "2026-13-01"),
            ("corporate_actions", "none"),
        )
        for field, value in cases:
            with self.subTest(field=field, value=value):
                raw = self.historical_raw()
                raw[field] = value
                self.assert_invalid(raw, field)

        raw = self.historical_raw()
        del raw["source_url"]
        self.assert_invalid(raw, "source_url")

    def test_parses_typed_annotations_and_rejects_invalid_coordinates_or_text(self):
        raw = self.synthetic_raw()
        raw["annotations"] = [
            {
                "type": "zone",
                "start": "2024-01-02",
                "end": "2024-01-03",
                "low": "100",
                "high": "104",
                "label": "支撐區",
            },
            {
                "type": "line",
                "start": "2024-01-02",
                "end": "2024-01-03",
                "start_price": "100",
                "end_price": "104",
                "label": "趨勢線",
            },
            {
                "type": "arrow",
                "start": "2024-01-02",
                "end": "2024-01-03",
                "start_price": "100",
                "end_price": "104",
                "label": "突破方向",
            },
            {"type": "label", "date": "2024-01-02", "price": "103", "label": "收盤"},
        ]

        spec = parse_figure_spec(raw, self.chapter_path)

        self.assertIsInstance(spec.annotations[0], ZoneAnnotation)
        self.assertIsInstance(spec.annotations[1], LineAnnotation)
        self.assertIsInstance(spec.annotations[2], ArrowAnnotation)
        self.assertIsInstance(spec.annotations[3], LabelAnnotation)
        self.assertEqual(Decimal("100"), spec.annotations[0].low)

        invalid_cases = (
            ({"type": "cloud", "label": "未知"}, "annotations[0].type"),
            ({"type": "line", "start": "2024-01-02", "end": "2024-01-03", "start_price": "100", "label": "缺座標"}, "annotations[0].end_price"),
            ({"type": "label", "date": "2024-01-02", "price": "100"}, "annotations[0].label"),
            ({"type": "zone", "start": "2024-01-03", "end": "2024-01-02", "low": "100", "high": "104", "label": "日期錯誤"}, "annotations[0].start"),
            ({"type": "zone", "start": "2024-01-02", "end": "2024-01-03", "low": "NaN", "high": "104", "label": "數值錯誤"}, "annotations[0].low"),
            ({"type": "label", "date": "2024-01-02", "price": "100", "label": "\x00"}, "annotations[0].label"),
        )
        for annotation, field in invalid_cases:
            with self.subTest(field=field):
                invalid_raw = self.synthetic_raw()
                invalid_raw["annotations"] = [annotation]
                self.assert_invalid(invalid_raw, field)

    def test_accepts_only_renderable_indicators_with_valid_parameters(self):
        raw = self.synthetic_raw()
        raw["indicators"] = [
            {"type": "sma", "period": 5},
            {"type": "macd", "fast": 3, "slow": 6, "signal": 2},
            {"type": "bollinger", "period": 5, "deviations": "2"},
        ]

        spec = parse_figure_spec(raw, self.chapter_path)

        self.assertEqual(("sma", "macd", "bollinger"), tuple(item.type for item in spec.indicators))
        self.assertEqual(5, spec.indicators[0].period)

        invalid_cases = (
            ({"type": "unknown", "period": 5}, "indicators[0].type"),
            ({"type": "sma", "period": 0}, "indicators[0].period"),
            ({"type": "sma", "period": 5, "window": 5}, "indicators[0].window"),
            ({"type": "macd", "fast": 6, "slow": 3, "signal": 2}, "indicators[0].fast"),
            ({"type": "bollinger", "period": 5, "deviations": "NaN"}, "indicators[0].deviations"),
        )
        for indicator, field in invalid_cases:
            with self.subTest(field=field):
                invalid_raw = self.synthetic_raw()
                invalid_raw["indicators"] = [indicator]
                self.assert_invalid(invalid_raw, field)

    def test_rejects_duplicate_ids_and_outputs_at_chapter_level(self):
        first = parse_figure_spec(self.synthetic_raw(), self.chapter_path)
        duplicate_id = parse_figure_spec(self.synthetic_raw(), self.chapter_path)
        with self.assertRaisesRegex(ValueError, "id"):
            validate_unique_figure_specs((first, duplicate_id))

        same_output_raw = self.synthetic_raw()
        same_output_raw["id"] = "another-id"
        duplicate_output = parse_figure_spec(same_output_raw, self.chapter_path)
        with self.assertRaisesRegex(ValueError, "output"):
            validate_unique_figure_specs((first, duplicate_output))

        case_collision_raw = self.synthetic_raw()
        case_collision_raw["id"] = "case-collision"
        case_collision_raw["output"] = "assets/figures/SYNTHETIC-BASIC.svg"
        case_collision = parse_figure_spec(case_collision_raw, self.chapter_path)
        with self.assertRaisesRegex(ValueError, "output"):
            validate_unique_figure_specs((first, case_collision))


if __name__ == "__main__":
    unittest.main()
