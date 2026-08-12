from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import json
from pathlib import Path
import ssl
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import market_sources

from market_sources import (
    EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    OfficialMarketClosedError,
    SUSPENSION_EVIDENCE_SCHEMA_VERSION,
    apply_emergency_market_closures,
    comparison_unit_for_prices,
    compute_freshness,
    expected_cutoff_date,
    fetch_tpex_historical_daily,
    fetch_twse_historical_daily,
    fetch_twse_daily,
    parse_corporate_actions,
    parse_emergency_market_closure_evidence,
    parse_holiday_calendar,
    parse_reduction_suspension_intervals,
    parse_suspension_interval_evidence,
    parse_supported_symbols,
    parse_tpex_historical_daily,
    parse_tpex_daily,
    parse_twse_historical_daily,
    parse_twse_daily,
)


FIXTURES = Path(__file__).parent / "fixtures" / "market_snapshot"


def load_fixture(name: str) -> object:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200) -> None:
        self.status = status
        self._body = body
        self.closed = False

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exception_type: object, exception: object, traceback: object) -> None:
        self.closed = True
        return None

    def read(self) -> bytes:
        return self._body


class OfficialDailyParserTests(unittest.TestCase):
    def test_twse_and_tpex_daily_rows_normalize_to_share_volume(self) -> None:
        """移除代碼或錯誤換算成交量時，這份官方形狀樣本必須失敗。"""
        twse = parse_twse_daily(load_fixture("twse-daily.json"))
        tpex = parse_tpex_daily(load_fixture("tpex-daily.json"))

        self.assertEqual("2330", twse[0].code)
        self.assertEqual("6488", tpex[0].code)
        self.assertEqual(21_345_678, twse[0].volume_shares)
        self.assertEqual(9_876_000, tpex[0].volume_shares)

    def test_daily_parser_keeps_auditable_evidence_for_an_official_no_quote_row(self) -> None:
        """官方未報價列必須保留可稽核證據，而非靜默遺失或補造 OHLC。"""
        payload = load_fixture("tpex-daily.json")
        assert isinstance(payload, list)
        unavailable = dict(payload[0])
        unavailable.update(
            {
                "SecuritiesCompanyCode": "9999",
                "CompanyName": "暫無報價",
                "Open": "---",
                "High": "---",
                "Low": "---",
                "Close": "---",
            }
        )

        response = parse_tpex_daily([*payload, unavailable])

        self.assertEqual(("6488", "006201"), tuple(quote.code for quote in response))
        self.assertEqual(
            (
                (
                    "TPEx",
                    "9999",
                    date(2026, 8, 11),
                    "official-no-quote",
                    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
                ),
            ),
            tuple(
                (
                    evidence.market,
                    evidence.code,
                    evidence.trading_date,
                    evidence.reason,
                    evidence.source_url,
                )
                for evidence in response.no_quote_evidence
            ),
        )


class OfficialCompanyMasterTests(unittest.TestCase):
    def test_company_masters_define_the_common_stock_support_index(self) -> None:
        """若改以代碼外觀猜測，或把 ETF 併入索引，這個交集契約必須失敗。"""
        symbols = parse_supported_symbols(
            load_fixture("twse-companies.json"),
            load_fixture("tpex-companies.json"),
        )

        self.assertEqual(
            (("TWSE", "2330", "台積電"), ("TPEx", "6488", "環球晶")),
            tuple((symbol.market, symbol.code, symbol.name) for symbol in symbols),
        )
        self.assertEqual(
            (date(1994, 9, 5), date(2015, 10, 28)),
            tuple(symbol.listing_date for symbol in symbols),
        )
        self.assertTrue(all(symbol.security_type == "common-stock" for symbol in symbols))


class OfficialCorporateActionTests(unittest.TestCase):
    def test_fetches_the_twse_calculation_result_for_an_explicit_date_range(self) -> None:
        """TWSE 官網新端點必須帶 startDate/endDate，不能誤用只回當期資料的舊路徑。"""
        payload_by_endpoint = {
            "twse-actions": load_fixture("twse-actions.json"),
            "tpex-actions": load_fixture("tpex-actions.json"),
            "twse-action-calculations": load_fixture("twse-adjustment-results.json"),
            "tpex-action-calculations": load_fixture("tpex-adjustment-results.json"),
        }
        calls: list[tuple[str, dict[str, str] | None]] = []

        def fake_fetch(endpoint: str, parameters: dict[str, str] | None = None) -> object:
            calls.append((endpoint, parameters))
            return payload_by_endpoint[endpoint]

        with patch("market_sources._fetch_official_json", side_effect=fake_fetch):
            actions = market_sources.fetch_corporate_actions(
                start_date=date(2026, 8, 1),
                end_date=date(2026, 8, 11),
            )

        self.assertEqual(2, len(actions))
        self.assertIn(
            (
                "twse-action-calculations",
                {"response": "json", "startDate": "20260801", "endDate": "20260811"},
            ),
            calls,
        )

    def test_keeps_a_conflicting_twse_calculation_key_unavailable_after_later_duplicates(self) -> None:
        """同日同股官方價格一旦互相矛盾，後續重複列也不可讓該 key 恢復可用。"""
        calculation = load_fixture("twse-adjustment-results.json")
        self.assertIsInstance(calculation, dict)
        conflicting = dict(calculation)
        original = list(conflicting["data"][0])
        different = list(original)
        different[3] = "101.00"
        conflicting["data"] = [original, different, original]

        actions = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            [],
            twse_calculation_payload=conflicting,
            tpex_calculation_payload=[],
            verified_at=date(2026, 8, 11),
        )

        self.assertEqual(1, len(actions))
        self.assertIsNone(actions[0].previous_close)
        self.assertIsNone(actions[0].reference_price)

    def test_joins_official_calculation_results_to_the_action_evidence(self) -> None:
        """計算結果表的前收與參考價必須保留，讓快照可重算而非推測跳空。"""
        actions = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            twse_calculation_payload=load_fixture("twse-adjustment-results.json"),
            tpex_calculation_payload=load_fixture("tpex-adjustment-results.json"),
            verified_at=date(2026, 8, 11),
        )

        self.assertEqual(
            (
                ("TWSE", "2330", Decimal("100.00"), Decimal("95.00")),
                ("TPEx", "6488", Decimal("100.00"), Decimal("97.00")),
            ),
            tuple(
                (action.market, action.code, action.previous_close, action.reference_price)
                for action in actions
            ),
        )
        self.assertEqual(
            (
                "https://www.twse.com.tw/rwd/zh/exRight/TWT49U",
                "https://www.tpex.org.tw/openapi/v1/tpex_exright_daily",
            ),
            tuple(action.calculation_source_url for action in actions),
        )

    def test_action_rows_keep_date_type_and_official_provenance(self) -> None:
        """若公司行動遺失官方來源或被當成不影響連續性，快照驗證必須失敗。"""
        actions = parse_corporate_actions(
            load_fixture("twse-actions.json"),
            load_fixture("tpex-actions.json"),
            verified_at=date(2026, 8, 11),
        )

        self.assertEqual(
            (("TWSE", "2330", date(2026, 8, 11), "cash-dividend"), ("TPEx", "6488", date(2026, 8, 5), "cash-dividend")),
            tuple((action.market, action.code, action.action_date, action.action_type) for action in actions),
        )
        self.assertTrue(all(action.affects_price_continuity for action in actions))
        self.assertTrue(all(action.source_url.startswith("https://") for action in actions))

    def test_keeps_an_official_unannounced_amount_as_an_action_without_fabricating_a_cash_value(self) -> None:
        """TPEx 以「尚未公告」表示數值未定時，仍保留事件而不把文字當成金額。"""
        payload = load_fixture("tpex-actions.json")
        assert isinstance(payload, list)
        unannounced = dict(payload[0])
        unannounced.update({"SecuritiesCompanyCode": "9999", "CashDividend": "尚未公告"})

        actions = parse_corporate_actions([], [unannounced], verified_at=date(2026, 8, 11))

        self.assertEqual(
            (("TPEx", "9999", date(2026, 8, 5), "other"),),
            tuple((action.market, action.code, action.action_date, action.action_type) for action in actions),
        )


class OfficialHistoricalParserTests(unittest.TestCase):
    def test_historical_tables_normalize_the_same_daily_contract(self) -> None:
        """若選錯歷史表格或欄位順序，兩市場的行情日期與成交量都會失敗。"""
        twse = parse_twse_historical_daily(load_fixture("twse-historical-daily.json"))
        tpex = parse_tpex_historical_daily(load_fixture("tpex-historical-daily.json"))

        self.assertEqual(date(2026, 8, 11), twse[0].trading_date)
        self.assertEqual(date(2026, 8, 11), tpex[0].trading_date)
        self.assertEqual(21_345_678, twse[0].volume_shares)
        self.assertEqual(9_876_000, tpex[0].volume_shares)

    def test_historical_parser_keeps_four_dash_official_no_quote_evidence(self) -> None:
        """TPEx 歷史表以四個連字號表示未報價時，不能把它當成格式錯誤或假 OHLC。"""
        payload = load_fixture("tpex-historical-daily.json")
        assert isinstance(payload, dict)
        table = payload["tables"][0]
        assert isinstance(table, dict)
        rows = table["data"]
        assert isinstance(rows, list)
        rows.append(["9999", "暫無報價", "----", "0", "----", "----", "----", "0", "0", "0"])

        response = parse_tpex_historical_daily(payload)

        self.assertEqual(("6488",), tuple(quote.code for quote in response.quotes))
        self.assertEqual(
            (("TPEx", "9999", date(2026, 8, 11), "official-no-quote"),),
            tuple(
                (evidence.market, evidence.code, evidence.trading_date, evidence.reason)
                for evidence in response.no_quote_evidence
            ),
        )


class ComparisonUnitTests(unittest.TestCase):
    def test_comparison_unit_uses_the_largest_source_precision_or_tick_size(self) -> None:
        """若千元價位仍使用 0.01 容忍值，K 線幾何判讀會誤判。"""
        unit = comparison_unit_for_prices(
            (Decimal("1000.00"), Decimal("1015.00"), Decimal("995.00"), Decimal("1010.00")),
            Decimal("0.01"),
        )

        self.assertEqual(Decimal("5"), unit)


class OfficialFetchBoundaryTests(unittest.TestCase):
    def test_current_daily_fetch_uses_the_fixed_twse_endpoint_and_date_contract(self) -> None:
        """若改成任意網址或接受錯誤資料日期，發布前的來源防線必須失敗。"""
        body = json.dumps(load_fixture("twse-daily.json"), ensure_ascii=False).encode("utf-8")

        with patch("market_sources._urlopen_official_market_source", return_value=FakeResponse(body)) as open_source:
            quotes = fetch_twse_daily(date(2026, 8, 11))

        request = open_source.call_args.args[0]
        self.assertEqual("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", request.full_url)
        self.assertEqual("2330", quotes[0].code)

    def test_tpex_historical_fetch_uses_roc_date_and_ew_market_scope(self) -> None:
        """若拿掉 EW 範圍，歷史資料會混入非普通股而破壞支援索引。"""
        body = json.dumps(load_fixture("tpex-historical-daily.json"), ensure_ascii=False).encode("utf-8")

        with patch("market_sources._urlopen_official_market_source", return_value=FakeResponse(body)) as open_source:
            quotes = fetch_tpex_historical_daily(date(2026, 8, 11))

        query = parse_qs(urlparse(open_source.call_args.args[0].full_url).query)
        self.assertEqual(["115/08/11"], query["date"])
        self.assertEqual(["EW"], query["type"])
        self.assertEqual("6488", quotes[0].code)

    def test_historical_fetch_marks_explicit_official_no_data_as_a_closed_market_date(self) -> None:
        """十年基準遇到官方明示休市日要快取可重用狀態，不能重試成來源故障。"""

        payload = {"stat": "很抱歉，沒有符合條件的資料!"}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        with patch("market_sources._urlopen_official_market_source", return_value=FakeResponse(body)):
            with self.assertRaises(OfficialMarketClosedError) as raised:
                fetch_twse_historical_daily(date(2025, 1, 1))

        self.assertEqual(("TWSE", date(2025, 1, 1)), (raised.exception.market, raised.exception.trading_date))

    def test_tpex_historical_fetch_marks_a_matching_zero_count_table_as_a_closed_market_date(self) -> None:
        """TPEx 休市日會回傳日期與欄位完整的零筆表格，不能誤判為來源故障。"""

        payload = {
            "stat": "ok",
            "date": "20160708",
            "tables": [
                {
                    "date": "105/07/08",
                    "totalCount": 0,
                    "fields": ["代號", "名稱", "收盤", "開盤", "最高", "最低", "成交股數", "成交筆數"],
                    "data": [],
                }
            ],
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        with patch("market_sources._urlopen_official_market_source", return_value=FakeResponse(body)):
            with self.assertRaises(OfficialMarketClosedError) as raised:
                fetch_tpex_historical_daily(date(2016, 7, 8))

        self.assertEqual(("TPEx", date(2016, 7, 8)), (raised.exception.market, raised.exception.trading_date))

    def test_tls_compatibility_retry_only_allows_the_exact_official_ski_error(self) -> None:
        """若 TLS fallback 擴大到其他錯誤，CA 或主機驗證可能被意外弱化。"""
        certificate_error = ssl.SSLCertVerificationError(1, "Missing Subject Key Identifier")
        certificate_error.verify_message = "Missing Subject Key Identifier"
        calls: list[object] = []

        def open_source(request: object, timeout: object, context: object = None) -> FakeResponse:
            calls.append(context)
            if len(calls) == 1:
                raise URLError(certificate_error)
            return FakeResponse(b"[]")

        request = Request("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL")
        with patch("market_sources._urlopen_official_market_source", side_effect=open_source):
            with market_sources._open_official_market_source(request) as response:
                self.assertEqual(b"[]", response.read())

        self.assertIsNone(calls[0])
        retry_context = calls[1]
        self.assertIsInstance(retry_context, ssl.SSLContext)
        self.assertTrue(retry_context.check_hostname)
        self.assertEqual(ssl.CERT_REQUIRED, retry_context.verify_mode)
        self.assertFalse(retry_context.verify_flags & ssl.VERIFY_X509_STRICT)

    def test_official_fetch_retries_transient_http_errors_with_a_finite_backoff(self) -> None:
        """官方站短暫回傳 5xx 時可重試，但不能放寬驗證或無限等待。"""
        transient_error = HTTPError(
            "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
            520,
            "transient",
            hdrs=None,
            fp=None,
        )

        with (
            patch(
                "market_sources._open_official_market_source",
                side_effect=[transient_error, transient_error, FakeResponse(b"[]")],
            ) as open_source,
            patch("market_sources.sleep") as wait,
        ):
            payload = market_sources._fetch_official_json("twse-daily")

        self.assertEqual([], payload)
        self.assertEqual(3, open_source.call_count)
        self.assertEqual([unittest.mock.call(1), unittest.mock.call(2)], wait.call_args_list)

    def test_official_fetch_treats_rate_limits_and_the_full_5xx_range_as_transient(self) -> None:
        for status in (429, 500, 521, 599):
            with self.subTest(status=status):
                self.assertTrue(market_sources._is_transient_http_status(status))
        for status in (400, 404, 600, True, None):
            with self.subTest(status=status):
                self.assertFalse(market_sources._is_transient_http_status(status))

    def test_official_fetch_stops_after_three_persistent_transient_errors(self) -> None:
        errors = [
            HTTPError(
                "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
                521,
                "transient",
                hdrs=None,
                fp=None,
            )
            for _ in range(3)
        ]
        close_spies = []
        for error in errors:
            close_spy = unittest.mock.Mock(wraps=error.close)
            error.close = close_spy
            close_spies.append(close_spy)

        with (
            patch("market_sources._open_official_market_source", side_effect=errors) as open_source,
            patch("market_sources.sleep") as wait,
            self.assertRaisesRegex(market_sources.OfficialSourceFetchError, "HTTP 521"),
        ):
            market_sources._fetch_official_json("twse-daily")

        self.assertEqual(3, open_source.call_count)
        self.assertEqual([unittest.mock.call(1), unittest.mock.call(2)], wait.call_args_list)
        for close_spy in close_spies:
            close_spy.assert_called_once_with()

    def test_official_fetch_closes_each_http_error_before_retrying(self) -> None:
        errors = [
            HTTPError(
                "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
                status,
                "transient",
                hdrs=None,
                fp=None,
            )
            for status in (429, 521)
        ]
        for error in errors:
            error.close = unittest.mock.Mock(wraps=error.close)

        with (
            patch(
                "market_sources._open_official_market_source",
                side_effect=[*errors, FakeResponse(b"[]")],
            ),
            patch("market_sources.sleep"),
        ):
            market_sources._fetch_official_json("twse-daily")

        for error in errors:
            error.close.assert_called_once_with()

    def test_official_fetch_does_not_retry_invalid_json(self) -> None:
        for body in (b"not-json", b"\xff"):
            with self.subTest(body=body):
                response = FakeResponse(body)
                with (
                    patch(
                        "market_sources._open_official_market_source",
                        return_value=response,
                    ) as open_source,
                    patch("market_sources.sleep") as wait,
                    self.assertRaisesRegex(market_sources.OfficialSourceFetchError, "UTF-8 JSON"),
                ):
                    market_sources._fetch_official_json("twse-daily")

                self.assertEqual(1, open_source.call_count)
                self.assertTrue(response.closed)
                wait.assert_not_called()

    def test_official_fetch_does_not_retry_a_permanent_http_error(self) -> None:
        """4xx 代表請求或契約錯誤，必須立即 fail closed。"""
        permanent_error = HTTPError(
            "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
            404,
            "permanent",
            hdrs=None,
            fp=None,
        )

        with (
            patch("market_sources._open_official_market_source", side_effect=permanent_error) as open_source,
            patch("market_sources.sleep") as wait,
            self.assertRaisesRegex(market_sources.MarketSourceError, "HTTP 404"),
        ):
            market_sources._fetch_official_json("twse-daily")

        self.assertEqual(1, open_source.call_count)
        wait.assert_not_called()

    def test_endpoint_guard_rejects_cross_host_and_userinfo_urls(self) -> None:
        """若任意 URL 可進入 opener，官方 redirect 邊界就能被繞過。"""
        for url in (
            "https://example.com/v1/exchangeReport/STOCK_DAY_ALL",
            "http://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
            "https://openapi.twse.com.tw:444/v1/exchangeReport/STOCK_DAY_ALL",
            "https://openapi.twse.com.tw@example.com/v1/exchangeReport/STOCK_DAY_ALL",
        ):
            with self.subTest(url=url):
                self.assertFalse(market_sources._is_known_official_request(url))


class OfficialCalendarTests(unittest.TestCase):
    def test_calendar_does_not_treat_trading_day_markers_as_market_holidays(self) -> None:
        """官方行事曆也列出春節前後交易日，不能因端點名稱而一律當成休市。"""

        calendar = parse_holiday_calendar(
            [
                {
                    "Date": "1150211",
                    "Name": "農曆春節前最後交易日",
                    "Description": "農曆春節前最後交易。",
                    "Weekday": "三",
                },
                {
                    "Date": "1150212",
                    "Name": "市場無交易，僅辦理結算交割作業",
                    "Description": "",
                    "Weekday": "四",
                },
                {
                    "Date": "1150223",
                    "Name": "農曆春節後開始交易日",
                    "Description": "農曆春節後開始交易。",
                    "Weekday": "一",
                },
            ]
        )

        self.assertNotIn(date(2026, 2, 11), calendar.holiday_dates)
        self.assertIn(date(2026, 2, 12), calendar.holiday_dates)
        self.assertNotIn(date(2026, 2, 23), calendar.holiday_dates)

    def test_calendar_rejects_a_payload_with_only_trading_day_markers(self) -> None:
        """只有開始／最後交易日不足以證明全年休市範圍，必須 fail closed。"""

        with self.assertRaisesRegex(ValueError, "不可缺少休市日"):
            parse_holiday_calendar(
                [
                    {
                        "Date": "1150102",
                        "Name": "國曆新年開始交易日",
                        "Description": "國曆新年開始交易。",
                        "Weekday": "五",
                    }
                ]
            )

    def test_calendar_derives_expected_cutoff_and_freshness_in_taipei_time(self) -> None:
        """若 17:30 前把當日當作已完成資料，或漏算休市日，新鮮度必須失敗。"""
        calendar = parse_holiday_calendar(load_fixture("holiday-calendar.json"))
        before_close = datetime(2026, 8, 11, 16, 0, tzinfo=calendar.timezone)
        after_close = datetime(2026, 8, 11, 18, 0, tzinfo=calendar.timezone)

        self.assertEqual(date(2026, 8, 10), expected_cutoff_date(calendar, before_close))
        self.assertEqual(date(2026, 8, 11), expected_cutoff_date(calendar, after_close))
        self.assertEqual("one-session-behind", compute_freshness(calendar, date(2026, 8, 10), after_close))
        self.assertEqual("stale", compute_freshness(calendar, date(2026, 8, 7), after_close))

    def test_emergency_market_closure_evidence_excludes_a_verified_closure_from_expected_sessions(self) -> None:
        calendar = parse_holiday_calendar(load_fixture("holiday-calendar.json"))
        closures = parse_emergency_market_closure_evidence(
            {
                "schemaVersion": EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
                "closures": [
                    {
                        "date": "2026-07-10",
                        "markets": ["TWSE", "TPEx"],
                        "reason": "臺灣證券交易所集中交易市場 115 年 7 月 10 日休市一天。",
                        "sourceUrls": [
                            "https://eoc.gov.taipei/News/Detail/909",
                            "https://www.tpex.org.tw/storage/eb_data/11205/11200591671.html",
                            "https://www.twse.com.tw/en/clearing/suspended.html",
                        ],
                    }
                ],
            }
        )

        effective_calendar = apply_emergency_market_closures(calendar, closures)
        after_close = datetime(2026, 7, 10, 18, 0, tzinfo=calendar.timezone)

        self.assertNotIn(date(2026, 7, 10), calendar.holiday_dates)
        self.assertIn(date(2026, 7, 10), effective_calendar.holiday_dates)
        self.assertEqual(date(2026, 7, 9), expected_cutoff_date(effective_calendar, after_close))
        self.assertEqual("臺灣證券交易所集中交易市場 115 年 7 月 10 日休市一天。", closures[0].reason)
        self.assertEqual(("TWSE", "TPEx"), closures[0].markets)

    def test_emergency_market_closure_evidence_requires_both_markets_once(self) -> None:
        invalid_market_declarations = (
            (["TWSE"], ["https://www.twse.com.tw/en/clearing/suspended.html"]),
            (["TPEx"], ["https://www.tpex.org.tw/storage/eb_data/11205/11200591671.html"]),
            (["TWSE", "TWSE"], ["https://www.twse.com.tw/en/clearing/suspended.html"]),
            (
                ["TWSE", "TPEx", "OTHER"],
                [
                    "https://www.tpex.org.tw/storage/eb_data/11205/11200591671.html",
                    "https://www.twse.com.tw/en/clearing/suspended.html",
                ],
            ),
        )

        for markets, source_urls in invalid_market_declarations:
            with self.subTest(markets=markets):
                with self.assertRaisesRegex(ValueError, "同日全市場休市"):
                    parse_emergency_market_closure_evidence(
                        {
                            "schemaVersion": EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
                            "closures": [
                                {
                                    "date": "2026-07-10",
                                    "markets": markets,
                                    "reason": "共享交易日曆僅可排除兩市場同日全市場休市。",
                                    "sourceUrls": source_urls,
                                }
                            ],
                        }
                    )

    def test_emergency_market_closure_evidence_requires_an_official_rule_for_every_excluded_market(self) -> None:
        with self.assertRaisesRegex(ValueError, "TPEx"):
            parse_emergency_market_closure_evidence(
                {
                    "schemaVersion": EMERGENCY_CLOSURE_EVIDENCE_SCHEMA_VERSION,
                    "closures": [
                        {
                            "date": "2026-07-10",
                            "markets": ["TWSE", "TPEx"],
                            "reason": "缺少 TPEx 官方規則時不可宣告兩市場休市。",
                            "sourceUrls": ["https://www.twse.com.tw/en/clearing/suspended.html"],
                        }
                    ],
                }
            )

    def test_suspension_interval_evidence_keeps_official_boundaries_and_recovery_day(self) -> None:
        """停牌區間使用 endDateExclusive，恢復日若有行情便不再屬於停牌。"""
        intervals = parse_suspension_interval_evidence(
            {
                "schemaVersion": SUSPENSION_EVIDENCE_SCHEMA_VERSION,
                "intervals": [
                    {
                        "market": "TWSE",
                        "code": "1435",
                        "startDate": "2026-04-29",
                        "endDateExclusive": "2026-06-18",
                        "reason": "因財務報告逾期重編申報而停止買賣。",
                        "sourceUrls": [
                            "https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB",
                            "https://www.twse.com.tw/zh/announcement/announcement/detail.html?06B39790696811F199A2F6A8670AFEDB",
                        ],
                    }
                ],
            }
        )

        interval = intervals[0]
        self.assertTrue(interval.includes(date(2026, 6, 17)))
        self.assertFalse(interval.includes(date(2026, 6, 18)))
        self.assertEqual("TWSE", interval.market)
        self.assertEqual("2026-06-18", interval.end_date_exclusive.isoformat())

    def test_reduction_history_builds_auditable_twse_and_tpex_suspension_intervals(self) -> None:
        """減資歷史表必須提供停止日與恢復日，不能只靠缺少行情猜測停牌。"""
        intervals = parse_reduction_suspension_intervals(
            {
                "stat": "OK",
                "fields": [
                    "恢復買賣日期",
                    "股票代號",
                    "名稱",
                    "停止買賣前收盤價格",
                    "恢復買賣參考價",
                    "漲停價格",
                    "跌停價格",
                    "開盤競價基準",
                    "除權參考價",
                    "減資原因",
                    "詳細資料",
                ],
                "data": [
                    [
                        "106/10/30",
                        "1109",
                        "信大",
                        "12.60",
                        "12.73",
                        "14.00",
                        "11.50",
                        "12.75",
                        "--",
                        "退還股款",
                        "1109  ,20171018",
                    ]
                ],
            },
            {
                "stat": "ok",
                "tables": [
                    {
                        "fields": [
                            "恢復買賣日期",
                            "股票代號",
                            "名稱",
                            "最後交易日之收盤價格",
                            "減資恢復買賣開始日參考價格",
                            "漲停價格",
                            "跌停價格",
                            "開始交易基準價",
                            "除權參考價",
                            "減資原因",
                            "詳細資料",
                        ],
                        "data": [
                            [
                                "1150630",
                                "3152",
                                "璟德",
                                "208.00",
                                "360.24",
                                "396.00",
                                "324.50",
                                "360.00",
                                "0.00",
                                "現金減資",
                                "<table><tr><th>股票代號/股票名稱:</th><td>3152&nbsp/&nbsp璟德</td></tr>"
                                "<tr><th>停止買賣日期:</th><td>115/06/23</td></tr>"
                                "<tr><th>恢復買賣日期:</th><td>115/06/30</td></tr></table>",
                            ]
                        ],
                    }
                ],
            },
            twse_source_url="https://www.twse.com.tw/rwd/zh/reducation/TWTAUU?startDate=20160601&endDate=20260812&response=json",
            tpex_source_url="https://www.tpex.org.tw/www/zh-tw/bulletin/revivt?startDate=2016%2F06%2F01&endDate=2026%2F08%2F12",
        )

        self.assertEqual(
            [
                ("TWSE", "1109", "2017-10-19", "2017-10-30"),
                ("TPEx", "3152", "2026-06-23", "2026-06-30"),
            ],
            [
                (
                    interval.market,
                    interval.code,
                    interval.start_date.isoformat(),
                    interval.end_date_exclusive.isoformat(),
                )
                for interval in intervals
            ],
        )

    def test_reduction_history_rejects_a_mismatched_detail_or_recovery_date(self) -> None:
        """詳情代碼或恢復日不一致時，不能建立看似合理的停牌區間。"""
        with self.assertRaisesRegex(ValueError, "代碼"):
            parse_reduction_suspension_intervals(
                {
                    "stat": "OK",
                    "fields": ["恢復買賣日期", "股票代號", "減資原因", "詳細資料"],
                    "data": [["106/10/30", "1109", "退還股款", "1236,20171018"]],
                },
                {"stat": "ok", "tables": [{"fields": [], "data": []}]},
                twse_source_url="https://www.twse.com.tw/rwd/zh/reducation/TWTAUU",
                tpex_source_url="https://www.tpex.org.tw/www/zh-tw/bulletin/revivt",
            )

        with self.assertRaisesRegex(ValueError, "TPEx.*代碼"):
            parse_reduction_suspension_intervals(
                {"stat": "OK", "fields": ["恢復買賣日期", "股票代號", "減資原因", "詳細資料"], "data": []},
                {
                    "stat": "ok",
                    "tables": [
                        {
                            "fields": ["恢復買賣日期", "股票代號", "減資原因", "詳細資料"],
                            "data": [
                                [
                                    "1150630",
                                    "3152",
                                    "現金減資",
                                    "<table><tr><th>股票代號/股票名稱:</th><td>6109&nbsp/&nbsp亞元</td></tr>"
                                    "<tr><th>停止買賣日期:</th><td>115/06/23</td></tr>"
                                    "<tr><th>恢復買賣日期:</th><td>115/06/30</td></tr></table>",
                                ]
                            ],
                        }
                    ],
                },
                twse_source_url="https://www.twse.com.tw/rwd/zh/reducation/TWTAUU",
                tpex_source_url="https://www.tpex.org.tw/www/zh-tw/bulletin/revivt",
            )

    def test_suspension_interval_evidence_rejects_an_overlapping_or_unofficial_interval(self) -> None:
        with self.assertRaisesRegex(ValueError, "重疊"):
            parse_suspension_interval_evidence(
                {
                    "schemaVersion": SUSPENSION_EVIDENCE_SCHEMA_VERSION,
                    "intervals": [
                        {
                            "market": "TPEx",
                            "code": "1591",
                            "startDate": "2026-06-11",
                            "endDateExclusive": "2026-07-22",
                            "reason": "停止買賣。",
                            "sourceUrls": [
                                "https://dsp.tpex.org.tw/web/announcement/announcement_detail.php?content_number=MTE1MDA2MzIzMDQ%3D&content_file=MTE1MDA2MzIzMDQuaHRtbA%3D%3D",
                            ],
                        },
                        {
                            "market": "TPEx",
                            "code": "1591",
                            "startDate": "2026-07-01",
                            "endDateExclusive": "2026-07-22",
                            "reason": "重複且衝突的停牌區間。",
                            "sourceUrls": [
                                "https://dsp.tpex.org.tw/web/announcement/announcement_detail.php?content_number=MTE1MDAwNDgwOTE%3D&content_file=MTE1MDAwNDgwOTEuaHRtbA%3D%3D",
                            ],
                        },
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
