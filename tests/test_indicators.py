from datetime import date, timedelta
from decimal import Decimal, localcontext
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

from indicators import (
    average_true_range,
    bollinger_bands,
    exponential_moving_average,
    macd,
    relative_strength_index,
    simple_moving_average,
    stochastic_kd,
)
from market_data import OhlcvBar


D = Decimal


def bars_from_rows(rows: list[tuple[str, str, str, str]]) -> tuple[OhlcvBar, ...]:
    return tuple(
        OhlcvBar(
            trading_date=date(2024, 1, 2) + timedelta(days=index),
            open=D(open_price),
            high=D(high),
            low=D(low),
            close=D(close),
            volume=1_000,
        )
        for index, (open_price, high, low, close) in enumerate(rows)
    )


class IndicatorTests(unittest.TestCase):
    def test_simple_moving_average_preserves_warmup_and_uses_decimal(self):
        result = simple_moving_average(tuple(map(D, (1, 2, 3, 4))), 3)

        self.assertEqual((None, None, D("2"), D("3")), result)
        self.assertTrue(all(value is None or isinstance(value, Decimal) for value in result))

    def test_exponential_moving_average_seeds_with_sma(self):
        result = exponential_moving_average(tuple(map(D, (1, 2, 3, 4, 5))), 3)

        self.assertEqual((None, None, D("2"), D("3"), D("4")), result)

    def test_average_true_range_uses_gap_aware_true_range_and_wilder_smoothing(self):
        bars = bars_from_rows(
            [
                ("9", "10", "8", "9"),
                ("13", "15", "12", "14"),
                ("13", "14", "10", "11"),
                ("12", "13", "11", "12"),
            ]
        )

        result = average_true_range(bars, 3)

        # 真實波幅為 2、6、4、2；初始平均為 4，接著為 (4*2 + 2) / 3 = 10/3。
        self.assertEqual((None, None, D("4"), D("10") / D("3")), result)

    def test_relative_strength_index_uses_wilder_averages(self):
        result = relative_strength_index(tuple(map(D, (1, 2, 3, 2, 2))), 3)

        # 初始漲幅／跌幅為 (1, 1, 0) 與 (0, 0, 1)，因此 RSI = 2 / 3 * 100。
        expected_rsi = D("100") - D("100") / D("3")
        self.assertEqual((None, None, None, expected_rsi, expected_rsi), result)

    def test_relative_strength_index_returns_100_when_loss_is_zero(self):
        result = relative_strength_index(tuple(map(D, (1, 2, 3, 4))), 2)

        self.assertEqual((None, None, D("100"), D("100")), result)

    def test_relative_strength_index_returns_neutral_50_for_flat_values(self):
        result = relative_strength_index(tuple(map(D, (5, 5, 5, 5))), 2)

        self.assertEqual((None, None, D("50"), D("50")), result)

    def test_relative_strength_index_handles_later_zero_gain_and_loss_periods(self):
        result = relative_strength_index(tuple(map(D, (1, 2, 2, 1, 1))), 1)

        self.assertEqual((None, D("100"), D("50"), D("0"), D("50")), result)

    def test_stochastic_kd_handles_flat_window_and_smoothing_warmup(self):
        bars = bars_from_rows(
            [
                ("10", "10", "10", "10"),
                ("10", "12", "8", "10"),
                ("10", "12", "8", "12"),
                ("12", "14", "10", "11"),
                ("10", "14", "10", "11"),
            ]
        )

        result = stochastic_kd(bars, period=3, smooth_k=2, smooth_d=2)

        self.assertEqual(
            (
                (None, None),
                (None, None),
                (None, None),
                (D("75"), None),
                (D("50"), D("62.5")),
            ),
            result,
        )

        flat_result = stochastic_kd(bars[:1], period=1, smooth_k=1, smooth_d=1)
        self.assertEqual(((D("50"), D("50")),), flat_result)

    def test_macd_aligns_lines_and_histogram_to_input(self):
        result = macd(tuple(map(D, (1, 2, 3, 4, 5, 6))), fast=2, slow=3, signal=2)

        expected = (
            (None, None, None),
            (None, None, None),
            (D("0.5"), None, None),
            (D("0.5"), D("0.5"), D("0.0")),
            (D("0.5"), D("0.5"), D("0.0")),
            (D("0.5"), D("0.5"), D("0.0")),
        )
        self.assertEqual(expected, result)

    def test_macd_signal_ema_updates_for_nonconstant_macd_values(self):
        result = macd(tuple(map(D, (0, 0, 0, 6, 0, 0))), fast=1, slow=3, signal=3)

        self.assertEqual(
            (
                (None, None, None),
                (None, None, None),
                (D("0"), None, None),
                (D("3"), None, None),
                (D("-1.5"), D("0.5"), D("-2.0")),
                (D("-0.75"), D("-0.125"), D("-0.625")),
            ),
            result,
        )

    def test_bollinger_bands_use_population_standard_deviation(self):
        with localcontext() as context:
            context.prec = 40
            result = bollinger_bands(tuple(map(D, (1, 2, 3, 4))), 4, D("1"))
            standard_deviation = (D("5") / D("4")).sqrt()
            self.assertEqual(
                (
                    (None, None, None),
                    (None, None, None),
                    (None, None, None),
                    (D("2.5") + standard_deviation, D("2.5"), D("2.5") - standard_deviation),
                ),
                result,
            )

    def test_period_and_length_boundaries_name_the_offending_parameter(self):
        with self.assertRaisesRegex(ValueError, "period"):
            simple_moving_average((D("1"),), 0)
        with self.assertRaisesRegex(ValueError, "values"):
            simple_moving_average((D("1"),), 2)
        with self.assertRaisesRegex(ValueError, "bars"):
            average_true_range((), 1)
        with self.assertRaisesRegex(ValueError, "values"):
            relative_strength_index((D("1"), D("2")), 2)
        with self.assertRaisesRegex(ValueError, "values"):
            exponential_moving_average((D("1"),), 2)
        with self.assertRaisesRegex(ValueError, "bars"):
            stochastic_kd((), 1, 1, 1)
        with self.assertRaisesRegex(ValueError, "values"):
            macd((D("1"), D("2")), fast=1, slow=3, signal=1)
        with self.assertRaisesRegex(ValueError, "values"):
            bollinger_bands((D("1"),), 2, D("1"))

    def test_stochastic_rejects_invalid_smoothing_periods(self):
        bars = bars_from_rows([("1", "2", "1", "2")])

        with self.assertRaisesRegex(ValueError, "smooth_k"):
            stochastic_kd(bars, 1, 0, 1)
        with self.assertRaisesRegex(ValueError, "smooth_d"):
            stochastic_kd(bars, 1, 1, 0)

    def test_macd_rejects_fast_period_not_below_slow_period(self):
        with self.assertRaisesRegex(ValueError, "fast.*slow"):
            macd(tuple(map(D, (1, 2, 3))), fast=3, slow=3, signal=1)
        with self.assertRaisesRegex(ValueError, "signal"):
            macd(tuple(map(D, (1, 2, 3))), fast=1, slow=2, signal=0)

    def test_bollinger_rejects_negative_and_non_finite_deviations(self):
        values = tuple(map(D, (1, 2, 3)))

        with self.assertRaisesRegex(ValueError, "deviations"):
            bollinger_bands(values, 2, D("-1"))
        with self.assertRaisesRegex(ValueError, "deviations"):
            bollinger_bands(values, 2, D("NaN"))
        with self.assertRaisesRegex(ValueError, "deviations"):
            bollinger_bands(values, 2, D("Infinity"))

    def test_all_indicators_keep_length_warmup_and_decimal_types_on_long_series(self):
        values = tuple(D(index) for index in range(1, 31))
        bars = bars_from_rows(
            [(str(index), str(index + 1), str(index - 1), str(index)) for index in range(1, 31)]
        )

        single_series = (
            simple_moving_average(values, 5),
            exponential_moving_average(values, 5),
            average_true_range(bars, 5),
            relative_strength_index(values, 14),
        )
        pair_series = stochastic_kd(bars, period=5, smooth_k=3, smooth_d=3)
        triple_series = (
            macd(values, fast=3, slow=6, signal=4),
            bollinger_bands(values, period=5, deviations=D("2")),
        )

        for series in (*single_series, pair_series, *triple_series):
            self.assertEqual(len(values), len(series))
        for series in single_series:
            self.assertTrue(all(value is None or isinstance(value, Decimal) for value in series))
        for series in (pair_series, *triple_series):
            self.assertTrue(
                all(value is None or isinstance(value, Decimal) for row in series for value in row)
            )

        self.assertEqual((None,) * 4, single_series[0][:4])
        self.assertEqual((None,) * 14, single_series[3][:14])
        self.assertEqual((None, None), pair_series[5])
        self.assertIsNotNone(pair_series[6][0])
        self.assertIsNone(pair_series[7][1])
        self.assertIsNotNone(pair_series[8][1])
        self.assertIsNotNone(triple_series[0][5][0])
        self.assertIsNone(triple_series[0][7][1])
        self.assertIsNotNone(triple_series[0][8][1])


if __name__ == "__main__":
    unittest.main()
