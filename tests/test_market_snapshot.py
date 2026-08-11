from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
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
    parse_corporate_actions,
    parse_holiday_calendar,
    parse_supported_symbols,
    parse_tpex_daily,
    parse_twse_daily,
)


FIXTURES = Path(__file__).parent / "fixtures" / "market_snapshot"


def load_fixture(name: str) -> object:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def fixture_build_input() -> SnapshotBuildInput:
    taipei = timezone(timedelta(hours=8), name="Asia/Taipei")
    return SnapshotBuildInput(
        source_commit="fixture",
        generated_at=datetime(2026, 8, 11, 18, 0, tzinfo=taipei),
        symbols=parse_supported_symbols(
            load_fixture("twse-companies.json"),
            load_fixture("tpex-companies.json"),
        ),
        sessions=(
            MarketSession("TWSE", parse_twse_daily(load_fixture("twse-daily.json"))),
            MarketSession("TPEx", parse_tpex_daily(load_fixture("tpex-daily.json"))),
        ),
        corporate_actions=parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            verified_at=date(2026, 8, 11),
        ),
        calendar=parse_holiday_calendar(load_fixture("holiday-calendar.json")),
    )


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
            self.assertEqual(1, document["snapshotVersion"])
            self.assertEqual({"TWSE", "TPEx"}, set(document["markets"]))
            self.assertEqual(["2330", "6488"], [symbol["code"] for symbol in document["symbols"]])
            self.assertTrue(all(symbol["securityType"] == "common-stock" for symbol in document["symbols"]))

            twse_entry = document["symbols"][0]
            self.assertRegex(twse_entry["dataPath"], r"^data/stocks/2330\.[0-9a-f]{12}\.json$")
            self.assertEqual(64, len(twse_entry["digest"]))
            self.assertGreater(twse_entry["size"], 0)
            stock = json.loads((output / twse_entry["dataPath"]).read_text(encoding="utf-8"))
            self.assertEqual("raw", stock["priceMode"])
            self.assertEqual("TWD", stock["priceUnit"])
            self.assertEqual("2026-08-11", stock["bars"][0]["date"])
            self.assertEqual(5, stock["bars"][0]["comparisonUnit"])
            self.assertEqual("cash-dividend", stock["corporateActions"][0]["type"])
            self.assertEqual("fresh", document["markets"]["TWSE"]["freshness"])
            self.assertTrue((output / "snapshot.tar.gz").is_file())
            self.assertTrue((output / "SHA256SUMS").is_file())

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
        initial = replace(
            fixture_build_input(),
            sessions=(
                MarketSession("TWSE", (original_twse,)),
                MarketSession("TPEx", parse_tpex_daily(load_fixture("tpex-daily.json"))[:1]),
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
            ), patch("market_snapshot.fetch_corporate_actions", return_value=actions), patch(
                "market_snapshot.fetch_twse_daily", return_value=(twse_new,)
            ), patch("market_snapshot.fetch_tpex_daily", return_value=(tpex_new,)):
                manifest, updated = update_snapshot(
                    output,
                    output,
                    "fixture-next",
                    Path(temporary_directory) / "cache",
                    now=datetime(2026, 8, 12, 18, 0, tzinfo=taipei),
                )

            stock = json.loads((output / manifest.symbols[0].data_path).read_text(encoding="utf-8"))
            self.assertTrue(updated)
            self.assertEqual(["2026-08-11", "2026-08-12"], [bar["date"] for bar in stock["bars"]])
            self.assertTrue(all(url.startswith("https://") for url in stock["sourceUrls"]))
            self.assertIn("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX", stock["sourceUrls"])

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
        first_date = date(2026, 4, 13)
        sessions: list[MarketSession] = []
        for day_offset in range(121):
            session_date = first_date + timedelta(days=day_offset)
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

        self.assertEqual(120, len(stock["bars"]))
        self.assertEqual("2026-04-14", stock["bars"][0]["date"])
        self.assertEqual("2026-08-11", stock["bars"][-1]["date"])

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

    def test_bootstrap_fetches_120_sessions_and_resumes_from_the_daily_cache(self) -> None:
        """若基準資料不滿 120 日或重跑又連線，歷史初始化會不完整且不具續跑性。"""
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
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions), patch(
                "market_snapshot.fetch_twse_historical_daily", side_effect=twse_history
            ) as twse_fetch, patch(
                "market_snapshot.fetch_tpex_historical_daily", side_effect=tpex_history
            ) as tpex_fetch, patch("market_snapshot._throttle_official_requests"):
                first = bootstrap_snapshot(root / "first", "fixture", cache, now=now)

            self.assertEqual(120, first.symbols[0].bar_count)
            self.assertEqual(120, twse_fetch.call_count)
            self.assertEqual(120, tpex_fetch.call_count)

            with patch("market_snapshot.fetch_trading_calendar", return_value=base.calendar), patch(
                "market_snapshot.fetch_supported_symbols", return_value=base.symbols
            ), patch("market_snapshot.fetch_corporate_actions", return_value=base.corporate_actions), patch(
                "market_snapshot.fetch_twse_historical_daily", side_effect=AssertionError("應使用快取")
            ), patch(
                "market_snapshot.fetch_tpex_historical_daily", side_effect=AssertionError("應使用快取")
            ), patch("market_snapshot._throttle_official_requests"):
                resumed = bootstrap_snapshot(root / "resumed", "fixture", cache, now=now)

            self.assertEqual(first.snapshot_hash, resumed.snapshot_hash)

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
