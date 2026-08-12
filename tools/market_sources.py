"""TWSE 與 TPEx 官方盤後資料的受限來源轉接器。"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import ssl
from time import sleep
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPSHandler, Request, build_opener

from market_data import _OfficialMarketRedirectHandler, _is_official_https_url


Market = Literal["TWSE", "TPEx"]
_MISSING_PRICE_MARKERS = frozenset({"", "-", "--", "---", "----", "N/A", "NA", "無", "—"})
_EXPLICIT_NO_HISTORICAL_DATA_STATUSES = frozenset(
    {
        "很抱歉，沒有符合條件的資料!",
        "很抱歉，沒有符合條件的資料！",
        "查無資料",
    }
)
USER_AGENT = "taiwan-stock-candlestick-guide/1.0 (official snapshot adapter)"
_OFFICIAL_FETCH_ATTEMPTS = 3
_OFFICIAL_FETCH_BACKOFF_SECONDS = (1, 2)

TWSE_DAILY_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TPEX_DAILY_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
TWSE_HISTORICAL_DAILY_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
TPEX_HISTORICAL_DAILY_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/otc"
TWSE_COMPANIES_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TPEX_COMPANIES_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
TWSE_ACTIONS_URL = "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL"
TPEX_ACTIONS_URL = "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost"
TWSE_ACTION_CALCULATION_URL = "https://www.twse.com.tw/rwd/zh/exRight/TWT49U"
TPEX_ACTION_CALCULATION_URL = "https://www.tpex.org.tw/openapi/v1/tpex_exright_daily"
HOLIDAY_CALENDAR_URL = "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule"
EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION = 1
DEFAULT_EMERGENCY_CLOSURES_PATH = Path(__file__).resolve().parents[1] / "data" / "emergency-market-closures.json"
SUSPENSION_EVIDENCE_SCHEMA_VERSION = 1
DEFAULT_SUSPENSION_INTERVALS_PATH = Path(__file__).resolve().parents[1] / "data" / "suspension-intervals.json"

_EMERGENCY_CLOSURE_OFFICIAL_HOSTS = frozenset(
    {
        "investoredu.twse.com.tw",
        "www.twse.com.tw",
        "www.tpex.org.tw",
        "eoc.gov.taipei",
    }
)
_EMERGENCY_CLOSURE_RULE_HOSTS: dict[Market, frozenset[str]] = {
    "TWSE": frozenset({"www.twse.com.tw"}),
    "TPEx": frozenset({"www.tpex.org.tw"}),
}
_MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS: tuple[Market, ...] = ("TWSE", "TPEx")
_SUSPENSION_OFFICIAL_HOSTS: dict[Market, frozenset[str]] = {
    "TWSE": frozenset({"www.twse.com.tw"}),
    "TPEx": frozenset({"dsp.tpex.org.tw"}),
}

_OFFICIAL_ENDPOINTS = {
    "twse-daily": TWSE_DAILY_URL,
    "tpex-daily": TPEX_DAILY_URL,
    "twse-historical-daily": TWSE_HISTORICAL_DAILY_URL,
    "tpex-historical-daily": TPEX_HISTORICAL_DAILY_URL,
    "twse-companies": TWSE_COMPANIES_URL,
    "tpex-companies": TPEX_COMPANIES_URL,
    "twse-actions": TWSE_ACTIONS_URL,
    "tpex-actions": TPEX_ACTIONS_URL,
    "twse-action-calculations": TWSE_ACTION_CALCULATION_URL,
    "tpex-action-calculations": TPEX_ACTION_CALCULATION_URL,
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
class NoQuoteEvidence:
    """官方回應明示沒有 OHLC 報價時保留的可稽核證據。"""

    market: Market
    code: str
    trading_date: date
    reason: Literal["official-no-quote", "official-suspension"]
    source_url: str


@dataclass(frozen=True, slots=True)
class DailyMarketResponse:
    """單一官方日行情回應中的合法日 K 與未報價證據。"""

    quotes: tuple[DailyQuote, ...]
    no_quote_evidence: tuple[NoQuoteEvidence, ...]

    def __iter__(self):
        """維持既有日行情呼叫端可逐筆讀取合法 K 線。"""
        return iter(self.quotes)

    def __len__(self) -> int:
        return len(self.quotes)

    def __getitem__(self, index: int) -> DailyQuote:
        return self.quotes[index]


@dataclass(frozen=True, slots=True)
class SupportedSymbol:
    """可進入第一版比對索引的上市或上櫃普通股。"""

    market: Market
    code: str
    name: str
    security_type: Literal["common-stock"]
    listing_date: date
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
    cash_dividend: Decimal | None = None
    stock_dividend_ratio: Decimal | None = None
    subscription_price: Decimal | None = None
    subscription_ratio: Decimal | None = None
    previous_close: Decimal | None = None
    reference_price: Decimal | None = None
    calculation_source_url: str | None = None


@dataclass(frozen=True, slots=True)
class _OfficialCalculationResult:
    """除權息計算結果表中可與預告資料交叉核對的官方價格。"""

    market: Market
    code: str
    action_date: date
    previous_close: Decimal
    reference_price: Decimal
    source_url: str


@dataclass(frozen=True, slots=True)
class EmergencyMarketClosure:
    """年度休市日曆之外，經官方來源佐證的全市場緊急休市日。"""

    trading_date: date
    markets: tuple[Market, ...]
    reason: str
    source_urls: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SuspensionInterval:
    """交易所公告的單一股票停止買賣區間，結束日採排他語意。"""

    market: Market
    code: str
    start_date: date
    end_date_exclusive: date | None
    reason: str
    source_urls: tuple[str, ...]

    def includes(self, trading_date: date) -> bool:
        """回傳交易日是否落在公告停牌區間；恢復日不包含在內。"""

        return trading_date >= self.start_date and (
            self.end_date_exclusive is None or trading_date < self.end_date_exclusive
        )


@dataclass(frozen=True, slots=True)
class TradingCalendar:
    """TWSE 官方開休市資料轉成台北時區的預期資料截止日依據。"""

    holiday_dates: tuple[date, ...]
    source_url: str
    valid_through: date
    timezone: tzinfo
    emergency_closures: tuple[EmergencyMarketClosure, ...] = ()


class MarketSourceError(RuntimeError):
    """官方來源、TLS 或回應契約未通過時提供繁體中文可追蹤錯誤。"""


class OfficialSourceFetchError(MarketSourceError):
    """單次官方請求週期已有限重試或確認為非暫時錯誤。"""


class OfficialMarketClosedError(MarketSourceError):
    """官方歷史端點明示該市場日期沒有收盤行情，可安全寫入日期快取。"""

    def __init__(self, market: Market, trading_date: date, source_url: str) -> None:
        self.market = market
        self.trading_date = trading_date
        self.source_url = source_url
        super().__init__(f"{market} {trading_date.isoformat()} 官方歷史日行情明示沒有資料。")


def fetch_twse_daily(requested_date: date) -> DailyMarketResponse:
    """取得指定交易日的 TWSE 上市日行情，回應日期不符即拒絕使用。"""
    quotes = parse_twse_daily(_fetch_official_json("twse-daily"))
    return _require_requested_date(quotes, requested_date, "TWSE")


def fetch_tpex_daily(requested_date: date) -> DailyMarketResponse:
    """取得指定交易日的 TPEx 上櫃日行情，回應日期不符即拒絕使用。"""
    quotes = parse_tpex_daily(_fetch_official_json("tpex-daily"))
    return _require_requested_date(quotes, requested_date, "TPEx")


def fetch_twse_historical_daily(requested_date: date) -> DailyMarketResponse:
    """取得 TWSE 全市場歷史日行情，供可續跑的十年基準快照使用。"""
    payload = _fetch_official_json(
        "twse-historical-daily",
        {
            "date": requested_date.strftime("%Y%m%d"),
            "type": "ALLBUT0999",
            "response": "json",
        },
    )
    if _is_explicit_historical_market_closure(payload):
        raise OfficialMarketClosedError("TWSE", requested_date, TWSE_HISTORICAL_DAILY_URL)
    quotes = parse_twse_historical_daily(payload)
    return _require_requested_date(quotes, requested_date, "TWSE")


def fetch_tpex_historical_daily(requested_date: date) -> DailyMarketResponse:
    """取得 TPEx 上櫃普通股歷史日行情，限定官方 EW 市場分類。"""
    roc_date = f"{requested_date.year - 1911:03d}/{requested_date:%m/%d}"
    payload = _fetch_official_json(
        "tpex-historical-daily",
        {"date": roc_date, "type": "EW", "response": "json"},
    )
    if _is_explicit_historical_market_closure(payload):
        raise OfficialMarketClosedError("TPEx", requested_date, TPEX_HISTORICAL_DAILY_URL)
    quotes = parse_tpex_historical_daily(payload)
    return _require_requested_date(quotes, requested_date, "TPEx")


def fetch_supported_symbols() -> tuple[SupportedSymbol, ...]:
    """取得兩市場官方公司主檔建立的普通股支援索引。"""
    return parse_supported_symbols(
        _fetch_official_json("twse-companies"),
        _fetch_official_json("tpex-companies"),
    )


def fetch_corporate_actions(
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> tuple[CorporateAction, ...]:
    """取得公司行動與官方計算結果；TWSE 以明確日期區間查詢，避免舊端點只回單期資料。"""
    calculation_end = end_date or date.today()
    calculation_start = start_date or calculation_end - timedelta(days=400)
    if calculation_start > calculation_end:
        raise ValueError("公司行動計算結果的開始日期不可晚於結束日期。")
    return parse_corporate_actions(
        _fetch_official_json("twse-actions"),
        _fetch_official_json("tpex-actions"),
        twse_calculation_payload=_fetch_official_json(
            "twse-action-calculations",
            {
                "response": "json",
                "startDate": calculation_start.strftime("%Y%m%d"),
                "endDate": calculation_end.strftime("%Y%m%d"),
            },
        ),
        tpex_calculation_payload=_fetch_official_json("tpex-action-calculations"),
    )


def fetch_trading_calendar(
    emergency_closures_path: Path = DEFAULT_EMERGENCY_CLOSURES_PATH,
) -> TradingCalendar:
    """取得 TWSE 官方開休市日曆，供兩市場使用相同的預期截止日基準。"""
    annual_calendar = parse_holiday_calendar(_fetch_official_json("holiday-calendar"))
    return apply_emergency_market_closures(
        annual_calendar,
        load_emergency_market_closure_evidence(emergency_closures_path),
    )


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


def load_emergency_market_closure_evidence(path: Path) -> tuple[EmergencyMarketClosure, ...]:
    """讀取版本化的緊急全市場休市佐證；檔案無效時拒絕猜測交易日。"""

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MarketSourceError(f"無法讀取緊急市場休市佐證：{path}") from error
    return parse_emergency_market_closure_evidence(payload)


def parse_emergency_market_closure_evidence(payload: object) -> tuple[EmergencyMarketClosure, ...]:
    """驗證 TWSE 與 TPEx 同日全市場緊急休市的官方佐證。"""

    if not isinstance(payload, dict) or payload.get("schemaVersion") != EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION:
        raise ValueError("緊急市場休市佐證 schemaVersion 必須是 1。")
    closures_value = payload.get("closures")
    if not isinstance(closures_value, list):
        raise ValueError("緊急市場休市佐證必須包含 closures 陣列。")

    closures: list[EmergencyMarketClosure] = []
    seen_dates: set[date] = set()
    for value in closures_value:
        if not isinstance(value, dict):
            raise ValueError("緊急市場休市佐證列必須是 JSON 物件。")
        closure_date = _parse_official_date(_required_text(value, "date"))
        markets_value = value.get("markets")
        reason = _required_text(value, "reason").strip()
        source_urls_value = value.get("sourceUrls")
        if not reason:
            raise ValueError("緊急市場休市佐證原因不可空白。")
        if closure_date.weekday() >= 5:
            raise ValueError("緊急市場休市日期必須是平日。")
        if (
            not isinstance(markets_value, list)
            or len(markets_value) != len(_MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS)
            or any(not isinstance(market, str) for market in markets_value)
            or set(markets_value) != set(_MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS)
        ):
            raise ValueError(
                "緊急市場休市佐證目前只支援 TWSE 與 TPEx 同日全市場休市，markets 必須各含一次。"
            )
        markets = _MARKET_WIDE_EMERGENCY_CLOSURE_MARKETS
        if not isinstance(source_urls_value, list) or not source_urls_value:
            raise ValueError("緊急市場休市佐證至少需要一個官方來源。")
        if any(not isinstance(source_url, str) for source_url in source_urls_value):
            raise ValueError("緊急市場休市佐證網址必須是文字。")
        source_urls = tuple(sorted({_validate_emergency_closure_source_url(source_url) for source_url in source_urls_value}))
        if len(source_urls) != len(source_urls_value):
            raise ValueError("緊急市場休市佐證網址不可重複。")
        for market in markets:
            if not any(
                urlparse(source_url).hostname in _EMERGENCY_CLOSURE_RULE_HOSTS[market]
                for source_url in source_urls
            ):
                raise ValueError(f"緊急市場休市佐證必須包含 {market} 官方規則來源。")
        if closure_date in seen_dates:
            raise ValueError("緊急市場休市佐證日期不可重複。")
        seen_dates.add(closure_date)
        closures.append(
            EmergencyMarketClosure(
                trading_date=closure_date,
                markets=markets,
                reason=reason,
                source_urls=source_urls,
            )
        )
    return tuple(sorted(closures, key=lambda closure: closure.trading_date))


def apply_emergency_market_closures(
    calendar: TradingCalendar,
    closures: tuple[EmergencyMarketClosure, ...],
) -> TradingCalendar:
    """把經驗證的兩市場同日全市場休市日加入共用年度日曆。"""

    coverage_start = date(min(day.year for day in calendar.holiday_dates), 1, 1)
    for closure in closures:
        if closure.trading_date < coverage_start or closure.trading_date > calendar.valid_through:
            raise ValueError("緊急市場休市日期不在年度日曆涵蓋範圍。")
    return replace(
        calendar,
        holiday_dates=tuple(sorted({*calendar.holiday_dates, *(closure.trading_date for closure in closures)})),
        emergency_closures=closures,
    )


def _validate_emergency_closure_source_url(value: str) -> str:
    source_url = value.strip()
    parsed = urlparse(source_url)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("緊急市場休市佐證網址的連接埠無效。") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname not in _EMERGENCY_CLOSURE_OFFICIAL_HOSTS
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("緊急市場休市佐證網址必須是核准官方 HTTPS 來源。")
    return source_url


def load_suspension_interval_evidence(path: Path) -> tuple[SuspensionInterval, ...]:
    """讀取版本化停復牌區間；檔案或契約無效時拒絕以猜測補洞。"""

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MarketSourceError(f"無法讀取官方停止買賣區間佐證：{path}。") from error
    return parse_suspension_interval_evidence(payload)


def parse_suspension_interval_evidence(payload: object) -> tuple[SuspensionInterval, ...]:
    """驗證交易所停復牌公告區間，並拒絕重疊、非官方或不明確的資料。"""

    if not isinstance(payload, dict) or payload.get("schemaVersion") != SUSPENSION_EVIDENCE_SCHEMA_VERSION:
        raise ValueError("停止買賣區間佐證的 schemaVersion 必須為 1。")
    values = payload.get("intervals")
    if not isinstance(values, list):
        raise ValueError("停止買賣區間佐證的 intervals 必須是陣列。")

    intervals: list[SuspensionInterval] = []
    seen_starts: set[tuple[Market, str, date]] = set()
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("停止買賣區間佐證列必須是 JSON 物件。")
        market = value.get("market")
        if market not in {"TWSE", "TPEx"}:
            raise ValueError("停止買賣區間市場必須為 TWSE 或 TPEx。")
        code = _required_text(value, "code").strip()
        reason = _required_text(value, "reason").strip()
        if not code or not reason:
            raise ValueError("停止買賣區間代碼與原因不可為空白。")
        start_date = _parse_official_date(_required_text(value, "startDate"))
        end_value = value.get("endDateExclusive")
        if end_value is not None and not isinstance(end_value, str):
            raise ValueError("停止買賣區間 endDateExclusive 必須是日期或 null。")
        end_date_exclusive = _parse_official_date(end_value) if isinstance(end_value, str) else None
        if end_date_exclusive is not None and end_date_exclusive <= start_date:
            raise ValueError("停止買賣區間的 endDateExclusive 必須晚於 startDate。")
        source_urls_value = value.get("sourceUrls")
        if not isinstance(source_urls_value, list) or not source_urls_value or any(
            not isinstance(source_url, str) for source_url in source_urls_value
        ):
            raise ValueError("停止買賣區間必須至少包含一個官方來源網址。")
        source_urls = tuple(
            sorted({_validate_suspension_source_url(market, source_url) for source_url in source_urls_value})
        )
        if len(source_urls) != len(source_urls_value):
            raise ValueError("停止買賣區間官方來源網址不可重複。")
        key = (market, code, start_date)
        if key in seen_starts:
            raise ValueError("停止買賣區間有重複起始日。")
        seen_starts.add(key)
        intervals.append(
            SuspensionInterval(
                market=market,
                code=code,
                start_date=start_date,
                end_date_exclusive=end_date_exclusive,
                reason=reason,
                source_urls=source_urls,
            )
        )

    ordered = tuple(sorted(intervals, key=lambda item: (item.market, item.code, item.start_date)))
    _validate_non_overlapping_suspension_intervals(ordered)
    return ordered


def _validate_suspension_source_url(market: Market, value: str) -> str:
    source_url = value.strip()
    parsed = urlparse(source_url)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("停止買賣區間佐證網址的連接埠無效。") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname not in _SUSPENSION_OFFICIAL_HOSTS[market]
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError(f"{market} 停止買賣區間佐證網址必須是核准官方 HTTPS 來源。")
    return source_url


def _validate_non_overlapping_suspension_intervals(intervals: tuple[SuspensionInterval, ...]) -> None:
    previous_by_symbol: dict[tuple[Market, str], SuspensionInterval] = {}
    for interval in intervals:
        key = (interval.market, interval.code)
        previous = previous_by_symbol.get(key)
        if previous is not None and (
            previous.end_date_exclusive is None or interval.start_date < previous.end_date_exclusive
        ):
            raise ValueError(f"{interval.market} {interval.code} 的停止買賣區間重疊。")
        previous_by_symbol[key] = interval


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
    response: DailyMarketResponse,
    requested_date: date,
    market: Market,
) -> DailyMarketResponse:
    if not response.quotes and not response.no_quote_evidence:
        raise MarketSourceError(f"{market} 官方日行情為空，不能建立快照。")
    dates = {
        *(quote.trading_date for quote in response.quotes),
        *(evidence.trading_date for evidence in response.no_quote_evidence),
    }
    if dates != {requested_date}:
        received = ", ".join(sorted(item.isoformat() for item in dates))
        raise MarketSourceError(
            f"{market} 官方日行情日期與要求日期不符：要求 {requested_date.isoformat()}，實際 {received}。"
        )
    return response


def _fetch_official_json(endpoint: str, parameters: dict[str, str] | None = None) -> object:
    try:
        base_url = _OFFICIAL_ENDPOINTS[endpoint]
    except KeyError as error:
        raise ValueError("不支援的官方來源代號。") from error
    query = urlencode(parameters) if parameters else ""
    request_url = f"{base_url}?{query}" if query else base_url
    request = Request(request_url, headers={"User-Agent": USER_AGENT})
    payload_bytes: bytes | None = None
    for attempt in range(_OFFICIAL_FETCH_ATTEMPTS):
        try:
            with _open_official_market_source(request) as response:
                status = getattr(response, "status", None)
                if status == 200:
                    payload_bytes = response.read()
                    break
                if _is_transient_http_status(status) and attempt < _OFFICIAL_FETCH_ATTEMPTS - 1:
                    sleep(_OFFICIAL_FETCH_BACKOFF_SECONDS[attempt])
                    continue
                raise OfficialSourceFetchError(f"官方來源回傳 HTTP {status}。")
        except MarketSourceError:
            raise
        except HTTPError as error:
            status = error.code
            error.close()
            if _is_transient_http_status(status) and attempt < _OFFICIAL_FETCH_ATTEMPTS - 1:
                sleep(_OFFICIAL_FETCH_BACKOFF_SECONDS[attempt])
                continue
            raise OfficialSourceFetchError(f"官方來源回傳 HTTP {status}。") from error
        except (URLError, OSError) as error:
            if attempt < _OFFICIAL_FETCH_ATTEMPTS - 1:
                sleep(_OFFICIAL_FETCH_BACKOFF_SECONDS[attempt])
                continue
            raise OfficialSourceFetchError(f"無法安全連線官方來源：{error}。") from error
    if payload_bytes is None:
        raise OfficialSourceFetchError("官方來源在有限重試後仍無可驗證回應。")
    try:
        return json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OfficialSourceFetchError("官方來源不是有效的 UTF-8 JSON。") from error


def _is_transient_http_status(status: object) -> bool:
    return isinstance(status, int) and not isinstance(status, bool) and (
        status == 429 or 500 <= status <= 599
    )


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


def parse_twse_daily(payload: object) -> DailyMarketResponse:
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


def parse_tpex_daily(payload: object) -> DailyMarketResponse:
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


def parse_twse_historical_daily(payload: object) -> DailyMarketResponse:
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


def parse_tpex_historical_daily(payload: object) -> DailyMarketResponse:
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


def _is_explicit_historical_market_closure(payload: object) -> bool:
    """只接受官方固定無資料狀態，其他歷史回應異常仍必須 fail closed。"""

    return (
        isinstance(payload, dict)
        and isinstance(payload.get("stat"), str)
        and payload["stat"].strip() in _EXPLICIT_NO_HISTORICAL_DATA_STATUSES
    )


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
        listing_date_field="上市日期",
        source_url="https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    )
    tpex = _parse_company_rows(
        tpex_payload,
        market="TPEx",
        code_field="SecuritiesCompanyCode",
        preferred_name_field="CompanyAbbreviation",
        fallback_name_field="CompanyName",
        listing_date_field="DateOfListing",
        source_url="https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
    )
    market_order = {"TWSE": 0, "TPEx": 1}
    return tuple(sorted((*twse, *tpex), key=lambda symbol: (market_order[symbol.market], symbol.code)))


def parse_corporate_actions(
    twse_payload: object,
    tpex_payload: object,
    *,
    twse_calculation_payload: object | None = None,
    tpex_calculation_payload: object | None = None,
    verified_at: date | None = None,
) -> tuple[CorporateAction, ...]:
    """正規化兩市場公司行動，並在有官方計算結果時保留可重算價格證據。"""
    checked_on = verified_at or date.today()
    twse = _parse_action_rows(
        twse_payload,
        market="TWSE",
        code_field="Code",
        date_field="Date",
        marker_field="Exdividend",
        stock_dividend_ratio_field="StockDividendRatio",
        subscription_price_field="SubscriptionPricePerShare",
        subscription_ratio_field="SubscriptionRatio",
        source_url="https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL",
        verified_at=checked_on,
    )
    tpex = _parse_action_rows(
        tpex_payload,
        market="TPEx",
        code_field="SecuritiesCompanyCode",
        date_field="ExRrightsExDividendDate",
        marker_field="ExRrightsExDividend",
        stock_dividend_ratio_field="StockDividendRatio",
        subscription_price_field="SubscriptionPricePerShare",
        subscription_ratio_field="SubscriptionRatioToNewSharesIssued",
        source_url="https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost",
        verified_at=checked_on,
    )
    calculations = {
        **_parse_twse_calculation_results(twse_calculation_payload),
        **_parse_tpex_calculation_results(tpex_calculation_payload),
    }
    actions = _attach_calculation_results((*twse, *tpex), calculations)
    market_order = {"TWSE": 0, "TPEx": 1}
    return tuple(
        sorted(
            actions,
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
    stock_dividend_ratio_field: str,
    subscription_price_field: str,
    subscription_ratio_field: str,
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
        stock_dividend = _positive_decimal(row.get(stock_dividend_ratio_field))
        cash_dividend_value = _optional_non_negative_decimal(row.get("CashDividend"))
        stock_dividend_ratio = _optional_non_negative_decimal(row.get(stock_dividend_ratio_field))
        subscription_price = _optional_non_negative_decimal(row.get(subscription_price_field))
        subscription_ratio = _optional_non_negative_decimal(row.get(subscription_ratio_field))
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
                    cash_dividend=cash_dividend_value,
                    stock_dividend_ratio=stock_dividend_ratio,
                    subscription_price=subscription_price,
                    subscription_ratio=subscription_ratio,
                )
            )
    return tuple(actions)


def _positive_decimal(value: object) -> bool:
    if not isinstance(value, str):
        return False
    text = value.strip().replace(",", "")
    # TPEx 官方除權息列用此固定文字表示金額尚未公布；保留事件標記，但不虛構現金股利數值。
    if not text or text == "尚未公告":
        return False
    try:
        return Decimal(text) > 0
    except InvalidOperation as error:
        raise ValueError(f"官方公司行動數值格式無效：{value!r}。") from error


def _optional_non_negative_decimal(value: object) -> Decimal | None:
    """保留官方數值；未公告或非數值時視為不可用證據而不虛構零值。"""

    if not isinstance(value, str):
        return None
    text = value.strip().replace(",", "")
    if not text or text == "尚未公告":
        return None
    try:
        parsed = Decimal(text)
    except InvalidOperation:
        return None
    if not parsed.is_finite() or parsed < 0:
        return None
    return parsed


def _attach_calculation_results(
    actions: tuple[CorporateAction, ...],
    calculations: dict[tuple[Market, str, date], _OfficialCalculationResult],
) -> tuple[CorporateAction, ...]:
    """將計算結果表的前收與參考價附到同一市場、代碼與生效日的公司行動。"""

    return tuple(
        replace(
            action,
            previous_close=calculation.previous_close,
            reference_price=calculation.reference_price,
            calculation_source_url=calculation.source_url,
        )
        if (calculation := calculations.get((action.market, action.code, action.action_date))) is not None
        else action
        for action in actions
    )


def _parse_twse_calculation_results(
    payload: object | None,
) -> dict[tuple[Market, str, date], _OfficialCalculationResult]:
    """解析 TWSE TWT49U 結果表；不完整列只代表無法建立還原證據。"""

    if not isinstance(payload, dict):
        return {}
    fields = payload.get("fields")
    rows = payload.get("data")
    if not isinstance(fields, list) or not isinstance(rows, list) or not all(isinstance(item, str) for item in fields):
        return {}
    indexes = {field: index for index, field in enumerate(fields)}
    required = ("資料日期", "股票代號", "除權息前收盤價", "除權息參考價")
    if any(field not in indexes for field in required):
        return {}
    results: dict[tuple[Market, str, date], _OfficialCalculationResult] = {}
    conflicts: set[tuple[Market, str, date]] = set()
    for row in rows:
        if not isinstance(row, list):
            continue
        try:
            action_date = _parse_official_date(_result_text(row, indexes["資料日期"]))
            code = _result_text(row, indexes["股票代號"]).strip()
            previous_close = _positive_calculation_price(_result_text(row, indexes["除權息前收盤價"]))
            reference_price = _positive_calculation_price(_result_text(row, indexes["除權息參考價"]))
        except ValueError:
            continue
        if not code:
            continue
        result = _OfficialCalculationResult(
            market="TWSE",
            code=code,
            action_date=action_date,
            previous_close=previous_close,
            reference_price=reference_price,
            source_url=TWSE_ACTION_CALCULATION_URL,
        )
        _insert_calculation_result(results, conflicts, result)
    return results


def _parse_tpex_calculation_results(
    payload: object | None,
) -> dict[tuple[Market, str, date], _OfficialCalculationResult]:
    """解析 TPEx `tpex_exright_daily` 結果表；僅採用完整的官方價格列。"""

    if not isinstance(payload, list):
        return {}
    results: dict[tuple[Market, str, date], _OfficialCalculationResult] = {}
    conflicts: set[tuple[Market, str, date]] = set()
    for row in payload:
        if not isinstance(row, dict):
            continue
        try:
            action_date = _parse_official_date(_result_mapping_text(row, "Date"))
            code = _result_mapping_text(row, "SecuritiesCompanyCode").strip()
            previous_close = _positive_calculation_price(
                _result_mapping_text(
                    row,
                    "ClosePriceBeforeExRightsDiviend",
                    "ClosePriceBeforeExRightsDividend",
                )
            )
            reference_price = _positive_calculation_price(
                _result_mapping_text(row, "ExRightsDiviendQuote", "ExRightsDividendQuote")
            )
        except ValueError:
            continue
        if not code:
            continue
        result = _OfficialCalculationResult(
            market="TPEx",
            code=code,
            action_date=action_date,
            previous_close=previous_close,
            reference_price=reference_price,
            source_url=TPEX_ACTION_CALCULATION_URL,
        )
        _insert_calculation_result(results, conflicts, result)
    return results


def _result_text(row: list[object], index: int) -> str:
    if index >= len(row) or not isinstance(row[index], str):
        raise ValueError("官方除權息計算結果欄位無效。")
    return row[index]


def _result_mapping_text(row: dict[object, object], *fields: str) -> str:
    for field in fields:
        value = row.get(field)
        if isinstance(value, str):
            return value
    raise ValueError("官方除權息計算結果欄位無效。")


def _positive_calculation_price(value: str) -> Decimal:
    parsed = _optional_non_negative_decimal(value)
    if parsed is None or parsed <= 0:
        raise ValueError("官方除權息計算結果價格無效。")
    return parsed


def _insert_calculation_result(
    results: dict[tuple[Market, str, date], _OfficialCalculationResult],
    conflicts: set[tuple[Market, str, date]],
    result: _OfficialCalculationResult,
) -> None:
    key = (result.market, result.code, result.action_date)
    if key in conflicts:
        return
    existing = results.get(key)
    if existing is not None and (
        existing.previous_close != result.previous_close or existing.reference_price != result.reference_price
    ):
        # 同一官方結果表互相矛盾時，不能任選一列產生調整因子。
        results.pop(key)
        conflicts.add(key)
        return
    results[key] = result


def _parse_company_rows(
    payload: object,
    *,
    market: Market,
    code_field: str,
    preferred_name_field: str,
    fallback_name_field: str,
    listing_date_field: str,
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
        listing_date = _parse_official_date(_required_text(row, listing_date_field))
        if code in seen_codes:
            raise ValueError(f"官方公司基本資料有重複代碼：{market} {code}。")
        seen_codes.add(code)
        symbols.append(
            SupportedSymbol(
                market=market,
                code=code,
                name=name,
                security_type="common-stock",
                listing_date=listing_date,
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
) -> DailyMarketResponse:
    if not isinstance(payload, list):
        raise ValueError("官方日行情回應必須是 JSON 陣列。")

    quotes: list[DailyQuote] = []
    no_quote_evidence: list[NoQuoteEvidence] = []
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
        trading_date = _parse_official_date(_required_text(row, date_field))
        price_texts = (open_text, high_text, low_text, close_text)
        missing_prices = tuple(_is_missing_price(text) for text in price_texts)
        if any(missing_prices):
            if not all(missing_prices):
                raise ValueError("官方日行情的 OHLC 缺漏狀態不一致，不能建立快照。")
            no_quote_evidence.append(
                NoQuoteEvidence(
                    market=market,
                    code=code,
                    trading_date=trading_date,
                    reason="official-no-quote",
                    source_url=source_url,
                )
            )
            continue
        quote = DailyQuote(
            market=market,
            code=code,
            name=name,
            trading_date=trading_date,
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
    return DailyMarketResponse(tuple(quotes), tuple(no_quote_evidence))


def _required_text(row: dict[object, object], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str):
        raise ValueError(f"官方日行情缺少文字欄位「{field}」。")
    return value


def _parse_official_date(value: str) -> date:
    compact = (
        value.strip()
        .replace("/", "")
        .replace("-", "")
        .replace("年", "")
        .replace("月", "")
        .replace("日", "")
    )
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
    if _is_missing_price(text):
        raise ValueError("官方日行情含有缺漏價格，不能建立快照。")
    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise ValueError(f"官方價格格式無效：{value!r}。") from error
    if not parsed.is_finite() or parsed < 0:
        raise ValueError(f"官方價格必須是非負有限數值：{value!r}。")
    return parsed


def _is_missing_price(value: str) -> bool:
    return value.strip().upper() in _MISSING_PRICE_MARKERS


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
