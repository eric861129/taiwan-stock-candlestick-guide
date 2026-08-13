from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import market_snapshot

from market_snapshot import (
    MarketSession,
    SnapshotBuildInput,
    SnapshotValidationError,
    StockIndexEntry,
    bootstrap_snapshot,
    build_snapshot,
    main,
    pack_snapshot,
    update_snapshot,
    validate_snapshot,
)
from market_sources import (
    EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    SUSPENSION_EVIDENCE_SCHEMA_VERSION,
    MarketSourceError,
    NoQuoteEvidence,
    OfficialMarketClosedError,
    OfficialSourceFetchError,
    SuspensionInterval,
    TradingCalendar,
    apply_emergency_market_closures,
    parse_corporate_actions,
    parse_emergency_market_closure_evidence,
    parse_holiday_calendar,
    parse_suspension_interval_evidence,
    parse_supported_symbols,
    parse_tpex_daily,
    parse_twse_daily,
)


FIXTURES = Path(__file__).parent / "fixtures" / "market_snapshot"


def load_fixture(name: str) -> object:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def official_fixture_sessions_ending_at(
    end_date: date,
    count: int,
    calendar: TradingCalendar,
) -> tuple[date, ...]:
    """依測試用官方行事曆取得截至指定日期的交易日。"""

    sessions: list[date] = []
    candidate = end_date
    while len(sessions) < count:
        if candidate.weekday() < 5 and candidate not in calendar.holiday_dates:
            sessions.append(candidate)
        candidate -= timedelta(days=1)
    return tuple(reversed(sessions))


def fixture_build_input() -> SnapshotBuildInput:
    """建立符合正式 bootstrap 120 日完整性契約的離線官方形狀資料。"""

    taipei = timezone(timedelta(hours=8), name="Asia/Taipei")
    calendar = parse_holiday_calendar(load_fixture("holiday-calendar.json"))
    twse_daily = parse_twse_daily(load_fixture("twse-daily.json"))
    tpex_daily = parse_tpex_daily(load_fixture("tpex-daily.json"))
    sessions = tuple(
        market_session
        for session_date in official_fixture_sessions_ending_at(date(2026, 8, 11), 120, calendar)
        for market_session in (
            MarketSession(
                "TWSE",
                tuple(replace(quote, trading_date=session_date) for quote in twse_daily),
            ),
            MarketSession(
                "TPEx",
                tuple(replace(quote, trading_date=session_date) for quote in tpex_daily),
            ),
        )
    )
    return SnapshotBuildInput(
        source_commit="fixture",
        generated_at=datetime(2026, 8, 11, 18, 0, tzinfo=taipei),
        symbols=parse_supported_symbols(
            load_fixture("twse-companies.json"),
            load_fixture("tpex-companies.json"),
        ),
        sessions=sessions,
        corporate_actions=parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            verified_at=date(2026, 8, 11),
        ),
        calendar=calendar,
    )


def ten_year_fixture_build_input() -> SnapshotBuildInput:
    """建立十年全市場日行情，驗證公開日／週／月各自保留 120 根。"""

    base = fixture_build_input()
    cutoff = date(2026, 8, 11)
    start = date(cutoff.year - 10, cutoff.month, 1) - timedelta(days=1)
    start = start.replace(day=1)
    historical_holidays = tuple(date(year, 1, 1) for year in range(start.year, cutoff.year + 1))
    calendar = TradingCalendar(
        holiday_dates=historical_holidays,
        source_url=base.calendar.source_url,
        valid_through=date(cutoff.year, 12, 31),
        timezone=base.calendar.timezone,
    )
    twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
    tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
    sessions: list[MarketSession] = []
    session_date = start
    while session_date <= cutoff:
        if session_date.weekday() < 5 and session_date not in historical_holidays:
            sessions.extend(
                (
                    MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        session_date += timedelta(days=1)
    return SnapshotBuildInput(
        source_commit="ten-year-fixture",
        generated_at=datetime(2026, 8, 11, 18, 0, tzinfo=calendar.timezone),
        symbols=base.symbols,
        sessions=tuple(sessions),
        corporate_actions=(),
        calendar=calendar,
    )


def raw_timeframe(stock: dict[str, object], timeframe: str = "1d") -> dict[str, object]:
    """取得 v4 原始價格指定週期，讓快照黑箱測試只關心公開契約。"""

    return stock["priceModes"]["raw"]["timeframes"][timeframe]


class ValidatorTimingTests(unittest.TestCase):
    """候選完整 validator 的可觀測性不可在失敗前誤報成功。"""

    def test_success_writes_one_canonical_validator_timing_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            timing = root / "validator-timing.json"
            with patch.dict(
                "os.environ",
                {"MARKET_VALIDATOR_TIMING_OUTPUT": str(timing)},
            ):
                build_snapshot(None, fixture_build_input(), root / "snapshot")

            raw = timing.read_bytes()
            document = json.loads(raw.decode("utf-8"))
            self.assertEqual(1, document["fullValidatorCount"])
            self.assertGreaterEqual(document["fullValidatorSeconds"], 0)
            self.assertEqual(market_snapshot._canonical_json_bytes(document), raw)

    def test_failed_validator_does_not_write_a_success_timing_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            timing = root / "validator-timing.json"
            with (
                patch.dict(
                    "os.environ",
                    {"MARKET_VALIDATOR_TIMING_OUTPUT": str(timing)},
                ),
                patch(
                    "market_snapshot.validate_snapshot",
                    side_effect=SnapshotValidationError("刻意失敗"),
                ),
                self.assertRaisesRegex(SnapshotValidationError, "刻意失敗"),
            ):
                build_snapshot(None, fixture_build_input(), root / "snapshot")

            self.assertFalse(timing.exists())


def raw_completed_bars(stock: dict[str, object], timeframe: str = "1d") -> list[dict[str, object]]:
    """取得 v4 原始價格指定週期的已完成 K 棒。"""

    return raw_timeframe(stock, timeframe)["completedBars"]


def adjusted_timeframe(stock: dict[str, object], timeframe: str = "1d") -> dict[str, object]:
    """取得 v4 向後還原價格指定週期，維持測試在公開 JSON 契約。"""

    return stock["priceModes"]["adjusted"]["timeframes"][timeframe]


def adjusted_completed_bars(stock: dict[str, object], timeframe: str = "1d") -> list[dict[str, object]]:
    """取得 v4 向後還原價格指定週期的已完成 K 棒。"""

    return adjusted_timeframe(stock, timeframe)["completedBars"]


def downgrade_snapshot_to_v1(output: Path) -> None:
    """將測試產出的 v4 或 v3 快照轉成舊版 v1 格式。"""

    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    provenance = json.loads((output / "provenance.json").read_text(encoding="utf-8"))
    manifest.pop("calendar")
    manifest.pop("suspensionEvidence")
    provenance["calendar"].pop("emergencyClosureEvidence")
    provenance.pop("suspensionEvidence")
    for entry in manifest["symbols"]:
        old_path = output / entry["dataPath"]
        stock = json.loads(old_path.read_text(encoding="utf-8"))
        if "priceModes" in stock:
            stock["priceMode"] = "raw"
            stock["bars"] = [
                {
                    key: value
                    for key, value in bar.items()
                    if key
                    not in {
                        "periodStart",
                        "periodEnd",
                        "completed",
                        "evidenceStatus",
                        "missingSessionDates",
                    }
                }
                for bar in raw_completed_bars(stock)
            ]
            stock.pop("priceModes")
        stock["snapshotVersion"] = 1
        stock.pop("listingDate")
        stock.pop("availableSessions")
        stock.pop("shortHistoryReason")
        stock.pop("noQuoteEvidence")
        payload = market_snapshot._canonical_json_bytes(stock)
        digest = market_snapshot._digest(payload)
        new_path = output / f"data/stocks/{entry['code']}.{digest[:12]}.json"
        new_path.write_bytes(payload)
        old_path.unlink()
        entry["dataPath"] = new_path.relative_to(output).as_posix()
        entry["digest"] = digest
        entry["size"] = len(payload)
        entry.pop("listingDate")
        entry.pop("availableSessions")
        entry.pop("shortHistoryReason")
        entry.pop("noQuoteCount")

    manifest["snapshotVersion"] = 1
    manifest_without_hash = dict(manifest)
    manifest_without_hash.pop("snapshotHash")
    manifest["snapshotHash"] = market_snapshot._digest(market_snapshot._canonical_json_bytes(manifest_without_hash))
    provenance["snapshotVersion"] = 1
    provenance["snapshotHash"] = manifest["snapshotHash"]
    (output / "manifest.json").write_bytes(market_snapshot._canonical_json_bytes(manifest))
    (output / "provenance.json").write_bytes(market_snapshot._canonical_json_bytes(provenance))

    sha256sums_path = output / "SHA256SUMS"
    sha256sums_path.unlink()
    archive_path = output / "snapshot.tar.gz"
    archive_path.unlink()
    with tarfile.open(archive_path, mode="w:gz") as tar:
        for path in sorted(
            path for path in output.rglob("*") if path.is_file() and path.name != "snapshot.tar.gz"
        ):
            tar.add(path, arcname=path.relative_to(output).as_posix(), recursive=False)
    market_snapshot._write_sha256sums(output)


def downgrade_snapshot_to_v2(output: Path) -> None:
    """將完整 v4 fixture 轉成仍可驗證的 v2，測試舊版只讀相容性。"""

    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    provenance = json.loads((output / "provenance.json").read_text(encoding="utf-8"))
    manifest.pop("calendar")
    manifest.pop("suspensionEvidence")
    provenance["calendar"].pop("emergencyClosureEvidence")
    provenance.pop("suspensionEvidence")
    for entry in manifest["symbols"]:
        old_path = output / entry["dataPath"]
        stock = json.loads(old_path.read_text(encoding="utf-8"))
        stock["snapshotVersion"] = 2
        stock["priceMode"] = "raw"
        stock["bars"] = [
            {
                key: value
                for key, value in bar.items()
                if key
                not in {
                    "periodStart",
                    "periodEnd",
                    "completed",
                    "evidenceStatus",
                    "missingSessionDates",
                }
            }
            for bar in raw_completed_bars(stock)
        ]
        stock.pop("priceModes")
        stock.pop("noQuoteEvidence")
        payload = market_snapshot._canonical_json_bytes(stock)
        digest = market_snapshot._digest(payload)
        new_path = output / f"data/stocks/{entry['code']}.{digest[:12]}.json"
        new_path.write_bytes(payload)
        old_path.unlink()
        entry["dataPath"] = new_path.relative_to(output).as_posix()
        entry["digest"] = digest
        entry["size"] = len(payload)
        entry.pop("noQuoteCount")

    manifest["snapshotVersion"] = 2
    manifest_without_hash = dict(manifest)
    manifest_without_hash.pop("snapshotHash")
    manifest["snapshotHash"] = market_snapshot._digest(market_snapshot._canonical_json_bytes(manifest_without_hash))
    provenance["snapshotVersion"] = 2
    provenance["snapshotHash"] = manifest["snapshotHash"]
    (output / "manifest.json").write_bytes(market_snapshot._canonical_json_bytes(manifest))
    (output / "provenance.json").write_bytes(market_snapshot._canonical_json_bytes(provenance))
    archive_path = output / "snapshot.tar.gz"
    archive_path.unlink()
    market_snapshot._write_deterministic_tar(output)
    market_snapshot._write_sha256sums(output)


def remove_verified_session_from_v3_snapshot(output: Path, removed_date: date) -> None:
    """建立仍可離線驗證、但市場行事曆有共同缺日的舊 v3 快照。"""

    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    provenance = json.loads((output / "provenance.json").read_text(encoding="utf-8"))
    removed_text = removed_date.isoformat()
    for entry in manifest["symbols"]:
        old_path = output / entry["dataPath"]
        stock = json.loads(old_path.read_text(encoding="utf-8"))
        if "priceModes" in stock:
            stock["snapshotVersion"] = 3
            stock["priceMode"] = "raw"
            stock["bars"] = [
                {
                    key: value
                    for key, value in bar.items()
                    if key
                    not in {
                        "periodStart",
                        "periodEnd",
                        "completed",
                        "evidenceStatus",
                        "missingSessionDates",
                    }
                }
                for bar in raw_completed_bars(stock)
            ]
            stock.pop("priceModes")
        stock["bars"] = [bar for bar in stock["bars"] if bar["date"] != removed_text]
        stock["availableSessions"] = len(stock["bars"])
        payload = market_snapshot._canonical_json_bytes(stock)
        digest = market_snapshot._digest(payload)
        new_path = output / f"data/stocks/{entry['code']}.{digest[:12]}.json"
        new_path.write_bytes(payload)
        old_path.unlink()
        entry["dataPath"] = new_path.relative_to(output).as_posix()
        entry["digest"] = digest
        entry["size"] = len(payload)
        entry["firstDate"] = stock["bars"][0]["date"]
        entry["lastDate"] = stock["bars"][-1]["date"]
        entry["barCount"] = len(stock["bars"])
        entry["availableSessions"] = len(stock["bars"])
    for market in manifest["markets"].values():
        market["tradingSessions"] = [session for session in market["tradingSessions"] if session != removed_text]
    manifest["snapshotVersion"] = 3
    provenance["snapshotVersion"] = 3
    manifest_without_hash = dict(manifest)
    manifest_without_hash.pop("snapshotHash")
    manifest["snapshotHash"] = market_snapshot._digest(market_snapshot._canonical_json_bytes(manifest_without_hash))
    provenance["snapshotHash"] = manifest["snapshotHash"]
    (output / "manifest.json").write_bytes(market_snapshot._canonical_json_bytes(manifest))
    (output / "provenance.json").write_bytes(market_snapshot._canonical_json_bytes(provenance))

    archive_path = output / "snapshot.tar.gz"
    archive_path.unlink()
    market_snapshot._write_deterministic_tar(output)
    market_snapshot._write_sha256sums(output)


def rewrite_snapshot_stock(
    output: Path,
    manifest_document: dict[str, object],
    stock_path: Path,
    stock: dict[str, object],
) -> None:
    """重寫測試股票並同步公開驗證會核對的 manifest、provenance 與 checksums。"""

    stock_payload = market_snapshot._canonical_json_bytes(stock)
    stock_path.write_bytes(stock_payload)
    symbols = manifest_document["symbols"]
    assert isinstance(symbols, list)
    symbol = symbols[0]
    assert isinstance(symbol, dict)
    symbol["digest"] = market_snapshot._digest(stock_payload)
    symbol["size"] = len(stock_payload)
    without_hash = dict(manifest_document)
    without_hash.pop("snapshotHash")
    manifest_document["snapshotHash"] = market_snapshot._digest(
        market_snapshot._canonical_json_bytes(without_hash)
    )
    (output / "manifest.json").write_bytes(market_snapshot._canonical_json_bytes(manifest_document))
    provenance_path = output / "provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["snapshotHash"] = manifest_document["snapshotHash"]
    provenance_path.write_bytes(market_snapshot._canonical_json_bytes(provenance))
    market_snapshot._write_deterministic_tar(output)
    market_snapshot._write_sha256sums(output)


class SnapshotBuildTests(unittest.TestCase):
    def test_build_snapshot_writes_two_raw_common_stock_files_and_a_manifest(self) -> None:
        """若 ETF 混入、欄位遺失或資料路徑不是內容雜湊，快照契約必須失敗。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, fixture_build_input(), output)
            document = json.loads((output / "manifest.json").read_text(encoding="utf-8"))

            self.assertEqual(1, manifest.schema_version)
            self.assertEqual("fixture", document["sourceCommit"])
            self.assertEqual(1, document["schemaVersion"])
            self.assertEqual(4, document["snapshotVersion"])
            self.assertEqual({"TWSE", "TPEx"}, set(document["markets"]))
            self.assertEqual(["2330", "6488"], [symbol["code"] for symbol in document["symbols"]])
            self.assertTrue(all(symbol["securityType"] == "common-stock" for symbol in document["symbols"]))

            twse_entry = document["symbols"][0]
            self.assertRegex(twse_entry["dataPath"], r"^data/stocks/2330\.[0-9a-f]{12}\.json$")
            self.assertEqual(64, len(twse_entry["digest"]))
            self.assertGreater(twse_entry["size"], 0)
            stock = json.loads((output / twse_entry["dataPath"]).read_text(encoding="utf-8"))
            self.assertNotIn("priceMode", stock)
            self.assertNotIn("bars", stock)
            self.assertEqual(
                {
                    "status": "available",
                    "reasonCodes": [],
                    "warnings": [],
                },
                {key: stock["priceModes"]["raw"][key] for key in ("status", "reasonCodes", "warnings")},
            )
            self.assertEqual(
                {
                    "status": "unavailable",
                    "reasonCodes": ["missing-adjustment-evidence"],
                    "warnings": ["公司行動缺少可重算的官方前收或參考價，請使用官方原始價格。"],
                },
                stock["priceModes"]["adjusted"],
            )
            self.assertEqual("TWD", stock["priceUnit"])
            self.assertEqual(120, len(raw_completed_bars(stock)))
            self.assertIsNone(raw_timeframe(stock)["formingBar"])
            self.assertEqual("2026-08-11", raw_completed_bars(stock)[-1]["date"])
            self.assertEqual(5, raw_completed_bars(stock)[-1]["comparisonUnit"])
            self.assertEqual("2026-08-11", raw_completed_bars(stock)[-1]["periodStart"])
            self.assertEqual("2026-08-11", raw_completed_bars(stock)[-1]["periodEnd"])
            self.assertTrue(raw_completed_bars(stock)[-1]["completed"])
            self.assertEqual("complete", raw_completed_bars(stock)[-1]["evidenceStatus"])
            self.assertEqual([], raw_completed_bars(stock)[-1]["missingSessionDates"])
            self.assertEqual("cash-dividend", stock["corporateActions"][0]["type"])
            self.assertEqual("fresh", document["markets"]["TWSE"]["freshness"])
            self.assertTrue((output / "snapshot.tar.gz").is_file())
            self.assertTrue((output / "SHA256SUMS").is_file())

    def test_builds_auditable_cash_dividend_adjustment_and_keeps_raw_unchanged(self) -> None:
        """純現金股利僅調整生效日前價格，因子可由官方前收與參考價重算。"""
        base = fixture_build_input()
        evidenced_actions = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=load_fixture("tpex-adjustment-results.json"),
            verified_at=date(2026, 8, 11),
        )
        build_input = replace(base, corporate_actions=evidenced_actions)

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            raw_output = root / "raw"
            adjusted_output = root / "adjusted"
            raw_manifest = build_snapshot(None, base, raw_output)
            adjusted_manifest = build_snapshot(None, build_input, adjusted_output)
            raw_stock = json.loads((raw_output / raw_manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            stock = json.loads((adjusted_output / adjusted_manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(adjusted_output)

        self.assertEqual(raw_timeframe(raw_stock), raw_timeframe(stock))
        self.assertEqual(
            [
                {
                    "effectiveDate": "2026-08-11",
                    "actionTypes": ["cash-dividend"],
                    "priceFactor": 0.95,
                    "volumeFactor": 1,
                    "stockDividendRatio": None,
                    "basis": "official-reference-price",
                    "previousClose": 100,
                    "referencePrice": 95,
                    "sourceUrls": [
                        "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL",
                        "https://www.twse.com.tw/rwd/zh/exRight/TWT49U",
                    ],
                    "verifiedAt": "2026-08-11",
                }
            ],
            stock["adjustmentFactors"],
        )
        self.assertEqual("available", stock["priceModes"]["adjusted"]["status"])
        self.assertEqual([], stock["priceModes"]["adjusted"]["reasonCodes"])
        self.assertEqual([], stock["priceModes"]["adjusted"]["warnings"])
        self.assertEqual({"1d", "1w", "1m"}, set(stock["priceModes"]["adjusted"]["timeframes"]))

        raw_by_date = {bar["date"]: bar for bar in raw_completed_bars(stock)}
        adjusted_by_date = {bar["date"]: bar for bar in adjusted_completed_bars(stock)}
        self.assertEqual(raw_by_date["2026-08-10"]["close"] * 0.95, adjusted_by_date["2026-08-10"]["close"])
        self.assertEqual(raw_by_date["2026-08-11"]["close"], adjusted_by_date["2026-08-11"]["close"])
        self.assertEqual(raw_by_date["2026-08-10"]["volumeShares"], adjusted_by_date["2026-08-10"]["volumeShares"])

    def test_adjusts_daily_bars_before_a_week_with_a_midweek_company_action_is_aggregated(self) -> None:
        """週中除息時，週 K 必須從逐日還原值聚合，不能對原始週 K 整根套因子。"""
        base = fixture_build_input()
        actions = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=load_fixture("tpex-adjustment-results.json"),
            verified_at=date(2026, 8, 11),
        )
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        sessions: list[MarketSession] = []
        for session in base.sessions:
            if session.market == "TWSE":
                session_date = session.quotes[0].trading_date
                if session_date == date(2026, 8, 10):
                    quote = replace(
                        twse_quote,
                        trading_date=session_date,
                        open=Decimal("100"),
                        high=Decimal("105"),
                        low=Decimal("95"),
                        close=Decimal("100"),
                    )
                elif session_date == date(2026, 8, 11):
                    quote = replace(
                        twse_quote,
                        trading_date=session_date,
                        open=Decimal("110"),
                        high=Decimal("120"),
                        low=Decimal("108"),
                        close=Decimal("115"),
                    )
                else:
                    quote = replace(twse_quote, trading_date=session_date)
                sessions.append(MarketSession("TWSE", (quote,)))
            else:
                session_date = session.quotes[0].trading_date
                sessions.append(MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)))
        build_input = replace(base, corporate_actions=actions, sessions=tuple(sessions))

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        adjusted_week = adjusted_timeframe(stock, "1w")["formingBar"]
        self.assertIsNotNone(adjusted_week)
        assert adjusted_week is not None
        self.assertEqual(95, adjusted_week["open"])
        self.assertEqual(120, adjusted_week["high"])
        self.assertEqual(90.25, adjusted_week["low"])
        self.assertEqual(115, adjusted_week["close"])

    def test_accumulates_multiple_adjustment_factors_by_effective_date(self) -> None:
        """兩個不同生效日的公司行動，較早日 K 必須套用其後所有因子一次。"""
        base = fixture_build_input()
        action = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            [],
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=[],
            verified_at=date(2026, 8, 11),
        )[0]
        actions = (
            replace(action, action_date=date(2026, 8, 5), previous_close=Decimal("100"), reference_price=Decimal("90")),
            replace(action, action_date=date(2026, 8, 10), previous_close=Decimal("100"), reference_price=Decimal("80")),
        )
        build_input = replace(base, corporate_actions=actions)

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        self.assertEqual(["2026-08-05", "2026-08-10"], [item["effectiveDate"] for item in stock["adjustmentFactors"]])
        adjusted_by_date = {bar["date"]: bar for bar in adjusted_completed_bars(stock)}
        raw_by_date = {bar["date"]: bar for bar in raw_completed_bars(stock)}
        self.assertEqual(raw_by_date["2026-08-04"]["close"] * 0.9 * 0.8, adjusted_by_date["2026-08-04"]["close"])
        self.assertEqual(raw_by_date["2026-08-05"]["close"] * 0.8, adjusted_by_date["2026-08-05"]["close"])
        self.assertEqual(raw_by_date["2026-08-10"]["close"], adjusted_by_date["2026-08-10"]["close"])

    def test_merges_same_day_cash_and_stock_actions_once_and_scales_volume_only_with_a_rebuildable_ratio(self) -> None:
        """同日混合事件只產生一筆因子；股票股利的完整比率才可調整生效日前整股成交量。"""
        base = fixture_build_input()
        action = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            [],
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=[],
            verified_at=date(2026, 8, 11),
        )[0]
        actions = (
            replace(action, action_type="cash-dividend", previous_close=Decimal("100"), reference_price=Decimal("90")),
            replace(
                action,
                action_type="stock-dividend",
                previous_close=Decimal("100"),
                reference_price=Decimal("90"),
                stock_dividend_ratio=Decimal("0.1"),
            ),
        )
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        sessions = tuple(
            MarketSession(
                session.market,
                (
                    replace(
                        twse_quote,
                        trading_date=session.quotes[0].trading_date,
                        volume_shares=1_001,
                    ),
                ),
            )
            if session.market == "TWSE"
            else session
            for session in base.sessions
        )
        build_input = replace(base, corporate_actions=actions, sessions=sessions)

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        self.assertEqual(1, len(stock["adjustmentFactors"]))
        factor = stock["adjustmentFactors"][0]
        self.assertEqual(["cash-dividend", "stock-dividend"], factor["actionTypes"])
        self.assertEqual(0.9, factor["priceFactor"])
        self.assertEqual(1.1, factor["volumeFactor"])
        self.assertEqual(0.1, factor["stockDividendRatio"])
        adjusted_by_date = {bar["date"]: bar for bar in adjusted_completed_bars(stock)}
        raw_by_date = {bar["date"]: bar for bar in raw_completed_bars(stock)}
        self.assertEqual(raw_by_date["2026-08-10"]["close"] * 0.9, adjusted_by_date["2026-08-10"]["close"])
        self.assertEqual(1_101.1, adjusted_by_date["2026-08-10"]["volumeShares"])
        self.assertEqual(1_001, adjusted_by_date["2026-08-11"]["volumeShares"])

    def test_keeps_adjusted_available_when_there_are_no_corporate_actions(self) -> None:
        """無公司行動時還原模式不是錯誤，必須可用且與原始序列完全相同。"""
        base = replace(fixture_build_input(), corporate_actions=())

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, base, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        self.assertEqual([], stock["adjustmentFactors"])
        self.assertEqual("available", stock["priceModes"]["adjusted"]["status"])
        self.assertEqual(raw_timeframe(stock, "1d"), adjusted_timeframe(stock, "1d"))
        self.assertEqual(raw_timeframe(stock, "1w"), adjusted_timeframe(stock, "1w"))
        self.assertEqual(raw_timeframe(stock, "1m"), adjusted_timeframe(stock, "1m"))

    def test_incremental_snapshot_preserves_prior_adjustment_evidence_when_new_day_has_no_new_action(self) -> None:
        """增量日沒有新公司行動時，既有生效日因子仍須隨原始歷史一併帶入新原子快照。"""
        base = fixture_build_input()
        actions = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=load_fixture("tpex-adjustment-results.json"),
            verified_at=date(2026, 8, 11),
        )
        initial = replace(base, corporate_actions=actions)
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        next_input = replace(
            base,
            source_commit="fixture-next",
            generated_at=datetime(2026, 8, 12, 18, 0, tzinfo=base.calendar.timezone),
            sessions=(
                MarketSession("TWSE", (replace(twse_quote, trading_date=date(2026, 8, 12)),)),
                MarketSession("TPEx", (replace(tpex_quote, trading_date=date(2026, 8, 12)),)),
            ),
            corporate_actions=(),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            previous = root / "previous"
            output = root / "next"
            previous_manifest = build_snapshot(None, initial, previous)
            next_manifest = build_snapshot(previous, next_input, output)
            previous_stock = json.loads((previous / previous_manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            stock = json.loads((output / next_manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        self.assertEqual(previous_stock["adjustmentFactors"], stock["adjustmentFactors"])
        self.assertEqual(previous_stock["corporateActions"], stock["corporateActions"])
        self.assertEqual("available", stock["priceModes"]["adjusted"]["status"])
        adjusted_by_date = {bar["date"]: bar for bar in adjusted_completed_bars(stock)}
        raw_by_date = {bar["date"]: bar for bar in raw_completed_bars(stock)}
        self.assertEqual(raw_by_date["2026-08-10"]["close"] * 0.95, adjusted_by_date["2026-08-10"]["close"])

    def test_rejects_a_tampered_adjustment_factor_even_when_the_snapshot_checksums_are_rewritten(self) -> None:
        """調整因子必須等於公開前收與參考價的比值，重算雜湊不能掩蓋竄改。"""
        base = fixture_build_input()
        actions = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=load_fixture("tpex-adjustment-results.json"),
            verified_at=date(2026, 8, 11),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, replace(base, corporate_actions=actions), output)
            manifest_document = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            stock_path = output / manifest.symbols[0].data_path
            stock = json.loads(stock_path.read_text(encoding="utf-8"))
            original_stock = json.loads(json.dumps(stock))
            stock["adjustmentFactors"][0]["priceFactor"] = 0.96
            rewrite_snapshot_stock(output, manifest_document, stock_path, stock)

            with self.assertRaisesRegex(SnapshotValidationError, "調整因子"):
                validate_snapshot(output)

            stock = json.loads(json.dumps(original_stock))
            stock["adjustmentFactors"][0]["priceFactor"] = 0.95
            stock["adjustmentFactors"][0]["stockDividendRatio"] = 0.1
            stock["adjustmentFactors"][0]["actionTypes"].append("stock-dividend")
            rewrite_snapshot_stock(output, manifest_document, stock_path, stock)

            with self.assertRaisesRegex(SnapshotValidationError, "成交量調整因子"):
                validate_snapshot(output)

            stock = json.loads(json.dumps(original_stock))
            stock["adjustmentFactors"][0]["sourceUrls"] = [
                "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL"
            ]
            rewrite_snapshot_stock(output, manifest_document, stock_path, stock)

            with self.assertRaisesRegex(SnapshotValidationError, "計算來源"):
                validate_snapshot(output)

            stock = json.loads(json.dumps(original_stock))
            stock["corporateActions"][0]["date"] = "2026-08-12"
            stock["adjustmentFactors"][0]["effectiveDate"] = "2026-08-12"
            rewrite_snapshot_stock(output, manifest_document, stock_path, stock)

            with self.assertRaisesRegex(SnapshotValidationError, "公司行動日期"):
                validate_snapshot(output)

    def test_records_emergency_market_closure_evidence_in_manifest_and_provenance(self) -> None:
        base = fixture_build_input()
        closures = parse_emergency_market_closure_evidence(
            {
                "schemaVersion": EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
                "closures": [
                    {
                        "date": "2026-07-10",
                        "markets": ["TWSE", "TPEx"],
                        "reason": "臺灣證券交易所集中交易市場 115 年 7 月 10 日因天然災害全日休市。",
                        "sourceUrls": [
                            "https://eoc.gov.taipei/News/Detail/909",
                            "https://www.tpex.org.tw/storage/eb_data/11205/11200591671.html",
                            "https://www.twse.com.tw/en/clearing/suspended.html",
                        ],
                    }
                ],
            }
        )
        calendar = apply_emergency_market_closures(base.calendar, closures)
        twse_daily = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_daily = parse_tpex_daily(load_fixture("tpex-daily.json"))
        sessions = tuple(
            market_session
            for session_date in official_fixture_sessions_ending_at(date(2026, 8, 11), 120, calendar)
            for market_session in (
                MarketSession("TWSE", tuple(replace(quote, trading_date=session_date) for quote in twse_daily)),
                MarketSession("TPEx", tuple(replace(quote, trading_date=session_date) for quote in tpex_daily)),
            )
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, replace(base, calendar=calendar, sessions=sessions), output)
            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            provenance = json.loads((output / "provenance.json").read_text(encoding="utf-8"))

        expected_evidence = {
            "schemaVersion": 1,
            "closures": [
                {
                    "date": "2026-07-10",
                    "markets": ["TWSE", "TPEx"],
                    "reason": "臺灣證券交易所集中交易市場 115 年 7 月 10 日因天然災害全日休市。",
                    "sourceUrls": [
                        "https://eoc.gov.taipei/News/Detail/909",
                        "https://www.tpex.org.tw/storage/eb_data/11205/11200591671.html",
                        "https://www.twse.com.tw/en/clearing/suspended.html",
                    ],
                }
            ],
        }
        self.assertEqual(expected_evidence, manifest["calendar"]["emergencyClosureEvidence"])
        self.assertEqual(expected_evidence, provenance["calendar"]["emergencyClosureEvidence"])
        self.assertNotIn("2026-07-10", manifest["markets"]["TWSE"]["tradingSessions"])
        self.assertNotIn("2026-07-10", manifest["markets"]["TPEx"]["tradingSessions"])

    def test_aggregates_natural_week_and_month_across_new_year_with_holiday_and_forming_bars(self) -> None:
        """自然週跨年、元旦休市與尚未結束的週／月，必須各自保留正確 OHLCV 與狀態。"""

        base = fixture_build_input()
        calendar = replace(
            base.calendar,
            holiday_dates=(date(2025, 1, 1), date(2026, 1, 1)),
            valid_through=date(2026, 12, 31),
        )
        session_dates = official_fixture_sessions_ending_at(date(2026, 1, 5), 120, calendar)
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        sessions: list[MarketSession] = []
        for index, session_date in enumerate(session_dates, start=1):
            price = Decimal(100 + index)
            sessions.extend(
                (
                    MarketSession(
                        "TWSE",
                        (
                            replace(
                                twse_quote,
                                trading_date=session_date,
                                open=price,
                                high=price + Decimal(10),
                                low=price - Decimal(10),
                                close=price + Decimal(5),
                                volume_shares=1_000 + index,
                                transaction_count=10 + index,
                            ),
                        ),
                    ),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(
            base,
            calendar=calendar,
            sessions=tuple(sessions),
            generated_at=datetime(2026, 1, 5, 18, 0, tzinfo=calendar.timezone),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        daily_by_date = {bar["date"]: bar for bar in raw_completed_bars(stock)}
        completed_weeks = raw_completed_bars(stock, "1w")
        completed_cross_year_week = next(
            bar
            for bar in completed_weeks
            if bar["periodStart"] == "2025-12-29" and bar["periodEnd"] == "2026-01-02"
        )
        cross_year_daily = [
            daily_by_date[day]
            for day in ("2025-12-29", "2025-12-30", "2025-12-31", "2026-01-02")
        ]
        self.assertEqual(cross_year_daily[0]["open"], completed_cross_year_week["open"])
        self.assertEqual(max(bar["high"] for bar in cross_year_daily), completed_cross_year_week["high"])
        self.assertEqual(min(bar["low"] for bar in cross_year_daily), completed_cross_year_week["low"])
        self.assertEqual(cross_year_daily[-1]["close"], completed_cross_year_week["close"])
        self.assertEqual(sum(bar["volumeShares"] for bar in cross_year_daily), completed_cross_year_week["volumeShares"])
        self.assertEqual(sum(bar["transactionCount"] for bar in cross_year_daily), completed_cross_year_week["transactionCount"])
        self.assertTrue(completed_cross_year_week["completed"])
        self.assertEqual("complete", completed_cross_year_week["evidenceStatus"])

        weekly_forming = raw_timeframe(stock, "1w")["formingBar"]
        self.assertEqual("2026-01-05", weekly_forming["periodStart"])
        self.assertEqual("2026-01-09", weekly_forming["periodEnd"])
        self.assertEqual("2026-01-05", weekly_forming["date"])
        self.assertFalse(weekly_forming["completed"])

        completed_december = next(
            bar
            for bar in raw_completed_bars(stock, "1m")
            if bar["periodStart"] == "2025-12-01" and bar["periodEnd"] == "2025-12-31"
        )
        self.assertTrue(completed_december["completed"])
        monthly_forming = raw_timeframe(stock, "1m")["formingBar"]
        self.assertEqual("2026-01-02", monthly_forming["periodStart"])
        self.assertEqual("2026-01-30", monthly_forming["periodEnd"])
        self.assertFalse(monthly_forming["completed"])

    def test_expands_only_verified_suspension_sessions_and_keeps_recovery_bar(self) -> None:
        """停牌日以 official-suspension 證據補齊；endDateExclusive 當日的合法 K 線不可被覆蓋。"""
        base = fixture_build_input()
        interval = SuspensionInterval(
            market="TWSE",
            code="2330",
            start_date=date(2026, 8, 10),
            end_date_exclusive=date(2026, 8, 11),
            reason="測試用官方停止買賣區間。",
            source_urls=("https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB",),
        )
        sessions = tuple(
            replace(
                session,
                quotes=tuple(
                    quote
                    for quote in session.quotes
                    if not (
                        session.market == "TWSE"
                        and quote.code == "2330"
                        and quote.trading_date == date(2026, 8, 10)
                    )
                ),
            )
            for session in base.sessions
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, replace(base, sessions=sessions, suspension_intervals=(interval,)), output)
            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            stock = json.loads((output / manifest["symbols"][0]["dataPath"]).read_text(encoding="utf-8"))

        evidence = next(item for item in stock["noQuoteEvidence"] if item["date"] == "2026-08-10")
        self.assertEqual("official-suspension", evidence["reason"])
        self.assertEqual("2026-08-11", raw_completed_bars(stock)[-1]["date"])
        self.assertEqual(
            {
                "schemaVersion": SUSPENSION_EVIDENCE_SCHEMA_VERSION,
                "intervals": [
                    {
                        "market": "TWSE",
                        "code": "2330",
                        "startDate": "2026-08-10",
                        "endDateExclusive": "2026-08-11",
                        "reason": "測試用官方停止買賣區間。",
                        "sourceUrls": [
                            "https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB"
                        ],
                    }
                ],
            },
            manifest["suspensionEvidence"],
        )

    def test_reduction_interval_uses_the_consecutive_missing_suffix_before_recovery(self) -> None:
        """TWSE 減資表的搜尋日期較早時，合法行情不可被誤標為停牌。"""
        base = fixture_build_input()
        sessions = tuple(
            replace(
                session,
                quotes=tuple(
                    quote
                    for quote in session.quotes
                    if not (
                        session.market == "TWSE"
                        and quote.code == "2330"
                        and quote.trading_date == date(2026, 8, 10)
                    )
                ),
            )
            for session in base.sessions
        )
        reduction = SuspensionInterval(
            market="TWSE",
            code="2330",
            start_date=date(2026, 8, 7),
            end_date_exclusive=date(2026, 8, 11),
            reason="退還股款減資換發新股。",
            source_urls=("https://www.twse.com.tw/rwd/zh/reducation/TWTAUU",),
        )

        merged = market_snapshot._merge_historical_suspension_intervals(
            base.symbols,
            sessions,
            (),
            (reduction,),
        )

        self.assertEqual(1, len(merged))
        self.assertEqual(date(2026, 8, 10), merged[0].start_date)
        self.assertEqual(date(2026, 8, 11), merged[0].end_date_exclusive)

    def test_rejects_a_suspension_interval_that_overlaps_a_legal_bar(self) -> None:
        """官方停牌區間若與同日合法 K 線衝突，快照必須 fail closed。"""
        base = fixture_build_input()
        interval = SuspensionInterval(
            market="TWSE",
            code="2330",
            start_date=date(2026, 8, 11),
            end_date_exclusive=None,
            reason="測試用不應覆蓋行情的區間。",
            source_urls=("https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB",),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(SnapshotValidationError, "停止買賣區間與合法 K 線衝突"):
                build_snapshot(None, replace(base, suspension_intervals=(interval,)), Path(temporary_directory) / "site-data")

    def test_fixture_cli_builds_without_live_network_and_validate_reads_it(self) -> None:
        """若 fixture 模式改打官方 API，前端與 PR 的離線 gate 必須失敗。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            with patch.multiple(
                "market_snapshot",
                fetch_trading_calendar=unittest.mock.DEFAULT,
                fetch_supported_symbols=unittest.mock.DEFAULT,
                fetch_corporate_actions=unittest.mock.DEFAULT,
                fetch_twse_daily=unittest.mock.DEFAULT,
                fetch_tpex_daily=unittest.mock.DEFAULT,
            ) as live_sources:
                for source in live_sources.values():
                    source.side_effect = AssertionError("fixture 模式不可連線官方來源")
                exit_code = main(
                    [
                        "fixture",
                        "--fixtures",
                        str(FIXTURES),
                        "--output",
                        str(output),
                        "--source-commit",
                        "fixture",
                    ]
                )

            self.assertEqual(0, exit_code)
            manifest = validate_snapshot(output)
            self.assertEqual("fixture", manifest.source_commit)
            self.assertEqual(120, len(manifest.markets["TWSE"].trading_sessions))
            self.assertEqual(120, manifest.symbols[0].bar_count)

    def test_fixture_command_invokes_the_cli_entrypoint(self) -> None:
        """若直接執行工具檔沒有進入 main，CI 的 fixture gate 會假成功。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "tools" / "market_snapshot.py"),
                    "fixture",
                    "--fixtures",
                    str(FIXTURES),
                    "--output",
                    str(output),
                    "--source-commit",
                    "fixture",
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertTrue((output / "manifest.json").is_file())
            self.assertIn("已建立離線 fixture 快照", result.stdout)

    def test_update_is_a_no_op_when_both_market_cutoffs_already_match(self) -> None:
        """若同一截止日仍重新抓資料或覆寫目錄，排程重入性必須失敗。"""
        taipei = timezone(timedelta(hours=8), name="Asia/Taipei")
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            original = build_snapshot(None, fixture_build_input(), output)
            manifest_before = (output / "manifest.json").read_bytes()
            calendar = parse_holiday_calendar(load_fixture("holiday-calendar.json"))

            with patch("market_snapshot.fetch_trading_calendar", return_value=calendar), patch(
                "market_snapshot.fetch_twse_daily", side_effect=AssertionError("同截止日不應抓取 TWSE")
            ), patch(
                "market_snapshot.fetch_tpex_daily", side_effect=AssertionError("同截止日不應抓取 TPEx")
            ):
                manifest, updated = update_snapshot(
                    output,
                    output,
                    "fixture",
                    Path(temporary_directory) / "cache",
                    now=datetime(2026, 8, 11, 18, 0, tzinfo=taipei),
                )

            self.assertFalse(updated)
            self.assertEqual(original.snapshot_hash, manifest.snapshot_hash)
            self.assertEqual(manifest_before, (output / "manifest.json").read_bytes())

    def test_successful_atomic_replace_does_not_accumulate_hidden_previous_snapshots(self) -> None:
        """若每次成功更新都留下整份 previous 目錄，長期排程會無限制佔用 artifact 空間。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "site-data"
            build_snapshot(None, fixture_build_input(), output)
            archive_before = (output / "snapshot.tar.gz").read_bytes()
            sums_before = (output / "SHA256SUMS").read_bytes()
            build_snapshot(None, fixture_build_input(), output)

            self.assertFalse(list(root.glob(".site-data.previous-*")))
            self.assertEqual(archive_before, (output / "snapshot.tar.gz").read_bytes())
            self.assertEqual(sums_before, (output / "SHA256SUMS").read_bytes())

    def test_update_appends_only_a_new_session_and_keeps_official_provenance(self) -> None:
        """若增量覆寫舊 K 線或把內部暫名寫入 sourceUrls，快照不可發布。"""
        taipei = timezone(timedelta(hours=8), name="Asia/Taipei")
        original_twse = replace(
            parse_twse_daily(load_fixture("twse-daily.json"))[0],
            source_url="https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
        )
        base = fixture_build_input()
        initial = replace(
            base,
            sessions=tuple(
                MarketSession(
                    session.market,
                    tuple(
                        replace(quote, source_url=original_twse.source_url)
                        if session.market == "TWSE"
                        else quote
                        for quote in session.quotes
                    ),
                )
                for session in base.sessions
            ),
        )
        twse_new = replace(parse_twse_daily(load_fixture("twse-daily.json"))[0], trading_date=date(2026, 8, 12))
        tpex_new = replace(parse_tpex_daily(load_fixture("tpex-daily.json"))[0], trading_date=date(2026, 8, 12))
        calendar = parse_holiday_calendar(load_fixture("holiday-calendar.json"))
        symbols = initial.symbols
        actions = initial.corporate_actions

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, initial, output)
            with patch("market_snapshot.fetch_trading_calendar", return_value=calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=actions) as action_fetch, patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ), patch(
                "market_snapshot.fetch_twse_daily", return_value=(twse_new,)
            ), patch("market_snapshot.fetch_tpex_daily", return_value=(tpex_new,)):
                manifest, updated = update_snapshot(
                    output,
                    output,
                    "fixture-next",
                    Path(temporary_directory) / "cache",
                    now=datetime(2026, 8, 12, 18, 0, tzinfo=taipei),
                )

            action_fetch.assert_called_once_with(start_date=date(2026, 8, 12), end_date=date(2026, 8, 12))

            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            self.assertTrue(updated)
            self.assertEqual(["2026-08-11", "2026-08-12"], [bar["date"] for bar in raw_completed_bars(stock)][-2:])
            self.assertTrue(all(url.startswith("https://") for url in stock["sourceUrls"]))
            self.assertIn("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX", stock["sourceUrls"])

    def test_update_without_full_history_cache_preserves_full_report_absence_evidence(self) -> None:
        """尚無十年快取時，增量更新也必須把完整日報缺席轉成可稽核未報價證據。"""
        taipei = timezone(timedelta(hours=8), name="Asia/Taipei")
        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        session_date = date(2026, 8, 12)
        unrelated_twse_quote = replace(
            twse_quote,
            code="9999",
            name="完整日報中的其他股票",
            trading_date=session_date,
        )
        tpex_new = replace(tpex_quote, trading_date=session_date)

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, base, output)
            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions), patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ), patch(
                "market_snapshot.fetch_twse_daily", return_value=(unrelated_twse_quote,)
            ), patch("market_snapshot.fetch_tpex_daily", return_value=(tpex_new,)):
                manifest, updated = update_snapshot(
                    output,
                    output,
                    "fixture-no-quote",
                    Path(temporary_directory) / "cache",
                    now=datetime(2026, 8, 12, 18, 0, tzinfo=taipei),
                )

            twse_entry = next(symbol for symbol in manifest.symbols if symbol.market == "TWSE")
            stock = json.loads((output / twse_entry.data_path).read_text(encoding="utf-8"))
            self.assertTrue(updated)
            self.assertEqual(
                {
                    "market": "TWSE",
                    "code": twse_entry.code,
                    "date": session_date.isoformat(),
                    "reason": "official-no-quote",
                    "sourceUrl": twse_quote.source_url,
                },
                stock["noQuoteEvidence"][-1],
            )

    def test_update_backfills_each_missing_official_trading_session_before_marking_fresh(self) -> None:
        """若舊 cutoff 落後多個交易日卻只追加最後一天，fresh 會成為錯誤宣告。"""
        base = fixture_build_input()
        prior_date = date(2026, 8, 6)
        expected_date = date(2026, 8, 11)
        expected_backfill_dates = [date(2026, 8, 7), date(2026, 8, 10), expected_date]
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        initial_sessions: list[MarketSession] = []
        for session_date in official_fixture_sessions_ending_at(prior_date, 120, base.calendar):
            initial_sessions.extend(
                (
                    MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        initial = replace(
            base,
            generated_at=datetime(2026, 8, 6, 18, 0, tzinfo=base.calendar.timezone),
            sessions=tuple(initial_sessions),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            cache = Path(temporary_directory) / "cache"
            build_snapshot(None, initial, output)

            def twse_history(session_date: date):
                return (replace(twse_quote, trading_date=session_date),)

            def tpex_history(session_date: date):
                return (replace(tpex_quote, trading_date=session_date),)

            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions) as action_fetch, patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ), patch(
                "market_snapshot.fetch_twse_historical_daily", side_effect=twse_history
            ) as twse_history_fetch, patch(
                "market_snapshot.fetch_tpex_historical_daily", side_effect=tpex_history
            ) as tpex_history_fetch, patch(
                "market_snapshot.fetch_twse_daily", return_value=(replace(twse_quote, trading_date=expected_date),)
            ), patch(
                "market_snapshot.fetch_tpex_daily", return_value=(replace(tpex_quote, trading_date=expected_date),)
            ), patch("market_snapshot._throttle_official_requests"):
                manifest, updated = update_snapshot(
                    output,
                    output,
                    "fixture-backfill",
                    cache,
                    now=datetime(2026, 8, 11, 18, 0, tzinfo=base.calendar.timezone),
                )

            action_fetch.assert_called_once_with(
                start_date=expected_backfill_dates[0],
                end_date=expected_date,
            )

            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            self.assertTrue(updated)
            self.assertEqual(
                ["2026-08-06", "2026-08-07", "2026-08-10", "2026-08-11"],
                [bar["date"] for bar in raw_completed_bars(stock)][-4:],
            )
            self.assertEqual(expected_backfill_dates, [call.args[0] for call in twse_history_fetch.call_args_list])
            self.assertEqual(expected_backfill_dates, [call.args[0] for call in tpex_history_fetch.call_args_list])
            self.assertEqual("fresh", manifest.markets["TWSE"].freshness)

    def test_update_keeps_previous_snapshot_when_any_backfill_session_fails(self) -> None:
        """若補齊中間交易日失敗，不能以部分新資料覆寫上一成功快照。"""
        base = fixture_build_input()
        prior_date = date(2026, 8, 6)
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        initial_sessions: list[MarketSession] = []
        for session_date in official_fixture_sessions_ending_at(prior_date, 120, base.calendar):
            initial_sessions.extend(
                (
                    MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        initial = replace(
            base,
            generated_at=datetime(2026, 8, 6, 18, 0, tzinfo=base.calendar.timezone),
            sessions=tuple(initial_sessions),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            cache = Path(temporary_directory) / "cache"
            build_snapshot(None, initial, output)
            manifest_before = (output / "manifest.json").read_bytes()
            archive_before = (output / "snapshot.tar.gz").read_bytes()
            sums_before = (output / "SHA256SUMS").read_bytes()

            def twse_history(session_date: date):
                return (replace(twse_quote, trading_date=session_date),)

            def tpex_history(session_date: date):
                if session_date == date(2026, 8, 10):
                    raise MarketSourceError("TPEx 歷史端點暫時失敗")
                return (replace(tpex_quote, trading_date=session_date),)

            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions), patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ), patch(
                "market_snapshot.fetch_twse_historical_daily", side_effect=twse_history
            ), patch("market_snapshot.fetch_tpex_historical_daily", side_effect=tpex_history), patch(
                "market_snapshot.fetch_twse_daily", return_value=(replace(twse_quote, trading_date=date(2026, 8, 11)),)
            ), patch(
                "market_snapshot.fetch_tpex_daily", return_value=(replace(tpex_quote, trading_date=date(2026, 8, 11)),)
            ), patch("market_snapshot._throttle_official_requests"), patch("market_snapshot.time.sleep"):
                with self.assertRaisesRegex(SnapshotValidationError, "官方資料重試三次仍失敗"):
                    update_snapshot(
                        output,
                        output,
                        "fixture-backfill",
                        cache,
                        now=datetime(2026, 8, 11, 18, 0, tzinfo=base.calendar.timezone),
                    )

            self.assertEqual(manifest_before, (output / "manifest.json").read_bytes())
            self.assertEqual(archive_before, (output / "snapshot.tar.gz").read_bytes())
            self.assertEqual(sums_before, (output / "SHA256SUMS").read_bytes())

    def test_snapshot_does_not_repeat_a_source_request_cycle_that_already_finished_retrying(self) -> None:
        """來源層已有限重試後，快照層不可再放大為九次官方請求。"""
        fetcher = unittest.mock.Mock(
            side_effect=OfficialSourceFetchError("官方來源回傳 HTTP 520。")
        )

        with (
            patch("market_snapshot.time.sleep") as wait,
            self.assertRaisesRegex(SnapshotValidationError, "官方來源請求失敗"),
        ):
            market_snapshot._fetch_with_retries("TPEx", date(2026, 8, 12), fetcher)

        fetcher.assert_called_once_with(date(2026, 8, 12))
        wait.assert_not_called()

    def test_update_rejects_a_current_day_coverage_drop_without_overwriting_output(self) -> None:
        """若沿用舊 K 線掩蓋今天的缺漏行情，部署會把資料掉量誤當正常。"""
        base = fixture_build_input()
        earlier_date = date(2026, 8, 10)
        later_date = date(2026, 8, 12)
        earlier_twse_quote = replace(
            parse_twse_daily(load_fixture("twse-daily.json"))[0],
            trading_date=earlier_date,
        )
        earlier_tpex_quote = replace(
            parse_tpex_daily(load_fixture("tpex-daily.json"))[0],
            trading_date=earlier_date,
        )
        twse_quote = replace(parse_twse_daily(load_fixture("twse-daily.json"))[0], trading_date=later_date)
        unsupported_tpex_quote = replace(
            parse_tpex_daily(load_fixture("tpex-daily.json"))[1],
            trading_date=later_date,
        )
        build_input = replace(
            base,
            sessions=(
                MarketSession("TWSE", (earlier_twse_quote,)),
                MarketSession("TPEx", (earlier_tpex_quote,)),
                MarketSession("TWSE", (twse_quote,)),
                MarketSession("TPEx", (unsupported_tpex_quote,)),
            ),
            generated_at=datetime(2026, 8, 12, 18, 0, tzinfo=base.calendar.timezone),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, base, output)
            manifest_before = (output / "manifest.json").read_bytes()

            with self.assertRaisesRegex(SnapshotValidationError, "當日官方普通股日行情覆蓋率"):
                build_snapshot(output, build_input, output)

            self.assertEqual(manifest_before, (output / "manifest.json").read_bytes())

    def test_retention_keeps_only_the_latest_120_sessions_per_stock(self) -> None:
        """若第 121 根仍留在資料檔，前端 60 根分析的資料界線會漂移。"""
        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        session_dates = official_fixture_sessions_ending_at(date(2026, 8, 11), 121, base.calendar)
        sessions: list[MarketSession] = []
        for session_date in session_dates:
            sessions.extend(
                (
                    MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(base, sessions=tuple(sessions))

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))

        self.assertEqual(120, len(raw_completed_bars(stock)))
        self.assertEqual(session_dates[-120].isoformat(), raw_completed_bars(stock)[0]["date"])
        self.assertEqual(session_dates[-1].isoformat(), raw_completed_bars(stock)[-1]["date"])
        self.assertEqual(120, manifest.symbols[0].available_sessions)
        self.assertIsNone(manifest.symbols[0].short_history_reason)
        self.assertEqual(120, stock["availableSessions"])
        self.assertIsNone(stock["shortHistoryReason"])

    def test_ten_year_history_keeps_120_completed_bars_per_timeframe(self) -> None:
        """十年基準不得因日 K 只留 120 根而讓月 K 或週 K 歷史不足。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, ten_year_fixture_build_input(), output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))

            self.assertEqual(120, len(raw_completed_bars(stock, "1d")))
            self.assertEqual(120, len(raw_completed_bars(stock, "1w")))
            self.assertEqual(120, len(raw_completed_bars(stock, "1m")))
            self.assertEqual(manifest.snapshot_hash, validate_snapshot(output).snapshot_hash)

    def test_published_artifact_limit_keeps_previous_snapshot_when_exceeded(self) -> None:
        """達 400 MiB 門檻時，候選資料不可覆寫上一個可驗證快照。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, fixture_build_input(), output)
            manifest_before = (output / "manifest.json").read_bytes()

            with patch("market_snapshot.MAX_PUBLISHED_ARTIFACT_BYTES", 1, create=True):
                with self.assertRaisesRegex(SnapshotValidationError, "400 MiB"):
                    build_snapshot(None, ten_year_fixture_build_input(), output)

            self.assertEqual(manifest_before, (output / "manifest.json").read_bytes())
            validate_snapshot(output)

    def test_rejects_an_old_stock_when_the_oldest_expected_market_session_is_missing(self) -> None:
        """舊股的 trailing 120 日少最早一天時，不能被縮短成看似完整的 119 日視窗。"""

        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        expected_sessions = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        sessions: list[MarketSession] = []
        for session_date in expected_sessions[1:]:
            sessions.extend(
                (
                    MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(base, sessions=tuple(sessions))

        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(SnapshotValidationError, "官方交易日缺漏"):
                build_snapshot(None, build_input, Path(temporary_directory) / "site-data")

    def test_allows_an_official_119_session_ipo_suffix_and_preserves_listing_evidence(self) -> None:
        """只有官方上市日期能讓 119 日短歷史成立，且 manifest 與個股都要保留證據。"""

        base = fixture_build_input()
        twse_quote, unsupported_twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        expected_sessions = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        listing_date = expected_sessions[1]
        sessions: list[MarketSession] = []
        for session_date in expected_sessions:
            twse_quotes = (
                (replace(twse_quote, trading_date=session_date),)
                if session_date >= listing_date
                else (replace(unsupported_twse_quote, trading_date=session_date),)
            )
            sessions.extend(
                (
                    MarketSession("TWSE", twse_quotes),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        symbol = replace(base.symbols[0], listing_date=listing_date)
        build_input = replace(base, symbols=(symbol, base.symbols[1]), sessions=tuple(sessions))

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))

        self.assertEqual(119, manifest.symbols[0].available_sessions)
        self.assertEqual(listing_date.isoformat(), manifest.symbols[0].listing_date)
        self.assertEqual("listing-history", manifest.symbols[0].short_history_reason)
        self.assertEqual(listing_date.isoformat(), stock["listingDate"])
        self.assertIn(symbol.source_url, stock["sourceUrls"])

    def test_rejects_a_short_stock_without_an_official_listing_date(self) -> None:
        """短歷史沒有官方上市日期時，不能自行推定是 IPO。"""

        base = fixture_build_input()
        twse_quote, unsupported_twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        expected_sessions = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        sessions: list[MarketSession] = []
        for index, session_date in enumerate(expected_sessions):
            twse_quotes = (
                (replace(unsupported_twse_quote, trading_date=session_date),)
                if index == 0
                else (replace(twse_quote, trading_date=session_date),)
            )
            sessions.extend(
                (
                    MarketSession("TWSE", twse_quotes),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(
            base,
            symbols=(replace(base.symbols[0], listing_date=None), base.symbols[1]),
            sessions=tuple(sessions),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(SnapshotValidationError, "官方上市日期無效"):
                build_snapshot(None, build_input, Path(temporary_directory) / "site-data")

    def test_short_ipo_history_is_disclosed_when_every_available_session_is_present(self) -> None:
        """若新上市股票的短歷史未標示來源，使用者會把資料缺口誤認為完整 120 根 K 線。"""
        base = fixture_build_input()
        twse_quote, unsupported_twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        session_dates = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        listing_date = session_dates[-4]
        sessions: list[MarketSession] = []
        for session_date in session_dates:
            twse_quotes = (
                (replace(twse_quote, trading_date=session_date),)
                if session_date >= listing_date
                else (replace(unsupported_twse_quote, trading_date=session_date),)
            )
            sessions.extend(
                (
                    MarketSession("TWSE", twse_quotes),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        symbols = (replace(base.symbols[0], listing_date=listing_date), base.symbols[1])
        build_input = replace(base, symbols=symbols, sessions=tuple(sessions))

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            entry = manifest.symbols[0]
            stock = json.loads((output / entry.data_path).read_text(encoding="utf-8"))

        self.assertEqual(4, entry.available_sessions)
        self.assertEqual("listing-history", entry.short_history_reason)
        self.assertEqual(4, len(raw_completed_bars(stock)))
        self.assertEqual(4, stock["availableSessions"])
        self.assertEqual("listing-history", stock["shortHistoryReason"])

    def test_records_official_no_quote_evidence_without_fabricating_ohlc(self) -> None:
        """官方明示未報價時，該交易日必須保留證據，不能補成一根假 K 線。"""

        base = fixture_build_input()
        no_quote_date = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)[60]
        sessions: list[MarketSession] = []
        for session in base.sessions:
            if session.market == "TWSE" and session.quotes[0].trading_date == no_quote_date:
                quote = session.quotes[0]
                sessions.append(
                    MarketSession(
                        "TWSE",
                        (),
                        (
                            NoQuoteEvidence(
                                market="TWSE",
                                code=quote.code,
                                trading_date=no_quote_date,
                                reason="official-no-quote",
                                source_url=quote.source_url,
                            ),
                        ),
                    )
                )
            else:
                sessions.append(session)
        build_input = replace(base, sessions=tuple(sessions))

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            entry = manifest.symbols[0]
            stock = json.loads((output / entry.data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        self.assertEqual(4, manifest.snapshot_version)
        self.assertEqual(119, entry.bar_count)
        self.assertEqual(1, entry.no_quote_count)
        self.assertEqual(120, entry.available_sessions)
        self.assertNotIn(no_quote_date.isoformat(), [bar["date"] for bar in raw_completed_bars(stock)])
        self.assertEqual(
            [{
                "market": "TWSE",
                "code": "2330",
                "date": no_quote_date.isoformat(),
                "reason": "official-no-quote",
                "sourceUrl": "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
            }],
            stock["noQuoteEvidence"],
        )
        for timeframe in ("1w", "1m"):
            aggregate_bars = [
                *raw_completed_bars(stock, timeframe),
                *([] if raw_timeframe(stock, timeframe)["formingBar"] is None else [raw_timeframe(stock, timeframe)["formingBar"]]),
            ]
            affected = next(
                bar
                for bar in aggregate_bars
                if bar["periodStart"] <= no_quote_date.isoformat() <= bar["periodEnd"]
            )
            self.assertEqual("incomplete", affected["evidenceStatus"])
            self.assertEqual([no_quote_date.isoformat()], affected["missingSessionDates"])

    def test_does_not_create_week_or_month_price_bar_when_a_new_listing_has_only_official_no_quote_evidence(self) -> None:
        """整個首週／首月沒有合法日 K 時，只能保留官方證據，不能補造價格棒。"""

        base = fixture_build_input()
        session_dates = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        listing_date = date(2026, 8, 10)
        twse_quote, unsupported_twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        sessions: list[MarketSession] = []
        for session_date in session_dates:
            if session_date < listing_date:
                twse_session = MarketSession(
                    "TWSE",
                    (replace(unsupported_twse_quote, trading_date=session_date),),
                )
            else:
                twse_session = MarketSession(
                    "TWSE",
                    (),
                    (
                        NoQuoteEvidence(
                            market="TWSE",
                            code="2330",
                            trading_date=session_date,
                            reason="official-no-quote",
                            source_url=twse_quote.source_url,
                        ),
                    ),
                )
            sessions.extend(
                (
                    twse_session,
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(
            base,
            symbols=(replace(base.symbols[0], listing_date=listing_date), base.symbols[1]),
            sessions=tuple(sessions),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            validate_snapshot(output)

        self.assertEqual(0, manifest.symbols[0].bar_count)
        self.assertEqual(2, manifest.symbols[0].no_quote_count)
        self.assertEqual([], raw_completed_bars(stock))
        for timeframe in ("1w", "1m"):
            self.assertEqual([], raw_completed_bars(stock, timeframe))
            self.assertIsNone(raw_timeframe(stock, timeframe)["formingBar"])

    def test_rejects_duplicate_official_no_quote_evidence_in_one_market_session(self) -> None:
        """來源若重複同一股票的未報價列，不能在停牌區間展開前被字典覆蓋。"""

        base = fixture_build_input()
        target_date = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)[60]
        sessions: list[MarketSession] = []
        for session in base.sessions:
            if session.market == "TWSE" and session.quotes[0].trading_date == target_date:
                quote = session.quotes[0]
                evidence = NoQuoteEvidence(
                    market="TWSE",
                    code=quote.code,
                    trading_date=target_date,
                    reason="official-no-quote",
                    source_url=quote.source_url,
                )
                sessions.append(MarketSession("TWSE", (), (evidence, evidence)))
            else:
                sessions.append(session)

        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(SnapshotValidationError, "重複未報價證據"):
                build_snapshot(None, replace(base, sessions=tuple(sessions)), Path(temporary_directory) / "site-data")

    def test_rejects_a_middle_history_hole_for_an_existing_stock(self) -> None:
        """若既有股票漏掉中間交易日仍可發布，短歷史標記會掩蓋官方來源掉量。"""
        base = fixture_build_input()
        twse_quote, unsupported_twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        session_dates = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        missing_date = session_dates[60]
        sessions: list[MarketSession] = []
        for session_date in session_dates:
            twse_quotes = (
                (replace(unsupported_twse_quote, trading_date=session_date),)
                if session_date == missing_date
                else (replace(twse_quote, trading_date=session_date),)
            )
            sessions.extend(
                (
                    MarketSession("TWSE", twse_quotes),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(base, sessions=tuple(sessions))

        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(SnapshotValidationError, "不合理缺口"):
                build_snapshot(None, build_input, Path(temporary_directory) / "site-data")

    def test_reports_all_stocks_with_history_holes_in_one_failure(self) -> None:
        """全市場基準應一次列出所有缺口股票，避免 Action 每次只修到第一檔。"""
        base = fixture_build_input()
        twse_quote, unsupported_twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        session_dates = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        twse_missing_date = session_dates[50]
        tpex_missing_date = session_dates[70]
        sessions: list[MarketSession] = []
        for session_date in session_dates:
            twse_quotes = (
                (replace(unsupported_twse_quote, trading_date=session_date),)
                if session_date == twse_missing_date
                else (replace(twse_quote, trading_date=session_date),)
            )
            tpex_quotes = (
                (replace(tpex_quote, code="9999", name="非支援股票", trading_date=session_date),)
                if session_date == tpex_missing_date
                else (replace(tpex_quote, trading_date=session_date),)
            )
            sessions.extend((MarketSession("TWSE", twse_quotes), MarketSession("TPEx", tpex_quotes)))

        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaises(SnapshotValidationError) as context:
                build_snapshot(
                    None,
                    replace(base, sessions=tuple(sessions)),
                    Path(temporary_directory) / "site-data",
                )

        message = str(context.exception)
        self.assertIn(f"TWSE {twse_quote.code}", message)
        self.assertIn(twse_missing_date.isoformat(), message)
        self.assertIn(f"TPEx {tpex_quote.code}", message)
        self.assertIn(tpex_missing_date.isoformat(), message)

    def test_full_market_report_absence_becomes_auditable_no_quote_evidence(self) -> None:
        """完整官方市場表缺少已上市股票時，只建立未報價證據，不得補造 OHLC。"""
        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        supported = base.symbols[0]
        absent_symbol = replace(supported, code="9998", name="測試缺席股票")
        session_date = date(2026, 8, 11)
        sessions = (
            MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
        )

        enriched = market_snapshot._with_full_market_absence_evidence(
            (supported, absent_symbol),
            sessions,
        )

        self.assertEqual(1, len(enriched))
        self.assertEqual(1, len(enriched[0].quotes))
        self.assertEqual(
            (("9998", session_date, "official-no-quote", twse_quote.source_url),),
            tuple(
                (evidence.code, evidence.trading_date, evidence.reason, evidence.source_url)
                for evidence in enriched[0].no_quote_evidence
            ),
        )

    def test_full_market_report_does_not_backfill_absence_before_official_listing(self) -> None:
        """公司主檔上市日前不屬於預期交易日，不能把尚未上市誤標成未報價。"""
        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        future_symbol = replace(base.symbols[0], code="9998", listing_date=date(2026, 8, 12))
        session_date = date(2026, 8, 11)

        enriched = market_snapshot._with_full_market_absence_evidence(
            (base.symbols[0], future_symbol),
            (MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),),
        )

        self.assertEqual((), enriched[0].no_quote_evidence)

    def test_ignores_official_history_before_the_current_market_listing_date(self) -> None:
        """轉板前同代碼歷史不可污染目前市場的上市後價格序列。"""
        base = fixture_build_input()
        listing_date = date(2026, 7, 1)
        build_input = replace(
            base,
            symbols=tuple(
                replace(symbol, listing_date=listing_date)
                if symbol.market == "TWSE"
                else symbol
                for symbol in base.symbols
            ),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            entry = next(entry for entry in manifest.symbols if entry.market == "TWSE")
            document = json.loads((output / entry.data_path).read_text(encoding="utf-8"))

        daily_bars = document["priceModes"]["raw"]["timeframes"]["1d"]["completedBars"]
        self.assertTrue(daily_bars)
        self.assertTrue(all(bar["date"] >= listing_date.isoformat() for bar in daily_bars))
        self.assertEqual(listing_date.isoformat(), document["listingDate"])

    def test_rejects_common_official_market_session_gap_in_a_direct_v3_build(self) -> None:
        """直接建立 v3 時，不可把兩市場共同缺少的官方交易日誤當成不存在。"""

        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        expected_sessions = official_fixture_sessions_ending_at(date(2026, 8, 12), 120, base.calendar)
        missing_date = date(2026, 8, 10)
        sessions: list[MarketSession] = []
        for session_date in expected_sessions:
            if session_date == missing_date:
                continue
            sessions.extend(
                (
                    MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(
            base,
            sessions=tuple(sessions),
            generated_at=datetime(2026, 8, 12, 18, 0, tzinfo=base.calendar.timezone),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(SnapshotValidationError, "官方交易日缺漏"):
                build_snapshot(None, build_input, Path(temporary_directory) / "site-data")

    def test_rejects_v3_previous_snapshot_before_any_v4_incremental_merge(self) -> None:
        """v3 即使可離線驗證也只能辨識，不能和 v4 資料增量混用。"""

        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        previous_dates = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)
        previous_sessions: list[MarketSession] = []
        for session_date in previous_dates:
            previous_sessions.extend(
                (
                    MarketSession("TWSE", (replace(twse_quote, trading_date=session_date),)),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        previous_input = replace(base, sessions=tuple(previous_sessions))
        next_date = date(2026, 8, 12)
        next_input = replace(
            base,
            sessions=(
                MarketSession("TWSE", (replace(twse_quote, trading_date=next_date),)),
                MarketSession("TPEx", (replace(tpex_quote, trading_date=next_date),)),
            ),
            generated_at=datetime(2026, 8, 12, 18, 0, tzinfo=base.calendar.timezone),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            previous = root / "previous"
            next_output = root / "next-output"
            build_snapshot(None, previous_input, previous)
            remove_verified_session_from_v3_snapshot(previous, date(2026, 8, 10))
            self.assertEqual(3, validate_snapshot(previous).snapshot_version)

            with self.assertRaisesRegex(SnapshotValidationError, "v3.*重新 bootstrap"):
                build_snapshot(previous, next_input, next_output)

            self.assertFalse(next_output.exists())

    def test_recognizes_v2_snapshot_but_requires_rebootstrap_before_v4_incremental_update(self) -> None:
        """v2 仍能驗證供舊資料辨識，但不允許將舊日 K 和新 v4 聚合序列混用。"""

        base = fixture_build_input()
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            previous = root / "previous"
            next_output = root / "next-output"
            build_snapshot(None, base, previous)
            downgrade_snapshot_to_v2(previous)

            self.assertEqual(2, validate_snapshot(previous).snapshot_version)
            with self.assertRaisesRegex(SnapshotValidationError, "v2.*重新 bootstrap"):
                build_snapshot(previous, base, next_output)

            self.assertFalse(next_output.exists())

    def test_allows_a_legal_ipo_history_suffix_from_the_official_market_calendar(self) -> None:
        """上市日前的共同市場交易日可缺少該股票，且必須明確揭露短歷史原因。"""

        base = fixture_build_input()
        twse_quote, unsupported_twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        expected_sessions = official_fixture_sessions_ending_at(date(2026, 8, 12), 120, base.calendar)
        listing_date = date(2026, 8, 10)
        sessions: list[MarketSession] = []
        for session_date in expected_sessions:
            twse_quotes = (
                (replace(twse_quote, trading_date=session_date),)
                if session_date >= listing_date
                else (replace(unsupported_twse_quote, trading_date=session_date),)
            )
            sessions.extend(
                (
                    MarketSession("TWSE", twse_quotes),
                    MarketSession("TPEx", (replace(tpex_quote, trading_date=session_date),)),
                )
            )
        build_input = replace(
            base,
            symbols=(replace(base.symbols[0], listing_date=listing_date), base.symbols[1]),
            sessions=tuple(sessions),
            generated_at=datetime(2026, 8, 12, 18, 0, tzinfo=base.calendar.timezone),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, build_input, output)
            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))

        self.assertEqual(tuple(session.isoformat() for session in expected_sessions), manifest.markets["TWSE"].trading_sessions)
        self.assertEqual(3, manifest.symbols[0].available_sessions)
        self.assertEqual("listing-history", manifest.symbols[0].short_history_reason)
        self.assertEqual(["2026-08-10", "2026-08-11", "2026-08-12"], [bar["date"] for bar in raw_completed_bars(stock)])
        self.assertEqual("listing-history", stock["shortHistoryReason"])
        self.assertEqual("2026-08-10", raw_timeframe(stock, "1w")["formingBar"]["periodStart"])
        self.assertEqual("2026-08-14", raw_timeframe(stock, "1w")["formingBar"]["periodEnd"])
        self.assertEqual("2026-08-10", raw_timeframe(stock, "1m")["formingBar"]["periodStart"])
        self.assertEqual("2026-08-31", raw_timeframe(stock, "1m")["formingBar"]["periodEnd"])

    def test_transition_rejects_count_reduction_even_with_retirement_evidence(self) -> None:
        """若退市證據使普通股總數減少超過 1%，仍需人工核准。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            original = build_snapshot(None, fixture_build_input(), output)
            original_manifest = (output / "manifest.json").read_bytes()
            missing_entry = StockIndexEntry(
                code="9999",
                name="測試普通股",
                market="TWSE",
                security_type="common-stock",
                data_path="data/stocks/9999.fixture.json",
                digest="0" * 64,
                size=1,
                first_date="2026-08-11",
                last_date="2026-08-11",
                bar_count=1,
            )
            previous = replace(original, symbols=(*original.symbols, missing_entry))
            build_input = replace(
                fixture_build_input(),
                retired_symbols=(("TWSE", "9999", "https://www.twse.com.tw/zh/announcement.html"),),
            )

            with self.assertRaisesRegex(SnapshotValidationError, "總數降低超過 1%"):
                build_snapshot(previous, build_input, output)

            self.assertEqual(original_manifest, (output / "manifest.json").read_bytes())

    def test_transition_rejects_missing_symbol_without_official_retirement_evidence(self) -> None:
        """若既有普通股無故消失，不能只因當日資料可建置就發布。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            original = build_snapshot(None, fixture_build_input(), output)
            manifest_before = (output / "manifest.json").read_bytes()
            missing_entry = StockIndexEntry(
                code="9999",
                name="測試普通股",
                market="TWSE",
                security_type="common-stock",
                data_path="data/stocks/9999.fixture.json",
                digest="0" * 64,
                size=1,
                first_date="2026-08-11",
                last_date="2026-08-11",
                bar_count=1,
            )

            with self.assertRaisesRegex(SnapshotValidationError, "消失且沒有官方證據"):
                build_snapshot(replace(original, symbols=(*original.symbols, missing_entry)), fixture_build_input(), output)

            self.assertEqual(manifest_before, (output / "manifest.json").read_bytes())

    def test_transition_rejects_prior_date_regression(self) -> None:
        """若新快照把既有股票的截止日倒退，不能覆寫上一成功版本。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            original = build_snapshot(None, fixture_build_input(), output)
            first_entry = replace(original.symbols[0], last_date="2026-08-12")
            previous = replace(original, symbols=(first_entry, *original.symbols[1:]))

            with self.assertRaisesRegex(SnapshotValidationError, "資料截止日倒退"):
                build_snapshot(previous, fixture_build_input(), output)

    def test_update_accepts_a_verified_previous_archive_reference(self) -> None:
        """若 archive 驗證後不能作為 previous，排程無法安全做增量 no-op。"""
        taipei = timezone(timedelta(hours=8), name="Asia/Taipei")
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            original = build_snapshot(None, fixture_build_input(), output)
            with patch(
                "market_snapshot.fetch_trading_calendar",
                return_value=parse_holiday_calendar(load_fixture("holiday-calendar.json")),
            ):
                manifest, updated = update_snapshot(
                    output / "snapshot.tar.gz",
                    output,
                    "fixture",
                    Path(temporary_directory) / "cache",
                    now=datetime(2026, 8, 11, 18, 0, tzinfo=taipei),
                )

            self.assertFalse(updated)
            self.assertEqual(original.snapshot_hash, manifest.snapshot_hash)

    def test_receipt_verified_manifest_mode_cannot_fall_back_to_old_snapshot_bars(self) -> None:
        """快速路徑只可信任 manifest 身分，必須以完整歷史快取重建全部 K 線。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            original = build_snapshot(None, fixture_build_input(), root / "source")

            with (
                patch("market_snapshot.validate_snapshot", side_effect=AssertionError("不得驗舊快照")),
                self.assertRaisesRegex(SnapshotValidationError, "require-history-cache"),
            ):
                update_snapshot(
                    original,
                    root / "next-output",
                    "fixture",
                    root / "cache",
                )

    def test_update_reads_a_standalone_previous_archive_without_parent_sidecar_files(self) -> None:
        """若 --previous archive 仍依賴父目錄裸資料，artifact rollback 會讀到錯誤來源。"""
        base = fixture_build_input()
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source"
            archive_directory = root / "archive-only"
            archive_directory.mkdir()
            build_snapshot(None, base, source)
            standalone_archive = archive_directory / "snapshot.tar.gz"
            standalone_archive.write_bytes((source / "snapshot.tar.gz").read_bytes())
            self.assertFalse((archive_directory / "manifest.json").exists())

            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar):
                manifest, updated = update_snapshot(
                    standalone_archive,
                    root / "next-output",
                    "fixture",
                    root / "cache",
                    now=datetime(2026, 8, 11, 18, 0, tzinfo=base.calendar.timezone),
                )

            self.assertFalse(updated)
            self.assertEqual("fixture", manifest.source_commit)
            self.assertFalse(list(archive_directory.glob(".snapshot.tar.previous-*")))

    def test_update_rejects_a_previous_archive_with_path_traversal_before_writing(self) -> None:
        """若 archive 成員可逃出暫存目錄，--previous 會成為任意檔案寫入途徑。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive = root / "snapshot.tar.gz"
            payload = b"not allowed"
            with tarfile.open(archive, mode="w:gz") as tar:
                entry = tarfile.TarInfo("../escaped.json")
                entry.size = len(payload)
                tar.addfile(entry, BytesIO(payload))

            with self.assertRaisesRegex(SnapshotValidationError, "不安全"):
                update_snapshot(
                    archive,
                    root / "next-output",
                    "fixture",
                    root / "cache",
                    now=datetime(2026, 8, 11, 18, tzinfo=timezone(timedelta(hours=8))),
                )

            self.assertFalse((root / "escaped.json").exists())

    def test_update_cleans_archive_temp_after_a_legal_member_then_path_traversal(self) -> None:
        """先解出合法檔案、後遇到穿越路徑時，暫存目錄不得殘留。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive = root / "snapshot.tar.gz"
            with tarfile.open(archive, mode="w:gz") as tar:
                stock = tarfile.TarInfo("data/stocks/known.json")
                stock_payload = b"{}"
                stock.size = len(stock_payload)
                tar.addfile(stock, BytesIO(stock_payload))
                traversal = tarfile.TarInfo("../escaped.json")
                traversal_payload = b"not allowed"
                traversal.size = len(traversal_payload)
                tar.addfile(traversal, BytesIO(traversal_payload))

            with self.assertRaisesRegex(SnapshotValidationError, "不安全"):
                update_snapshot(
                    archive,
                    root / "next-output",
                    "fixture",
                    root / "cache",
                    now=datetime(2026, 8, 11, 18, tzinfo=timezone(timedelta(hours=8))),
                )

            self.assertFalse((root / "escaped.json").exists())
            self.assertFalse(list(root.glob(".snapshot.tar.previous-*")))

    def test_update_rejects_a_previous_archive_symlink_before_writing(self) -> None:
        """若 archive 可放入 symlink，解壓後的資料讀取仍可能跳出暫存目錄。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive = root / "snapshot.tar.gz"
            with tarfile.open(archive, mode="w:gz") as tar:
                entry = tarfile.TarInfo("data/stocks/link")
                entry.type = tarfile.SYMTYPE
                entry.linkname = "../../escaped.json"
                tar.addfile(entry)

            with self.assertRaisesRegex(SnapshotValidationError, "不安全"):
                update_snapshot(
                    archive,
                    root / "next-output",
                    "fixture",
                    root / "cache",
                    now=datetime(2026, 8, 11, 18, tzinfo=timezone(timedelta(hours=8))),
                )

            self.assertFalse((root / "escaped.json").exists())

    def test_legacy_archive_extraction_streams_without_getmembers(self) -> None:
        """一次性 legacy migration 也不可先把全部 TarInfo 載入記憶體。"""

        base = fixture_build_input()
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source"
            build_snapshot(None, base, source)

            with (
                patch.object(tarfile.TarFile, "getmembers", side_effect=AssertionError("不得全量列舉")),
                patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar),
            ):
                manifest, updated = update_snapshot(
                    source / "snapshot.tar.gz",
                    root / "next-output",
                    "fixture",
                    root / "cache",
                    now=datetime(2026, 8, 11, 18, 0, tzinfo=base.calendar.timezone),
                )

            self.assertFalse(updated)
            self.assertEqual("fixture", manifest.source_commit)

    def test_legacy_archive_rejects_member_count_and_payload_size_before_validation(self) -> None:
        """一次性舊 archive 工具即使未接部署，也必須鎖住 tar bomb 上限。"""

        cases = (
            ("MAX_SNAPSHOT_ARCHIVE_MEMBERS", 1, (b"a", b"b"), "檔案數量"),
            ("MAX_SNAPSHOT_PAYLOAD_BYTES", 1, (b"ab",), "解壓後"),
        )
        for constant, limit, payloads, message in cases:
            with self.subTest(constant=constant), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "snapshot.tar.gz"
                with tarfile.open(archive, mode="w:gz") as destination:
                    for index, payload in enumerate(payloads):
                        member = tarfile.TarInfo(f"file-{index}.json")
                        member.size = len(payload)
                        destination.addfile(member, BytesIO(payload))

                with (
                    patch.object(market_snapshot, constant, limit),
                    self.assertRaisesRegex(SnapshotValidationError, message),
                ):
                    update_snapshot(archive, root / "output", "fixture", root / "cache")

    def test_update_rejects_a_standalone_archive_with_a_bad_embedded_checksum(self) -> None:
        """若只展開 archive 而不驗證內嵌 SHA256SUMS，損毀 artifact 可能成為增量基準。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source"
            archive = root / "snapshot.tar.gz"
            build_snapshot(None, fixture_build_input(), source)
            contents: dict[str, bytes] = {}
            with tarfile.open(source / "snapshot.tar.gz", mode="r:gz") as source_tar:
                for member in source_tar.getmembers():
                    extracted = source_tar.extractfile(member)
                    self.assertIsNotNone(extracted)
                    contents[member.name] = extracted.read() if extracted is not None else b""
            contents["SHA256SUMS"] = b"not-a-valid-checksum\n"
            with tarfile.open(archive, mode="w:gz") as destination_tar:
                for name, payload in sorted(contents.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size = len(payload)
                    entry.mode = 0o644
                    destination_tar.addfile(entry, BytesIO(payload))

            with self.assertRaisesRegex(SnapshotValidationError, "SHA256SUMS"):
                update_snapshot(
                    archive,
                    root / "next-output",
                    "fixture",
                    root / "cache",
                    now=datetime(2026, 8, 11, 18, tzinfo=timezone(timedelta(hours=8))),
                )

            self.assertFalse((root / "next-output").exists())

    def test_rejects_an_incomplete_v1_target_before_a_fresh_v3_replacement(self) -> None:
        """已有 v1 目錄時，不完整直接 bootstrap 不可覆寫既有快照。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            base = fixture_build_input()
            build_snapshot(None, base, output)
            downgrade_snapshot_to_v1(output)
            self.assertEqual(1, validate_snapshot(output).snapshot_version)
            incomplete = replace(base, sessions=base.sessions[2:])

            with self.assertRaisesRegex(SnapshotValidationError, "官方交易日缺漏"):
                build_snapshot(None, incomplete, output)

            self.assertEqual(1, validate_snapshot(output).snapshot_version)

    def test_rejects_a_v1_standalone_archive_without_an_embedded_checksum(self) -> None:
        """v1 archive 缺少內嵌 SHA256SUMS 時，不可作為安全的增量來源。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output = root / "site-data"
            build_snapshot(None, fixture_build_input(), output)
            downgrade_snapshot_to_v1(output)

            with self.assertRaisesRegex(SnapshotValidationError, "舊版.*完整.*目錄"):
                update_snapshot(
                    output / "snapshot.tar.gz",
                    root / "next-output",
                    "fixture",
                    root / "cache",
                )

    def test_rejects_an_incomplete_v1_snapshot_before_a_v3_incremental_upgrade(self) -> None:
        """v1 未能證明完整 120 個官方交易日時，不可用一次增量更新升級成 v3。"""

        base = fixture_build_input()
        next_date = date(2026, 8, 12)
        twse_quote = replace(parse_twse_daily(load_fixture("twse-daily.json"))[0], trading_date=next_date)
        tpex_quote = replace(parse_tpex_daily(load_fixture("tpex-daily.json"))[0], trading_date=next_date)
        next_input = replace(
            base,
            sessions=(
                MarketSession("TWSE", (twse_quote,)),
                MarketSession("TPEx", (tpex_quote,)),
            ),
            generated_at=datetime(2026, 8, 12, 18, 0, tzinfo=base.calendar.timezone),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            previous = root / "previous"
            next_output = root / "next-output"
            build_snapshot(None, base, previous)
            earliest_session = official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar)[0]
            remove_verified_session_from_v3_snapshot(previous, earliest_session)
            downgrade_snapshot_to_v1(previous)
            self.assertEqual(1, validate_snapshot(previous).snapshot_version)

            with self.assertRaisesRegex(SnapshotValidationError, "v1.*重新 bootstrap"):
                build_snapshot(previous, next_input, next_output)

            self.assertFalse(next_output.exists())

    def test_ten_year_history_range_starts_at_the_calendar_boundary_and_only_requests_weekdays(self) -> None:
        """十年基準要涵蓋完整首月，且不把週末誤當成官方盤後端點。"""

        start = market_snapshot._ten_year_history_start(date(2026, 8, 11))
        candidates = market_snapshot._historical_candidate_dates(start, date(2026, 8, 11))

        self.assertEqual(date(2016, 7, 1), start)
        self.assertEqual(start, candidates[0])
        self.assertEqual(date(2026, 8, 11), candidates[-1])
        self.assertTrue(all(candidate.weekday() < 5 for candidate in candidates))
        self.assertGreater(len(candidates), 2_500)

    def test_same_cutoff_rebuild_without_a_complete_history_cache_fails_closed(self) -> None:
        """要求同截止日重封裝時，缺少十年快取必須回受控錯誤，不可落入空索引。"""

        base = fixture_build_input()
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            previous = root / "previous"
            output = root / "output"
            cache = root / "empty-cache"
            build_snapshot(None, base, previous)
            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot._history_cache_is_complete", return_value=False), patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ):
                with self.assertRaisesRegex(SnapshotValidationError, "同截止日.*十年歷史日期快取"):
                    update_snapshot(
                        previous,
                        output,
                        "next-source",
                        cache,
                        now=base.generated_at,
                        rebuild_if_same_cutoff=True,
                    )

        self.assertFalse(output.exists())

    def test_ten_year_snapshot_keeps_an_auditable_action_older_than_the_public_daily_window(self) -> None:
        """公司行動位於已發布月 K 歷史內時，不可被公開 120 根日 K 的範圍排除。"""

        base = ten_year_fixture_build_input()
        action = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            [],
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=[],
            verified_at=date(2026, 8, 11),
        )[0]
        historical_action = replace(
            action,
            action_date=date(2018, 8, 6),
            previous_close=Decimal("100"),
            reference_price=Decimal("95"),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(
                None,
                replace(base, corporate_actions=(historical_action,)),
                output,
            )
            validate_snapshot(output)
            entry = next(item for item in manifest.symbols if item.market == "TWSE")
            stock = json.loads((output / entry.data_path).read_text(encoding="utf-8"))

        self.assertEqual("2018-08-06", stock["corporateActions"][0]["date"])
        self.assertEqual("2018-08-06", stock["adjustmentFactors"][0]["effectiveDate"])
        self.assertGreater(raw_completed_bars(stock)[0]["date"], "2018-08-06")

    def test_ten_year_snapshot_falls_back_to_raw_when_action_history_coverage_is_not_provable(self) -> None:
        """官方 feed 未證明涵蓋完整十年時，不可把沒有列出的舊事件誤當成不存在。"""

        base = replace(ten_year_fixture_build_input(), adjustment_evidence_complete=False)
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, base, output)
            validate_snapshot(output)
            entry = next(item for item in manifest.symbols if item.market == "TWSE")
            stock = json.loads((output / entry.data_path).read_text(encoding="utf-8"))

        self.assertEqual("unavailable", stock["priceModes"]["adjusted"]["status"])
        self.assertEqual(["missing-adjustment-evidence"], stock["priceModes"]["adjusted"]["reasonCodes"])
        self.assertEqual([], stock["adjustmentFactors"])

    def test_bootstrap_fetches_historical_sessions_and_resumes_from_the_daily_cache(self) -> None:
        """若歷史資料重跑又連線，十年初始化就不具市場／日期級續跑性。"""
        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        now = datetime(2026, 8, 11, 18, 0, tzinfo=base.calendar.timezone)

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            cache = root / "cache"

            def twse_history(session_date: date):
                return (replace(twse_quote, trading_date=session_date),)

            def tpex_history(session_date: date):
                return (replace(tpex_quote, trading_date=session_date),)

            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions) as action_fetch, patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ), patch(
                "market_snapshot._historical_candidate_dates",
                return_value=official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar),
            ), patch(
                "market_snapshot.fetch_twse_historical_daily", side_effect=twse_history
            ) as twse_fetch, patch(
                "market_snapshot.fetch_tpex_historical_daily", side_effect=tpex_history
            ) as tpex_fetch, patch("market_snapshot._throttle_official_requests"):
                first = bootstrap_snapshot(root / "first", "fixture", cache, now=now)

            self.assertEqual(120, first.symbols[0].bar_count)
            action_fetch.assert_called_once_with(
                start_date=date(2016, 7, 1),
                end_date=date(2026, 8, 11),
            )
            self.assertEqual(120, twse_fetch.call_count)
            self.assertEqual(120, tpex_fetch.call_count)

            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions), patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ), patch(
                "market_snapshot._historical_candidate_dates",
                return_value=official_fixture_sessions_ending_at(date(2026, 8, 11), 120, base.calendar),
            ), patch(
                "market_snapshot.fetch_twse_historical_daily", side_effect=AssertionError("應使用快取")
            ), patch(
                "market_snapshot.fetch_tpex_historical_daily", side_effect=AssertionError("應使用快取")
            ), patch("market_snapshot._throttle_official_requests") as resumed_throttle:
                resumed = bootstrap_snapshot(root / "resumed", "fixture", cache, now=now)

            self.assertEqual(first.snapshot_hash, resumed.snapshot_hash)
            resumed_throttle.assert_not_called()

    def test_incremental_history_cache_matches_a_full_rebuild_at_the_same_cutoff(self) -> None:
        """每日補齊後的公開結果必須與同一截止日完整重建位元一致。"""

        base = fixture_build_input()
        twse_quote = parse_twse_daily(load_fixture("twse-daily.json"))[0]
        tpex_quote = parse_tpex_daily(load_fixture("tpex-daily.json"))[0]
        first_now = datetime(2026, 8, 11, 18, 0, tzinfo=base.calendar.timezone)
        second_now = datetime(2026, 8, 12, 18, 0, tzinfo=base.calendar.timezone)

        def candidate_dates(_: date, cutoff: date) -> tuple[date, ...]:
            return official_fixture_sessions_ending_at(cutoff, 120, base.calendar)

        def twse_history(session_date: date):
            return (replace(twse_quote, trading_date=session_date),)

        def tpex_history(session_date: date):
            return (replace(tpex_quote, trading_date=session_date),)

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            cache = root / "cache"
            incremental_output = root / "incremental"
            full_output = root / "full"
            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions), patch(
                "market_snapshot.load_suspension_interval_evidence", return_value=()
            ), patch(
                "market_snapshot.fetch_reduction_suspension_intervals", return_value=()
            ), patch("market_snapshot._historical_candidate_dates", side_effect=candidate_dates), patch(
                "market_snapshot.fetch_twse_historical_daily", side_effect=twse_history
            ), patch("market_snapshot.fetch_tpex_historical_daily", side_effect=tpex_history), patch(
                "market_snapshot.fetch_twse_daily",
                side_effect=AssertionError("應使用下一交易日快取"),
            ), patch(
                "market_snapshot.fetch_tpex_daily",
                side_effect=AssertionError("應使用下一交易日快取"),
            ), patch("market_snapshot._throttle_official_requests") as throttle:
                bootstrap_snapshot(incremental_output, "fixture-history", cache, now=first_now)
                market_snapshot._fetch_cached_daily(
                    "TWSE",
                    date(2026, 8, 12),
                    cache,
                    lambda session_date: (replace(twse_quote, trading_date=session_date),),
                )
                market_snapshot._fetch_cached_daily(
                    "TPEx",
                    date(2026, 8, 12),
                    cache,
                    lambda session_date: (replace(tpex_quote, trading_date=session_date),),
                )
                throttle_calls_before_update = throttle.call_count
                incremental, updated = update_snapshot(
                    incremental_output,
                    incremental_output,
                    "fixture-history",
                    cache,
                    now=second_now,
                )
                self.assertEqual(throttle_calls_before_update, throttle.call_count)
                full = bootstrap_snapshot(full_output, "fixture-history", cache, now=second_now)

            self.assertTrue(updated)
            self.assertEqual(full.snapshot_hash, incremental.snapshot_hash)
            self.assertEqual(
                (full_output / "manifest.json").read_bytes(),
                (incremental_output / "manifest.json").read_bytes(),
            )
            self.assertEqual(
                (full_output / "provenance.json").read_bytes(),
                (incremental_output / "provenance.json").read_bytes(),
            )
            self.assertEqual(full.snapshot_hash, validate_snapshot(incremental_output).snapshot_hash)

    def test_daily_cache_rejects_a_downloaded_quote_for_the_wrong_market_or_date(self) -> None:
        """若下載回應日期錯置仍寫入 cache，下一次 bootstrap 會重複使用錯誤基準。"""
        requested_date = date(2026, 8, 11)
        wrong_quote = replace(
            parse_twse_daily(load_fixture("twse-daily.json"))[0],
            trading_date=date(2026, 8, 10),
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            cache = Path(temporary_directory) / "cache"
            with self.assertRaisesRegex(SnapshotValidationError, "市場或交易日不符"):
                market_snapshot._fetch_cached_daily(
                    "TWSE",
                    requested_date,
                    cache,
                    lambda _: (wrong_quote,),
                )

            self.assertFalse((cache / "TWSE" / "2026-08-11.json").exists())

    def test_historical_date_cache_reuses_an_official_closed_market_result(self) -> None:
        """十年建置重跑時，官方已明示休市的市場日期不可再次連線。"""

        requested_date = date(2025, 1, 1)
        with tempfile.TemporaryDirectory() as temporary_directory:
            cache = Path(temporary_directory) / "cache"
            closed = OfficialMarketClosedError(
                "TWSE",
                requested_date,
                "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
            )
            self.assertIsNone(
                market_snapshot._fetch_cached_historical_daily(
                    "TWSE",
                    requested_date,
                    cache,
                    lambda _: (_ for _ in ()).throw(closed),
                )
            )
            cache_path = cache / "TWSE" / "2025-01-01.json"
            self.assertEqual(
                {
                    "date": "2025-01-01",
                    "market": "TWSE",
                    "sourceUrl": "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
                    "status": "official-market-closed",
                },
                json.loads(cache_path.read_text(encoding="utf-8")),
            )
            self.assertIsNone(
                market_snapshot._fetch_cached_historical_daily(
                    "TWSE",
                    requested_date,
                    cache,
                    lambda _: (_ for _ in ()).throw(AssertionError("應使用日期快取")),
                )
            )

    def test_validate_rejects_a_stock_file_digest_tamper_and_pack_recreates_a_verifiable_archive(self) -> None:
        """若 stock JSON 或 archive 被竄改卻仍通過，部署來源完整性會失效。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, fixture_build_input(), output)
            pack_snapshot(output)
            self.assertEqual(manifest.snapshot_hash, validate_snapshot(output).snapshot_hash)

            stock_path = output / manifest.symbols[0].data_path
            stock_path.write_text('{"tampered":true}\n', encoding="utf-8")
            with self.assertRaisesRegex(SnapshotValidationError, "雜湊"):
                validate_snapshot(output)

    def test_validate_rejects_a_shortened_week_even_when_ohlcv_is_recalculated(self) -> None:
        """週 K 不可縮短官方自然週後再用局部日 K 重算，否則驗證會接受不完整期間。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, fixture_build_input(), output)
            manifest_path = output / "manifest.json"
            manifest_document = json.loads(manifest_path.read_text(encoding="utf-8"))
            stock_path = output / manifest.symbols[0].data_path
            stock = json.loads(stock_path.read_text(encoding="utf-8"))
            daily_bars = raw_completed_bars(stock)
            weekly_bars = raw_completed_bars(stock, "1w")
            target = next(
                bar
                for bar in weekly_bars
                if len([
                    daily
                    for daily in daily_bars
                    if bar["periodStart"] <= daily["date"] <= bar["periodEnd"]
                ]) >= 2
            )
            original_constituents = [
                daily
                for daily in daily_bars
                if target["periodStart"] <= daily["date"] <= target["periodEnd"]
            ]
            shortened = original_constituents[1:]
            target["periodStart"] = shortened[0]["date"]
            target["open"] = shortened[0]["open"]
            target["high"] = max(bar["high"] for bar in shortened)
            target["low"] = min(bar["low"] for bar in shortened)
            target["close"] = shortened[-1]["close"]
            target["volumeShares"] = sum(bar["volumeShares"] for bar in shortened)
            if all("transactionCount" in bar for bar in shortened):
                target["transactionCount"] = sum(bar["transactionCount"] for bar in shortened)

            rewrite_snapshot_stock(output, manifest_document, stock_path, stock)

            with self.assertRaisesRegex(SnapshotValidationError, "自然週期間邊界"):
                validate_snapshot(output)

    def test_validate_accepts_an_older_week_outside_the_retained_daily_window(self) -> None:
        """週 K 可保存比 120 根日 K 更早的期間，讓後續十年基準能各自保留 120 根。"""

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, fixture_build_input(), output)
            manifest_path = output / "manifest.json"
            manifest_document = json.loads(manifest_path.read_text(encoding="utf-8"))
            stock_path = output / manifest.symbols[0].data_path
            stock = json.loads(stock_path.read_text(encoding="utf-8"))
            weekly_bars = raw_completed_bars(stock, "1w")
            older_week = {
                **weekly_bars[0],
                "date": "2026-01-09",
                "periodStart": "2026-01-05",
                "periodEnd": "2026-01-09",
                "completed": True,
                "evidenceStatus": "complete",
                "missingSessionDates": [],
            }
            weekly_bars.insert(0, older_week)
            rewrite_snapshot_stock(output, manifest_document, stock_path, stock)

            validated = validate_snapshot(output)

            self.assertEqual(4, validated.snapshot_version)

    def test_pack_keeps_the_previous_archive_and_checksums_when_staging_fails(self) -> None:
        """若 pack 在寫完 archive 後失敗，上一成功 artifact 的兩個封裝檔必須逐位元保留。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, fixture_build_input(), output)
            archive_before = (output / "snapshot.tar.gz").read_bytes()
            sums_before = (output / "SHA256SUMS").read_bytes()
            original_write_sums = market_snapshot._write_sha256sums

            def fail_outer_checksum(root: Path, *, include_archive: bool = True) -> None:
                if include_archive:
                    raise OSError("injected checksum write failure")
                original_write_sums(root, include_archive=False)

            with patch("market_snapshot._write_sha256sums", side_effect=fail_outer_checksum):
                with self.assertRaisesRegex(OSError, "injected checksum"):
                    pack_snapshot(output)

            self.assertEqual(archive_before, (output / "snapshot.tar.gz").read_bytes())
            self.assertEqual(sums_before, (output / "SHA256SUMS").read_bytes())
            self.assertFalse(list(Path(temporary_directory).glob(".site-data.pack-*")))

    def test_pack_writes_portable_read_only_tar_member_modes(self) -> None:
        """若 archive 保留本機預設權限，Windows 與 Unix 的解壓結果會不一致。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, fixture_build_input(), output)

            with tarfile.open(output / "snapshot.tar.gz", mode="r:gz") as tar:
                self.assertTrue(tar.getmembers())
                self.assertTrue(all(member.mode == 0o644 for member in tar.getmembers()))

    def test_validate_rejects_a_manifest_hash_or_stock_source_provenance_tamper(self) -> None:
        """若攻擊者重算檔案 digest，manifest 雜湊與官方來源仍必須分別守住。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            manifest = build_snapshot(None, fixture_build_input(), output)
            manifest_path = output / "manifest.json"
            manifest_document = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest_document["snapshotHash"] = "0" * 64
            manifest_path.write_bytes(market_snapshot._canonical_json_bytes(manifest_document))

            with self.assertRaisesRegex(SnapshotValidationError, "snapshotHash"):
                validate_snapshot(output)

            manifest_document = json.loads(manifest_path.read_text(encoding="utf-8"))
            stock_path = output / manifest.symbols[0].data_path
            stock = json.loads(stock_path.read_text(encoding="utf-8"))
            stock["sourceUrls"] = ["https://example.com/not-official"]
            stock_payload = market_snapshot._canonical_json_bytes(stock)
            stock_path.write_bytes(stock_payload)
            manifest_document["symbols"][0]["digest"] = market_snapshot._digest(stock_payload)
            manifest_document["symbols"][0]["size"] = len(stock_payload)
            without_hash = dict(manifest_document)
            without_hash.pop("snapshotHash")
            manifest_document["snapshotHash"] = market_snapshot._digest(
                market_snapshot._canonical_json_bytes(without_hash)
            )
            manifest_path.write_bytes(market_snapshot._canonical_json_bytes(manifest_document))
            market_snapshot._write_sha256sums(output)

            with self.assertRaisesRegex(SnapshotValidationError, "官方來源"):
                validate_snapshot(output)

    def test_validate_rejects_a_tampered_archive_even_when_its_checksum_is_rewritten(self) -> None:
        """若只驗證 archive 檔案雜湊，重寫 SHA256SUMS 後仍可能帶入錯誤快照內容。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, fixture_build_input(), output)
            (output / "snapshot.tar.gz").write_bytes(b"not a gzip archive")
            market_snapshot._write_sha256sums(output)

            with self.assertRaisesRegex(SnapshotValidationError, "archive"):
                validate_snapshot(output)

    def test_validate_rejects_provenance_that_does_not_match_the_manifest(self) -> None:
        """若 provenance 可與 manifest 分離，部署產物就失去來源提交與截止日的對應關係。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "site-data"
            build_snapshot(None, fixture_build_input(), output)
            provenance_path = output / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["sourceCommit"] = "different-source-commit"
            provenance_path.write_bytes(market_snapshot._canonical_json_bytes(provenance))
            market_snapshot._write_deterministic_tar(output)
            market_snapshot._write_sha256sums(output)

            with self.assertRaisesRegex(SnapshotValidationError, "provenance"):
                validate_snapshot(output)


if __name__ == "__main__":
    unittest.main()
