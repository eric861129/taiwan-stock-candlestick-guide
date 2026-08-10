"""圖表規格的型別化解析與輸入驗證。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
import ntpath
from pathlib import Path, PurePosixPath
import re
from typing import Literal, TypeAlias
from urllib.parse import urlsplit

from market_data import OhlcvBar


FigureKind: TypeAlias = Literal["synthetic", "historical"]
Market: TypeAlias = Literal["TWSE", "TPEX"]
IndicatorKind: TypeAlias = Literal["sma", "ema", "atr", "rsi", "kd", "macd", "bollinger"]

_TRADITIONAL_CHINESE_PATTERN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_ISO_DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
_HISTORICAL_FIELDS = (
    "market",
    "symbol",
    "start",
    "end",
    "timeframe",
    "price_mode",
    "source_url",
    "checked_on",
    "corporate_actions",
)
_SUPPORTED_INDICATORS = frozenset({"sma", "ema", "atr", "rsi", "kd", "macd", "bollinger"})


@dataclass(frozen=True, slots=True)
class ZoneAnnotation:
    """以日期與價格範圍標示的關鍵區域。"""

    type: Literal["zone"]
    start: date
    end: date
    low: Decimal
    high: Decimal
    label: str


@dataclass(frozen=True, slots=True)
class LineAnnotation:
    """以兩個日期價格座標標示的趨勢線。"""

    type: Literal["line"]
    start: date
    end: date
    start_price: Decimal
    end_price: Decimal
    label: str


@dataclass(frozen=True, slots=True)
class ArrowAnnotation:
    """以兩個日期價格座標標示的方向箭頭。"""

    type: Literal["arrow"]
    start: date
    end: date
    start_price: Decimal
    end_price: Decimal
    label: str


@dataclass(frozen=True, slots=True)
class LabelAnnotation:
    """附著在一個日期價格座標上的文字標籤。"""

    type: Literal["label"]
    date: date
    price: Decimal
    label: str


Annotation: TypeAlias = ZoneAnnotation | LineAnnotation | ArrowAnnotation | LabelAnnotation


@dataclass(frozen=True, slots=True)
class IndicatorSpec:
    """Renderer 可計算與繪製的技術指標宣告。"""

    type: IndicatorKind
    period: int | None = None
    smooth_k: int | None = None
    smooth_d: int | None = None
    fast: int | None = None
    slow: int | None = None
    signal: int | None = None
    deviations: Decimal | None = None


@dataclass(frozen=True, slots=True)
class FigureSpec:
    """一張教材圖的完整、不可變圖表規格。"""

    id: str
    kind: FigureKind
    title: str
    alt_text: str
    output: Path
    annotations: tuple[Annotation, ...] = ()
    indicators: tuple[IndicatorSpec, ...] = ()
    bars: tuple[OhlcvBar, ...] = ()
    market: Market | None = None
    symbol: str | None = None
    start: date | None = None
    end: date | None = None
    timeframe: str | None = None
    price_mode: str | None = None
    source_url: str | None = None
    checked_on: date | None = None
    corporate_actions: tuple[str, ...] = ()


def parse_figure_spec(raw: dict[str, object], chapter_path: Path) -> FigureSpec:
    """將 chapter HTML comment 中的原始 JSON 規格轉成受驗證的型別資料。"""

    del chapter_path
    if not isinstance(raw, dict):
        _fail("spec", "must be an object")

    figure_id = _text(_required(raw, "id"), "id")
    kind_text = _text(_required(raw, "kind"), "kind")
    if kind_text not in {"synthetic", "historical"}:
        _fail("kind", "must be synthetic or historical")
    kind: FigureKind = kind_text  # type: ignore[assignment]

    title = _text(_required(raw, "title"), "title")
    alt_text = _text(_required(raw, "alt_text"), "alt_text")
    if _TRADITIONAL_CHINESE_PATTERN.search(alt_text) is None:
        _fail("alt_text", "must contain Traditional Chinese text")
    output = _output_path(_required(raw, "output"))
    annotations = _annotations(raw.get("annotations", []))
    indicators = _indicators(raw.get("indicators", []))

    if kind == "synthetic":
        for field in _HISTORICAL_FIELDS:
            if field in raw:
                _fail(field, "must not be declared for synthetic figures")
        return FigureSpec(
            id=figure_id,
            kind=kind,
            title=title,
            alt_text=alt_text,
            output=output,
            annotations=annotations,
            indicators=indicators,
            bars=_bars(_required(raw, "bars")),
        )

    if "bars" in raw:
        _fail("bars", "must not be declared for historical figures")

    market_text = _text(_required(raw, "market"), "market")
    if market_text not in {"TWSE", "TPEX"}:
        _fail("market", "must be TWSE or TPEX")
    market: Market = market_text  # type: ignore[assignment]
    symbol = _text(_required(raw, "symbol"), "symbol")
    start = _iso_date(_required(raw, "start"), "start")
    end = _iso_date(_required(raw, "end"), "end")
    if start > end:
        _fail("start", "must not be later than end")
    timeframe = _text(_required(raw, "timeframe"), "timeframe")
    if timeframe != "1d":
        _fail("timeframe", "only 1d is supported")
    price_mode = _text(_required(raw, "price_mode"), "price_mode")
    if price_mode != "raw":
        _fail("price_mode", "only raw is supported by the market-data adapter")
    source_url = _http_url(_required(raw, "source_url"), "source_url")
    checked_on = _iso_date(_required(raw, "checked_on"), "checked_on")
    corporate_actions = _corporate_actions(_required(raw, "corporate_actions"))

    return FigureSpec(
        id=figure_id,
        kind=kind,
        title=title,
        alt_text=alt_text,
        output=output,
        annotations=annotations,
        indicators=indicators,
        market=market,
        symbol=symbol,
        start=start,
        end=end,
        timeframe=timeframe,
        price_mode=price_mode,
        source_url=source_url,
        checked_on=checked_on,
        corporate_actions=corporate_actions,
    )


def validate_unique_figure_specs(specs: tuple[FigureSpec, ...] | list[FigureSpec]) -> None:
    """拒絕同一章或同一 CLI 批次中的重複 ID 與輸出目標。"""

    seen_ids: set[str] = set()
    seen_outputs: set[str] = set()
    for spec in specs:
        if spec.id in seen_ids:
            _fail("id", f"duplicate figure id: {spec.id}")
        seen_ids.add(spec.id)
        output = spec.output.as_posix().casefold()
        if output in seen_outputs:
            _fail("output", f"duplicate figure output: {output}")
        seen_outputs.add(output)


def _required(raw: dict[str, object], field: str) -> object:
    if field not in raw:
        _fail(field, "is required")
    return raw[field]


def _text(value: object, field: str) -> str:
    if not isinstance(value, str):
        _fail(field, "must be text")
    result = value.strip()
    if not result:
        _fail(field, "must not be empty")
    if not _safe_text(result):
        _fail(field, "contains unsafe control characters")
    return result


def _safe_text(value: str) -> bool:
    return all(
        ord(character) >= 32
        and ord(character) != 127
        and not 0xD800 <= ord(character) <= 0xDFFF
        for character in value
    )


def _iso_date(value: object, field: str) -> date:
    text = _text(value, field)
    if _ISO_DATE_PATTERN.fullmatch(text) is None:
        _fail(field, "must be an ISO date in YYYY-MM-DD format")
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        _fail(field, f"must be a valid ISO date: {error}")


def _decimal(value: object, field: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        _fail(field, "must be a finite number")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        _fail(field, f"must be a finite number: {error}")
    if not result.is_finite():
        _fail(field, "must be a finite number")
    return result


def _output_path(value: object) -> Path:
    text = _text(value, "output")
    if "\\" in text:
        _fail("output", "must use root-relative POSIX separators")
    path = PurePosixPath(text)
    if path.is_absolute() or ".." in path.parts:
        _fail("output", "must not be absolute or traverse directories")
    if len(path.parts) < 3 or path.parts[:2] != ("assets", "figures"):
        _fail("output", "must be strictly under assets/figures/")
    for part in path.parts:
        if ntpath.isreserved(part):
            _fail("output", "contains a Windows drive, device, or unsafe path component")
    if path.suffix != ".svg" or path.name == ".svg":
        _fail("output", "must have a .svg extension")
    return Path(*path.parts)


def _bars(value: object) -> tuple[OhlcvBar, ...]:
    if not isinstance(value, list) or not value:
        _fail("bars", "must be a non-empty list")

    parsed: list[OhlcvBar] = []
    previous_date: date | None = None
    for index, item in enumerate(value):
        prefix = f"bars[{index}]"
        if not isinstance(item, dict):
            _fail(prefix, "must be an object")
        trading_date = _iso_date(_annotation_value(item, "date", prefix), f"{prefix}.date")
        open_price = _decimal(_annotation_value(item, "open", prefix), f"{prefix}.open")
        high = _decimal(_annotation_value(item, "high", prefix), f"{prefix}.high")
        low = _decimal(_annotation_value(item, "low", prefix), f"{prefix}.low")
        close = _decimal(_annotation_value(item, "close", prefix), f"{prefix}.close")
        volume = _volume(_annotation_value(item, "volume", prefix), f"{prefix}.volume")
        if low > open_price or low > close:
            _fail(f"{prefix}.low", "must be less than or equal to open and close")
        if open_price > high:
            _fail(f"{prefix}.open", "must be less than or equal to high")
        if close > high:
            _fail(f"{prefix}.close", "must be less than or equal to high")
        if previous_date is not None and trading_date <= previous_date:
            _fail(f"{prefix}.date", "must be strictly increasing")
        previous_date = trading_date
        parsed.append(OhlcvBar(trading_date, open_price, high, low, close, volume))
    return tuple(parsed)


def _volume(value: object, field: str) -> int:
    decimal_value = _decimal(value, field)
    if decimal_value != decimal_value.to_integral_value():
        _fail(field, "must be a whole number")
    if decimal_value < 0:
        _fail(field, "must be non-negative")
    return int(decimal_value)


def _annotations(value: object) -> tuple[Annotation, ...]:
    if not isinstance(value, list):
        _fail("annotations", "must be a list")
    return tuple(_annotation(item, index) for index, item in enumerate(value))


def _annotation(value: object, index: int) -> Annotation:
    prefix = f"annotations[{index}]"
    if not isinstance(value, dict):
        _fail(prefix, "must be an object")
    annotation_type = _text(_annotation_value(value, "type", prefix), f"{prefix}.type")
    if annotation_type == "zone":
        start = _iso_date(_annotation_value(value, "start", prefix), f"{prefix}.start")
        end = _iso_date(_annotation_value(value, "end", prefix), f"{prefix}.end")
        if start > end:
            _fail(f"{prefix}.start", "must not be later than end")
        low = _decimal(_annotation_value(value, "low", prefix), f"{prefix}.low")
        high = _decimal(_annotation_value(value, "high", prefix), f"{prefix}.high")
        if low > high:
            _fail(f"{prefix}.low", "must not be greater than high")
        return ZoneAnnotation("zone", start, end, low, high, _text(_annotation_value(value, "label", prefix), f"{prefix}.label"))
    if annotation_type in {"line", "arrow"}:
        start = _iso_date(_annotation_value(value, "start", prefix), f"{prefix}.start")
        end = _iso_date(_annotation_value(value, "end", prefix), f"{prefix}.end")
        if start > end:
            _fail(f"{prefix}.start", "must not be later than end")
        start_price = _decimal(_annotation_value(value, "start_price", prefix), f"{prefix}.start_price")
        end_price = _decimal(_annotation_value(value, "end_price", prefix), f"{prefix}.end_price")
        label = _text(_annotation_value(value, "label", prefix), f"{prefix}.label")
        if annotation_type == "line":
            return LineAnnotation("line", start, end, start_price, end_price, label)
        return ArrowAnnotation("arrow", start, end, start_price, end_price, label)
    if annotation_type == "label":
        return LabelAnnotation(
            "label",
            _iso_date(_annotation_value(value, "date", prefix), f"{prefix}.date"),
            _decimal(_annotation_value(value, "price", prefix), f"{prefix}.price"),
            _text(_annotation_value(value, "label", prefix), f"{prefix}.label"),
        )
    _fail(f"{prefix}.type", "must be zone, line, arrow, or label")


def _annotation_value(raw: dict[object, object], field: str, prefix: str) -> object:
    if field not in raw:
        _fail(f"{prefix}.{field}", "is required")
    return raw[field]


def _http_url(value: object, field: str) -> str:
    text = _text(value, field)
    try:
        parsed = urlsplit(text)
    except ValueError as error:
        _fail(field, f"must be a valid HTTP(S) URL: {error}")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        _fail(field, "must be an HTTP(S) URL")
    return text


def _corporate_actions(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        _fail("corporate_actions", "must be a list")
    return tuple(_text(action, f"corporate_actions[{index}]") for index, action in enumerate(value))


def _indicators(value: object) -> tuple[IndicatorSpec, ...]:
    if not isinstance(value, list):
        _fail("indicators", "must be a list")
    return tuple(_indicator(item, index) for index, item in enumerate(value))


def _indicator(value: object, index: int) -> IndicatorSpec:
    prefix = f"indicators[{index}]"
    if not isinstance(value, dict):
        _fail(prefix, "must be an object")
    indicator_type = _text(_annotation_value(value, "type", prefix), f"{prefix}.type")
    if indicator_type not in _SUPPORTED_INDICATORS:
        _fail(f"{prefix}.type", "is not implemented by the renderer")
    kind: IndicatorKind = indicator_type  # type: ignore[assignment]

    if kind in {"sma", "ema", "atr", "rsi"}:
        _reject_unknown_indicator_fields(value, prefix, {"type", "period"})
        return IndicatorSpec(type=kind, period=_positive_int(_annotation_value(value, "period", prefix), f"{prefix}.period"))
    if kind == "kd":
        _reject_unknown_indicator_fields(value, prefix, {"type", "period", "smooth_k", "smooth_d"})
        return IndicatorSpec(
            type=kind,
            period=_positive_int(_annotation_value(value, "period", prefix), f"{prefix}.period"),
            smooth_k=_positive_int(_annotation_value(value, "smooth_k", prefix), f"{prefix}.smooth_k"),
            smooth_d=_positive_int(_annotation_value(value, "smooth_d", prefix), f"{prefix}.smooth_d"),
        )
    if kind == "macd":
        _reject_unknown_indicator_fields(value, prefix, {"type", "fast", "slow", "signal"})
        fast = _positive_int(_annotation_value(value, "fast", prefix), f"{prefix}.fast")
        slow = _positive_int(_annotation_value(value, "slow", prefix), f"{prefix}.slow")
        if fast >= slow:
            _fail(f"{prefix}.fast", "must be less than slow")
        return IndicatorSpec(
            type=kind,
            fast=fast,
            slow=slow,
            signal=_positive_int(_annotation_value(value, "signal", prefix), f"{prefix}.signal"),
        )
    _reject_unknown_indicator_fields(value, prefix, {"type", "period", "deviations"})
    deviations = _decimal(_annotation_value(value, "deviations", prefix), f"{prefix}.deviations")
    if deviations < 0:
        _fail(f"{prefix}.deviations", "must be non-negative")
    return IndicatorSpec(
        type=kind,
        period=_positive_int(_annotation_value(value, "period", prefix), f"{prefix}.period"),
        deviations=deviations,
    )


def _positive_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        _fail(field, "must be a positive integer")
    return value


def _reject_unknown_indicator_fields(raw: dict[object, object], prefix: str, allowed: set[str]) -> None:
    unexpected = sorted((str(field) for field in raw if field not in allowed))
    if unexpected:
        _fail(f"{prefix}.{unexpected[0]}", "is not supported for this indicator")


def _fail(field: str, detail: str) -> None:
    raise ValueError(f"{field}: {detail}")
