"""建立、驗證與封裝 TWSE／TPEx 官方盤後日 K 靜態快照。"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import Decimal
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
from tempfile import mkdtemp
import time
from typing import Any, Literal, Mapping, Sequence
from urllib.parse import urlparse
from uuid import uuid4

from market_sources import (
    CorporateAction,
    DailyMarketResponse,
    DEFAULT_SUSPENSION_INTERVALS_PATH,
    DailyQuote,
    EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    EmergencyMarketClosure,
    Market,
    NoQuoteEvidence,
    SUSPENSION_EVIDENCE_SCHEMA_VERSION,
    SupportedSymbol,
    SuspensionInterval,
    TradingCalendar,
    comparison_unit_for_prices,
    compute_freshness,
    expected_cutoff_date,
    fetch_corporate_actions,
    fetch_supported_symbols,
    fetch_tpex_daily,
    fetch_tpex_historical_daily,
    fetch_trading_calendar,
    fetch_twse_daily,
    fetch_twse_historical_daily,
    load_suspension_interval_evidence,
    MarketSourceError,
    parse_corporate_actions,
    parse_emergency_market_closure_evidence,
    parse_suspension_interval_evidence,
    parse_holiday_calendar,
    parse_supported_symbols,
    parse_tpex_daily,
    parse_twse_daily,
)


SCHEMA_VERSION = 1
SNAPSHOT_VERSION = 3
LEGACY_SNAPSHOT_VERSION = 1
PREVIOUS_SNAPSHOT_VERSION = 2
SUPPORTED_SNAPSHOT_VERSIONS = frozenset({LEGACY_SNAPSHOT_VERSION, PREVIOUS_SNAPSHOT_VERSION, SNAPSHOT_VERSION})
HISTORY_METADATA_SNAPSHOT_VERSIONS = frozenset({PREVIOUS_SNAPSHOT_VERSION, SNAPSHOT_VERSION})
RETENTION_SESSIONS = 120
PRICE_UNIT = "TWD"
COMPARISON_UNIT_POLICY_URL = "https://www.twse.com.tw/zh/trading/trading-rule.html"
DEFAULT_OVERRIDES_PATH = Path(__file__).resolve().parents[1] / "data" / "company-action-overrides.json"


class SnapshotValidationError(ValueError):
    """快照資料不符合發布門檻時，輸出繁體中文且不覆寫上一成功資料。"""


@dataclass(frozen=True, slots=True)
class MarketSession:
    """一個市場、交易日與其官方全市場盤後行情。"""

    market: Market
    quotes: tuple[DailyQuote, ...]
    no_quote_evidence: tuple[NoQuoteEvidence, ...] = ()


@dataclass(frozen=True, slots=True)
class SnapshotBuildInput:
    """建置快照需要的已正規化官方資料，不允許由瀏覽器直接取得。"""

    source_commit: str
    generated_at: datetime
    symbols: tuple[SupportedSymbol, ...]
    sessions: tuple[MarketSession, ...]
    corporate_actions: tuple[CorporateAction, ...]
    calendar: TradingCalendar
    retired_symbols: tuple[tuple[Market, str, str], ...] = ()
    suspension_intervals: tuple[SuspensionInterval, ...] = ()


@dataclass(frozen=True, slots=True)
class MarketCutoff:
    """單一市場資料截止日、交易日曆與新鮮度。"""

    cutoff_date: str
    expected_cutoff_date: str | None
    freshness: Literal["fresh", "one-session-behind", "stale", "unknown"]
    calendar_source_url: str
    calendar_valid_through: str
    trading_sessions: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class StockIndexEntry:
    """manifest 對單一內容雜湊股票快照的安全索引。"""

    code: str
    name: str
    market: Market
    security_type: Literal["common-stock"]
    data_path: str
    digest: str
    size: int
    first_date: str | None
    last_date: str | None
    bar_count: int
    listing_date: str | None = None
    available_sessions: int = 0
    short_history_reason: Literal["listing-history"] | None = None
    no_quote_count: int = 0


@dataclass(frozen=True, slots=True)
class CalendarEvidence:
    """寫入快照的年度日曆與經驗證緊急休市佐證。"""

    source_url: str
    valid_through: str
    emergency_closures: tuple[EmergencyMarketClosure, ...]


@dataclass(frozen=True, slots=True)
class SnapshotManifest:
    """可部署快照的版本化索引與完整性識別。"""

    schema_version: int
    snapshot_version: int
    source_commit: str
    snapshot_hash: str
    generated_at: str
    markets: dict[str, MarketCutoff]
    symbols: tuple[StockIndexEntry, ...]
    calendar: CalendarEvidence | None = None
    suspension_intervals: tuple[SuspensionInterval, ...] = ()


@dataclass(frozen=True, slots=True)
class _NormalizedBar:
    trading_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume_shares: int
    transaction_count: int | None
    source_precision: Decimal
    comparison_unit: Decimal
    source_url: str


def build_snapshot(
    previous: Path | SnapshotManifest | None,
    sessions: SnapshotBuildInput,
    output: Path,
) -> SnapshotManifest:
    """驗證完整候選資料後，以暫存同層目錄建立可原子切換的快照。"""
    _validate_build_input(sessions)
    sessions = _with_official_suspension_evidence(sessions)
    previous_manifest = _load_previous_manifest(previous)
    _validate_incremental_history(previous, previous_manifest, sessions.calendar)
    _validate_current_daily_coverage(previous_manifest, sessions, sessions.retired_symbols)
    stock_documents, market_cutoffs = _build_stock_documents(sessions, previous, previous_manifest)
    entries, stock_payloads = _index_stock_documents(stock_documents)
    _validate_transition(previous_manifest, entries, sessions.retired_symbols)
    _validate_market_cutoffs(market_cutoffs)
    _validate_v1_replacement_target(previous, output, market_cutoffs)

    generated_at = _iso_datetime(sessions.generated_at)
    calendar_evidence = _calendar_evidence_from_trading_calendar(sessions.calendar)
    manifest_without_hash = {
        "schemaVersion": SCHEMA_VERSION,
        "snapshotVersion": SNAPSHOT_VERSION,
        "sourceCommit": sessions.source_commit,
        "generatedAt": generated_at,
        "calendar": _calendar_evidence_json(calendar_evidence),
        "suspensionEvidence": _suspension_evidence_json(sessions.suspension_intervals),
        "markets": {market: _market_cutoff_json(cutoff) for market, cutoff in market_cutoffs.items()},
        "symbols": [_stock_entry_json(entry) for entry in entries],
    }
    snapshot_hash = _digest(_canonical_json_bytes(manifest_without_hash))
    manifest = SnapshotManifest(
        schema_version=SCHEMA_VERSION,
        snapshot_version=SNAPSHOT_VERSION,
        source_commit=sessions.source_commit,
        snapshot_hash=snapshot_hash,
        generated_at=generated_at,
        markets=market_cutoffs,
        symbols=entries,
        calendar=calendar_evidence,
        suspension_intervals=sessions.suspension_intervals,
    )
    manifest_document = {
        **manifest_without_hash,
        "snapshotHash": snapshot_hash,
    }
    provenance_document = _provenance_document(sessions, manifest)

    _write_snapshot_atomically(
        output=output,
        stock_payloads=stock_payloads,
        manifest_document=manifest_document,
        provenance_document=provenance_document,
    )
    return manifest


def _validate_build_input(build: SnapshotBuildInput) -> None:
    if not build.source_commit.strip():
        raise SnapshotValidationError("sourceCommit 不可為空白。")
    if build.generated_at.tzinfo is None:
        raise SnapshotValidationError("generatedAt 必須含有時區。")
    if not build.symbols:
        raise SnapshotValidationError("沒有可支援的上市或上櫃普通股。")
    symbol_keys: set[tuple[Market, str]] = set()
    for symbol in build.symbols:
        key = (symbol.market, symbol.code)
        if key in symbol_keys:
            raise SnapshotValidationError(f"支援索引有重複股票：{symbol.market} {symbol.code}。")
        if symbol.security_type != "common-stock":
            raise SnapshotValidationError("支援索引只能包含普通股。")
        if not isinstance(symbol.listing_date, date):
            raise SnapshotValidationError("支援索引的官方上市日期無效。")
        symbol_keys.add(key)
    if not build.sessions:
        raise SnapshotValidationError("沒有任何官方交易日行情可建立快照。")
    try:
        intervals = _suspension_intervals_from_json(_suspension_evidence_json(build.suspension_intervals))
    except (TypeError, ValueError) as error:
        raise SnapshotValidationError("停止買賣區間佐證無效。") from error
    if any((interval.market, interval.code) not in symbol_keys for interval in intervals):
        raise SnapshotValidationError("停止買賣區間包含不在支援普通股索引中的股票。")


def _with_official_suspension_evidence(build: SnapshotBuildInput) -> SnapshotBuildInput:
    """僅以已驗證區間補入 expected session，絕不把停牌日偽造成 OHLC。"""

    try:
        intervals = _suspension_intervals_from_json(_suspension_evidence_json(build.suspension_intervals))
    except (TypeError, ValueError) as error:
        raise SnapshotValidationError("停止買賣區間佐證無效。") from error
    supported_keys = {(symbol.market, symbol.code) for symbol in build.symbols}
    if any((interval.market, interval.code) not in supported_keys for interval in intervals):
        raise SnapshotValidationError("停止買賣區間包含不在支援普通股索引中的股票。")

    intervals_by_market: dict[Market, tuple[SuspensionInterval, ...]] = {
        market: tuple(interval for interval in intervals if interval.market == market)
        for market in ("TWSE", "TPEx")
    }
    expanded_sessions: list[MarketSession] = []
    for session in build.sessions:
        observations = {
            *(quote.trading_date for quote in session.quotes),
            *(evidence.trading_date for evidence in session.no_quote_evidence),
        }
        if len(observations) != 1:
            raise SnapshotValidationError(f"{session.market} 官方交易日行情日期不一致。")
        session_date = next(iter(observations))
        quotes_by_key = {(quote.market, quote.code): quote for quote in session.quotes}
        evidence_by_key: dict[tuple[Market, str], NoQuoteEvidence] = {}
        for evidence in session.no_quote_evidence:
            if evidence.market != session.market or evidence.reason not in {"official-no-quote", "official-suspension"}:
                raise SnapshotValidationError("官方未報價證據的市場或原因無效。")
            key = (evidence.market, evidence.code)
            if key in evidence_by_key:
                raise SnapshotValidationError(
                    f"{evidence.market} {evidence.code} 有重複未報價證據 {session_date.isoformat()}。"
                )
            evidence_by_key[key] = evidence
        for interval in intervals_by_market[session.market]:
            if not interval.includes(session_date):
                continue
            key = (interval.market, interval.code)
            if key in quotes_by_key:
                raise SnapshotValidationError(
                    f"{interval.market} {interval.code} 的停止買賣區間與合法 K 線衝突：{session_date.isoformat()}。"
                )
            existing = evidence_by_key.get(key)
            if existing is not None and existing.reason == "official-suspension":
                if existing.source_url not in interval.source_urls:
                    raise SnapshotValidationError("官方停牌證據與公告來源不一致。")
                continue
            evidence_by_key[key] = NoQuoteEvidence(
                market=interval.market,
                code=interval.code,
                trading_date=session_date,
                reason="official-suspension",
                source_url=interval.source_urls[0],
            )
        for evidence in evidence_by_key.values():
            if evidence.reason == "official-suspension" and not any(
                interval.market == evidence.market
                and interval.code == evidence.code
                and interval.includes(evidence.trading_date)
                and evidence.source_url in interval.source_urls
                for interval in intervals
            ):
                raise SnapshotValidationError("官方停牌證據沒有對應的公告區間。")
        expanded_sessions.append(
            MarketSession(
                market=session.market,
                quotes=session.quotes,
                no_quote_evidence=tuple(
                    sorted(evidence_by_key.values(), key=lambda item: (item.code, item.trading_date, item.reason))
                ),
            )
        )
    return replace(build, sessions=tuple(expanded_sessions), suspension_intervals=intervals)


def _build_stock_documents(
    build: SnapshotBuildInput,
    previous: Path | SnapshotManifest | None,
    previous_manifest: SnapshotManifest | None,
) -> tuple[dict[tuple[Market, str], dict[str, Any]], dict[str, MarketCutoff]]:
    symbols = {(symbol.market, symbol.code): symbol for symbol in build.symbols}
    available_sessions_by_market = _available_market_sessions(build, previous, previous_manifest)
    bars_by_symbol, no_quote_by_symbol, previous_sources_by_symbol = _load_previous_bars(previous)
    sources_by_symbol: dict[tuple[Market, str], set[str]] = {
        key: {symbol.source_url} for key, symbol in symbols.items()
    }
    for interval in build.suspension_intervals:
        sources_by_symbol[(interval.market, interval.code)].update(interval.source_urls)
    for key, source_urls in previous_sources_by_symbol.items():
        if key in sources_by_symbol:
            sources_by_symbol[key].update(source_urls)

    for session in build.sessions:
        if not session.quotes and not session.no_quote_evidence:
            raise SnapshotValidationError(f"{session.market} 官方交易日行情不可為空。")
        observed_dates = {
            *(quote.trading_date for quote in session.quotes),
            *(evidence.trading_date for evidence in session.no_quote_evidence),
        }
        if len(observed_dates) != 1:
            raise SnapshotValidationError(f"{session.market} 官方交易日行情日期不一致。")
        for quote in session.quotes:
            if quote.market != session.market:
                raise SnapshotValidationError("交易日行情的市場標記不一致。")
            key = (quote.market, quote.code)
            if key not in symbols:
                continue
            normalized = _normalize_quote(quote)
            existing = bars_by_symbol.setdefault(key, [])
            if any(bar.trading_date == normalized.trading_date for bar in existing):
                raise SnapshotValidationError(
                    f"{quote.market} {quote.code} 有重複交易日 {quote.trading_date.isoformat()}。"
                )
            existing.append(normalized)
            sources_by_symbol[key].add(quote.source_url)
        for evidence in session.no_quote_evidence:
            if evidence.market != session.market or evidence.reason not in {"official-no-quote", "official-suspension"}:
                raise SnapshotValidationError("官方未報價證據的市場或原因無效。")
            key = (evidence.market, evidence.code)
            if key not in symbols:
                continue
            if any(bar.trading_date == evidence.trading_date for bar in bars_by_symbol.get(key, ())):
                raise SnapshotValidationError(
                    f"{evidence.market} {evidence.code} 的未報價證據與合法 K 線日期重複。"
                )
            existing_evidence = no_quote_by_symbol.setdefault(key, [])
            if any(item.trading_date == evidence.trading_date for item in existing_evidence):
                raise SnapshotValidationError(
                    f"{evidence.market} {evidence.code} 有重複未報價證據 {evidence.trading_date.isoformat()}。"
                )
            _official_evidence_url(evidence.source_url)
            existing_evidence.append(evidence)
            sources_by_symbol[key].add(evidence.source_url)

    documents: dict[tuple[Market, str], dict[str, Any]] = {}
    available_symbol_keys = {
        key
        for key in symbols
        if bars_by_symbol.get(key) or no_quote_by_symbol.get(key)
    }
    coverage = Decimal(len(available_symbol_keys)) / Decimal(len(symbols))
    if coverage < Decimal("0.98"):
        raise SnapshotValidationError(f"官方普通股日行情覆蓋率 {coverage:.2%} 低於 98% 發布門檻。")

    for key, symbol in symbols.items():
        bars = sorted(bars_by_symbol.get(key, []), key=lambda item: item.trading_date)
        _validate_bars(symbol, bars)
        retained_session_dates = set(available_sessions_by_market[symbol.market])
        retained_bars = tuple(bar for bar in bars if bar.trading_date in retained_session_dates)
        retained_no_quote_evidence = tuple(
            evidence
            for evidence in sorted(no_quote_by_symbol.get(key, ()), key=lambda item: item.trading_date)
            if evidence.trading_date in retained_session_dates
        )
        _validate_suspension_evidence_for_history(
            market=symbol.market,
            code=symbol.code,
            listing_date=symbol.listing_date,
            bar_dates=tuple(bar.trading_date for bar in retained_bars),
            no_quote_evidence=retained_no_quote_evidence,
            market_sessions=available_sessions_by_market[symbol.market],
            suspension_intervals=build.suspension_intervals,
        )
        available_sessions, short_history_reason = _validate_history_availability(
            symbol,
            retained_bars,
            retained_no_quote_evidence,
            available_sessions_by_market[symbol.market],
        )
        actions = _actions_for_stock(
            build.corporate_actions,
            symbol,
            tuple(
                sorted(
                    tuple(bar.trading_date for bar in retained_bars)
                    + tuple(evidence.trading_date for evidence in retained_no_quote_evidence)
                )
            ),
        )
        sources = set(sources_by_symbol[key])
        sources.update(action.source_url for action in actions)
        documents[key] = {
            "schemaVersion": SCHEMA_VERSION,
            "snapshotVersion": SNAPSHOT_VERSION,
            "code": symbol.code,
            "name": symbol.name,
            "market": symbol.market,
            "securityType": "common-stock",
            "priceMode": "raw",
            "currency": PRICE_UNIT,
            "priceUnit": PRICE_UNIT,
            "listingDate": symbol.listing_date.isoformat(),
            "availableSessions": available_sessions,
            "shortHistoryReason": short_history_reason,
            "comparisonUnitPolicy": {
                "version": 1,
                "effectiveFrom": "2026-08-11",
                "sourceUrl": COMPARISON_UNIT_POLICY_URL,
            },
            "bars": [_bar_json(bar) for bar in retained_bars],
            "noQuoteEvidence": [_no_quote_evidence_json(evidence) for evidence in retained_no_quote_evidence],
            "corporateActions": [_action_json(action) for action in actions],
            "sourceUrls": sorted(sources),
        }

    return documents, _market_cutoffs(
        documents,
        build.calendar,
        build.generated_at,
        available_sessions_by_market,
    )


def _available_market_sessions(
    build: SnapshotBuildInput,
    previous: Path | SnapshotManifest | None,
    previous_manifest: SnapshotManifest | None,
) -> dict[Market, tuple[date, ...]]:
    """以官方行事曆驗證市場交易日，拒絕共同遺漏日與非交易日。"""

    observed_sessions = _current_market_session_dates(build)
    claimed_sessions: dict[Market, set[date]] = {
        market: set(session_dates)
        for market, session_dates in observed_sessions.items()
    }
    if isinstance(previous, Path) and previous_manifest is not None:
        for market, cutoff in previous_manifest.markets.items():
            claimed_sessions[market].update(date.fromisoformat(session) for session in cutoff.trading_sessions)

    verified_sessions: dict[Market, tuple[date, ...]] = {}
    for market, dates in claimed_sessions.items():
        retained_dates = tuple(sorted(dates)[-RETENTION_SESSIONS:])
        if not retained_dates:
            raise SnapshotValidationError(f"缺少 {market} 官方交易日行情。")
        expected_sessions = _official_trading_sessions_ending_at(
            build.calendar,
            retained_dates[-1],
            RETENTION_SESSIONS,
        )
        if retained_dates != expected_sessions:
            missing = tuple(session for session in expected_sessions if session not in dates)
            unexpected = tuple(session for session in retained_dates if session not in expected_sessions)
            details: list[str] = []
            if missing:
                details.append("缺漏 " + ", ".join(session.isoformat() for session in missing))
            if unexpected:
                details.append("非預期 " + ", ".join(session.isoformat() for session in unexpected))
            raise SnapshotValidationError(f"{market} 官方交易日缺漏或不在官方交易視窗：{'；'.join(details)}。")
        verified_sessions[market] = expected_sessions
    return verified_sessions


def _current_market_session_dates(build: SnapshotBuildInput) -> dict[Market, set[date]]:
    """取得本次兩市場日行情聲明的交易日，並驗證每個檔案日的日期一致。"""

    result: dict[Market, set[date]] = {"TWSE": set(), "TPEx": set()}
    for session in build.sessions:
        if session.market not in result:
            raise SnapshotValidationError("交易日行情的市場標記無效。")
        observed_dates = {
            *(quote.trading_date for quote in session.quotes),
            *(evidence.trading_date for evidence in session.no_quote_evidence),
        }
        if len(observed_dates) != 1:
            raise SnapshotValidationError(f"{session.market} 官方交易日行情日期不一致。")
        result[session.market].update(observed_dates)
    return result


def _official_trading_sessions_between(
    calendar: TradingCalendar,
    first_session: date,
    last_session: date,
) -> tuple[date, ...]:
    """依官方休市日曆列出閉區間內的交易日，行事曆涵蓋不足即拒絕猜測。"""

    if first_session > last_session:
        return ()
    _require_calendar_coverage(calendar, first_session, last_session)
    sessions: list[date] = []
    candidate = first_session
    while candidate <= last_session:
        if candidate.weekday() < 5 and candidate not in calendar.holiday_dates:
            sessions.append(candidate)
        candidate += timedelta(days=1)
    return tuple(sessions)


def _official_trading_sessions_ending_at(
    calendar: TradingCalendar,
    cutoff: date,
    count: int,
) -> tuple[date, ...]:
    """依官方行事曆取截至 cutoff 的固定數量交易日。"""

    _require_calendar_coverage(calendar, cutoff, cutoff)
    sessions: list[date] = []
    candidate = cutoff
    lower_bound = _calendar_coverage_start(calendar)
    while len(sessions) < count:
        if candidate.weekday() < 5 and candidate not in calendar.holiday_dates:
            sessions.append(candidate)
        candidate -= timedelta(days=1)
        if candidate < lower_bound and len(sessions) < count:
            raise SnapshotValidationError("官方交易日曆不足以驗證最近 120 個交易日。")
    return tuple(reversed(sessions))


def _require_calendar_coverage(calendar: TradingCalendar, first_day: date, last_day: date) -> None:
    if first_day < _calendar_coverage_start(calendar) or last_day > calendar.valid_through:
        raise SnapshotValidationError("官方交易日曆未涵蓋交易日視窗，不能猜測市場資料完整性。")


def _calendar_coverage_start(calendar: TradingCalendar) -> date:
    return date(min(day.year for day in calendar.holiday_dates), 1, 1)


def _validate_incremental_history(
    previous: Path | SnapshotManifest | None,
    previous_manifest: SnapshotManifest | None,
    calendar: TradingCalendar,
) -> None:
    """增量來源必須與目前無報價證據契約相容，否則強制完整 bootstrap。"""

    if previous_manifest is None:
        return
    if previous_manifest.snapshot_version == PREVIOUS_SNAPSHOT_VERSION:
        raise SnapshotValidationError(_v2_rebootstrap_message())
    if previous_manifest.snapshot_version != LEGACY_SNAPSHOT_VERSION:
        return
    if not isinstance(previous, Path):
        raise SnapshotValidationError(_v1_rebootstrap_message())
    try:
        expected_by_market = {
            market: _official_trading_sessions_ending_at(
                calendar,
                date.fromisoformat(cutoff.cutoff_date),
                RETENTION_SESSIONS,
            )
            for market, cutoff in previous_manifest.markets.items()
        }
        for market, cutoff in previous_manifest.markets.items():
            actual_sessions = tuple(date.fromisoformat(session) for session in cutoff.trading_sessions)
            if actual_sessions != expected_by_market[market]:
                raise ValueError
    except (ValueError, SnapshotValidationError) as error:
        raise SnapshotValidationError(_v1_rebootstrap_message()) from error


def _validate_v1_replacement_target(
    previous: Path | SnapshotManifest | None,
    output: Path,
    market_cutoffs: Mapping[str, MarketCutoff],
) -> None:
    """禁止用未回補的短 v2 候選資料直接覆蓋既有 v1 快照。"""

    if previous is not None or not output.is_dir() or not (output / "manifest.json").is_file():
        return
    existing = validate_snapshot(output)
    if existing.snapshot_version != LEGACY_SNAPSHOT_VERSION:
        return
    if any(len(cutoff.trading_sessions) != RETENTION_SESSIONS for cutoff in market_cutoffs.values()):
        raise SnapshotValidationError(_v1_rebootstrap_message())


def _v1_rebootstrap_message() -> str:
    return "v1 快照無法由官方交易日曆證明最近 120 個交易日完整；請先以官方歷史資料回補或重新 bootstrap。"


def _v2_rebootstrap_message() -> str:
    return "v2 快照無法承載官方未報價證據；請以官方歷史資料重新 bootstrap。"


def _validate_history_availability(
    symbol: SupportedSymbol,
    bars: Sequence[_NormalizedBar],
    no_quote_evidence: Sequence[NoQuoteEvidence],
    market_sessions: Sequence[date],
) -> tuple[int, Literal["listing-history"] | None]:
    """每個應有交易日必須是合法 K 線或同日官方未報價證據。"""
    eligible_sessions = tuple(session for session in market_sessions if session >= symbol.listing_date)
    bar_dates = tuple(bar.trading_date for bar in bars)
    evidence_dates = tuple(evidence.trading_date for evidence in no_quote_evidence)
    if (
        not eligible_sessions
        or len(set(bar_dates)) != len(bar_dates)
        or len(set(evidence_dates)) != len(evidence_dates)
        or set(bar_dates) & set(evidence_dates)
        or tuple(sorted((*bar_dates, *evidence_dates))) != eligible_sessions
    ):
        raise SnapshotValidationError(f"{symbol.market} {symbol.code} 的歷史交易日有不合理缺口。")
    short_history_reason: Literal["listing-history"] | None = None
    if len(eligible_sessions) < len(market_sessions):
        short_history_reason = "listing-history"
    return len(eligible_sessions), short_history_reason


def _validate_suspension_evidence_for_history(
    *,
    market: Market,
    code: str,
    listing_date: date,
    bar_dates: Sequence[date],
    no_quote_evidence: Sequence[NoQuoteEvidence],
    market_sessions: Sequence[date],
    suspension_intervals: Sequence[SuspensionInterval],
) -> None:
    """確認每一筆 official-suspension 都對應公告，並完整覆蓋其 expected sessions。"""

    intervals = tuple(
        interval
        for interval in suspension_intervals
        if (interval.market, interval.code) == (market, code)
    )
    observed_bar_dates = set(bar_dates)
    evidence_by_date = {evidence.trading_date: evidence for evidence in no_quote_evidence}
    for evidence in no_quote_evidence:
        matching = tuple(
            interval
            for interval in intervals
            if interval.includes(evidence.trading_date)
        )
        if evidence.reason == "official-suspension":
            if len(matching) != 1 or evidence.source_url not in matching[0].source_urls:
                raise SnapshotValidationError(
                    f"{market} {code} 的官方停牌證據沒有對應公告區間：{evidence.trading_date.isoformat()}。"
                )
        elif evidence.reason == "official-no-quote":
            if matching:
                raise SnapshotValidationError(
                    f"{market} {code} 的公告停牌日不可標示為一般未報價：{evidence.trading_date.isoformat()}。"
                )
        else:
            raise SnapshotValidationError("官方未報價證據原因無效。")

    eligible_sessions = tuple(session for session in market_sessions if session >= listing_date)
    for interval in intervals:
        for session_date in eligible_sessions:
            if not interval.includes(session_date):
                continue
            if session_date in observed_bar_dates:
                raise SnapshotValidationError(
                    f"{market} {code} 的停止買賣區間與合法 K 線衝突：{session_date.isoformat()}。"
                )
            evidence = evidence_by_date.get(session_date)
            if (
                evidence is None
                or evidence.reason != "official-suspension"
                or evidence.source_url not in interval.source_urls
            ):
                raise SnapshotValidationError(
                    f"{market} {code} 的停止買賣區間缺少官方證據：{session_date.isoformat()}。"
                )


def _normalize_quote(quote: DailyQuote) -> _NormalizedBar:
    comparison_unit = comparison_unit_for_prices(
        (quote.open, quote.high, quote.low, quote.close),
        quote.source_precision,
    )
    return _NormalizedBar(
        trading_date=quote.trading_date,
        open=quote.open,
        high=quote.high,
        low=quote.low,
        close=quote.close,
        volume_shares=quote.volume_shares,
        transaction_count=quote.transaction_count,
        source_precision=quote.source_precision,
        comparison_unit=comparison_unit,
        source_url=quote.source_url,
    )


def _validate_bars(symbol: SupportedSymbol, bars: Sequence[_NormalizedBar]) -> None:
    previous_date: date | None = None
    for bar in bars:
        if min(bar.open, bar.high, bar.low, bar.close) < 0:
            raise SnapshotValidationError(f"{symbol.market} {symbol.code} 有負價格。")
        if bar.high < max(bar.open, bar.low, bar.close):
            raise SnapshotValidationError(f"{symbol.market} {symbol.code} 的最高價關係無效。")
        if bar.low > min(bar.open, bar.high, bar.close):
            raise SnapshotValidationError(f"{symbol.market} {symbol.code} 的最低價關係無效。")
        if bar.volume_shares < 0:
            raise SnapshotValidationError(f"{symbol.market} {symbol.code} 的成交量不可為負數。")
        if previous_date is not None and bar.trading_date <= previous_date:
            raise SnapshotValidationError(f"{symbol.market} {symbol.code} 的交易日必須嚴格遞增。")
        previous_date = bar.trading_date


def _actions_for_stock(
    actions: Sequence[CorporateAction],
    symbol: SupportedSymbol,
    observed_dates: Sequence[date],
) -> tuple[CorporateAction, ...]:
    if not observed_dates:
        raise SnapshotValidationError(f"{symbol.market} {symbol.code} 沒有可稽核交易日。")
    first_date = min(observed_dates)
    last_date = max(observed_dates)
    matching = [
        action
        for action in actions
        if (action.market, action.code) == (symbol.market, symbol.code)
        and first_date <= action.action_date <= last_date
    ]
    for action in matching:
        if not action.source_url.startswith("https://"):
            raise SnapshotValidationError(f"{symbol.market} {symbol.code} 的公司行動缺少官方來源。")
    return tuple(sorted(matching, key=lambda item: (item.action_date, item.action_type)))


def _market_cutoffs(
    documents: Mapping[tuple[Market, str], dict[str, Any]],
    calendar: TradingCalendar,
    generated_at: datetime,
    available_sessions_by_market: Mapping[Market, Sequence[date]],
) -> dict[str, MarketCutoff]:
    expected = expected_cutoff_date(calendar, generated_at)
    result: dict[str, MarketCutoff] = {}
    for market in ("TWSE", "TPEx"):
        market_documents = [document for (document_market, _), document in documents.items() if document_market == market]
        if not market_documents:
            raise SnapshotValidationError(f"缺少 {market} 支援普通股。")
        available_sessions = available_sessions_by_market[market]
        if not available_sessions:
            raise SnapshotValidationError(f"{market} 缺少可驗證交易日。")
        cutoff = available_sessions[-1]
        cutoff_text = cutoff.isoformat()
        if any(document["availableSessions"] < 1 for document in market_documents):
            raise SnapshotValidationError(f"{market} 可用交易日與資料截止日不一致。")
        result[market] = MarketCutoff(
            cutoff_date=cutoff_text,
            expected_cutoff_date=expected.isoformat() if expected else None,
            freshness=compute_freshness(calendar, cutoff, generated_at),
            calendar_source_url=calendar.source_url,
            calendar_valid_through=calendar.valid_through.isoformat(),
            trading_sessions=tuple(session.isoformat() for session in available_sessions),
        )
    return result


def _validate_market_cutoffs(cutoffs: Mapping[str, MarketCutoff]) -> None:
    twse = cutoffs.get("TWSE")
    tpex = cutoffs.get("TPEx")
    if twse is None or tpex is None:
        raise SnapshotValidationError("快照必須同時包含 TWSE 與 TPEx。")
    if twse.cutoff_date != tpex.cutoff_date:
        raise SnapshotValidationError(
            f"TWSE 與 TPEx 資料截止日不一致：{twse.cutoff_date}、{tpex.cutoff_date}。"
        )
    for market, cutoff in cutoffs.items():
        cutoff_date = date.fromisoformat(cutoff.cutoff_date)
        if cutoff.expected_cutoff_date is None:
            if cutoff.freshness != "unknown":
                raise SnapshotValidationError(f"{market} 沒有預期截止日卻標示為已知新鮮度。")
            continue
        expected = date.fromisoformat(cutoff.expected_cutoff_date)
        if cutoff_date > expected:
            raise SnapshotValidationError(f"{market} 資料截止日不得晚於官方預期交易日。")
        if cutoff_date == expected and cutoff.freshness != "fresh":
            raise SnapshotValidationError(f"{market} 截止日等於預期交易日卻未標示 fresh。")
        if cutoff_date < expected and cutoff.freshness == "fresh":
            raise SnapshotValidationError(f"{market} 截止日落後預期交易日卻標示 fresh。")


def _index_stock_documents(
    documents: Mapping[tuple[Market, str], dict[str, Any]],
) -> tuple[tuple[StockIndexEntry, ...], dict[str, bytes]]:
    entries: list[StockIndexEntry] = []
    payloads: dict[str, bytes] = {}
    market_order = {"TWSE": 0, "TPEx": 1}
    for (market, code), document in sorted(documents.items(), key=lambda item: (market_order[item[0][0]], item[0][1])):
        payload = _canonical_json_bytes(document)
        digest = _digest(payload)
        path = f"data/stocks/{code}.{digest[:12]}.json"
        bars = document["bars"]
        no_quote_evidence = document["noQuoteEvidence"]
        entry = StockIndexEntry(
            code=code,
            name=document["name"],
            market=market,
            security_type="common-stock",
            data_path=path,
            digest=digest,
            size=len(payload),
            first_date=bars[0]["date"] if bars else None,
            last_date=bars[-1]["date"] if bars else None,
            bar_count=len(bars),
            listing_date=document["listingDate"],
            available_sessions=document["availableSessions"],
            short_history_reason=document["shortHistoryReason"],
            no_quote_count=len(no_quote_evidence),
        )
        entries.append(entry)
        payloads[path] = payload
    return tuple(entries), payloads


def _validate_transition(
    previous: SnapshotManifest | None,
    entries: Sequence[StockIndexEntry],
    retired_symbols: Sequence[tuple[Market, str, str]],
) -> None:
    if previous is None:
        return
    current_by_key = {(entry.market, entry.code): entry for entry in entries}
    retired_by_key: dict[tuple[Market, str], str] = {}
    for market, code, source_url in retired_symbols:
        key = (market, code)
        if key in retired_by_key:
            raise SnapshotValidationError(f"下市或停止交易證據有重複股票：{market} {code}。")
        retired_by_key[key] = _official_evidence_url(source_url)
    previous_by_key = {(entry.market, entry.code): entry for entry in previous.symbols}
    missing = [key for key in previous_by_key if key not in current_by_key and key not in retired_by_key]
    if missing:
        details = ", ".join(f"{market} {code}" for market, code in missing)
        raise SnapshotValidationError(f"先前有效普通股消失且沒有官方證據：{details}。")
    if previous.symbols:
        coverage = Decimal(
            len([key for key in previous_by_key if key in current_by_key or key in retired_by_key])
        ) / Decimal(len(previous.symbols))
        if coverage < Decimal("0.98"):
            raise SnapshotValidationError(f"普通股覆蓋率 {coverage:.2%} 低於 98% 發布門檻。")
        reduction = Decimal(1) - Decimal(len(entries)) / Decimal(len(previous.symbols))
        if reduction > Decimal("0.01"):
            raise SnapshotValidationError("普通股總數降低超過 1%，需要人工核准。")
    for key, old_entry in previous_by_key.items():
        current = current_by_key.get(key)
        if (
            current is not None
            and current.last_date is not None
            and old_entry.last_date is not None
            and current.last_date < old_entry.last_date
        ):
            raise SnapshotValidationError(f"{key[0]} {key[1]} 的資料截止日倒退。")


def _validate_current_daily_coverage(
    previous: SnapshotManifest | None,
    build: SnapshotBuildInput,
    retired_symbols: Sequence[tuple[Market, str, str]],
) -> None:
    """增量時以當日官方行情檢查舊股票覆蓋率，不能讓舊 K 線掩蓋來源掉量。"""
    if previous is None or not previous.symbols:
        return
    previous_keys = {(entry.market, entry.code) for entry in previous.symbols}
    current_supported_keys = {(symbol.market, symbol.code) for symbol in build.symbols}
    coverage_keys = previous_keys & current_supported_keys
    if not coverage_keys:
        return
    retired_keys = {(market, code) for market, code, _ in retired_symbols}
    latest_session_date = max(
        observation_date
        for session in build.sessions
        for observation_date in (
            *(quote.trading_date for quote in session.quotes),
            *(evidence.trading_date for evidence in session.no_quote_evidence),
        )
    )
    current_observed_keys = {
        (quote.market, quote.code)
        for session in build.sessions
        for quote in session.quotes
        if quote.trading_date == latest_session_date and (quote.market, quote.code) in coverage_keys
    }
    current_observed_keys.update(
        (evidence.market, evidence.code)
        for session in build.sessions
        for evidence in session.no_quote_evidence
        if evidence.trading_date == latest_session_date and (evidence.market, evidence.code) in coverage_keys
    )
    coverage = Decimal(len((current_observed_keys | retired_keys) & coverage_keys)) / Decimal(len(coverage_keys))
    if coverage < Decimal("0.98"):
        raise SnapshotValidationError(
            f"當日官方普通股日行情覆蓋率 {coverage:.2%} 低於 98% 發布門檻。"
        )


def _provenance_document(build: SnapshotBuildInput, manifest: SnapshotManifest) -> dict[str, Any]:
    calendar_evidence = manifest.calendar or _calendar_evidence_from_trading_calendar(build.calendar)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "snapshotVersion": manifest.snapshot_version,
        "sourceCommit": manifest.source_commit,
        "snapshotHash": manifest.snapshot_hash,
        "generatedAt": manifest.generated_at,
        "calendar": _calendar_evidence_json(calendar_evidence),
        "suspensionEvidence": _suspension_evidence_json(manifest.suspension_intervals),
        "markets": {
            market: {
                "cutoffDate": cutoff.cutoff_date,
                "expectedCutoffDate": cutoff.expected_cutoff_date,
                "freshness": cutoff.freshness,
            }
            for market, cutoff in manifest.markets.items()
        },
    }


def _write_snapshot_atomically(
    *,
    output: Path,
    stock_payloads: Mapping[str, bytes],
    manifest_document: Mapping[str, Any],
    provenance_document: Mapping[str, Any],
) -> None:
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent))
    try:
        for relative_path, payload in stock_payloads.items():
            destination = temporary / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            _write_bytes(destination, payload)
        _write_bytes(temporary / "manifest.json", _canonical_json_bytes(manifest_document))
        _write_bytes(temporary / "provenance.json", _canonical_json_bytes(provenance_document))
        _write_deterministic_tar(temporary)
        _write_sha256sums(temporary)
        validate_snapshot(temporary)
        _replace_output_directory(temporary, output)
    except Exception:
        try:
            _remove_known_snapshot_files(temporary, stock_payloads)
        except OSError:
            # 暫存內容無法確認為本次檔案時保留現場，不能用遞迴刪除掩蓋原始錯誤。
            pass
        raise


def _replace_output_directory(temporary: Path, output: Path) -> None:
    if not output.exists():
        temporary.replace(output)
        return
    if not output.is_dir():
        raise SnapshotValidationError("快照輸出位置已存在但不是目錄，拒絕覆寫。")
    previous_manifest = validate_snapshot(output)
    backup = output.parent / f".{output.name}.previous-{uuid4().hex}"
    output.replace(backup)
    try:
        temporary.replace(output)
    except Exception:
        backup.replace(output)
        raise
    try:
        _remove_known_snapshot_files(backup, (entry.data_path for entry in previous_manifest.symbols))
    except OSError:
        # 新快照已成功切換；保留可辨識的舊快照，供下次人工清理而不影響發布。
        pass


def _remove_known_snapshot_files(root: Path, stock_paths: Sequence[str]) -> None:
    """只刪除 manifest 明列或本次建立的路徑，不掃描或遞迴刪除未知內容。"""
    if not root.exists():
        return
    for relative_path in sorted(set(stock_paths)):
        path = root / relative_path
        if path.is_file():
            path.unlink()
    for name in ("manifest.json", "provenance.json", "snapshot.tar.gz", "SHA256SUMS"):
        path = root / name
        if path.is_file():
            path.unlink()
    for directory in (root / "data" / "stocks", root / "data", root):
        if directory.is_dir():
            directory.rmdir()


def _write_bytes(path: Path, payload: bytes) -> None:
    with path.open("wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def _write_deterministic_tar(root: Path) -> None:
    # 封存檔中的 SHA256SUMS 只涵蓋 payload；外層 SHA256SUMS 會在封存檔
    # 完成後重寫，避免將 snapshot.tar.gz 自身納入造成遞迴校驗。
    _write_sha256sums(root, include_archive=False)
    archive = root / "snapshot.tar.gz"
    candidates = sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.name != "snapshot.tar.gz"
    )
    with archive.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as tar:
                for path in candidates:
                    relative_path = path.relative_to(root).as_posix()
                    info = tar.gettarinfo(str(path), arcname=relative_path)
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    info.mtime = 0
                    info.mode = 0o644
                    with path.open("rb") as handle:
                        tar.addfile(info, handle)


def _write_sha256sums(root: Path, *, include_archive: bool = True) -> None:
    files = sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.name != "SHA256SUMS"
        and (include_archive or path.name != "snapshot.tar.gz")
    )
    lines = [f"{_digest(path.read_bytes())}  {path.relative_to(root).as_posix()}" for path in files]
    _write_bytes(root / "SHA256SUMS", ("\n".join(lines) + "\n").encode("utf-8"))


def validate_snapshot(snapshot: Path) -> SnapshotManifest:
    """驗證 manifest、個股、provenance、封裝內容與 SHA256SUMS。"""
    snapshot = snapshot.resolve()
    manifest = _validate_snapshot_payload(snapshot)
    _validate_sha256sums(snapshot)
    _validate_archive_contents(snapshot, manifest)
    return manifest


def _validate_snapshot_payload(snapshot: Path) -> SnapshotManifest:
    """驗證不依賴外層封存檔的資料 payload。"""
    manifest_path = snapshot / "manifest.json"
    if not manifest_path.is_file():
        raise SnapshotValidationError("找不到 manifest.json。")
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotValidationError("manifest.json 不是有效 UTF-8 JSON。") from error
    manifest = _manifest_from_json(document)
    _validate_manifest_files(snapshot, manifest)
    _validate_provenance(snapshot, manifest)
    return manifest


def _validate_manifest_files(snapshot: Path, manifest: SnapshotManifest) -> None:
    seen_keys: set[tuple[Market, str]] = set()
    for entry in manifest.symbols:
        key = (entry.market, entry.code)
        if key in seen_keys:
            raise SnapshotValidationError("manifest 有重複的市場／股票代碼。")
        seen_keys.add(key)
        path = snapshot / entry.data_path
        if not path.is_file() or not path.resolve().is_relative_to(snapshot):
            raise SnapshotValidationError(f"manifest 指向不存在或不安全的股票資料：{entry.data_path}。")
        payload = path.read_bytes()
        if len(payload) != entry.size or _digest(payload) != entry.digest:
            raise SnapshotValidationError(f"股票資料雜湊不符：{entry.market} {entry.code}。")
        try:
            stock = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SnapshotValidationError(f"股票資料不是有效 UTF-8 JSON：{entry.market} {entry.code}。") from error
        _validate_stock_document(
            stock,
            entry,
            tuple(date.fromisoformat(session) for session in manifest.markets[entry.market].trading_sessions),
            manifest.snapshot_version,
            manifest.suspension_intervals,
        )


def _validate_provenance(snapshot: Path, manifest: SnapshotManifest) -> None:
    path = snapshot / "provenance.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotValidationError("provenance.json 不是有效 UTF-8 JSON。") from error
    try:
        calendar = document["calendar"]
        suspension_evidence = document.get("suspensionEvidence")
        markets = document["markets"]
        if (
            not isinstance(document, dict)
            or document["schemaVersion"] != SCHEMA_VERSION
            or document["snapshotVersion"] != manifest.snapshot_version
            or document["sourceCommit"] != manifest.source_commit
            or document["snapshotHash"] != manifest.snapshot_hash
            or document["generatedAt"] != manifest.generated_at
            or not isinstance(calendar, dict)
            or not isinstance(markets, dict)
            or set(markets) != {"TWSE", "TPEx"}
        ):
            raise ValueError
        calendar_source_url = calendar["sourceUrl"]
        calendar_valid_through = calendar["validThrough"]
        _official_evidence_url(calendar_source_url)
        date.fromisoformat(calendar_valid_through)
        if manifest.snapshot_version == SNAPSHOT_VERSION:
            calendar_evidence = _calendar_evidence_from_json(calendar)
            suspension_intervals = _suspension_intervals_from_json(suspension_evidence)
            if manifest.calendar != calendar_evidence or manifest.suspension_intervals != suspension_intervals:
                raise ValueError
        elif "emergencyClosureEvidence" in calendar or suspension_evidence is not None:
            raise ValueError
        for market, cutoff in manifest.markets.items():
            value = markets[market]
            if (
                not isinstance(value, dict)
                or value["cutoffDate"] != cutoff.cutoff_date
                or value["expectedCutoffDate"] != cutoff.expected_cutoff_date
                or value["freshness"] != cutoff.freshness
                or calendar_source_url != cutoff.calendar_source_url
                or calendar_valid_through != cutoff.calendar_valid_through
            ):
                raise ValueError
    except (KeyError, TypeError, ValueError, SnapshotValidationError) as error:
        raise SnapshotValidationError("provenance.json 與 manifest 不一致。") from error


def _validate_stock_document(
    stock: object,
    entry: StockIndexEntry,
    market_sessions: Sequence[date],
    snapshot_version: int,
    suspension_intervals: Sequence[SuspensionInterval] = (),
) -> None:
    if not isinstance(stock, dict):
        raise SnapshotValidationError("股票快照必須是 JSON 物件。")
    required = {
        "schemaVersion",
        "snapshotVersion",
        "code",
        "name",
        "market",
        "securityType",
        "priceMode",
        "currency",
        "priceUnit",
        "comparisonUnitPolicy",
        "bars",
        "corporateActions",
        "sourceUrls",
    }
    if snapshot_version in HISTORY_METADATA_SNAPSHOT_VERSIONS:
        required.update({"listingDate", "availableSessions", "shortHistoryReason"})
    if snapshot_version == SNAPSHOT_VERSION:
        required.add("noQuoteEvidence")
    if not required.issubset(stock):
        raise SnapshotValidationError(f"股票快照缺少必要欄位：{entry.market} {entry.code}。")
    if snapshot_version != SNAPSHOT_VERSION and "noQuoteEvidence" in stock:
        raise SnapshotValidationError("舊版股票快照不可混入 v3 未報價證據欄位。")
    if (
        stock["schemaVersion"] != SCHEMA_VERSION
        or stock["snapshotVersion"] != snapshot_version
        or stock["code"] != entry.code
        or stock["market"] != entry.market
        or stock["securityType"] != "common-stock"
        or stock["priceMode"] != "raw"
        or stock["currency"] != PRICE_UNIT
        or stock["priceUnit"] != PRICE_UNIT
    ):
        raise SnapshotValidationError(f"股票快照核心欄位不符：{entry.market} {entry.code}。")
    if not isinstance(stock["name"], str) or not stock["name"].strip():
        raise SnapshotValidationError(f"股票快照名稱無效：{entry.market} {entry.code}。")
    listing_date: date | None = None
    if snapshot_version in HISTORY_METADATA_SNAPSHOT_VERSIONS:
        if (
            stock["listingDate"] != entry.listing_date
            or stock["availableSessions"] != entry.available_sessions
            or stock["shortHistoryReason"] != entry.short_history_reason
        ):
            raise SnapshotValidationError(f"股票快照歷史可用性欄位不一致：{entry.market} {entry.code}。")
        try:
            listing_date = date.fromisoformat(stock["listingDate"])
        except (TypeError, ValueError) as error:
            raise SnapshotValidationError(f"股票快照上市日期無效：{entry.market} {entry.code}。") from error
        if (
            not isinstance(stock["availableSessions"], int)
            or isinstance(stock["availableSessions"], bool)
            or stock["availableSessions"] < 1
            or stock["availableSessions"] > RETENTION_SESSIONS
            or stock["shortHistoryReason"] not in {None, "listing-history"}
        ):
            raise SnapshotValidationError(f"股票快照歷史可用性欄位無效：{entry.market} {entry.code}。")
    policy = stock["comparisonUnitPolicy"]
    if not isinstance(policy, dict):
        raise SnapshotValidationError(f"股票快照比較單位規則無效：{entry.market} {entry.code}。")
    try:
        if not isinstance(policy["version"], int) or policy["version"] <= 0:
            raise ValueError
        date.fromisoformat(policy["effectiveFrom"])
        _official_evidence_url(policy["sourceUrl"])
    except (KeyError, TypeError, ValueError) as error:
        raise SnapshotValidationError(f"股票快照比較單位規則無效：{entry.market} {entry.code}。") from error
    source_urls = _stock_source_urls(stock, entry)
    bars = stock["bars"]
    if (
        not isinstance(bars, list)
        or len(bars) > RETENTION_SESSIONS
        or snapshot_version != SNAPSHOT_VERSION and not bars
    ):
        raise SnapshotValidationError(f"股票快照 K 線數量不符合範圍：{entry.market} {entry.code}。")
    dates: list[date] = []
    for bar in bars:
        if not isinstance(bar, dict):
            raise SnapshotValidationError("股票快照 K 線必須是 JSON 物件。")
        try:
            bar_date = date.fromisoformat(bar["date"])
            prices = [Decimal(str(bar[name])) for name in ("open", "high", "low", "close")]
            volume = int(bar["volumeShares"])
            source_precision = Decimal(str(bar["sourcePrecision"]))
            comparison_unit = Decimal(str(bar["comparisonUnit"]))
        except (KeyError, TypeError, ValueError) as error:
            raise SnapshotValidationError("股票快照 K 線欄位格式無效。") from error
        if (
            bar.get("priceUnit") != PRICE_UNIT
            or min(prices) < 0
            or prices[1] < max(prices)
            or prices[2] > min(prices)
            or volume < 0
        ):
            raise SnapshotValidationError("股票快照 K 線 OHLCV 關係無效。")
        if source_precision <= 0 or comparison_unit < source_precision:
            raise SnapshotValidationError("股票快照的精度或比較單位無效。")
        dates.append(bar_date)
    if dates != sorted(dates) or len(set(dates)) != len(dates):
        raise SnapshotValidationError("股票快照交易日必須遞增且不得重複。")
    no_quote_dates: list[date] = []
    parsed_no_quote_evidence: list[NoQuoteEvidence] = []
    if snapshot_version == SNAPSHOT_VERSION:
        no_quote_evidence = stock["noQuoteEvidence"]
        if not isinstance(no_quote_evidence, list) or len(no_quote_evidence) > RETENTION_SESSIONS:
            raise SnapshotValidationError(f"股票快照未報價證據數量不符合範圍：{entry.market} {entry.code}。")
        for evidence in no_quote_evidence:
            if not isinstance(evidence, dict):
                raise SnapshotValidationError("股票快照未報價證據必須是 JSON 物件。")
            try:
                evidence_date = date.fromisoformat(evidence["date"])
                evidence_source_url = _official_evidence_url(evidence["sourceUrl"])
                if (
                    evidence["market"] != entry.market
                    or evidence["code"] != entry.code
                    or evidence["reason"] not in {"official-no-quote", "official-suspension"}
                ):
                    raise ValueError
            except (KeyError, TypeError, ValueError, SnapshotValidationError) as error:
                raise SnapshotValidationError("股票快照未報價證據欄位無效。") from error
            if evidence_source_url not in source_urls:
                raise SnapshotValidationError("股票快照未報價證據缺少對應官方來源。")
            no_quote_dates.append(evidence_date)
            parsed_no_quote_evidence.append(
                NoQuoteEvidence(
                    market=entry.market,
                    code=entry.code,
                    trading_date=evidence_date,
                    reason=evidence["reason"],
                    source_url=evidence_source_url,
                )
            )
        if no_quote_dates != sorted(no_quote_dates) or len(set(no_quote_dates)) != len(no_quote_dates):
            raise SnapshotValidationError("股票快照未報價證據日期必須遞增且不得重複。")
        if set(dates) & set(no_quote_dates):
            raise SnapshotValidationError("股票快照未報價證據不可與合法 K 線共用日期。")
        if not dates and not no_quote_dates:
            raise SnapshotValidationError("股票快照至少需要一筆合法 K 線或官方未報價證據。")
        expected_first_date = dates[0].isoformat() if dates else None
        expected_last_date = dates[-1].isoformat() if dates else None
        if (
            entry.first_date != expected_first_date
            or entry.last_date != expected_last_date
            or len(dates) != entry.bar_count
            or len(no_quote_dates) != entry.no_quote_count
        ):
            raise SnapshotValidationError("manifest 與股票快照的日期、K 線或未報價證據數量不一致。")
    elif dates[0].isoformat() != entry.first_date or dates[-1].isoformat() != entry.last_date or len(dates) != entry.bar_count:
        raise SnapshotValidationError("manifest 與股票快照的日期或筆數不一致。")
    if snapshot_version in HISTORY_METADATA_SNAPSHOT_VERSIONS:
        if listing_date is None:
            raise SnapshotValidationError(f"股票快照上市日期無效：{entry.market} {entry.code}。")
        eligible_sessions = tuple(session for session in market_sessions if session >= listing_date)
        observed_dates = tuple(sorted((*dates, *no_quote_dates)))
        if (
            tuple(observed_dates) != eligible_sessions
            or len(observed_dates) != stock["availableSessions"]
        ):
            raise SnapshotValidationError(f"股票快照歷史交易日有不合理缺口：{entry.market} {entry.code}。")
        expected_short_history_reason: Literal["listing-history"] | None = None
        if len(eligible_sessions) < len(market_sessions):
            expected_short_history_reason = "listing-history"
        if stock["shortHistoryReason"] != expected_short_history_reason:
            raise SnapshotValidationError(f"股票快照短歷史原因無效：{entry.market} {entry.code}。")
        if snapshot_version == SNAPSHOT_VERSION:
            _validate_suspension_evidence_for_history(
                market=entry.market,
                code=entry.code,
                listing_date=listing_date,
                bar_dates=tuple(dates),
                no_quote_evidence=tuple(parsed_no_quote_evidence),
                market_sessions=market_sessions,
                suspension_intervals=suspension_intervals,
            )
    actions = stock["corporateActions"]
    if not isinstance(actions, list):
        raise SnapshotValidationError("股票快照公司行動欄位無效。")
    for action in actions:
        if not isinstance(action, dict):
            raise SnapshotValidationError("股票快照公司行動缺少官方來源。")
        try:
            date.fromisoformat(action["date"])
            date.fromisoformat(action["verifiedAt"])
            if action["type"] not in {
                "cash-dividend",
                "stock-dividend",
                "capital-reduction",
                "split",
                "other",
            }:
                raise ValueError
            if not isinstance(action["affectsPriceContinuity"], bool):
                raise ValueError
            _official_evidence_url(action["sourceUrl"])
        except (KeyError, TypeError, ValueError) as error:
            raise SnapshotValidationError("股票快照公司行動日期無效。") from error


def _stock_source_urls(stock: Mapping[str, Any], entry: StockIndexEntry) -> set[str]:
    source_urls = stock.get("sourceUrls")
    if not isinstance(source_urls, list) or not source_urls:
        raise SnapshotValidationError(f"股票快照缺少官方來源：{entry.market} {entry.code}。")
    verified: set[str] = set()
    for source_url in source_urls:
        try:
            verified.add(_official_evidence_url(source_url))
        except SnapshotValidationError as error:
            raise SnapshotValidationError(f"股票快照官方來源無效：{entry.market} {entry.code}。") from error
    return verified


def _validate_sha256sums(snapshot: Path, *, include_archive: bool = True) -> None:
    sums_path = snapshot / "SHA256SUMS"
    if not sums_path.is_file():
        raise SnapshotValidationError("找不到 SHA256SUMS。")
    expected_files = sorted(
        path.relative_to(snapshot).as_posix()
        for path in snapshot.rglob("*")
        if path.is_file()
        and path.name != "SHA256SUMS"
        and (include_archive or path.name != "snapshot.tar.gz")
    )
    _validate_checksum_lines(
        sums_path.read_text(encoding="utf-8").splitlines(),
        expected_files,
        lambda relative_path: _read_safe_snapshot_file(snapshot, relative_path),
        "SHA256SUMS",
    )


def _validate_checksum_lines(
    lines: Sequence[str],
    expected_files: Sequence[str],
    read_file: Any,
    label: str,
) -> None:
    seen_files: list[str] = []
    for line in lines:
        try:
            digest, relative_path = line.split("  ", 1)
        except ValueError as error:
            raise SnapshotValidationError(f"{label} 格式無效。") from error
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise SnapshotValidationError(f"{label} 雜湊格式無效：{relative_path}。")
        try:
            payload = read_file(relative_path)
        except SnapshotValidationError:
            raise
        except (OSError, ValueError) as error:
            raise SnapshotValidationError(f"{label} 驗證失敗：{relative_path}。") from error
        if _digest(payload) != digest:
            raise SnapshotValidationError(f"{label} 驗證失敗：{relative_path}。")
        seen_files.append(relative_path)
    if seen_files != list(expected_files):
        raise SnapshotValidationError(f"{label} 未完整列出所有快照檔案。")


def _read_safe_snapshot_file(snapshot: Path, relative_path: str) -> bytes:
    candidate = snapshot / relative_path
    if not candidate.is_file() or not candidate.resolve().is_relative_to(snapshot):
        raise SnapshotValidationError(f"SHA256SUMS 指向不安全或不存在的檔案：{relative_path}。")
    return candidate.read_bytes()


def _manifest_from_json(document: object) -> SnapshotManifest:
    if not isinstance(document, dict):
        raise SnapshotValidationError("manifest 必須是 JSON 物件。")
    try:
        markets_value = document["markets"]
        symbols_value = document["symbols"]
        if not isinstance(markets_value, dict) or not isinstance(symbols_value, list):
            raise TypeError
        snapshot_version = document["snapshotVersion"]
        if (
            document["schemaVersion"] != SCHEMA_VERSION
            or not isinstance(snapshot_version, int)
            or isinstance(snapshot_version, bool)
            or snapshot_version not in SUPPORTED_SNAPSHOT_VERSIONS
        ):
            raise ValueError
        if not isinstance(document["sourceCommit"], str) or not document["sourceCommit"].strip():
            raise ValueError
        if not isinstance(document["snapshotHash"], str) or len(document["snapshotHash"]) != 64:
            raise ValueError
        datetime.fromisoformat(document["generatedAt"])
        calendar_evidence: CalendarEvidence | None = None
        suspension_intervals: tuple[SuspensionInterval, ...] = ()
        if snapshot_version == SNAPSHOT_VERSION:
            calendar_evidence = _calendar_evidence_from_json(document["calendar"])
            suspension_intervals = _suspension_intervals_from_json(document["suspensionEvidence"])
        elif "calendar" in document or "suspensionEvidence" in document:
            raise ValueError
        if set(markets_value) != {"TWSE", "TPEx"}:
            raise ValueError
        markets = {
            market: _market_cutoff_from_json(market, markets_value[market])
            for market in ("TWSE", "TPEx")
        }
        if any(not isinstance(value, dict) for value in symbols_value):
            raise TypeError
        if snapshot_version == LEGACY_SNAPSHOT_VERSION and any(
            any(field in value for field in ("listingDate", "availableSessions", "shortHistoryReason", "noQuoteCount"))
            for value in symbols_value
        ):
            raise ValueError
        if snapshot_version == PREVIOUS_SNAPSHOT_VERSION and any("noQuoteCount" in value for value in symbols_value):
            raise ValueError
        if snapshot_version == SNAPSHOT_VERSION and any("noQuoteCount" not in value for value in symbols_value):
            raise ValueError
        symbols = tuple(
            StockIndexEntry(
                code=value["code"],
                name=value["name"],
                market=value["market"],
                security_type=value["securityType"],
                data_path=value["dataPath"],
                digest=value["digest"],
                size=value["size"],
                first_date=value["firstDate"],
                last_date=value["lastDate"],
                bar_count=value["barCount"],
                listing_date=value.get("listingDate") if snapshot_version in HISTORY_METADATA_SNAPSHOT_VERSIONS else None,
                available_sessions=value.get("availableSessions", 0) if snapshot_version in HISTORY_METADATA_SNAPSHOT_VERSIONS else 0,
                short_history_reason=value.get("shortHistoryReason") if snapshot_version in HISTORY_METADATA_SNAPSHOT_VERSIONS else None,
                no_quote_count=value.get("noQuoteCount", 0) if snapshot_version == SNAPSHOT_VERSION else 0,
            )
            for value in symbols_value
        )
        for entry in symbols:
            if (
                entry.market not in {"TWSE", "TPEx"}
                or entry.security_type != "common-stock"
                or not isinstance(entry.code, str)
                or not entry.code.strip()
                or not isinstance(entry.name, str)
                or not entry.name.strip()
                or not isinstance(entry.data_path, str)
                or not entry.data_path.startswith("data/stocks/")
                or len(entry.digest) != 64
                or entry.size <= 0
            ):
                raise ValueError
            if snapshot_version == SNAPSHOT_VERSION:
                if (
                    not isinstance(entry.bar_count, int)
                    or isinstance(entry.bar_count, bool)
                    or entry.bar_count < 0
                    or not isinstance(entry.no_quote_count, int)
                    or isinstance(entry.no_quote_count, bool)
                    or entry.no_quote_count < 0
                    or entry.bar_count + entry.no_quote_count < 1
                    or entry.bar_count + entry.no_quote_count > RETENTION_SESSIONS
                    or entry.bar_count == 0 and (entry.first_date is not None or entry.last_date is not None)
                    or entry.bar_count > 0 and (not isinstance(entry.first_date, str) or not isinstance(entry.last_date, str))
                ):
                    raise ValueError
                if entry.first_date is not None:
                    date.fromisoformat(entry.first_date)
                if entry.last_date is not None:
                    date.fromisoformat(entry.last_date)
            else:
                if (
                    not isinstance(entry.bar_count, int)
                    or isinstance(entry.bar_count, bool)
                    or entry.bar_count < 1
                    or not isinstance(entry.first_date, str)
                    or not isinstance(entry.last_date, str)
                ):
                    raise ValueError
                date.fromisoformat(entry.first_date)
                date.fromisoformat(entry.last_date)
            if snapshot_version in HISTORY_METADATA_SNAPSHOT_VERSIONS:
                if (
                    not isinstance(entry.listing_date, str)
                    or not isinstance(entry.available_sessions, int)
                    or isinstance(entry.available_sessions, bool)
                    or entry.available_sessions < 1
                    or entry.available_sessions > RETENTION_SESSIONS
                    or entry.short_history_reason not in {None, "listing-history"}
                ):
                    raise ValueError
                date.fromisoformat(entry.listing_date)
        manifest = SnapshotManifest(
            schema_version=document["schemaVersion"],
            snapshot_version=document["snapshotVersion"],
            source_commit=document["sourceCommit"],
            snapshot_hash=document["snapshotHash"],
            generated_at=document["generatedAt"],
            markets=markets,
            symbols=symbols,
            calendar=calendar_evidence,
            suspension_intervals=suspension_intervals,
        )
    except (KeyError, TypeError, ValueError) as error:
        raise SnapshotValidationError("manifest 欄位格式無效。") from error
    document_without_hash = dict(document)
    document_without_hash.pop("snapshotHash")
    if _digest(_canonical_json_bytes(document_without_hash)) != manifest.snapshot_hash:
        raise SnapshotValidationError("manifest snapshotHash 驗證失敗。")
    if manifest.calendar is not None and any(
        cutoff.calendar_source_url != manifest.calendar.source_url
        or cutoff.calendar_valid_through != manifest.calendar.valid_through
        for cutoff in manifest.markets.values()
    ):
        raise SnapshotValidationError("manifest 年度日曆與市場交易日視窗不一致。")
    if manifest.calendar is not None:
        closure_dates = {closure.trading_date.isoformat() for closure in manifest.calendar.emergency_closures}
        if any(closure_dates & set(cutoff.trading_sessions) for cutoff in manifest.markets.values()):
            raise SnapshotValidationError("manifest 交易日視窗不可包含緊急市場休市日。")
    if any((interval.market, interval.code) not in {(entry.market, entry.code) for entry in manifest.symbols} for interval in manifest.suspension_intervals):
        raise SnapshotValidationError("manifest 停止買賣區間包含不存在的普通股。")
    _validate_market_cutoffs(manifest.markets)
    return manifest


def _market_cutoff_from_json(market: str, value: object) -> MarketCutoff:
    if not isinstance(value, dict):
        raise ValueError(f"{market} 市場截止日欄位無效。")
    cutoff_date = value["cutoffDate"]
    expected_cutoff_date = value["expectedCutoffDate"]
    freshness = value["freshness"]
    calendar_source_url = value["calendarSourceUrl"]
    calendar_valid_through = value["calendarValidThrough"]
    trading_sessions = value["tradingSessions"]
    if (
        not isinstance(cutoff_date, str)
        or expected_cutoff_date is not None and not isinstance(expected_cutoff_date, str)
        or freshness not in {"fresh", "one-session-behind", "stale", "unknown"}
        or not isinstance(calendar_source_url, str)
        or not isinstance(calendar_valid_through, str)
        or not isinstance(trading_sessions, list)
        or not trading_sessions
        or any(not isinstance(session, str) for session in trading_sessions)
    ):
        raise ValueError(f"{market} 市場截止日欄位無效。")
    parsed_sessions = [date.fromisoformat(session) for session in trading_sessions]
    if parsed_sessions != sorted(parsed_sessions) or len(set(parsed_sessions)) != len(parsed_sessions):
        raise ValueError(f"{market} 交易日清單必須遞增且不得重複。")
    if date.fromisoformat(cutoff_date) != parsed_sessions[-1]:
        raise ValueError(f"{market} 截止日必須等於交易日清單最後一日。")
    if expected_cutoff_date is not None:
        date.fromisoformat(expected_cutoff_date)
    if date.fromisoformat(calendar_valid_through) < parsed_sessions[-1]:
        raise ValueError(f"{market} 交易日曆有效日早於快照截止日。")
    _official_evidence_url(calendar_source_url)
    return MarketCutoff(
        cutoff_date=cutoff_date,
        expected_cutoff_date=expected_cutoff_date,
        freshness=freshness,
        calendar_source_url=calendar_source_url,
        calendar_valid_through=calendar_valid_through,
        trading_sessions=tuple(trading_sessions),
    )


def _calendar_evidence_from_json(value: object) -> CalendarEvidence:
    if not isinstance(value, dict):
        raise ValueError("calendar 必須是 JSON 物件。")
    source_url = value["sourceUrl"]
    valid_through = value["validThrough"]
    _official_evidence_url(source_url)
    date.fromisoformat(valid_through)
    closures = parse_emergency_market_closure_evidence(value["emergencyClosureEvidence"])
    return CalendarEvidence(
        source_url=source_url,
        valid_through=valid_through,
        emergency_closures=closures,
    )


def _load_previous_manifest(previous: Path | SnapshotManifest | None) -> SnapshotManifest | None:
    if previous is None:
        return None
    if isinstance(previous, SnapshotManifest):
        return previous
    return validate_snapshot(previous)


def _load_previous_bars(
    previous: Path | SnapshotManifest | None,
) -> tuple[
    dict[tuple[Market, str], list[_NormalizedBar]],
    dict[tuple[Market, str], list[NoQuoteEvidence]],
    dict[tuple[Market, str], set[str]],
]:
    if previous is None or isinstance(previous, SnapshotManifest):
        return {}, {}, {}
    manifest = validate_snapshot(previous)
    bars_by_symbol: dict[tuple[Market, str], list[_NormalizedBar]] = {}
    no_quote_by_symbol: dict[tuple[Market, str], list[NoQuoteEvidence]] = {}
    sources_by_symbol: dict[tuple[Market, str], set[str]] = {}
    for entry in manifest.symbols:
        stock = json.loads((previous / entry.data_path).read_text(encoding="utf-8"))
        source_urls = _stock_source_urls(stock, entry)
        sources_by_symbol[(entry.market, entry.code)] = source_urls
        bars_by_symbol[(entry.market, entry.code)] = [
            _NormalizedBar(
                trading_date=date.fromisoformat(value["date"]),
                open=Decimal(str(value["open"])),
                high=Decimal(str(value["high"])),
                low=Decimal(str(value["low"])),
                close=Decimal(str(value["close"])),
                volume_shares=int(value["volumeShares"]),
                transaction_count=value.get("transactionCount"),
                source_precision=Decimal(str(value["sourcePrecision"])),
                comparison_unit=Decimal(str(value["comparisonUnit"])),
                source_url=next(iter(sorted(source_urls))),
            )
            for value in stock["bars"]
        ]
        if manifest.snapshot_version == SNAPSHOT_VERSION:
            no_quote_by_symbol[(entry.market, entry.code)] = [
                NoQuoteEvidence(
                    market=value["market"],
                    code=value["code"],
                    trading_date=date.fromisoformat(value["date"]),
                    reason=value["reason"],
                    source_url=value["sourceUrl"],
                )
                for value in stock["noQuoteEvidence"]
            ]
    return bars_by_symbol, no_quote_by_symbol, sources_by_symbol


def _bar_json(bar: _NormalizedBar) -> dict[str, Any]:
    result: dict[str, Any] = {
        "date": bar.trading_date.isoformat(),
        "open": _json_number(bar.open),
        "high": _json_number(bar.high),
        "low": _json_number(bar.low),
        "close": _json_number(bar.close),
        "volumeShares": bar.volume_shares,
        "priceUnit": PRICE_UNIT,
        "sourcePrecision": _json_number(bar.source_precision),
        "comparisonUnit": _json_number(bar.comparison_unit),
    }
    if bar.transaction_count is not None:
        result["transactionCount"] = bar.transaction_count
    return result


def _action_json(action: CorporateAction) -> dict[str, Any]:
    return {
        "date": action.action_date.isoformat(),
        "type": action.action_type,
        "affectsPriceContinuity": action.affects_price_continuity,
        "sourceUrl": action.source_url,
        "verifiedAt": action.verified_at.isoformat(),
    }


def _no_quote_evidence_json(evidence: NoQuoteEvidence) -> dict[str, str]:
    return {
        "market": evidence.market,
        "code": evidence.code,
        "date": evidence.trading_date.isoformat(),
        "reason": evidence.reason,
        "sourceUrl": evidence.source_url,
    }


def _calendar_evidence_from_trading_calendar(calendar: TradingCalendar) -> CalendarEvidence:
    return CalendarEvidence(
        source_url=calendar.source_url,
        valid_through=calendar.valid_through.isoformat(),
        emergency_closures=calendar.emergency_closures,
    )


def _calendar_evidence_json(evidence: CalendarEvidence) -> dict[str, Any]:
    return {
        "sourceUrl": evidence.source_url,
        "validThrough": evidence.valid_through,
        "emergencyClosureEvidence": {
            "schemaVersion": EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
            "closures": [
                {
                    "date": closure.trading_date.isoformat(),
                    "reason": closure.reason,
                    "sourceUrls": list(closure.source_urls),
                }
                for closure in evidence.emergency_closures
            ],
        },
    }


def _suspension_evidence_json(intervals: Sequence[SuspensionInterval]) -> dict[str, Any]:
    return {
        "schemaVersion": SUSPENSION_EVIDENCE_SCHEMA_VERSION,
        "intervals": [
            {
                "market": interval.market,
                "code": interval.code,
                "startDate": interval.start_date.isoformat(),
                "endDateExclusive": (
                    interval.end_date_exclusive.isoformat() if interval.end_date_exclusive is not None else None
                ),
                "reason": interval.reason,
                "sourceUrls": list(interval.source_urls),
            }
            for interval in intervals
        ],
    }


def _suspension_intervals_from_json(value: object) -> tuple[SuspensionInterval, ...]:
    return parse_suspension_interval_evidence(value)


def _market_cutoff_json(cutoff: MarketCutoff) -> dict[str, Any]:
    return {
        "cutoffDate": cutoff.cutoff_date,
        "expectedCutoffDate": cutoff.expected_cutoff_date,
        "freshness": cutoff.freshness,
        "calendarSourceUrl": cutoff.calendar_source_url,
        "calendarValidThrough": cutoff.calendar_valid_through,
        "tradingSessions": list(cutoff.trading_sessions),
    }


def _stock_entry_json(entry: StockIndexEntry) -> dict[str, Any]:
    return {
        "code": entry.code,
        "name": entry.name,
        "market": entry.market,
        "securityType": entry.security_type,
        "dataPath": entry.data_path,
        "digest": entry.digest,
        "size": entry.size,
        "firstDate": entry.first_date,
        "lastDate": entry.last_date,
        "barCount": entry.bar_count,
        "listingDate": entry.listing_date,
        "availableSessions": entry.available_sessions,
        "shortHistoryReason": entry.short_history_reason,
        "noQuoteCount": entry.no_quote_count,
    }


def _canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _json_number(value: Decimal) -> int | float:
    if value == value.to_integral_value():
        return int(value)
    return float(value)


def _iso_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        raise SnapshotValidationError("generatedAt 必須含有時區。")
    return value.isoformat(timespec="seconds")


class _TraditionalChineseArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        self.exit(2, "錯誤：命令列參數無效，請使用 --help 查看用法。\n")


def main(argv: Sequence[str] | None = None) -> int:
    """快照工具 CLI；fixture 與 validate 都不會連線官方市場來源。"""
    parser = _TraditionalChineseArgumentParser(description="TWSE／TPEx 官方盤後快照工具")
    commands = parser.add_subparsers(dest="command", required=True, title="模式")

    fixture = commands.add_parser("fixture", help="從已提交的官方形狀樣本建立離線快照")
    fixture.add_argument("--fixtures", type=Path, required=True, help="fixture 目錄")
    fixture.add_argument("--output", type=Path, required=True, help="輸出目錄")
    fixture.add_argument("--source-commit", required=True, help="對應的完整 source commit")
    fixture.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES_PATH, help="公司行動與下市證據覆寫檔")

    validate = commands.add_parser("validate", help="驗證已建立的快照、雜湊與 SHA256SUMS")
    validate.add_argument("--snapshot", type=Path, required=True, help="快照目錄")

    pack = commands.add_parser("pack", help="重新產生可重現的 snapshot.tar.gz 與 SHA256SUMS")
    pack.add_argument("--snapshot", type=Path, required=True, help="快照目錄")

    bootstrap = commands.add_parser("bootstrap", help="以 120 個官方交易日建立基準快照")
    bootstrap.add_argument("--output", type=Path, required=True, help="輸出目錄")
    bootstrap.add_argument("--source-commit", required=True, help="對應的完整 source commit")
    bootstrap.add_argument("--cache", type=Path, default=Path(".cache/market-snapshot"), help="可續跑快取目錄")
    bootstrap.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES_PATH, help="公司行動與下市證據覆寫檔")
    bootstrap.add_argument("--suspensions", type=Path, default=DEFAULT_SUSPENSION_INTERVALS_PATH, help="官方停止買賣區間佐證檔")

    update = commands.add_parser("update", help="從前一成功快照追加一個官方交易日")
    update.add_argument("--previous", type=Path, required=True, help="前一成功快照目錄")
    update.add_argument("--output", type=Path, required=True, help="輸出目錄")
    update.add_argument("--source-commit", required=True, help="對應的完整 source commit")
    update.add_argument("--cache", type=Path, default=Path(".cache/market-snapshot"), help="可續跑快取目錄")
    update.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES_PATH, help="公司行動與下市證據覆寫檔")
    update.add_argument("--suspensions", type=Path, default=DEFAULT_SUSPENSION_INTERVALS_PATH, help="官方停止買賣區間佐證檔")

    args = parser.parse_args(argv)
    try:
        if args.command == "fixture":
            manifest = build_snapshot(None, _fixture_input(args.fixtures, args.source_commit, args.overrides), args.output)
            print(f"已建立離線 fixture 快照：{args.output}（{manifest.snapshot_hash}）。")
            return 0
        if args.command == "validate":
            manifest = validate_snapshot(args.snapshot)
            print(f"快照驗證通過：{manifest.snapshot_hash}。")
            return 0
        if args.command == "pack":
            manifest = pack_snapshot(args.snapshot)
            print(f"快照封裝完成：{manifest.snapshot_hash}。")
            return 0
        if args.command == "bootstrap":
            manifest = bootstrap_snapshot(args.output, args.source_commit, args.cache, args.overrides, args.suspensions)
            print(f"已建立 120 交易日基準快照：{manifest.snapshot_hash}。")
            return 0
        if args.command == "update":
            manifest, updated = update_snapshot(
                args.previous,
                args.output,
                args.source_commit,
                args.cache,
                args.overrides,
                args.suspensions,
            )
            if updated:
                print(f"已追加官方交易日快照：{manifest.snapshot_hash}。")
            else:
                print("官方資料截止日未變動，保留上一成功快照。")
            return 0
        raise SnapshotValidationError("不支援的快照模式。")
    except (OSError, SnapshotValidationError, ValueError) as error:
        print(f"快照處理失敗：{error}", file=sys.stderr)
        return 2


def _fixture_input(fixtures: Path, source_commit: str, overrides_path: Path) -> SnapshotBuildInput:
    twse_daily = parse_twse_daily(_read_fixture(fixtures, "twse-daily.json"))
    tpex_daily = parse_tpex_daily(_read_fixture(fixtures, "tpex-daily.json"))
    symbols = parse_supported_symbols(
        _read_fixture(fixtures, "twse-companies.json"),
        _read_fixture(fixtures, "tpex-companies.json"),
    )
    calendar = parse_holiday_calendar(_read_fixture(fixtures, "holiday-calendar.json"))
    latest_date = max(quote.trading_date for quote in (*twse_daily, *tpex_daily))
    actions = parse_corporate_actions(
        _read_fixture(fixtures, "twse-actions.json"),
        _read_fixture(fixtures, "tpex-actions.json"),
        verified_at=latest_date,
    )
    override_actions, retired_symbols = _load_company_action_overrides(overrides_path)
    return SnapshotBuildInput(
        source_commit=source_commit,
        generated_at=datetime.combine(latest_date, datetime.min.time().replace(hour=18), tzinfo=calendar.timezone),
        symbols=symbols,
        sessions=_fixture_market_sessions(twse_daily, tpex_daily, calendar, latest_date),
        corporate_actions=(*actions, *override_actions),
        calendar=calendar,
        retired_symbols=retired_symbols,
    )


def _fixture_market_sessions(
    twse_daily: Sequence[DailyQuote],
    tpex_daily: Sequence[DailyQuote],
    calendar: TradingCalendar,
    cutoff: date,
) -> tuple[MarketSession, ...]:
    """由離線官方形狀樣本重建完整 120 日 fixture，維持與 bootstrap 相同的完整性契約。"""

    sessions: list[MarketSession] = []
    for session_date in _official_trading_sessions_ending_at(calendar, cutoff, RETENTION_SESSIONS):
        sessions.append(
            MarketSession(
                "TWSE",
                tuple(replace(quote, trading_date=session_date) for quote in twse_daily),
            )
        )
        sessions.append(
            MarketSession(
                "TPEx",
                tuple(replace(quote, trading_date=session_date) for quote in tpex_daily),
            )
        )
    return tuple(sessions)


def _read_fixture(directory: Path, name: str) -> object:
    path = directory / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotValidationError(f"fixture 無法讀取：{path}。") from error


def _load_company_action_overrides(
    path: Path,
) -> tuple[tuple[CorporateAction, ...], tuple[tuple[Market, str, str], ...]]:
    """讀取版本化人工證據；只接受官方 HTTPS 來源以保留可追溯性。"""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotValidationError(f"公司行動覆寫檔無法讀取：{path}。") from error
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        raise SnapshotValidationError("公司行動覆寫檔 schemaVersion 必須是 1。")
    action_rows = payload.get("actions")
    retired_rows = payload.get("retiredSymbols")
    if not isinstance(action_rows, list) or not isinstance(retired_rows, list):
        raise SnapshotValidationError("公司行動覆寫檔必須包含 actions 與 retiredSymbols 陣列。")
    actions: list[CorporateAction] = []
    for row in action_rows:
        if not isinstance(row, dict):
            raise SnapshotValidationError("公司行動覆寫列必須是物件。")
        market = row.get("market")
        action_type = row.get("type")
        if market not in {"TWSE", "TPEx"} or action_type not in {
            "cash-dividend",
            "stock-dividend",
            "capital-reduction",
            "split",
            "other",
        }:
            raise SnapshotValidationError("公司行動覆寫列的市場或類型無效。")
        source_url = _official_evidence_url(row.get("sourceUrl"))
        try:
            code = _non_empty_text(row.get("code"), "公司行動覆寫代碼")
            action_date = date.fromisoformat(_non_empty_text(row.get("date"), "公司行動覆寫日期"))
            verified_at = date.fromisoformat(_non_empty_text(row.get("verifiedAt"), "公司行動覆寫查核日期"))
        except ValueError as error:
            raise SnapshotValidationError("公司行動覆寫日期必須是 ISO 格式。") from error
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
    retired: list[tuple[Market, str, str]] = []
    for row in retired_rows:
        if not isinstance(row, dict):
            raise SnapshotValidationError("下市或停止交易證據列必須是物件。")
        market = row.get("market")
        if market not in {"TWSE", "TPEx"}:
            raise SnapshotValidationError("下市或停止交易證據的市場無效。")
        retired.append(
            (
                market,
                _non_empty_text(row.get("code"), "下市或停止交易證據代碼"),
                _official_evidence_url(row.get("sourceUrl")),
            )
        )
    return tuple(actions), tuple(retired)


def _non_empty_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotValidationError(f"{label}不可空白。")
    return value.strip()


def _official_evidence_url(value: object) -> str:
    url = _non_empty_text(value, "官方證據網址")
    parsed = urlparse(url)
    try:
        port = parsed.port
    except ValueError as error:
        raise SnapshotValidationError("官方證據網址的連接埠無效。") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname not in {
            "openapi.twse.com.tw",
            "www.twse.com.tw",
            "www.tpex.org.tw",
            "dsp.tpex.org.tw",
        }
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise SnapshotValidationError("官方證據網址必須是核准主機的 HTTPS 來源。")
    return url


def pack_snapshot(snapshot: Path) -> SnapshotManifest:
    """在同層 staging 完成驗證後，原子切換可重現封裝與 checksum 清單。"""
    snapshot = snapshot.resolve()
    manifest = validate_snapshot(snapshot)
    staging = Path(mkdtemp(prefix=f".{snapshot.name}.pack-", dir=snapshot.parent))
    stock_paths = tuple(entry.data_path for entry in manifest.symbols)
    try:
        _copy_snapshot_payload_for_pack(snapshot, staging, stock_paths)
        _write_deterministic_tar(staging)
        _write_sha256sums(staging)
        validate_snapshot(staging)
        _replace_output_directory(staging, snapshot)
    except Exception:
        try:
            _remove_known_snapshot_files(staging, stock_paths)
        except OSError:
            # staging 無法完整辨識時保留現場，不能使用遞迴刪除掩蓋原始錯誤。
            pass
        raise
    return validate_snapshot(snapshot)


def _copy_snapshot_payload_for_pack(snapshot: Path, staging: Path, stock_paths: Sequence[str]) -> None:
    """只複製已由 manifest 識別的 payload，避免在原快照上就地改寫。"""
    for relative_path in (*stock_paths, "manifest.json", "provenance.json"):
        source = snapshot / relative_path
        destination = staging / relative_path
        if not source.is_file() or not source.resolve().is_relative_to(snapshot):
            raise SnapshotValidationError(f"快照 payload 路徑不安全或不存在：{relative_path}。")
        destination.parent.mkdir(parents=True, exist_ok=True)
        _write_bytes(destination, source.read_bytes())


def bootstrap_snapshot(
    output: Path,
    source_commit: str,
    cache_directory: Path,
    overrides_path: Path = DEFAULT_OVERRIDES_PATH,
    suspension_intervals_path: Path = DEFAULT_SUSPENSION_INTERVALS_PATH,
    *,
    now: datetime | None = None,
) -> SnapshotManifest:
    """以最近 120 個官方交易日建立基準快照，快取成功回應以便安全續跑。"""
    calendar = fetch_trading_calendar()
    generated_at = now or datetime.now(calendar.timezone)
    sessions = _recent_trading_sessions(calendar, generated_at, RETENTION_SESSIONS)
    symbols = fetch_supported_symbols()
    actions = fetch_corporate_actions()
    override_actions, retired_symbols = _load_company_action_overrides(overrides_path)
    suspension_intervals = load_suspension_interval_evidence(suspension_intervals_path)
    market_sessions: list[MarketSession] = []
    for session_date in sessions:
        market_sessions.append(
            _market_session_from_response(
                "TWSE",
                _fetch_cached_daily("TWSE", session_date, cache_directory, fetch_twse_historical_daily),
            )
        )
        _throttle_official_requests()
        market_sessions.append(
            _market_session_from_response(
                "TPEx",
                _fetch_cached_daily("TPEx", session_date, cache_directory, fetch_tpex_historical_daily),
            )
        )
        _throttle_official_requests()
    build_input = SnapshotBuildInput(
        source_commit=source_commit,
        generated_at=generated_at,
        symbols=symbols,
        sessions=tuple(market_sessions),
        corporate_actions=(*actions, *override_actions),
        calendar=calendar,
        retired_symbols=retired_symbols,
        suspension_intervals=suspension_intervals,
    )
    return build_snapshot(None, build_input, output)


def update_snapshot(
    previous: Path,
    output: Path,
    source_commit: str,
    cache_directory: Path,
    overrides_path: Path = DEFAULT_OVERRIDES_PATH,
    suspension_intervals_path: Path = DEFAULT_SUSPENSION_INTERVALS_PATH,
    *,
    now: datetime | None = None,
) -> tuple[SnapshotManifest, bool]:
    """只在兩市場都有一個新官方截止日時追加，既有截止日則不改寫。"""
    previous_directory, is_temporary = _previous_snapshot_directory(previous)
    previous_manifest: SnapshotManifest | None = None
    try:
        previous_manifest = validate_snapshot(previous_directory)
        if previous_manifest.snapshot_version == PREVIOUS_SNAPSHOT_VERSION:
            raise SnapshotValidationError(_v2_rebootstrap_message())
        calendar = fetch_trading_calendar()
        generated_at = now or datetime.now(calendar.timezone)
        expected = expected_cutoff_date(calendar, generated_at)
        if expected is None:
            raise SnapshotValidationError("官方交易日曆未涵蓋目前日期，不能安全更新快照。")
        expected_text = expected.isoformat()
        if all(cutoff.cutoff_date == expected_text for cutoff in previous_manifest.markets.values()):
            return previous_manifest, False
        if any(cutoff.cutoff_date > expected_text for cutoff in previous_manifest.markets.values()):
            raise SnapshotValidationError("前一快照截止日比官方預期交易日更新，拒絕覆寫。")

        previous_cutoff_dates = {date.fromisoformat(cutoff.cutoff_date) for cutoff in previous_manifest.markets.values()}
        if len(previous_cutoff_dates) != 1:
            raise SnapshotValidationError("前一快照兩市場截止日不一致，不能安全補齊。")
        missing_sessions = _trading_sessions_after(calendar, previous_cutoff_dates.pop(), expected)
        if not missing_sessions:
            raise SnapshotValidationError("前一快照與官方預期交易日的缺口無法辨識。")

        symbols = fetch_supported_symbols()
        actions = fetch_corporate_actions()
        override_actions, retired_symbols = _load_company_action_overrides(overrides_path)
        suspension_intervals = load_suspension_interval_evidence(suspension_intervals_path)
        if len(missing_sessions) == 1:
            twse_response = _fetch_cached_daily("TWSE", expected, cache_directory, fetch_twse_daily)
            _throttle_official_requests()
            tpex_response = _fetch_cached_daily("TPEx", expected, cache_directory, fetch_tpex_daily)
            market_sessions = (
                _market_session_from_response("TWSE", twse_response),
                _market_session_from_response("TPEx", tpex_response),
            )
        else:
            market_sessions_list: list[MarketSession] = []
            for session_date in missing_sessions:
                market_sessions_list.append(
                    _market_session_from_response(
                        "TWSE",
                        _fetch_cached_daily("TWSE", session_date, cache_directory, fetch_twse_historical_daily),
                    )
                )
                _throttle_official_requests()
                market_sessions_list.append(
                    _market_session_from_response(
                        "TPEx",
                        _fetch_cached_daily("TPEx", session_date, cache_directory, fetch_tpex_historical_daily),
                    )
                )
                _throttle_official_requests()
            market_sessions = tuple(market_sessions_list)
        build_input = SnapshotBuildInput(
            source_commit=source_commit,
            generated_at=generated_at,
            symbols=symbols,
            sessions=market_sessions,
            corporate_actions=(*actions, *override_actions),
            calendar=calendar,
            retired_symbols=retired_symbols,
            suspension_intervals=suspension_intervals,
        )
        return build_snapshot(previous_directory, build_input, output), True
    finally:
        if is_temporary and previous_manifest is not None:
            try:
                _remove_known_snapshot_files(previous_directory, (entry.data_path for entry in previous_manifest.symbols))
            except OSError:
                # 暫存檔案無法完整辨識時保留現場，不能使用遞迴刪除掩蓋問題。
                pass


def _trading_sessions_after(
    calendar: TradingCalendar,
    previous_cutoff: date,
    expected_cutoff: date,
) -> tuple[date, ...]:
    """列出官方日曆中前次 cutoff 之後、此次 expected 以前的全部交易日。"""
    if previous_cutoff >= expected_cutoff:
        return ()
    if previous_cutoff.year < min(day.year for day in calendar.holiday_dates):
        raise SnapshotValidationError("官方交易日曆未涵蓋前一快照 cutoff，不能猜測補齊日期。")
    sessions: list[date] = []
    candidate = previous_cutoff.fromordinal(previous_cutoff.toordinal() + 1)
    while candidate <= expected_cutoff:
        if candidate.weekday() < 5 and candidate not in calendar.holiday_dates:
            sessions.append(candidate)
        candidate = candidate.fromordinal(candidate.toordinal() + 1)
    return tuple(sessions)


def _previous_snapshot_directory(previous: Path) -> tuple[Path, bool]:
    if previous.is_dir():
        return previous, False
    if previous.is_file() and previous.name == "snapshot.tar.gz":
        return _extract_previous_snapshot_archive(previous), True
    raise SnapshotValidationError("前一成功快照必須是目錄，或是可獨立驗證的 snapshot.tar.gz。")


def _extract_previous_snapshot_archive(archive: Path) -> Path:
    """安全展開獨立 archive，驗證後才作為增量更新基準。"""
    archive = archive.resolve()
    temporary = Path(mkdtemp(prefix=f".{archive.stem}.previous-", dir=archive.parent))
    manifest: SnapshotManifest | None = None
    created_files: list[Path] = []
    created_directories: list[Path] = []
    try:
        with gzip.open(archive, "rb") as compressed:
            with tarfile.open(fileobj=compressed, mode="r:") as tar:
                names: set[str] = set()
                for member in tar.getmembers():
                    relative_path = _safe_archive_member_path(member)
                    if relative_path in names:
                        raise SnapshotValidationError("snapshot archive 有重複檔案。")
                    names.add(relative_path)
                    extracted = tar.extractfile(member)
                    if extracted is None:
                        raise SnapshotValidationError("snapshot archive 檔案無法讀取。")
                    destination = temporary / Path(relative_path)
                    _create_archive_parent_directories(temporary, destination.parent, created_directories)
                    created_files.append(destination)
                    _write_bytes(destination, extracted.read())
        manifest = _validate_snapshot_payload(temporary)
        if manifest.snapshot_version == LEGACY_SNAPSHOT_VERSION and not (temporary / "SHA256SUMS").is_file():
            raise SnapshotValidationError(
                "舊版 snapshot.tar.gz 未內嵌 SHA256SUMS；請改傳完整 v1 快照目錄，或先以新版 pack 重新封裝。"
            )
        _validate_sha256sums(temporary, include_archive=False)
        copied_archive = temporary / "snapshot.tar.gz"
        created_files.append(copied_archive)
        _write_bytes(copied_archive, archive.read_bytes())
        _write_sha256sums(temporary)
        validate_snapshot(temporary)
        return temporary
    except (OSError, EOFError, tarfile.TarError) as error:
        _cleanup_extracted_archive(temporary, created_files, created_directories)
        raise SnapshotValidationError("snapshot archive 無法解壓或讀取。") from error
    except Exception:
        _cleanup_extracted_archive(temporary, created_files, created_directories)
        raise


def _create_archive_parent_directories(
    root: Path,
    destination_parent: Path,
    created_directories: list[Path],
) -> None:
    """只記錄本次 archive 解壓實際建立的父目錄，供失敗時逐一清除。"""

    relative_parent = destination_parent.relative_to(root)
    current = root
    for part in relative_parent.parts:
        current /= part
        if current.exists():
            if not current.is_dir():
                raise SnapshotValidationError("snapshot archive 檔案路徑衝突。")
            continue
        current.mkdir()
        created_directories.append(current)


def _cleanup_extracted_archive(
    temporary: Path,
    created_files: Sequence[Path],
    created_directories: Sequence[Path],
) -> None:
    """僅刪除本次安全解壓明確建立的檔案與空目錄，不掃描或遞迴刪除。"""

    for path in reversed(tuple(dict.fromkeys(created_files))):
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
    for directory in sorted(set(created_directories), key=lambda path: len(path.parts), reverse=True):
        try:
            if directory.is_dir():
                directory.rmdir()
        except OSError:
            pass
    try:
        if temporary.is_dir():
            temporary.rmdir()
    except OSError:
        pass


def _safe_archive_member_path(member: tarfile.TarInfo) -> str:
    """拒絕連結、絕對路徑與跳脫暫存目錄的 archive 成員。"""
    if not member.isfile() or member.issym() or member.islnk():
        raise SnapshotValidationError("snapshot archive 含有不安全檔案。")
    name = member.name
    path = Path(name)
    if (
        not name
        or "\\" in name
        or name.startswith("/")
        or path.is_absolute()
        or ".." in path.parts
        or any(part in {"", "."} for part in path.parts)
    ):
        raise SnapshotValidationError("snapshot archive 含有不安全檔案。")
    return Path(*path.parts).as_posix()


def _recent_trading_sessions(calendar: TradingCalendar, now: datetime, count: int) -> tuple[date, ...]:
    expected = expected_cutoff_date(calendar, now)
    if expected is None:
        raise SnapshotValidationError("官方交易日曆未涵蓋目前日期，不能建立基準快照。")
    sessions: list[date] = []
    candidate = expected
    lower_bound = min(day.year for day in calendar.holiday_dates)
    while len(sessions) < count:
        if candidate.weekday() < 5 and candidate not in calendar.holiday_dates:
            sessions.append(candidate)
        candidate = candidate.fromordinal(candidate.toordinal() - 1)
        if candidate.year < lower_bound:
            raise SnapshotValidationError("官方交易日曆不足以建立 120 個交易日基準快照。")
    return tuple(reversed(sessions))


def _market_session_from_response(market: Market, response: DailyMarketResponse) -> MarketSession:
    if not response.quotes and not response.no_quote_evidence:
        raise SnapshotValidationError(f"{market} 官方日行情不可為空。")
    return MarketSession(market, response.quotes, response.no_quote_evidence)


def _fetch_cached_daily(
    market: Market,
    session_date: date,
    cache_directory: Path,
    fetcher: Any,
) -> DailyMarketResponse:
    path = cache_directory / market / f"{session_date.isoformat()}.json"
    if path.is_file():
        try:
            response = _daily_response_from_cache(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise SnapshotValidationError(f"快取資料無效：{path}。") from error
        if (
            not response.quotes and not response.no_quote_evidence
            or any(quote.market != market or quote.trading_date != session_date for quote in response.quotes)
            or any(
                evidence.market != market or evidence.trading_date != session_date
                for evidence in response.no_quote_evidence
            )
        ):
            raise SnapshotValidationError(f"快取資料市場或交易日不符：{path}。")
        return response
    response = _fetch_with_retries(market, session_date, fetcher)
    if (
        any(quote.market != market or quote.trading_date != session_date for quote in response.quotes)
        or any(
            evidence.market != market or evidence.trading_date != session_date
            for evidence in response.no_quote_evidence
        )
    ):
        raise SnapshotValidationError(f"下載日行情市場或交易日不符：{market} {session_date.isoformat()}。")
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_bytes(
        path,
        _canonical_json_bytes(
            {
                "quotes": [_quote_cache_json(quote) for quote in response.quotes],
                "noQuoteEvidence": [_no_quote_evidence_json(evidence) for evidence in response.no_quote_evidence],
            }
        ),
    )
    return response


def _fetch_with_retries(market: Market, session_date: date, fetcher: Any) -> DailyMarketResponse:
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            response = _as_daily_market_response(fetcher(session_date))
            if not response.quotes and not response.no_quote_evidence:
                raise SnapshotValidationError(f"{market} 官方日行情不可為空。")
            return response
        except (MarketSourceError, OSError, SnapshotValidationError) as error:
            last_error = error
            if attempt < 3:
                time.sleep(attempt * 0.5)
    raise SnapshotValidationError(f"{market} {session_date.isoformat()} 官方資料重試三次仍失敗：{last_error}。")


def _throttle_official_requests() -> None:
    time.sleep(0.15)


def _quote_cache_json(quote: DailyQuote) -> dict[str, Any]:
    return {
        "market": quote.market,
        "code": quote.code,
        "name": quote.name,
        "date": quote.trading_date.isoformat(),
        "open": str(quote.open),
        "high": str(quote.high),
        "low": str(quote.low),
        "close": str(quote.close),
        "volumeShares": quote.volume_shares,
        "transactionCount": quote.transaction_count,
        "sourcePrecision": str(quote.source_precision),
        "sourceUrl": quote.source_url,
    }


def _as_daily_market_response(payload: object) -> DailyMarketResponse:
    if isinstance(payload, DailyMarketResponse):
        return payload
    if isinstance(payload, tuple) and all(isinstance(quote, DailyQuote) for quote in payload):
        return DailyMarketResponse(payload, ())
    if isinstance(payload, list) and all(isinstance(quote, DailyQuote) for quote in payload):
        return DailyMarketResponse(tuple(payload), ())
    raise SnapshotValidationError("官方日行情回應格式無效。")


def _daily_response_from_cache(payload: object) -> DailyMarketResponse:
    if isinstance(payload, list):
        # 舊版快取只含合法 K 線；最終 v3 完整性驗證仍會拒絕無證據缺日。
        return DailyMarketResponse(_quotes_from_cache(payload), ())
    if not isinstance(payload, dict):
        raise ValueError("快取日行情必須是物件。")
    quotes = _quotes_from_cache(payload["quotes"])
    evidence_value = payload["noQuoteEvidence"]
    if not isinstance(evidence_value, list):
        raise ValueError("快取未報價證據必須是陣列。")
    evidence: list[NoQuoteEvidence] = []
    for value in evidence_value:
        if not isinstance(value, dict):
            raise ValueError("快取未報價證據列必須是物件。")
        market = value["market"]
        if market not in {"TWSE", "TPEx"} or value["reason"] != "official-no-quote":
            raise ValueError("快取未報價證據格式無效。")
        evidence.append(
            NoQuoteEvidence(
                market=market,
                code=value["code"],
                trading_date=date.fromisoformat(value["date"]),
                reason=value["reason"],
                source_url=value["sourceUrl"],
            )
        )
    return DailyMarketResponse(quotes, tuple(evidence))


def _quotes_from_cache(payload: object) -> tuple[DailyQuote, ...]:
    if not isinstance(payload, list):
        raise ValueError("快取日行情必須是陣列。")
    quotes: list[DailyQuote] = []
    for value in payload:
        if not isinstance(value, dict):
            raise ValueError("快取日行情列必須是物件。")
        market = value["market"]
        if market not in {"TWSE", "TPEx"}:
            raise ValueError("快取日行情市場無效。")
        quotes.append(
            DailyQuote(
                market=market,
                code=value["code"],
                name=value["name"],
                trading_date=date.fromisoformat(value["date"]),
                open=Decimal(value["open"]),
                high=Decimal(value["high"]),
                low=Decimal(value["low"]),
                close=Decimal(value["close"]),
                volume_shares=int(value["volumeShares"]),
                transaction_count=value.get("transactionCount"),
                source_precision=Decimal(value["sourcePrecision"]),
                source_url=value["sourceUrl"],
            )
        )
    return tuple(quotes)


def _verify_archive_contents(snapshot: Path) -> None:
    """確認 archive 與同層 manifest/data 內容一致，再允許作為增量基準。"""
    _validate_archive_contents(snapshot, _validate_snapshot_payload(snapshot))


def _validate_archive_contents(snapshot: Path, manifest: SnapshotManifest) -> None:
    """archive 必須完整封裝同層已驗證的資料，不只比對壓縮檔本身的雜湊。"""
    archive = snapshot / "snapshot.tar.gz"
    if not archive.is_file():
        raise SnapshotValidationError("找不到 snapshot.tar.gz。")
    expected_files = {
        path.relative_to(snapshot).as_posix(): path.read_bytes()
        for path in snapshot.rglob("*")
        if path.is_file() and path.name not in {"snapshot.tar.gz", "SHA256SUMS"}
    }
    try:
        with gzip.open(archive, "rb") as compressed:
            with tarfile.open(fileobj=compressed, mode="r:") as tar:
                actual_files: dict[str, bytes] = {}
                for member in tar.getmembers():
                    if not member.isfile() or member.name.startswith("/") or ".." in Path(member.name).parts:
                        raise SnapshotValidationError("snapshot archive 含有不安全檔案。")
                    if member.name in actual_files:
                        raise SnapshotValidationError("snapshot archive 有重複檔案。")
                    extracted = tar.extractfile(member)
                    if extracted is None:
                        raise SnapshotValidationError("snapshot archive 檔案無法讀取。")
                    actual_files[member.name] = extracted.read()
    except (OSError, EOFError, tarfile.TarError) as error:
        raise SnapshotValidationError("snapshot archive 無法解壓或讀取。") from error
    internal_sums = actual_files.pop("SHA256SUMS", None)
    if internal_sums is None:
        if manifest.snapshot_version != LEGACY_SNAPSHOT_VERSION:
            raise SnapshotValidationError("snapshot archive 缺少內嵌 SHA256SUMS。")
    else:
        try:
            internal_lines = internal_sums.decode("utf-8").splitlines()
        except UnicodeDecodeError as error:
            raise SnapshotValidationError("snapshot archive 內嵌 SHA256SUMS 不是 UTF-8。") from error
        _validate_checksum_lines(
            internal_lines,
            sorted(actual_files),
            lambda relative_path: actual_files[relative_path],
            "snapshot archive 內嵌 SHA256SUMS",
        )
    if actual_files != expected_files:
        raise SnapshotValidationError("snapshot archive 與同層資料不一致。")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
