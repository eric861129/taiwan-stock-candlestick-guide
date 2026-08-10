from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Callable, Literal, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


MISSING_PRICE_MARKERS = frozenset({"", "-", "--", "---", "N/A", "NA", "無", "—"})
TWSE_STOCK_DAY_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY"
TPEX_TRADING_STOCK_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock"
USER_AGENT = "taiwan-stock-candlestick-guide/1.0 (educational market-data adapter)"


@dataclass(frozen=True, slots=True)
class OhlcvBar:
    trading_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


class MarketDataError(RuntimeError):
    def __init__(self, market: str, symbol: str, month: date | str, rule: str, detail: str):
        month_text = month.strftime("%Y-%m") if isinstance(month, date) else month
        super().__init__(f"market={market}; symbol={symbol}; month={month_text}; rule={rule}; {detail}")


class _PayloadError(ValueError):
    def __init__(self, rule: str, detail: str):
        self.rule = rule
        super().__init__(detail)


def roc_to_date(value: str) -> date:
    year, month, day = (int(part) for part in value.strip().split("/"))
    return date(year + 1911, month, day)


def parse_twse_month(payload: dict[str, Any]) -> tuple[OhlcvBar, ...]:
    _ensure_success_status(payload)
    try:
        indexes = _column_indexes(payload["fields"], ("日期", "成交股數", "開盤價", "最高價", "最低價", "收盤價"))
        bars = _parse_rows(
            payload["data"],
            indexes,
            open_field="開盤價",
            high_field="最高價",
            low_field="最低價",
            close_field="收盤價",
            volume_field="成交股數",
            volume_multiplier=1,
        )
    except _PayloadError:
        raise
    except (IndexError, KeyError, TypeError, ValueError) as error:
        raise _PayloadError("malformed-payload", str(error)) from error
    return _sort_and_validate(bars)


def parse_tpex_month(payload: dict[str, Any]) -> tuple[OhlcvBar, ...]:
    _ensure_success_status(payload)
    try:
        tables = payload["tables"]
        if not isinstance(tables, list) or not tables or not isinstance(tables[0], dict):
            raise ValueError("tables[0] must be an object")
        table = tables[0]
        indexes = _column_indexes(table["fields"], ("日期", "成交仟股", "開盤", "最高", "最低", "收盤"))
        bars = _parse_rows(
            table["data"],
            indexes,
            open_field="開盤",
            high_field="最高",
            low_field="最低",
            close_field="收盤",
            volume_field="成交仟股",
            volume_multiplier=1_000,
        )
    except _PayloadError:
        raise
    except (IndexError, KeyError, TypeError, ValueError) as error:
        raise _PayloadError("malformed-payload", str(error)) from error
    return _sort_and_validate(bars)


def _ensure_success_status(payload: object) -> None:
    if not isinstance(payload, dict):
        raise _PayloadError("malformed-payload", "payload must be an object")
    status = payload.get("stat")
    if not isinstance(status, str):
        raise _PayloadError("malformed-payload", "stat must be text")
    if status.strip().lower() != "ok":
        raise _PayloadError("source-status", f"stat={status!r}")


def _column_indexes(fields: object, required_fields: tuple[str, ...]) -> dict[str, int]:
    if not isinstance(fields, list):
        raise ValueError("fields must be a list")
    indexes: dict[str, int] = {}
    for index, field in enumerate(fields):
        if not isinstance(field, str):
            raise ValueError("field name must be text")
        indexes["".join(field.split())] = index
    missing = [field for field in required_fields if field not in indexes]
    if missing:
        raise ValueError(f"missing fields: {', '.join(missing)}")
    return indexes


def _parse_rows(
    rows: object,
    indexes: dict[str, int],
    *,
    open_field: str,
    high_field: str,
    low_field: str,
    close_field: str,
    volume_field: str,
    volume_multiplier: int,
) -> tuple[OhlcvBar, ...]:
    if not isinstance(rows, list):
        raise ValueError("data must be a list")
    bars: list[OhlcvBar] = []
    for row in rows:
        if not isinstance(row, list):
            raise ValueError("data row must be a list")
        bars.append(
            OhlcvBar(
                trading_date=roc_to_date(_text_at(row, indexes["日期"])),
                open=_parse_price(_text_at(row, indexes[open_field])),
                high=_parse_price(_text_at(row, indexes[high_field])),
                low=_parse_price(_text_at(row, indexes[low_field])),
                close=_parse_price(_text_at(row, indexes[close_field])),
                volume=_parse_volume(_text_at(row, indexes[volume_field])) * volume_multiplier,
            )
        )
    return tuple(bars)


def _text_at(row: list[object], index: int) -> str:
    try:
        value = row[index]
    except IndexError as error:
        raise ValueError("data row is missing a required value") from error
    if not isinstance(value, str):
        raise ValueError("data value must be text")
    return value


def _parse_price(value: object) -> Decimal:
    text = str(value).strip().replace(",", "")
    if text.upper() in MISSING_PRICE_MARKERS:
        raise ValueError("missing price marker")
    try:
        price = Decimal(text)
    except (InvalidOperation, ValueError) as error:
        raise ValueError("invalid price") from error
    if not price.is_finite():
        raise ValueError("invalid price")
    return price


def _parse_volume(value: object) -> int:
    text = str(value).strip().replace(",", "")
    if not text:
        raise ValueError("missing volume")
    try:
        return int(text)
    except ValueError as error:
        raise ValueError("invalid volume") from error


def _sort_and_validate(bars: Sequence[OhlcvBar]) -> tuple[OhlcvBar, ...]:
    ordered = tuple(sorted(bars, key=lambda bar: bar.trading_date))
    errors = validate_bars(ordered)
    if errors:
        raise _PayloadError("validation", "; ".join(errors))
    return ordered


def validate_bars(bars: Sequence[OhlcvBar]) -> list[str]:
    errors: list[str] = []
    previous_date: date | None = None
    for bar in bars:
        if bar.low > bar.open or bar.low > bar.close:
            errors.append("low must be <= open and close")
        if bar.open > bar.high:
            errors.append("open must be <= high")
        if bar.close > bar.high:
            errors.append("close must be <= high")
        if bar.volume < 0:
            errors.append("volume must be non-negative")
        if previous_date is not None and bar.trading_date <= previous_date:
            errors.append("dates must be strictly increasing")
        previous_date = bar.trading_date
    return errors


def fetch_month(
    market: Literal["TWSE", "TPEX"],
    symbol: str,
    month: date,
    cache_dir: Path,
) -> tuple[OhlcvBar, ...]:
    month_start = date(month.year, month.month, 1)
    parser: Callable[[dict[str, Any]], tuple[OhlcvBar, ...]]
    query_parameters: dict[str, str]
    endpoint: str
    if market == "TWSE":
        endpoint = TWSE_STOCK_DAY_URL
        parser = parse_twse_month
        query_parameters = {
            "date": month_start.strftime("%Y%m%d"),
            "stockNo": symbol,
            "response": "json",
        }
    elif market == "TPEX":
        endpoint = TPEX_TRADING_STOCK_URL
        parser = parse_tpex_month
        query_parameters = {
            "date": month_start.strftime("%Y/%m/01"),
            "code": symbol,
            "response": "json",
        }
    else:
        raise ValueError("market must be TWSE or TPEX")

    cache_path = cache_dir / market / symbol / f"{month_start:%Y-%m}.json"
    if cache_path.exists():
        return _parse_payload_with_context(
            cache_path.read_bytes(),
            parser,
            market,
            symbol,
            month_start,
        )

    request = Request(f"{endpoint}?{urlencode(query_parameters)}", headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=30) as response:
            if response.status != 200:
                raise MarketDataError(market, symbol, month_start, "http-status", f"HTTP status {response.status}")
            payload_bytes = response.read()
    except HTTPError as error:
        raise MarketDataError(market, symbol, month_start, "http-status", f"HTTP status {error.code}") from error
    except (URLError, OSError) as error:
        raise MarketDataError(market, symbol, month_start, "network", str(error)) from error

    bars = _parse_payload_with_context(payload_bytes, parser, market, symbol, month_start)
    try:
        _write_cache_atomically(cache_path, payload_bytes)
    except OSError as error:
        raise MarketDataError(market, symbol, month_start, "cache-write", str(error)) from error
    return bars


def _parse_payload_with_context(
    payload_bytes: bytes,
    parser: Callable[[dict[str, Any]], tuple[OhlcvBar, ...]],
    market: str,
    symbol: str,
    month: date,
) -> tuple[OhlcvBar, ...]:
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MarketDataError(market, symbol, month, "malformed-payload", str(error)) from error
    try:
        return parser(payload)
    except _PayloadError as error:
        raise MarketDataError(market, symbol, month, error.rule, str(error)) from error


def _write_cache_atomically(cache_path: Path, payload_bytes: bytes) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="wb",
            dir=cache_path.parent,
            prefix=f".{cache_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(payload_bytes)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        temporary_path.replace(cache_path)
    except OSError:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
        raise


def fetch_range(
    market: Literal["TWSE", "TPEX"],
    symbol: str,
    start: date,
    end: date,
    cache_dir: Path,
) -> tuple[OhlcvBar, ...]:
    if start > end:
        raise ValueError("start must be <= end")

    bars: list[OhlcvBar] = []
    month = date(start.year, start.month, 1)
    final_month = date(end.year, end.month, 1)
    while month <= final_month:
        bars.extend(fetch_month(market, symbol, month, cache_dir))
        month = _next_month(month)
    filtered = tuple(bar for bar in bars if start <= bar.trading_date <= end)
    errors = validate_bars(filtered)
    if errors:
        range_months = f"{start:%Y-%m}..{end:%Y-%m}"
        raise MarketDataError(market, symbol, range_months, "validation", "; ".join(errors))
    return filtered


def _next_month(month: date) -> date:
    if month.month == 12:
        return date(month.year + 1, 1, 1)
    return date(month.year, month.month + 1, 1)
