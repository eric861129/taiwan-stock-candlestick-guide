"""以 Decimal 計算、可重現且保留暖機區段的技術指標。"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Sequence

from market_data import OhlcvBar


__all__ = [
    "average_true_range",
    "bollinger_bands",
    "exponential_moving_average",
    "macd",
    "relative_strength_index",
    "simple_moving_average",
    "stochastic_kd",
]


_ZERO = Decimal("0")
_ONE_HUNDRED = Decimal("100")


def simple_moving_average(values: Sequence[Decimal], period: int) -> tuple[Decimal | None, ...]:
    """計算簡單移動平均，前 ``period - 1`` 筆保留為 ``None``。"""

    _validate_period(period)
    decimals = _decimal_values(values, "values")
    _require_length(decimals, period, "values", "values")
    return _sma_decimals(decimals, period)


def exponential_moving_average(values: Sequence[Decimal], period: int) -> tuple[Decimal | None, ...]:
    """以第一個期間的 SMA 作為種子計算指數移動平均。"""

    _validate_period(period)
    decimals = _decimal_values(values, "values")
    _require_length(decimals, period, "values", "values")
    return _ema_decimals(decimals, period)


def average_true_range(bars: Sequence[OhlcvBar], period: int) -> tuple[Decimal | None, ...]:
    """計算以 Wilder 平滑方式更新的平均真實波幅。"""

    _validate_period(period)
    bar_values = tuple(bars)
    _require_length(bar_values, period, "bars", "bars")
    true_ranges = _true_ranges(bar_values)

    result: list[Decimal | None] = [None] * len(bar_values)
    average = sum(true_ranges[:period], _ZERO) / Decimal(period)
    result[period - 1] = average
    for index in range(period, len(true_ranges)):
        average = ((average * Decimal(period - 1)) + true_ranges[index]) / Decimal(period)
        result[index] = average
    return tuple(result)


def relative_strength_index(values: Sequence[Decimal], period: int) -> tuple[Decimal | None, ...]:
    """以 Wilder 平均漲跌幅計算 RSI；無漲跌時回傳中性值 50。"""

    _validate_period(period)
    decimals = _decimal_values(values, "values")
    _require_length(decimals, period + 1, "values", "values")

    gains: list[Decimal] = []
    losses: list[Decimal] = []
    for previous, current in zip(decimals, decimals[1:]):
        change = current - previous
        gains.append(max(change, _ZERO))
        losses.append(max(-change, _ZERO))

    average_gain = sum(gains[:period], _ZERO) / Decimal(period)
    average_loss = sum(losses[:period], _ZERO) / Decimal(period)
    result: list[Decimal | None] = [None] * len(decimals)
    result[period] = _rsi_value(average_gain, average_loss)

    for change_index in range(period, len(gains)):
        average_gain = ((average_gain * Decimal(period - 1)) + gains[change_index]) / Decimal(period)
        average_loss = ((average_loss * Decimal(period - 1)) + losses[change_index]) / Decimal(period)
        result[change_index + 1] = _rsi_value(average_gain, average_loss)
    return tuple(result)


def stochastic_kd(
    bars: Sequence[OhlcvBar],
    period: int,
    smooth_k: int,
    smooth_d: int,
) -> tuple[tuple[Decimal | None, Decimal | None], ...]:
    """計算 rolling %K，並依序以 SMA 平滑成 %K 與 %D。"""

    _validate_period(period)
    _validate_period(smooth_k, "smooth_k")
    _validate_period(smooth_d, "smooth_d")
    bar_values = tuple(bars)
    _require_length(bar_values, period, "bars", "bars")

    highs = [_bar_decimal(bar, "high") for bar in bar_values]
    lows = [_bar_decimal(bar, "low") for bar in bar_values]
    closes = [_bar_decimal(bar, "close") for bar in bar_values]
    raw_k: list[Decimal | None] = [None] * len(bar_values)
    for index in range(period - 1, len(bar_values)):
        window_high = max(highs[index - period + 1 : index + 1])
        window_low = min(lows[index - period + 1 : index + 1])
        range_size = window_high - window_low
        raw_k[index] = (
            _ONE_HUNDRED / Decimal("2")
            if range_size == _ZERO
            else _ONE_HUNDRED * (closes[index] - window_low) / range_size
        )

    smoothed_k: list[Decimal | None] = [None] * len(bar_values)
    first_k_index = period + smooth_k - 2
    for index in range(first_k_index, len(bar_values)):
        window = raw_k[index - smooth_k + 1 : index + 1]
        smoothed_k[index] = sum((value for value in window if value is not None), _ZERO) / Decimal(smooth_k)

    smoothed_d: list[Decimal | None] = [None] * len(bar_values)
    first_d_index = first_k_index + smooth_d - 1
    for index in range(first_d_index, len(bar_values)):
        window = smoothed_k[index - smooth_d + 1 : index + 1]
        smoothed_d[index] = sum((value for value in window if value is not None), _ZERO) / Decimal(smooth_d)

    return tuple(zip(smoothed_k, smoothed_d))


def macd(
    values: Sequence[Decimal],
    fast: int,
    slow: int,
    signal: int,
) -> tuple[tuple[Decimal | None, Decimal | None, Decimal | None], ...]:
    """計算 MACD、可用 MACD 值的 signal EMA，以及 histogram。"""

    _validate_period(fast, "fast")
    _validate_period(slow, "slow")
    _validate_period(signal, "signal")
    if fast >= slow:
        raise ValueError("fast must be less than slow")
    decimals = _decimal_values(values, "values")
    _require_length(decimals, slow, "values", "values")

    fast_values = _ema_decimals(decimals, fast)
    slow_values = _ema_decimals(decimals, slow)
    macd_values: list[Decimal | None] = [None] * len(decimals)
    for index, (fast_value, slow_value) in enumerate(zip(fast_values, slow_values)):
        if fast_value is not None and slow_value is not None:
            macd_values[index] = fast_value - slow_value

    first_macd_index = slow - 1
    available_macd = tuple(value for value in macd_values if value is not None)
    signal_values = _ema_decimals(available_macd, signal)
    aligned_signal: list[Decimal | None] = [None] * len(decimals)
    for offset, signal_value in enumerate(signal_values):
        aligned_signal[first_macd_index + offset] = signal_value

    result: list[tuple[Decimal | None, Decimal | None, Decimal | None]] = []
    for macd_value, signal_value in zip(macd_values, aligned_signal):
        histogram = None if macd_value is None or signal_value is None else macd_value - signal_value
        result.append((macd_value, signal_value, histogram))
    return tuple(result)


def bollinger_bands(
    values: Sequence[Decimal],
    period: int,
    deviations: Decimal,
) -> tuple[tuple[Decimal | None, Decimal | None, Decimal | None], ...]:
    """計算以母體標準差為基礎的布林上軌、中線與下軌。"""

    _validate_period(period)
    decimals = _decimal_values(values, "values")
    _require_length(decimals, period, "values", "values")
    deviation_value = _decimal_value(deviations, "deviations")
    if deviation_value < _ZERO:
        raise ValueError("deviations must be non-negative")

    result: list[tuple[Decimal | None, Decimal | None, Decimal | None]] = [(None, None, None)] * len(decimals)
    for index in range(period - 1, len(decimals)):
        window = decimals[index - period + 1 : index + 1]
        middle = sum(window, _ZERO) / Decimal(period)
        variance = sum(((value - middle) ** 2 for value in window), _ZERO) / Decimal(period)
        standard_deviation = variance.sqrt()
        offset = deviation_value * standard_deviation
        result[index] = (middle + offset, middle, middle - offset)
    return tuple(result)


def _validate_period(period: int, parameter: str = "period") -> None:
    if isinstance(period, bool) or not isinstance(period, int) or period < 1:
        raise ValueError(f"{parameter} must be an integer greater than or equal to 1")


def _decimal_values(values: Sequence[Decimal], parameter: str) -> tuple[Decimal, ...]:
    try:
        return tuple(_decimal_value(value, parameter) for value in values)
    except TypeError as error:
        raise ValueError(f"{parameter} must be a sequence of finite Decimal values") from error


def _decimal_value(value: object, parameter: str) -> Decimal:
    try:
        decimal_value = value if isinstance(value, Decimal) else Decimal(value)  # type: ignore[arg-type]
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError(f"{parameter} must contain Decimal values") from error
    if not decimal_value.is_finite():
        raise ValueError(f"{parameter} must contain finite Decimal values")
    return decimal_value


def _require_length(values: Sequence[object], minimum: int, parameter: str, item_name: str) -> None:
    if len(values) < minimum:
        raise ValueError(f"{parameter} must contain at least {minimum} {item_name} for the requested period")


def _sma_decimals(values: tuple[Decimal, ...], period: int) -> tuple[Decimal | None, ...]:
    result: list[Decimal | None] = [None] * len(values)
    running_total = _ZERO
    for index, value in enumerate(values):
        running_total += value
        if index >= period:
            running_total -= values[index - period]
        if index >= period - 1:
            result[index] = running_total / Decimal(period)
    return tuple(result)


def _ema_decimals(values: Sequence[Decimal], period: int) -> tuple[Decimal | None, ...]:
    result: list[Decimal | None] = [None] * len(values)
    if len(values) < period:
        return tuple(result)
    average = sum(values[:period], _ZERO) / Decimal(period)
    result[period - 1] = average
    multiplier = Decimal("2") / Decimal(period + 1)
    for index in range(period, len(values)):
        average = ((values[index] - average) * multiplier) + average
        result[index] = average
    return tuple(result)


def _true_ranges(bars: Sequence[OhlcvBar]) -> tuple[Decimal, ...]:
    ranges: list[Decimal] = []
    previous_close: Decimal | None = None
    for bar in bars:
        high = _bar_decimal(bar, "high")
        low = _bar_decimal(bar, "low")
        if previous_close is None:
            ranges.append(high - low)
        else:
            ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
        previous_close = _bar_decimal(bar, "close")
    return tuple(ranges)


def _bar_decimal(bar: OhlcvBar, field: str) -> Decimal:
    try:
        value = getattr(bar, field)
    except AttributeError as error:
        raise ValueError(f"bars must contain OhlcvBar values with {field}") from error
    return _decimal_value(value, f"bars.{field}")


def _rsi_value(average_gain: Decimal, average_loss: Decimal) -> Decimal:
    if average_loss == _ZERO:
        return _ONE_HUNDRED if average_gain > _ZERO else _ONE_HUNDRED / Decimal("2")
    if average_gain == _ZERO:
        return _ZERO
    return _ONE_HUNDRED - (_ONE_HUNDRED / (Decimal("1") + (average_gain / average_loss)))
