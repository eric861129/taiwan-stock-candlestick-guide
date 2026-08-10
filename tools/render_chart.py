"""將受驗證圖表規格轉成可及且可重現的獨立 SVG。"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from html import escape
from typing import Iterable, Sequence

from chart_spec import (
    Annotation,
    ArrowAnnotation,
    FigureSpec,
    IndicatorSpec,
    LabelAnnotation,
    LineAnnotation,
    ZoneAnnotation,
)
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


_WIDTH = Decimal("960")
_LEFT = Decimal("72")
_RIGHT = Decimal("32")
_PRICE_TOP = Decimal("100")
_PRICE_BOTTOM = Decimal("390")
_VOLUME_TOP = Decimal("430")
_VOLUME_BOTTOM = Decimal("535")
_INDICATOR_TOP = Decimal("575")
_INDICATOR_HEIGHT = Decimal("92")
_INDICATOR_GAP = Decimal("22")
_COORDINATE_QUANTUM = Decimal("0.01")
_OVERLAY_INDICATORS = frozenset({"sma", "ema", "bollinger"})


def render_svg(spec: FigureSpec, bars: Sequence[OhlcvBar]) -> str:
    """以固定幾何與排序規則輸出可單獨使用的 UTF-8 SVG 字串。"""

    bar_values = _validate_bars(bars)
    overlay_specs = tuple(item for item in spec.indicators if item.type in _OVERLAY_INDICATORS)
    panel_specs = tuple(item for item in spec.indicators if item.type not in _OVERLAY_INDICATORS)
    height = max(Decimal("640"), _INDICATOR_TOP + len(panel_specs) * (_INDICATOR_HEIGHT + _INDICATOR_GAP) + Decimal("18"))
    x_positions = _x_positions(len(bar_values))
    price_low, price_high = _price_bounds(bar_values)

    def price_y(value: Decimal) -> Decimal:
        return _scaled_y(value, price_low, price_high, _PRICE_TOP, _PRICE_BOTTOM)

    volume_max = max((bar.volume for bar in bar_values), default=0)
    volume_scale = Decimal(max(volume_max, 1))
    candle_width = _candle_width(len(bar_values))

    content = [
        _tag("title", {"id": "chart-title"}, escape(spec.title)),
        _tag("desc", {"id": "chart-desc"}, escape(spec.alt_text)),
        _tag("style", {}, _STYLE),
        _definitions(),
        _text(spec.title, {"class": "chart-heading", "x": _coord(_LEFT), "y": _coord(Decimal("30"))}),
        _axes(price_low, price_high, height),
        _date_labels(bar_values, x_positions),
        _price_candles(bar_values, x_positions, candle_width, price_y),
        _volume_bars(bar_values, x_positions, candle_width, volume_scale),
        _legend(),
        _annotations(spec.annotations, x_positions, bar_values, price_y),
        _overlay_indicators(overlay_specs, bar_values, x_positions, price_y),
        _panel_indicators(panel_specs, bar_values, x_positions),
    ]
    return _tag(
        "svg",
        {
            "aria-labelledby": "chart-title chart-desc",
            "height": _coord(height),
            "role": "img",
            "viewBox": f"0 0 {_coord(_WIDTH)} {_coord(height)}",
            "width": _coord(_WIDTH),
            "xmlns": "http://www.w3.org/2000/svg",
        },
        "\n".join(content),
    )


def _validate_bars(bars: Sequence[OhlcvBar]) -> tuple[OhlcvBar, ...]:
    values = tuple(bars)
    if not values:
        _fail("bars", "must not be empty")
    previous_date: date | None = None
    for index, bar in enumerate(values):
        prefix = f"bars[{index}]"
        if not isinstance(bar, OhlcvBar):
            _fail(prefix, "must be an OhlcvBar")
        if not isinstance(bar.trading_date, date):
            _fail(f"{prefix}.trading_date", "must be a date")
        for field in ("open", "high", "low", "close"):
            value = getattr(bar, field)
            if not isinstance(value, Decimal) or not value.is_finite():
                _fail(f"{prefix}.{field}", "must be a finite Decimal")
        if isinstance(bar.volume, bool) or not isinstance(bar.volume, int) or bar.volume < 0:
            _fail(f"{prefix}.volume", "must be a non-negative integer")
        if bar.low > bar.open or bar.low > bar.close:
            _fail(f"{prefix}.low", "must be less than or equal to open and close")
        if bar.open > bar.high:
            _fail(f"{prefix}.open", "must be less than or equal to high")
        if bar.close > bar.high:
            _fail(f"{prefix}.close", "must be less than or equal to high")
        if previous_date is not None and bar.trading_date <= previous_date:
            _fail(f"{prefix}.trading_date", "must be strictly increasing")
        previous_date = bar.trading_date
    return values


def _price_bounds(bars: Sequence[OhlcvBar]) -> tuple[Decimal, Decimal]:
    low = min(bar.low for bar in bars)
    high = max(bar.high for bar in bars)
    span = high - low
    if span == 0:
        padding = abs(high) * Decimal("0.05")
        if padding == 0:
            padding = Decimal("1")
    else:
        padding = span * Decimal("0.05")
    return low - padding, high + padding


def _x_positions(count: int) -> tuple[Decimal, ...]:
    plot_width = _WIDTH - _LEFT - _RIGHT
    if count == 1:
        return (_LEFT + plot_width / Decimal("2"),)
    return tuple(_LEFT + plot_width * Decimal(index) / Decimal(count - 1) for index in range(count))


def _candle_width(count: int) -> Decimal:
    plot_width = _WIDTH - _LEFT - _RIGHT
    return max(Decimal("4"), min(Decimal("18"), plot_width / Decimal(max(count * 2, 2))))


def _scaled_y(value: Decimal, minimum: Decimal, maximum: Decimal, top: Decimal, bottom: Decimal) -> Decimal:
    span = maximum - minimum
    if span == 0:
        return (top + bottom) / Decimal("2")
    position = top + (maximum - value) * (bottom - top) / span
    return max(top, min(bottom, position))


def _axes(price_low: Decimal, price_high: Decimal, height: Decimal) -> str:
    price_mid = (price_low + price_high) / Decimal("2")
    lines = [
        _empty("line", {"class": "axis", "x1": _coord(_LEFT), "x2": _coord(_LEFT), "y1": _coord(_PRICE_TOP), "y2": _coord(_VOLUME_BOTTOM)}),
        _empty("line", {"class": "axis", "x1": _coord(_LEFT), "x2": _coord(_WIDTH - _RIGHT), "y1": _coord(_PRICE_BOTTOM), "y2": _coord(_PRICE_BOTTOM)}),
        _empty("line", {"class": "axis", "x1": _coord(_LEFT), "x2": _coord(_WIDTH - _RIGHT), "y1": _coord(_VOLUME_BOTTOM), "y2": _coord(_VOLUME_BOTTOM)}),
        _text("價格", {"class": "axis-label", "x": _coord(Decimal("12")), "y": _coord(_PRICE_TOP)}),
        _text(_number(price_high), {"class": "axis-label", "x": _coord(Decimal("16")), "y": _coord(_PRICE_TOP + Decimal("12"))}),
        _text(_number(price_mid), {"class": "axis-label", "x": _coord(Decimal("16")), "y": _coord((_PRICE_TOP + _PRICE_BOTTOM) / Decimal("2"))}),
        _text(_number(price_low), {"class": "axis-label", "x": _coord(Decimal("16")), "y": _coord(_PRICE_BOTTOM)}),
        _text("成交量", {"class": "axis-label", "x": _coord(Decimal("12")), "y": _coord(_VOLUME_TOP + Decimal("12"))}),
        _text("日期", {"class": "axis-label", "x": _coord(_WIDTH - _RIGHT - Decimal("20")), "y": _coord(_VOLUME_BOTTOM + Decimal("22"))}),
    ]
    if height > Decimal("640"):
        lines.append(_empty("line", {"class": "axis", "x1": _coord(_LEFT), "x2": _coord(_WIDTH - _RIGHT), "y1": _coord(_INDICATOR_TOP - Decimal("14")), "y2": _coord(_INDICATOR_TOP - Decimal("14"))}))
    return _tag("g", {"class": "axes"}, "".join(lines))


def _date_labels(bars: Sequence[OhlcvBar], x_positions: Sequence[Decimal]) -> str:
    labels = [
        _text(
            bars[0].trading_date.isoformat(),
            {"class": "axis-label", "text-anchor": "start", "x": _coord(x_positions[0]), "y": _coord(_VOLUME_BOTTOM + Decimal("38"))},
        )
    ]
    if len(bars) > 1:
        labels.append(
            _text(
                bars[-1].trading_date.isoformat(),
                {"class": "axis-label", "text-anchor": "end", "x": _coord(x_positions[-1]), "y": _coord(_VOLUME_BOTTOM + Decimal("38"))},
            )
        )
    return _tag("g", {"class": "date-labels"}, "".join(labels))


def _price_candles(
    bars: Sequence[OhlcvBar],
    x_positions: Sequence[Decimal],
    candle_width: Decimal,
    price_y: callable,
) -> str:
    candles: list[str] = []
    half_width = candle_width / Decimal("2")
    for bar, x in zip(bars, x_positions):
        direction = _direction(bar)
        colour = {"up": "#c62828", "down": "#2e7d32", "doji": "#5f6368"}[direction]
        candles.append(
            _empty(
                "line",
                {
                    "class": f"candle-wick {direction}",
                    "data-direction": direction,
                    "stroke": colour,
                    "x1": _coord(x),
                    "x2": _coord(x),
                    "y1": _coord(price_y(bar.high)),
                    "y2": _coord(price_y(bar.low)),
                },
            )
        )
        if direction == "doji":
            candles.append(
                _empty(
                    "line",
                    {
                        "class": "candle-body doji cross",
                        "data-direction": "doji",
                        "stroke": colour,
                        "stroke-width": _coord(Decimal("2")),
                        "x1": _coord(x - half_width),
                        "x2": _coord(x + half_width),
                        "y1": _coord(price_y(bar.close)),
                        "y2": _coord(price_y(bar.close)),
                    },
                )
            )
            continue
        top = min(price_y(bar.open), price_y(bar.close))
        body_height = max(Decimal("1"), abs(price_y(bar.open) - price_y(bar.close)))
        attributes: dict[str, str] = {
            "class": f"candle-body {direction} {'hollow' if direction == 'up' else 'solid'}",
            "data-direction": direction,
            "height": _coord(body_height),
            "stroke": colour,
            "stroke-width": _coord(Decimal("1.5")),
            "width": _coord(candle_width),
            "x": _coord(x - half_width),
            "y": _coord(top),
        }
        attributes["fill"] = "none" if direction == "up" else colour
        candles.append(_empty("rect", attributes))
    return _tag("g", {"class": "price-candles"}, "".join(candles))


def _volume_bars(
    bars: Sequence[OhlcvBar],
    x_positions: Sequence[Decimal],
    candle_width: Decimal,
    volume_scale: Decimal,
) -> str:
    rectangles: list[str] = []
    half_width = candle_width / Decimal("2")
    volume_height = _VOLUME_BOTTOM - _VOLUME_TOP
    for bar, x in zip(bars, x_positions):
        height = Decimal(bar.volume) * volume_height / volume_scale
        direction = _direction(bar)
        colour = {"up": "#c62828", "down": "#2e7d32", "doji": "#5f6368"}[direction]
        rectangles.append(
            _empty(
                "rect",
                {
                    "class": f"volume-bar {direction}",
                    "data-direction": direction,
                    "fill": colour,
                    "height": _coord(height),
                    "width": _coord(candle_width),
                    "x": _coord(x - half_width),
                    "y": _coord(_VOLUME_BOTTOM - height),
                },
            )
        )
    return _tag("g", {"class": "volume-bars"}, "".join(rectangles))


def _legend() -> str:
    content = "".join(
        (
            _empty("rect", {"class": "legend-up hollow", "fill": "none", "height": _coord(Decimal("10")), "stroke": "#c62828", "width": _coord(Decimal("14")), "x": _coord(Decimal("600")), "y": _coord(Decimal("48"))}),
            _empty("rect", {"class": "legend-down solid", "fill": "#2e7d32", "height": _coord(Decimal("10")), "stroke": "#2e7d32", "width": _coord(Decimal("14")), "x": _coord(Decimal("690")), "y": _coord(Decimal("48"))}),
            _empty("line", {"class": "legend-doji cross", "stroke": "#5f6368", "x1": _coord(Decimal("782")), "x2": _coord(Decimal("796")), "y1": _coord(Decimal("53")), "y2": _coord(Decimal("53"))}),
            _text("圖例：紅色空心＝上漲；綠色實心＝下跌；灰色十字＝平盤", {"class": "legend-text", "x": _coord(Decimal("520")), "y": _coord(Decimal("72"))}),
        )
    )
    return _tag("g", {"class": "legend"}, content)


def _annotations(
    annotations: Sequence[Annotation],
    x_positions: Sequence[Decimal],
    bars: Sequence[OhlcvBar],
    price_y: callable,
) -> str:
    sorted_annotations = sorted(enumerate(annotations), key=lambda item: (_annotation_key(item[1]), item[0]))
    content: list[str] = []
    for _, annotation in sorted_annotations:
        if isinstance(annotation, ZoneAnnotation):
            x1 = _date_x(annotation.start, bars, x_positions)
            x2 = _date_x(annotation.end, bars, x_positions)
            y1 = price_y(annotation.high)
            y2 = price_y(annotation.low)
            content.extend(
                (
                    _empty("rect", {"class": "annotation zone", "data-annotation": "zone", "fill": "#5b8ff9", "fill-opacity": "0.16", "height": _coord(abs(y2 - y1)), "stroke": "#356ae6", "width": _coord(abs(x2 - x1)), "x": _coord(min(x1, x2)), "y": _coord(min(y1, y2))}),
                    _text(annotation.label, {"class": "annotation-label", "x": _coord(min(x1, x2) + Decimal("3")), "y": _coord(min(y1, y2) + Decimal("14"))}),
                )
            )
        elif isinstance(annotation, LineAnnotation):
            _line_annotation(content, annotation, "line", x_positions, bars, price_y)
        elif isinstance(annotation, ArrowAnnotation):
            _line_annotation(content, annotation, "arrow", x_positions, bars, price_y)
        else:
            content.append(
                _text(
                    annotation.label,
                    {
                        "class": "annotation label",
                        "data-annotation": "label",
                        "x": _coord(_date_x(annotation.date, bars, x_positions)),
                        "y": _coord(price_y(annotation.price) - Decimal("5")),
                    },
                )
            )
    return _tag("g", {"class": "annotations"}, "".join(content))


def _line_annotation(
    content: list[str],
    annotation: LineAnnotation | ArrowAnnotation,
    annotation_type: str,
    x_positions: Sequence[Decimal],
    bars: Sequence[OhlcvBar],
    price_y: callable,
) -> None:
    x1 = _date_x(annotation.start, bars, x_positions)
    x2 = _date_x(annotation.end, bars, x_positions)
    attributes = {
        "class": f"annotation {annotation_type}",
        "data-annotation": annotation_type,
        "stroke": "#6d4c41" if annotation_type == "line" else "#5d4037",
        "stroke-width": _coord(Decimal("1.5")),
        "x1": _coord(x1),
        "x2": _coord(x2),
        "y1": _coord(price_y(annotation.start_price)),
        "y2": _coord(price_y(annotation.end_price)),
    }
    if annotation_type == "arrow":
        attributes["marker-end"] = "url(#arrowhead)"
    content.extend(
        (
            _empty("line", attributes),
            _text(annotation.label, {"class": "annotation-label", "x": _coord(x2 + Decimal("3")), "y": _coord(price_y(annotation.end_price) - Decimal("4"))}),
        )
    )


def _annotation_key(annotation: Annotation) -> tuple[str, str, str, str, str, str]:
    if isinstance(annotation, ZoneAnnotation):
        return (annotation.type, annotation.start.isoformat(), annotation.end.isoformat(), str(annotation.low), str(annotation.high), annotation.label)
    if isinstance(annotation, (LineAnnotation, ArrowAnnotation)):
        return (annotation.type, annotation.start.isoformat(), annotation.end.isoformat(), str(annotation.start_price), str(annotation.end_price), annotation.label)
    return (annotation.type, annotation.date.isoformat(), "", str(annotation.price), "", annotation.label)


def _date_x(target: date, bars: Sequence[OhlcvBar], x_positions: Sequence[Decimal]) -> Decimal:
    first = bars[0].trading_date
    last = bars[-1].trading_date
    if first == last:
        return x_positions[0]
    ratio = Decimal(target.toordinal() - first.toordinal()) / Decimal(last.toordinal() - first.toordinal())
    ratio = max(Decimal("0"), min(Decimal("1"), ratio))
    return x_positions[0] + ratio * (x_positions[-1] - x_positions[0])


def _overlay_indicators(
    indicators: Sequence[IndicatorSpec],
    bars: Sequence[OhlcvBar],
    x_positions: Sequence[Decimal],
    price_y: callable,
) -> str:
    content: list[str] = []
    closes = tuple(bar.close for bar in bars)
    for index, indicator in enumerate(indicators):
        try:
            if indicator.type == "sma":
                values = simple_moving_average(closes, _required_parameter(indicator.period, index, "period"))
                lines = (_polyline(values, x_positions, price_y, "indicator-line sma"),)
            elif indicator.type == "ema":
                values = exponential_moving_average(closes, _required_parameter(indicator.period, index, "period"))
                lines = (_polyline(values, x_positions, price_y, "indicator-line ema"),)
            else:
                upper, middle, lower = zip(*bollinger_bands(
                    closes,
                    _required_parameter(indicator.period, index, "period"),
                    _required_decimal(indicator.deviations, index, "deviations"),
                ))
                lines = (
                    _polyline(upper, x_positions, price_y, "indicator-line bollinger upper"),
                    _polyline(middle, x_positions, price_y, "indicator-line bollinger middle"),
                    _polyline(lower, x_positions, price_y, "indicator-line bollinger lower"),
                )
        except ValueError as error:
            _fail(f"indicators[{index}]", str(error))
        content.append(
            _tag(
                "g",
                {"class": f"indicator overlay {indicator.type}", "data-indicator": indicator.type},
                "".join(lines),
            )
        )
    return "".join(content)


def _panel_indicators(indicators: Sequence[IndicatorSpec], bars: Sequence[OhlcvBar], x_positions: Sequence[Decimal]) -> str:
    content: list[str] = []
    closes = tuple(bar.close for bar in bars)
    for index, indicator in enumerate(indicators):
        top = _INDICATOR_TOP + index * (_INDICATOR_HEIGHT + _INDICATOR_GAP)
        bottom = top + _INDICATOR_HEIGHT
        try:
            title, series = _panel_series(indicator, bars, closes, index)
        except ValueError as error:
            _fail(f"indicators[{index}]", str(error))
        values = tuple(value for _, value_series in series for value in value_series if value is not None)
        if not values:
            _fail(f"indicators[{index}]", "does not have drawable values for the supplied bars")
        minimum, maximum = _indicator_bounds(values, indicator.type)

        def panel_y(value: Decimal) -> Decimal:
            return _scaled_y(value, minimum, maximum, top, bottom)

        panel_content = [
            _empty("rect", {"class": "indicator-frame", "fill": "none", "height": _coord(_INDICATOR_HEIGHT), "stroke": "#9aa0a6", "width": _coord(_WIDTH - _LEFT - _RIGHT), "x": _coord(_LEFT), "y": _coord(top)}),
            _text(title, {"class": "indicator-label", "x": _coord(Decimal("12")), "y": _coord(top + Decimal("15"))}),
        ]
        for class_name, values_for_line in series:
            panel_content.append(_polyline(values_for_line, x_positions, panel_y, f"indicator-line {class_name}"))
        content.append(_tag("g", {"class": f"indicator-panel {indicator.type}", "data-indicator": indicator.type}, "".join(panel_content)))
    return "".join(content)


def _panel_series(
    indicator: IndicatorSpec,
    bars: Sequence[OhlcvBar],
    closes: Sequence[Decimal],
    index: int,
) -> tuple[str, tuple[tuple[str, Sequence[Decimal | None]], ...]]:
    if indicator.type == "atr":
        period = _required_parameter(indicator.period, index, "period")
        return f"ATR({period})", (("atr", average_true_range(bars, period)),)
    if indicator.type == "rsi":
        period = _required_parameter(indicator.period, index, "period")
        return f"RSI({period})", (("rsi", relative_strength_index(closes, period)),)
    if indicator.type == "kd":
        period = _required_parameter(indicator.period, index, "period")
        values = stochastic_kd(
            bars,
            period,
            _required_parameter(indicator.smooth_k, index, "smooth_k"),
            _required_parameter(indicator.smooth_d, index, "smooth_d"),
        )
        k_values, d_values = zip(*values)
        return f"KD({period})", (("kd-k", k_values), ("kd-d", d_values))
    fast = _required_parameter(indicator.fast, index, "fast")
    slow = _required_parameter(indicator.slow, index, "slow")
    signal = _required_parameter(indicator.signal, index, "signal")
    values = macd(closes, fast, slow, signal)
    macd_values, signal_values, histogram = zip(*values)
    return f"MACD({fast},{slow},{signal})", (("macd", macd_values), ("macd-signal", signal_values), ("macd-histogram", histogram))


def _indicator_bounds(values: Sequence[Decimal], indicator_type: str) -> tuple[Decimal, Decimal]:
    minimum = min(values)
    maximum = max(values)
    if indicator_type in {"rsi", "kd"}:
        minimum = min(minimum, Decimal("0"))
        maximum = max(maximum, Decimal("100"))
    elif minimum == maximum:
        padding = abs(maximum) * Decimal("0.05")
        if padding == 0:
            padding = Decimal("1")
        minimum -= padding
        maximum += padding
    else:
        padding = (maximum - minimum) * Decimal("0.05")
        minimum -= padding
        maximum += padding
    return minimum, maximum


def _polyline(
    values: Sequence[Decimal | None],
    x_positions: Sequence[Decimal],
    y_coordinate: callable,
    class_name: str,
) -> str:
    points = " ".join(
        f"{_coord(x)},{_coord(y_coordinate(value))}"
        for x, value in zip(x_positions, values)
        if value is not None
    )
    if not points:
        return ""
    return _empty("polyline", {"class": class_name, "fill": "none", "points": points})


def _required_parameter(value: int | None, index: int, field: str) -> int:
    if value is None:
        _fail(f"indicators[{index}].{field}", "is required")
    return value


def _required_decimal(value: Decimal | None, index: int, field: str) -> Decimal:
    if value is None:
        _fail(f"indicators[{index}].{field}", "is required")
    return value


def _direction(bar: OhlcvBar) -> str:
    if bar.close > bar.open:
        return "up"
    if bar.close < bar.open:
        return "down"
    return "doji"


def _definitions() -> str:
    marker = _tag(
        "marker",
        {
            "id": "arrowhead",
            "markerHeight": _coord(Decimal("6")),
            "markerWidth": _coord(Decimal("6")),
            "orient": "auto",
            "refX": _coord(Decimal("5")),
            "refY": _coord(Decimal("3")),
        },
        _empty("path", {"d": "M 0 0 L 6 3 L 0 6 z", "fill": "#5d4037"}),
    )
    return _tag("defs", {}, marker)


def _text(value: str, attributes: dict[str, str]) -> str:
    return _tag("text", attributes, escape(value))


def _tag(name: str, attributes: dict[str, str], content: str) -> str:
    return f"<{name}{_attributes(attributes)}>{content}</{name}>"


def _empty(name: str, attributes: dict[str, str]) -> str:
    return f"<{name}{_attributes(attributes)} />"


def _attributes(attributes: dict[str, str]) -> str:
    return "".join(f' {escape(name, quote=True)}="{escape(value, quote=True)}"' for name, value in sorted(attributes.items()))


def _coord(value: Decimal) -> str:
    rounded = value.quantize(_COORDINATE_QUANTUM, rounding=ROUND_HALF_UP)
    if rounded == 0:
        rounded = Decimal("0")
    return format(rounded, "f")


def _number(value: Decimal) -> str:
    return format(value.quantize(_COORDINATE_QUANTUM, rounding=ROUND_HALF_UP), "f")


def _fail(field: str, detail: str) -> None:
    raise ValueError(f"{field}: {detail}")


_STYLE = """.chart-heading{font:600 18px sans-serif;fill:#202124}.axis{stroke:#9aa0a6;stroke-width:1}.axis-label{font:12px sans-serif;fill:#3c4043}.legend-text,.annotation-label,.indicator-label{font:12px sans-serif;fill:#202124}.candle-wick{stroke-width:1.25}.volume-bar{fill-opacity:.55}.annotation{stroke-dasharray:4 3}.indicator-line{stroke-width:1.5}.sma{stroke:#1565c0}.ema{stroke:#8e24aa}.bollinger{stroke:#ef6c00}.atr{stroke:#455a64}.rsi{stroke:#00695c}.kd-k{stroke:#1565c0}.kd-d{stroke:#ef6c00}.macd{stroke:#6a1b9a}.macd-signal{stroke:#d81b60}.macd-histogram{stroke:#546e7a}"""
