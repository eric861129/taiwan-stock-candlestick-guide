"""TWSE 與 TPEx 官方盤後資料的受限來源轉接器。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from decimal import Decimal, InvalidOperation
import json
import ssl
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPSHandler, Request, build_opener

from market_data import _OfficialMarketRedirectHandler, _is_official_https_url


Market = Literal["TWSE", "TPEx"]
_MISSING_PRICE_MARKERS = frozenset({"", "-", "--", "---", "N/A", "NA", "無", "—"})
USER_AGENT = "taiwan-stock-candlestick-guide/1.0 (official snapshot adapter)"

TWSE_DAILY_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TPEX_DAILY_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
TWSE_HISTORICAL_DAILY_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
TPEX_HISTORICAL_DAILY_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/otc"
TWSE_COMPANIES_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TPEX_COMPANIES_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
TWSE_ACTIONS_URL = "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL"
TPEX_ACTIONS_URL = "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost"
HOLIDAY_CALENDAR_URL = "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule"

_OFFICIAL_ENDPOINTS = {
    "twse-daily": TWSE_DAILY_URL,
    "tpex-daily": TPEX_DAILY_URL,
    "twse-historical-daily": TWSE_HISTORICAL_DAILY_URL,
    "tpex-historical-daily": TPEX_HISTORICAL_DAILY_URL,
    "twse-companies": TWSE_COMPANIES_URL,
    "tpex-companies": TPEX_COMPANIES_URL,
    "twse-actions": TWSE_ACTIONS_URL,
    "tpex-actions": TPEX_ACTIONS_URL,
    "holiday-calendar": HOLIDAY_CALENDAR_URL,
}


@dataclass(frozen=True, slots=True)
class DailyQuote:
    """一筆官方盤後日行情，成交量一律正規化為股。"""

    market: Market
    code: str
    name: str
    trading_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume_shares: int
    transaction_count: int | None
    source_precision: Decimal
    source_url: str


@dataclass(frozen=True, slots=True)
class SupportedSymbol:
    """可進入第一版比對索引的上市或上櫃普通股。"""

    market: Market
    code: str
    name: str
    security_type: Literal["common-stock"]
    source_url: str


@dataclass(frozen=True, slots=True)
class CorporateAction:
    """官方除權息或資本變動事件，供型態規則停用價格連續性判讀。"""

    market: Market
    code: str
    action_date: date
    action_type: Literal[
        "cash-dividend",
        "stock-dividend",
        "capital-reduction",
        "split",
        "other",
    ]
    affects_price_continuity: bool
    source_url: str
    verified_at: date


@dataclass(frozen=True, slots=True)
class TradingCalendar:
    """TWSE 官方開休市資料轉成台北時區的預期資料截止日依據。"""

    holiday_dates: tuple[date, ...]
    source_url: str
    valid_through: date
    timezone: tzinfo


class MarketSourceError(RuntimeError):
    """官方來源、TLS 或回應契約未通過時提供繁體中文可追蹤錯誤。"""


def fetch_twse_daily(requested_date: date) -> tuple[DailyQuote, ...]:
    """取得指定交易日的 TWSE 上市日行情，回應日期不符即拒絕使用。"""
    quotes = parse_twse_daily(_fetch_official_json("twse-daily"))
    return _require_requested_date(quotes, requested_date, "TWSE")


def fetch_tpex_daily(requested_date: date) -> tuple[DailyQuote, ...]:
    """取得指定交易日的 TPEx 上櫃日行情，回應日期不符即拒絕使用。"""
    quotes = parse_tpex_daily(_fetch_official_json("tpex-daily"))
    return _require_requested_date(quotes, requested_date, "TPEx")


def fetch_twse_historical_daily(requested_date: date) -> tuple[DailyQuote, ...]:
    """取得 TWSE 全市場歷史日行情，供 120 個交易日基準快照使用。"""
    quotes = parse_twse_historical_daily(
        _fetch_official_json(
            "twse-historical-daily",
            {
                "date": requested_date.strftime("%Y%m%d"),
                "type": "ALLBUT0999",
                "response": "json",
            },
        )
    )
    return _require_requested_date(quotes, requested_date, "TWSE")


def fetch_tpex_historical_daily(requested_date: date) -> tuple[DailyQuote, ...]:
    """取得 TPEx 上櫃普通股歷史日行情，限定官方 EW 市場分類。"""
    roc_date = f"{requested_date.year - 1911:03d}/{requested_date:%m/%d}"
    quotes = parse_tpex_historical_daily(
        _fetch_official_json(
            "tpex-historical-daily",
            {"date": roc_date, "type": "EW", "response": "json"},
        )
    )
    return _require_requested_date(quotes, requested_date, "TPEx")


def fetch_supported_symbols() -> tuple[SupportedSymbol, ...]:
    """取得兩市場官方公司主檔建立的普通股支援索引。"""
    return parse_supported_symbols(
        _fetch_official_json("twse-companies"),
        _fetch_official_json("tpex-companies"),
    )


def fetch_corporate_actions() -> tuple[CorporateAction, ...]:
    """取得兩市場的官方公司行動資料。"""
    return parse_corporate_actions(
        _fetch_official_json("twse-actions"),
        _fetch_official_json("tpex-actions"),
    )


def fetch_trading_calendar() -> TradingCalendar:
    """取得 TWSE 官方開休市日曆，供兩市場使用相同的預期截止日基準。"""
    return parse_holiday_calendar(_fetch_official_json("holiday-calendar"))


def parse_holiday_calendar(payload: object) -> TradingCalendar:
    """解析 TWSE 休市日清單；資料不足以覆蓋日期時不可宣稱最新。"""
    if not isinstance(payload, list):
        raise ValueError("官方開休市日曆回應必須是 JSON 陣列。")
    holidays: set[date] = set()
    years: set[int] = set()
    for row in payload:
        if not isinstance(row, dict):
            raise ValueError("官方開休市日曆每一列必須是 JSON 物件。")
        holiday = _parse_official_date(_required_text(row, "Date"))
        holidays.add(holiday)
        years.add(holiday.year)
    if not years:
        raise ValueError("官方開休市日曆不可為空。")
    valid_year = max(years)
    return TradingCalendar(
        holiday_dates=tuple(sorted(holidays)),
        source_url=HOLIDAY_CALENDAR_URL,
        valid_through=date(valid_year, 12, 31),
        timezone=timezone(timedelta(hours=8), name="Asia/Taipei"),
    )


def expected_cutoff_date(calendar: TradingCalendar, now: datetime) -> date | None:
    """依台北時間與 17:30 盤後門檻，回傳應存在的最近一個交易日。"""
    local_now = _taipei_time(calendar, now)
    if local_now.date() > calendar.valid_through:
        return None
    candidate = local_now.date()
    if local_now.timetz().replace(tzinfo=None) < time(17, 30) or not _is_trading_day(calendar, candidate):
        candidate -= timedelta(days=1)
    while not _is_trading_day(calendar, candidate):
        candidate -= timedelta(days=1)
        if candidate.year < min(day.year for day in calendar.holiday_dates):
            return None
    return candidate


def compute_freshness(calendar: TradingCalendar, cutoff: date, now: datetime) -> Literal[
    "fresh",
    "one-session-behind",
    "stale",
    "unknown",
]:
    """依遺漏交易日數區分新鮮、落後一日、過期與未知。"""
    expected = expected_cutoff_date(calendar, now)
    if expected is None or cutoff > expected or not _is_trading_day(calendar, cutoff):
        return "unknown"
    missing_sessions = 0
    candidate = cutoff + timedelta(days=1)
    while candidate <= expected:
        if _is_trading_day(calendar, candidate):
            missing_sessions += 1
        candidate += timedelta(days=1)
    if missing_sessions == 0:
        return "fresh"
    if missing_sessions == 1:
        return "one-session-behind"
    return "stale"


def _taipei_time(calendar: TradingCalendar, now: datetime) -> datetime:
    if now.tzinfo is None:
        raise ValueError("計算資料截止日必須提供含時區的時間。")
    return now.astimezone(calendar.timezone)


def _is_trading_day(calendar: TradingCalendar, candidate: date) -> bool:
    return candidate.weekday() < 5 and candidate not in calendar.holiday_dates


def _require_requested_date(
    quotes: tuple[DailyQuote, ...],
    requested_date: date,
    market: Market,
) -> tuple[DailyQuote, ...]:
    if not quotes:
        raise MarketSourceError(f"{market} 官方日行情為空，不能建立快照。")
    dates = {quote.trading_date for quote in quotes}
    if dates != {requested_date}:
        received = ", ".join(sorted(item.isoformat() for item in dates))
        raise MarketSourceError(
            f"{market} 官方日行情日期與要求日期不符：要求 {requested_date.isoformat()}，實際 {received}。"
        )
    return quotes


def _fetch_official_json(endpoint: str, parameters: dict[str, str] | None = None) -> object:
    try:
        base_url = _OFFICIAL_ENDPOINTS[endpoint]
    except KeyError as error:
        raise ValueError("不支援的官方來源代號。") from error
    query = urlencode(parameters) if parameters else ""
    request_url = f"{base_url}?{query}" if query else base_url
    request = Request(request_url, headers={"User-Agent": USER_AGENT})
    try:
        with _open_official_market_source(request) as response:
            status = getattr(response, "status", None)
            if status != 200:
                raise MarketSourceError(f"官方來源回傳 HTTP {status}。")
            payload_bytes = response.read()
    except MarketSourceError:
        raise
    except HTTPError as error:
        raise MarketSourceError(f"官方來源回傳 HTTP {error.code}。") from error
    except (URLError, OSError) as error:
        raise MarketSourceError(f"無法安全連線官方來源：{error}。") from error
    try:
        return json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MarketSourceError("官方來源不是有效的 UTF-8 JSON。") from error


def _open_official_market_source(request: Request):
    """保留 CA/主機驗證，僅對精確 SKI 相容問題做受限重試。"""
    if not _is_known_official_request(request.full_url):
        raise URLError("市場資料請求不是核准的官方 HTTPS 端點。")
    try:
        return _urlopen_official_market_source(request, timeout=30)
    except URLError as error:
        reason = getattr(error, "reason", None)
        if not (
            isinstance(reason, ssl.SSLCertVerificationError)
            and getattr(reason, "verify_message", None) == "Missing Subject Key Identifier"
            and hasattr(ssl, "VERIFY_X509_STRICT")
        ):
            raise
        compatibility_context = ssl.create_default_context()
        compatibility_context.verify_flags &= ~ssl.VERIFY_X509_STRICT
        return _urlopen_official_market_source(request, timeout=30, context=compatibility_context)


def _urlopen_official_market_source(
    request: Request,
    timeout: int,
    context: ssl.SSLContext | None = None,
):
    parsed = urlparse(request.full_url)
    host = parsed.hostname
    if host is None or not _is_known_official_request(request.full_url):
        raise URLError("市場資料請求不是核准的官方 HTTPS 端點。")
    handlers: list[object] = [_OfficialMarketRedirectHandler(host)]
    if context is not None:
        handlers.append(HTTPSHandler(context=context))
    return build_opener(*handlers).open(request, timeout=timeout)


def _is_known_official_request(url: str) -> bool:
    parsed = urlparse(url)
    try:
        port = parsed.port
    except ValueError:
        return False
    for endpoint_url in _OFFICIAL_ENDPOINTS.values():
        endpoint = urlparse(endpoint_url)
        if (
            parsed.scheme == "https"
            and parsed.hostname == endpoint.hostname
            and parsed.path == endpoint.path
            and port in {None, 443}
            and parsed.username is None
            and parsed.password is None
            and _is_official_https_url(url, endpoint.hostname or "")
        ):
            return True
    return False


def parse_twse_daily(payload: object) -> tuple[DailyQuote, ...]:
    """解析 TWSE `STOCK_DAY_ALL` 的官方 JSON 清單。"""
    return _parse_daily_rows(
        payload,
        market="TWSE",
        source_url="https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        code_field="Code",
        name_field="Name",
        date_field="Date",
        open_field="OpeningPrice",
        high_field="HighestPrice",
        low_field="LowestPrice",
        close_field="ClosingPrice",
        volume_field="TradeVolume",
        transaction_field="Transaction",
    )


def parse_tpex_daily(payload: object) -> tuple[DailyQuote, ...]:
    """解析 TPEx `tpex_mainboard_daily_close_quotes` 的官方 JSON 清單。"""
    return _parse_daily_rows(
        payload,
        market="TPEx",
        source_url="https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
        code_field="SecuritiesCompanyCode",
        name_field="CompanyName",
        date_field="Date",
        open_field="Open",
        high_field="High",
        low_field="Low",
        close_field="Close",
        volume_field="TradingShares",
        transaction_field="TransactionNumber",
    )


def parse_twse_historical_daily(payload: object) -> tuple[DailyQuote, ...]:
    """解析 TWSE `MI_INDEX` 中含有全部日收盤行情的表格。"""
    rows, trading_date = _historical_rows(
        payload,
        required_fields=("證券代號", "證券名稱", "成交股數", "成交筆數", "開盤價", "最高價", "最低價", "收盤價"),
    )
    normalized = [
        {
            "Code": row["證券代號"],
            "Name": row["證券名稱"],
            "Date": trading_date,
            "TradeVolume": row["成交股數"],
            "Transaction": row["成交筆數"],
            "OpeningPrice": row["開盤價"],
            "HighestPrice": row["最高價"],
            "LowestPrice": row["最低價"],
            "ClosingPrice": row["收盤價"],
        }
        for row in rows
    ]
    quotes = _parse_daily_rows(
        normalized,
        market="TWSE",
        source_url="https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
        code_field="Code",
        name_field="Name",
        date_field="Date",
        open_field="OpeningPrice",
        high_field="HighestPrice",
        low_field="LowestPrice",
        close_field="ClosingPrice",
        volume_field="TradeVolume",
        transaction_field="Transaction",
    )
    return quotes


def parse_tpex_historical_daily(payload: object) -> tuple[DailyQuote, ...]:
    """解析 TPEx `afterTrading/otc` 的上櫃普通股歷史表格。"""
    rows, trading_date = _historical_rows(
        payload,
        required_fields=("代號", "名稱", "收盤", "開盤", "最高", "最低", "成交股數", "成交筆數"),
    )
    normalized = [
        {
            "SecuritiesCompanyCode": row["代號"],
            "CompanyName": row["名稱"],
            "Date": trading_date,
            "TradingShares": row["成交股數"],
            "TransactionNumber": row["成交筆數"],
            "Open": row["開盤"],
            "High": row["最高"],
            "Low": row["最低"],
            "Close": row["收盤"],
        }
        for row in rows
    ]
    quotes = _parse_daily_rows(
        normalized,
        market="TPEx",
        source_url="https://www.tpex.org.tw/www/zh-tw/afterTrading/otc",
        code_field="SecuritiesCompanyCode",
        name_field="CompanyName",
        date_field="Date",
        open_field="Open",
        high_field="High",
        low_field="Low",
        close_field="Close",
        volume_field="TradingShares",
        transaction_field="TransactionNumber",
    )
    return quotes


def comparison_unit_for_prices(prices: tuple[Decimal, ...], source_precision: Decimal) -> Decimal:
    """回傳來源精度與所有 OHLC 價格適用升降單位中較大的容忍值。"""
    if not prices:
        raise ValueError("比較單位至少需要一個價格。")
    if source_precision <= 0:
        raise ValueError("來源精度必須大於零。")
    return max(source_precision, *(_official_tick_size(price) for price in prices))


def _official_tick_size(price: Decimal) -> Decimal:
    if price < 0:
        raise ValueError("價格不可為負數。")
    if price < Decimal("10"):
        return Decimal("0.01")
    if price < Decimal("50"):
        return Decimal("0.05")
    if price < Decimal("100"):
        return Decimal("0.1")
    if price < Decimal("500"):
        return Decimal("0.5")
    if price < Decimal("1000"):
        return Decimal("1")
    return Decimal("5")


def _historical_rows(
    payload: object,
    *,
    required_fields: tuple[str, ...],
) -> tuple[tuple[dict[str, str], ...], str]:
    if not isinstance(payload, dict):
        raise ValueError("官方歷史日行情回應必須是 JSON 物件。")
    status = payload.get("stat")
    if not isinstance(status, str) or status.strip().lower() != "ok":
        raise ValueError("官方歷史日行情狀態不是成功。")
    trading_date = payload.get("date")
    if not isinstance(trading_date, str):
        raise ValueError("官方歷史日行情缺少日期。")
    _parse_official_date(trading_date)
    tables = payload.get("tables")
    if not isinstance(tables, list):
        raise ValueError("官方歷史日行情缺少表格。")
    for table in tables:
        if not isinstance(table, dict):
            continue
        fields = table.get("fields")
        data = table.get("data")
        if not isinstance(fields, list) or not isinstance(data, list):
            continue
        indexes = _normalized_field_indexes(fields)
        if not all(field in indexes for field in required_fields):
            continue
        rows: list[dict[str, str]] = []
        for raw_row in data:
            if not isinstance(raw_row, list):
                raise ValueError("官方歷史日行情資料列必須是陣列。")
            row: dict[str, str] = {}
            for field in required_fields:
                index = indexes[field]
                try:
                    value = raw_row[index]
                except IndexError as error:
                    raise ValueError("官方歷史日行情資料列缺少必要欄位。") from error
                if not isinstance(value, str):
                    raise ValueError("官方歷史日行情欄位必須是文字。")
                row[field] = value
            rows.append(row)
        return tuple(rows), trading_date
    raise ValueError("官方歷史日行情找不到必要的收盤行情表格。")


def _normalized_field_indexes(fields: list[object]) -> dict[str, int]:
    indexes: dict[str, int] = {}
    for index, field in enumerate(fields):
        if not isinstance(field, str):
            raise ValueError("官方歷史日行情欄位名稱必須是文字。")
        normalized = "".join(field.replace("<br>", "").split())
        indexes[normalized] = index
    return indexes


def parse_supported_symbols(
    twse_payload: object,
    tpex_payload: object,
) -> tuple[SupportedSymbol, ...]:
    """以官方公司基本資料建立普通股索引，絕不以代碼外觀分類。"""
    twse = _parse_company_rows(
        twse_payload,
        market="TWSE",
        code_field="公司代號",
        preferred_name_field="公司簡稱",
        fallback_name_field="公司名稱",
        source_url="https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    )
    tpex = _parse_company_rows(
        tpex_payload,
        market="TPEx",
        code_field="SecuritiesCompanyCode",
        preferred_name_field="CompanyAbbreviation",
        fallback_name_field="CompanyName",
        source_url="https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
    )
    market_order = {"TWSE": 0, "TPEx": 1}
    return tuple(sorted((*twse, *tpex), key=lambda symbol: (market_order[symbol.market], symbol.code)))


def parse_corporate_actions(
    twse_payload: object,
    tpex_payload: object,
    *,
    verified_at: date | None = None,
) -> tuple[CorporateAction, ...]:
    """正規化兩市場的公司行動，並保留官方端點與查核日期。"""
    checked_on = verified_at or date.today()
    twse = _parse_action_rows(
        twse_payload,
        market="TWSE",
        code_field="Code",
        date_field="Date",
        marker_field="Exdividend",
        source_url="https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL",
        verified_at=checked_on,
    )
    tpex = _parse_action_rows(
        tpex_payload,
        market="TPEx",
        code_field="SecuritiesCompanyCode",
        date_field="ExRrightsExDividendDate",
        marker_field="ExRrightsExDividend",
        source_url="https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost",
        verified_at=checked_on,
    )
    market_order = {"TWSE": 0, "TPEx": 1}
    return tuple(
        sorted(
            (*twse, *tpex),
            key=lambda action: (market_order[action.market], action.code, action.action_date, action.action_type),
        )
    )


def _parse_action_rows(
    payload: object,
    *,
    market: Market,
    code_field: str,
    date_field: str,
    marker_field: str,
    source_url: str,
    verified_at: date,
) -> tuple[CorporateAction, ...]:
    if not isinstance(payload, list):
        raise ValueError("官方公司行動回應必須是 JSON 陣列。")
    actions: list[CorporateAction] = []
    for row in payload:
        if not isinstance(row, dict):
            raise ValueError("官方公司行動每一列必須是 JSON 物件。")
        code = _required_text(row, code_field).strip()
        if not code:
            raise ValueError("官方公司行動缺少證券代碼。")
        action_date = _parse_official_date(_required_text(row, date_field))
        marker = _required_text(row, marker_field).strip()
        cash_dividend = _positive_decimal(row.get("CashDividend"))
        stock_dividend = _positive_decimal(row.get("StockDividendRatio"))
        action_types: list[Literal["cash-dividend", "stock-dividend", "capital-reduction", "split", "other"]] = []
        if cash_dividend:
            action_types.append("cash-dividend")
        if stock_dividend:
            action_types.append("stock-dividend")
        if "減資" in marker:
            action_types.append("capital-reduction")
        if "分割" in marker:
            action_types.append("split")
        if not action_types and marker:
            action_types.append("other")
        for action_type in action_types:
            actions.append(
                CorporateAction(
                    market=market,
                    code=code,
                    action_date=action_date,
                    action_type=action_type,
                    affects_price_continuity=True,
                    source_url=source_url,
                    verified_at=verified_at,
                )
            )
    return tuple(actions)


def _positive_decimal(value: object) -> bool:
    if not isinstance(value, str):
        return False
    text = value.strip().replace(",", "")
    if not text:
        return False
    try:
        return Decimal(text) > 0
    except InvalidOperation as error:
        raise ValueError(f"官方公司行動數值格式無效：{value!r}。") from error


def _parse_company_rows(
    payload: object,
    *,
    market: Market,
    code_field: str,
    preferred_name_field: str,
    fallback_name_field: str,
    source_url: str,
) -> tuple[SupportedSymbol, ...]:
    if not isinstance(payload, list):
        raise ValueError("官方公司基本資料回應必須是 JSON 陣列。")
    symbols: list[SupportedSymbol] = []
    seen_codes: set[str] = set()
    for row in payload:
        if not isinstance(row, dict):
            raise ValueError("官方公司基本資料每一列必須是 JSON 物件。")
        code = _required_text(row, code_field).strip()
        preferred_name = row.get(preferred_name_field)
        fallback_name = row.get(fallback_name_field)
        name = preferred_name.strip() if isinstance(preferred_name, str) else ""
        if not name and isinstance(fallback_name, str):
            name = fallback_name.strip()
        if not code or not name:
            raise ValueError("官方公司基本資料缺少證券代碼或名稱。")
        if code in seen_codes:
            raise ValueError(f"官方公司基本資料有重複代碼：{market} {code}。")
        seen_codes.add(code)
        symbols.append(
            SupportedSymbol(
                market=market,
                code=code,
                name=name,
                security_type="common-stock",
                source_url=source_url,
            )
        )
    return tuple(symbols)


def _parse_daily_rows(
    payload: object,
    *,
    market: Market,
    source_url: str,
    code_field: str,
    name_field: str,
    date_field: str,
    open_field: str,
    high_field: str,
    low_field: str,
    close_field: str,
    volume_field: str,
    transaction_field: str,
) -> tuple[DailyQuote, ...]:
    if not isinstance(payload, list):
        raise ValueError("官方日行情回應必須是 JSON 陣列。")

    quotes: list[DailyQuote] = []
    for row in payload:
        if not isinstance(row, dict):
            raise ValueError("官方日行情每一列必須是 JSON 物件。")
        code = _required_text(row, code_field).strip()
        name = _required_text(row, name_field).strip()
        if not code or not name:
            raise ValueError("官方日行情缺少證券代碼或名稱。")

        open_text = _required_text(row, open_field)
        high_text = _required_text(row, high_field)
        low_text = _required_text(row, low_field)
        close_text = _required_text(row, close_field)
        quote = DailyQuote(
            market=market,
            code=code,
            name=name,
            trading_date=_parse_official_date(_required_text(row, date_field)),
            open=_parse_price(open_text),
            high=_parse_price(high_text),
            low=_parse_price(low_text),
            close=_parse_price(close_text),
            volume_shares=_parse_non_negative_integer(_required_text(row, volume_field), "成交股數"),
            transaction_count=_parse_non_negative_integer(_required_text(row, transaction_field), "成交筆數"),
            source_precision=_source_precision((open_text, high_text, low_text, close_text)),
            source_url=source_url,
        )
        _validate_quote(quote)
        quotes.append(quote)
    return tuple(quotes)


def _required_text(row: dict[object, object], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str):
        raise ValueError(f"官方日行情缺少文字欄位「{field}」。")
    return value


def _parse_official_date(value: str) -> date:
    compact = value.strip().replace("/", "").replace("-", "")
    if len(compact) != 7 and len(compact) != 8 or not compact.isdigit():
        raise ValueError(f"官方日期格式無法辨識：{value!r}。")
    if len(compact) == 7:
        year = int(compact[:3]) + 1911
        month = int(compact[3:5])
        day = int(compact[5:])
    else:
        year = int(compact[:4])
        month = int(compact[4:6])
        day = int(compact[6:])
    try:
        return date(year, month, day)
    except ValueError as error:
        raise ValueError(f"官方日期無效：{value!r}。") from error


def _parse_price(value: str) -> Decimal:
    text = value.strip().replace(",", "")
    if text.upper() in _MISSING_PRICE_MARKERS:
        raise ValueError("官方日行情含有缺漏價格，不能建立快照。")
    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"官方價格格式無效：{value!r}。") from error
    if not parsed.is_finite() or parsed < 0:
        raise ValueError(f"官方價格必須是非負有限數值：{value!r}。")
    return parsed


def _parse_non_negative_integer(value: str, field: str) -> int:
    text = value.strip().replace(",", "")
    try:
        parsed = int(text)
    except ValueError as error:
        raise ValueError(f"官方{field}格式無效：{value!r}。") from error
    if parsed < 0:
        raise ValueError(f"官方{field}不可為負數。")
    return parsed


def _source_precision(values: tuple[str, ...]) -> Decimal:
    decimal_places = 0
    for value in values:
        normalized = value.strip().replace(",", "")
        if "." in normalized:
            decimal_places = max(decimal_places, len(normalized.rsplit(".", 1)[1]))
    return Decimal(1).scaleb(-decimal_places)


def _validate_quote(quote: DailyQuote) -> None:
    if quote.low > quote.open or quote.low > quote.close:
        raise ValueError("官方日行情最低價不可高於開盤價或收盤價。")
    if quote.high < quote.open or quote.high < quote.close or quote.high < quote.low:
        raise ValueError("官方日行情最高價不可低於開盤價、收盤價或最低價。")
