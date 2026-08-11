from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import json
from pathlib import Path
import ssl
import sys
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import market_sources

from market_sources import (
    comparison_unit_for_prices,
    compute_freshness,
    expected_cutoff_date,
    fetch_tpex_historical_daily,
    fetch_twse_daily,
    parse_corporate_actions,
    parse_holiday_calendar,
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

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exception_type: object, exception: object, traceback: object) -> None:
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
        self.assertTrue(all(symbol.security_type == "common-stock" for symbol in symbols))


class OfficialCorporateActionTests(unittest.TestCase):
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


class OfficialHistoricalParserTests(unittest.TestCase):
    def test_historical_tables_normalize_the_same_daily_contract(self) -> None:
        """若選錯歷史表格或欄位順序，兩市場的行情日期與成交量都會失敗。"""
        twse = parse_twse_historical_daily(load_fixture("twse-historical-daily.json"))
        tpex = parse_tpex_historical_daily(load_fixture("tpex-historical-daily.json"))

        self.assertEqual(date(2026, 8, 11), twse[0].trading_date)
        self.assertEqual(date(2026, 8, 11), tpex[0].trading_date)
        self.assertEqual(21_345_678, twse[0].volume_shares)
        self.assertEqual(9_876_000, tpex[0].volume_shares)


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
    def test_calendar_derives_expected_cutoff_and_freshness_in_taipei_time(self) -> None:
        """若 17:30 前把當日當作已完成資料，或漏算休市日，新鮮度必須失敗。"""
        calendar = parse_holiday_calendar(load_fixture("holiday-calendar.json"))
        before_close = datetime(2026, 8, 11, 16, 0, tzinfo=calendar.timezone)
        after_close = datetime(2026, 8, 11, 18, 0, tzinfo=calendar.timezone)

        self.assertEqual(date(2026, 8, 10), expected_cutoff_date(calendar, before_close))
        self.assertEqual(date(2026, 8, 11), expected_cutoff_date(calendar, after_close))
        self.assertEqual("one-session-behind", compute_freshness(calendar, date(2026, 8, 10), after_close))
        self.assertEqual("stale", compute_freshness(calendar, date(2026, 8, 7), after_close))


if __name__ == "__main__":
    unittest.main()
