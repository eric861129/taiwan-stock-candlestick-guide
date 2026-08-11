"""建立、驗證與封裝 TWSE／TPEx 官方盤後日 K 靜態快照。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
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
    DailyQuote,
    Market,
    SupportedSymbol,
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
    MarketSourceError,
    parse_corporate_actions,
    parse_holiday_calendar,
    parse_supported_symbols,
    parse_tpex_daily,
    parse_twse_daily,
)


SCHEMA_VERSION = 1
SNAPSHOT_VERSION = 1
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
    first_date: str
    last_date: str
    bar_count: int


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
    previous_manifest = _load_previous_manifest(previous)
    stock_documents, market_cutoffs = _build_stock_documents(sessions, previous)
    entries, stock_payloads = _index_stock_documents(stock_documents)
    _validate_transition(previous_manifest, entries, sessions.retired_symbols)
    _validate_current_daily_coverage(previous_manifest, sessions, sessions.retired_symbols)
    _validate_market_cutoffs(market_cutoffs)

    generated_at = _iso_datetime(sessions.generated_at)
    manifest_without_hash = {
        "schemaVersion": SCHEMA_VERSION,
        "snapshotVersion": SNAPSHOT_VERSION,
        "sourceCommit": sessions.source_commit,
        "generatedAt": generated_at,
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
        symbol_keys.add(key)
    if not build.sessions:
        raise SnapshotValidationError("沒有任何官方交易日行情可建立快照。")


def _build_stock_documents(
    build: SnapshotBuildInput,
    previous: Path | SnapshotManifest | None,
) -> tuple[dict[tuple[Market, str], dict[str, Any]], dict[str, MarketCutoff]]:
    symbols = {(symbol.market, symbol.code): symbol for symbol in build.symbols}
    bars_by_symbol, previous_sources_by_symbol = _load_previous_bars(previous)
    sources_by_symbol: dict[tuple[Market, str], set[str]] = {
        key: {symbol.source_url} for key, symbol in symbols.items()
    }
    for key, source_urls in previous_sources_by_symbol.items():
        if key in sources_by_symbol:
            sources_by_symbol[key].update(source_urls)

    for session in build.sessions:
        if not session.quotes:
            raise SnapshotValidationError(f"{session.market} 官方交易日行情不可為空。")
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

    documents: dict[tuple[Market, str], dict[str, Any]] = {}
    available_symbol_keys = {key for key, bars in bars_by_symbol.items() if bars and key in symbols}
    coverage = Decimal(len(available_symbol_keys)) / Decimal(len(symbols))
    if coverage < Decimal("0.98"):
        raise SnapshotValidationError(f"官方普通股日行情覆蓋率 {coverage:.2%} 低於 98% 發布門檻。")

    for key, symbol in symbols.items():
        bars = sorted(bars_by_symbol.get(key, []), key=lambda item: item.trading_date)
        if not bars:
            continue
        _validate_bars(symbol, bars)
        retained_bars = bars[-RETENTION_SESSIONS:]
        actions = _actions_for_stock(build.corporate_actions, symbol, retained_bars)
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
            "comparisonUnitPolicy": {
                "version": 1,
                "effectiveFrom": "2026-08-11",
                "sourceUrl": COMPARISON_UNIT_POLICY_URL,
            },
            "bars": [_bar_json(bar) for bar in retained_bars],
            "corporateActions": [_action_json(action) for action in actions],
            "sourceUrls": sorted(sources),
        }

    return documents, _market_cutoffs(documents, build.calendar, build.generated_at)


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
    bars: Sequence[_NormalizedBar],
) -> tuple[CorporateAction, ...]:
    first_date = bars[0].trading_date
    last_date = bars[-1].trading_date
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
) -> dict[str, MarketCutoff]:
    expected = expected_cutoff_date(calendar, generated_at)
    result: dict[str, MarketCutoff] = {}
    for market in ("TWSE", "TPEx"):
        market_documents = [document for (document_market, _), document in documents.items() if document_market == market]
        if not market_documents:
            raise SnapshotValidationError(f"缺少 {market} 支援普通股。")
        dates = {
            bar["date"]
            for document in market_documents
            for bar in document["bars"]
            if bar["date"] == document["bars"][-1]["date"]
        }
        if len(dates) != 1:
            raise SnapshotValidationError(f"{market} 支援普通股的資料截止日不一致。")
        cutoff_text = next(iter(dates))
        cutoff = date.fromisoformat(cutoff_text)
        result[market] = MarketCutoff(
            cutoff_date=cutoff_text,
            expected_cutoff_date=expected.isoformat() if expected else None,
            freshness=compute_freshness(calendar, cutoff, generated_at),
            calendar_source_url=calendar.source_url,
            calendar_valid_through=calendar.valid_through.isoformat(),
            trading_sessions=tuple(
                sorted(
                    {
                        bar["date"]
                        for document in market_documents
                        for bar in document["bars"]
                    }
                )
            ),
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
        entry = StockIndexEntry(
            code=code,
            name=document["name"],
            market=market,
            security_type="common-stock",
            data_path=path,
            digest=digest,
            size=len(payload),
            first_date=bars[0]["date"],
            last_date=bars[-1]["date"],
            bar_count=len(bars),
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
        if current is not None and current.last_date < old_entry.last_date:
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
    retired_keys = {(market, code) for market, code, _ in retired_symbols}
    latest_session_date = max(
        quote.trading_date
        for session in build.sessions
        for quote in session.quotes
    )
    current_quote_keys = {
        (quote.market, quote.code)
        for session in build.sessions
        for quote in session.quotes
        if quote.trading_date == latest_session_date and (quote.market, quote.code) in previous_keys
    }
    coverage = Decimal(len((current_quote_keys | retired_keys) & previous_keys)) / Decimal(len(previous_keys))
    if coverage < Decimal("0.98"):
        raise SnapshotValidationError(
            f"當日官方普通股日行情覆蓋率 {coverage:.2%} 低於 98% 發布門檻。"
        )


def _provenance_document(build: SnapshotBuildInput, manifest: SnapshotManifest) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "snapshotVersion": SNAPSHOT_VERSION,
        "sourceCommit": manifest.source_commit,
        "snapshotHash": manifest.snapshot_hash,
        "generatedAt": manifest.generated_at,
        "calendar": {
            "sourceUrl": build.calendar.source_url,
            "validThrough": build.calendar.valid_through.isoformat(),
        },
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
    archive = root / "snapshot.tar.gz"
    candidates = sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.name not in {"snapshot.tar.gz", "SHA256SUMS"}
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
                    with path.open("rb") as handle:
                        tar.addfile(info, handle)


def _write_sha256sums(root: Path) -> None:
    files = sorted(path for path in root.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
    lines = [f"{_digest(path.read_bytes())}  {path.relative_to(root).as_posix()}" for path in files]
    _write_bytes(root / "SHA256SUMS", ("\n".join(lines) + "\n").encode("utf-8"))


def validate_snapshot(snapshot: Path) -> SnapshotManifest:
    """驗證 manifest、個股、provenance、封裝內容與 SHA256SUMS。"""
    snapshot = snapshot.resolve()
    manifest_path = snapshot / "manifest.json"
    if not manifest_path.is_file():
        raise SnapshotValidationError("找不到 manifest.json。")
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotValidationError("manifest.json 不是有效 UTF-8 JSON。") from error
    manifest = _manifest_from_json(document)
    _validate_manifest_files(snapshot, manifest)
    _validate_sha256sums(snapshot)
    _validate_provenance(snapshot, manifest)
    _validate_archive_contents(snapshot)
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
        _validate_stock_document(stock, entry)


def _validate_provenance(snapshot: Path, manifest: SnapshotManifest) -> None:
    path = snapshot / "provenance.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotValidationError("provenance.json 不是有效 UTF-8 JSON。") from error
    try:
        calendar = document["calendar"]
        markets = document["markets"]
        if (
            not isinstance(document, dict)
            or document["schemaVersion"] != SCHEMA_VERSION
            or document["snapshotVersion"] != SNAPSHOT_VERSION
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


def _validate_stock_document(stock: object, entry: StockIndexEntry) -> None:
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
    if not required.issubset(stock):
        raise SnapshotValidationError(f"股票快照缺少必要欄位：{entry.market} {entry.code}。")
    if (
        stock["schemaVersion"] != SCHEMA_VERSION
        or stock["snapshotVersion"] != SNAPSHOT_VERSION
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
    _stock_source_urls(stock, entry)
    bars = stock["bars"]
    if not isinstance(bars, list) or not bars or len(bars) > RETENTION_SESSIONS:
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
    if dates[0].isoformat() != entry.first_date or dates[-1].isoformat() != entry.last_date or len(dates) != entry.bar_count:
        raise SnapshotValidationError("manifest 與股票快照的日期或筆數不一致。")
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


def _validate_sha256sums(snapshot: Path) -> None:
    sums_path = snapshot / "SHA256SUMS"
    if not sums_path.is_file():
        raise SnapshotValidationError("找不到 SHA256SUMS。")
    lines = sums_path.read_text(encoding="utf-8").splitlines()
    expected_files = sorted(
        path.relative_to(snapshot).as_posix()
        for path in snapshot.rglob("*")
        if path.is_file() and path.name != "SHA256SUMS"
    )
    seen_files: list[str] = []
    for line in lines:
        try:
            digest, relative_path = line.split("  ", 1)
        except ValueError as error:
            raise SnapshotValidationError("SHA256SUMS 格式無效。") from error
        path = snapshot / relative_path
        if not path.is_file() or not path.resolve().is_relative_to(snapshot) or _digest(path.read_bytes()) != digest:
            raise SnapshotValidationError(f"SHA256SUMS 驗證失敗：{relative_path}。")
        seen_files.append(relative_path)
    if seen_files != expected_files:
        raise SnapshotValidationError("SHA256SUMS 未完整列出所有快照檔案。")


def _manifest_from_json(document: object) -> SnapshotManifest:
    if not isinstance(document, dict):
        raise SnapshotValidationError("manifest 必須是 JSON 物件。")
    try:
        markets_value = document["markets"]
        symbols_value = document["symbols"]
        if not isinstance(markets_value, dict) or not isinstance(symbols_value, list):
            raise TypeError
        if document["schemaVersion"] != SCHEMA_VERSION or document["snapshotVersion"] != SNAPSHOT_VERSION:
            raise ValueError
        if not isinstance(document["sourceCommit"], str) or not document["sourceCommit"].strip():
            raise ValueError
        if not isinstance(document["snapshotHash"], str) or len(document["snapshotHash"]) != 64:
            raise ValueError
        datetime.fromisoformat(document["generatedAt"])
        if set(markets_value) != {"TWSE", "TPEx"}:
            raise ValueError
        markets = {
            market: _market_cutoff_from_json(market, markets_value[market])
            for market in ("TWSE", "TPEx")
        }
        if any(not isinstance(value, dict) for value in symbols_value):
            raise TypeError
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
                or entry.bar_count < 1
            ):
                raise ValueError
            date.fromisoformat(entry.first_date)
            date.fromisoformat(entry.last_date)
        manifest = SnapshotManifest(
            schema_version=document["schemaVersion"],
            snapshot_version=document["snapshotVersion"],
            source_commit=document["sourceCommit"],
            snapshot_hash=document["snapshotHash"],
            generated_at=document["generatedAt"],
            markets=markets,
            symbols=symbols,
        )
    except (KeyError, TypeError, ValueError) as error:
        raise SnapshotValidationError("manifest 欄位格式無效。") from error
    document_without_hash = dict(document)
    document_without_hash.pop("snapshotHash")
    if _digest(_canonical_json_bytes(document_without_hash)) != manifest.snapshot_hash:
        raise SnapshotValidationError("manifest snapshotHash 驗證失敗。")
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
    dict[tuple[Market, str], set[str]],
]:
    if previous is None or isinstance(previous, SnapshotManifest):
        return {}, {}
    manifest = validate_snapshot(previous)
    bars_by_symbol: dict[tuple[Market, str], list[_NormalizedBar]] = {}
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
    return bars_by_symbol, sources_by_symbol


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

    update = commands.add_parser("update", help="從前一成功快照追加一個官方交易日")
    update.add_argument("--previous", type=Path, required=True, help="前一成功快照目錄")
    update.add_argument("--output", type=Path, required=True, help="輸出目錄")
    update.add_argument("--source-commit", required=True, help="對應的完整 source commit")
    update.add_argument("--cache", type=Path, default=Path(".cache/market-snapshot"), help="可續跑快取目錄")
    update.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES_PATH, help="公司行動與下市證據覆寫檔")

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
            manifest = bootstrap_snapshot(args.output, args.source_commit, args.cache, args.overrides)
            print(f"已建立 120 交易日基準快照：{manifest.snapshot_hash}。")
            return 0
        if args.command == "update":
            manifest, updated = update_snapshot(args.previous, args.output, args.source_commit, args.cache, args.overrides)
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
        sessions=(MarketSession("TWSE", twse_daily), MarketSession("TPEx", tpex_daily)),
        corporate_actions=(*actions, *override_actions),
        calendar=calendar,
        retired_symbols=retired_symbols,
    )


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
        or parsed.hostname not in {"openapi.twse.com.tw", "www.twse.com.tw", "www.tpex.org.tw"}
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise SnapshotValidationError("官方證據網址必須是核准主機的 HTTPS 來源。")
    return url


def pack_snapshot(snapshot: Path) -> SnapshotManifest:
    """在已通過驗證的快照上重建可重現封裝與 checksum 清單。"""
    manifest = validate_snapshot(snapshot)
    _write_deterministic_tar(snapshot)
    _write_sha256sums(snapshot)
    return validate_snapshot(snapshot)


def bootstrap_snapshot(
    output: Path,
    source_commit: str,
    cache_directory: Path,
    overrides_path: Path = DEFAULT_OVERRIDES_PATH,
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
    market_sessions: list[MarketSession] = []
    for session_date in sessions:
        market_sessions.append(
            MarketSession(
                "TWSE",
                _fetch_cached_daily("TWSE", session_date, cache_directory, fetch_twse_historical_daily),
            )
        )
        _throttle_official_requests()
        market_sessions.append(
            MarketSession(
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
    )
    return build_snapshot(None, build_input, output)


def update_snapshot(
    previous: Path,
    output: Path,
    source_commit: str,
    cache_directory: Path,
    overrides_path: Path = DEFAULT_OVERRIDES_PATH,
    *,
    now: datetime | None = None,
) -> tuple[SnapshotManifest, bool]:
    """只在兩市場都有一個新官方截止日時追加，既有截止日則不改寫。"""
    previous_directory = _previous_snapshot_directory(previous)
    previous_manifest = validate_snapshot(previous_directory)
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

    symbols = fetch_supported_symbols()
    actions = fetch_corporate_actions()
    override_actions, retired_symbols = _load_company_action_overrides(overrides_path)
    twse_quotes = _fetch_cached_daily("TWSE", expected, cache_directory, fetch_twse_daily)
    _throttle_official_requests()
    tpex_quotes = _fetch_cached_daily("TPEx", expected, cache_directory, fetch_tpex_daily)
    build_input = SnapshotBuildInput(
        source_commit=source_commit,
        generated_at=generated_at,
        symbols=symbols,
        sessions=(MarketSession("TWSE", twse_quotes), MarketSession("TPEx", tpex_quotes)),
        corporate_actions=(*actions, *override_actions),
        calendar=calendar,
        retired_symbols=retired_symbols,
    )
    return build_snapshot(previous_directory, build_input, output), True


def _previous_snapshot_directory(previous: Path) -> Path:
    if previous.is_dir():
        return previous
    if previous.is_file() and previous.name == "snapshot.tar.gz":
        candidate = previous.parent
        _verify_archive_contents(candidate)
        return candidate
    raise SnapshotValidationError("前一成功快照必須是目錄，或是同目錄含完整驗證檔的 snapshot.tar.gz。")


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


def _fetch_cached_daily(
    market: Market,
    session_date: date,
    cache_directory: Path,
    fetcher: Any,
) -> tuple[DailyQuote, ...]:
    path = cache_directory / market / f"{session_date.isoformat()}.json"
    if path.is_file():
        try:
            quotes = _quotes_from_cache(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise SnapshotValidationError(f"快取資料無效：{path}。") from error
        if not quotes or any(quote.market != market or quote.trading_date != session_date for quote in quotes):
            raise SnapshotValidationError(f"快取資料市場或交易日不符：{path}。")
        return quotes
    quotes = _fetch_with_retries(market, session_date, fetcher)
    if any(quote.market != market or quote.trading_date != session_date for quote in quotes):
        raise SnapshotValidationError(f"下載日行情市場或交易日不符：{market} {session_date.isoformat()}。")
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_bytes(path, _canonical_json_bytes([_quote_cache_json(quote) for quote in quotes]))
    return quotes


def _fetch_with_retries(market: Market, session_date: date, fetcher: Any) -> tuple[DailyQuote, ...]:
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            quotes = fetcher(session_date)
            if not quotes:
                raise SnapshotValidationError(f"{market} 官方日行情不可為空。")
            return quotes
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
    _validate_archive_contents(snapshot)


def _validate_archive_contents(snapshot: Path) -> None:
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
    if actual_files != expected_files:
        raise SnapshotValidationError("snapshot archive 與同層資料不一致。")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
