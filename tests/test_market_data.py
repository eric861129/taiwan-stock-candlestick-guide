from datetime import date
from decimal import Decimal
import copy
import json
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request


sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))

import market_data
from market_data import MarketDataError, OhlcvBar, fetch_month, fetch_range, parse_tpex_month, parse_twse_month, validate_bars


FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURE_DIRECTORY / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, status: int, body: bytes):
        self.status = status
        self._body = body

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exception_type: object, exception: object, traceback: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class MarketDataParserTests(unittest.TestCase):
    def test_twse_parser_normalizes_roc_date_and_share_volume(self):
        bars = parse_twse_month(load_fixture("twse_stock_day_sample.json"))

        self.assertEqual(date(2024, 1, 2), bars[0].trading_date)
        self.assertEqual(27_000_000, bars[0].volume)
        self.assertEqual(Decimal("10.00"), bars[0].open)
        self.assertEqual((date(2024, 1, 2), date(2024, 1, 3)), tuple(bar.trading_date for bar in bars))

    def test_tpex_parser_converts_thousand_shares_to_shares(self):
        bars = parse_tpex_month(load_fixture("tpex_trading_stock_sample.json"))

        self.assertEqual(date(2024, 1, 2), bars[0].trading_date)
        self.assertEqual(6_832_000, bars[0].volume)
        self.assertEqual(Decimal("201.00"), bars[0].close)

    def test_parser_rejects_missing_price_marker(self):
        payload = copy.deepcopy(load_fixture("twse_stock_day_sample.json"))
        payload["data"][0][3] = "--"

        with self.assertRaisesRegex(ValueError, "missing price marker"):
            parse_twse_month(payload)

    def test_parser_rejects_duplicate_dates_after_sorting(self):
        payload = copy.deepcopy(load_fixture("twse_stock_day_sample.json"))
        payload["data"][0][0] = "113/01/02"

        with self.assertRaisesRegex(ValueError, "dates must be strictly increasing"):
            parse_twse_month(payload)

    def test_parser_rejects_invalid_ohlcv_values(self):
        payload = copy.deepcopy(load_fixture("twse_stock_day_sample.json"))
        payload["data"][0][3] = "10.00"
        payload["data"][0][5] = "10.50"

        with self.assertRaisesRegex(ValueError, "low must be <= open and close"):
            parse_twse_month(payload)


class OhlcvValidationTests(unittest.TestCase):
    def test_validator_rejects_low_above_open(self):
        invalid = OhlcvBar(
            date(2024, 1, 2),
            Decimal("10"),
            Decimal("12"),
            Decimal("11"),
            Decimal("11.5"),
            1_000,
        )

        self.assertIn("low must be <= open and close", validate_bars([invalid]))

    def test_validator_rejects_open_above_high(self):
        invalid = OhlcvBar(
            date(2024, 1, 2),
            Decimal("13"),
            Decimal("12"),
            Decimal("10"),
            Decimal("11"),
            1_000,
        )

        self.assertIn("open must be <= high", validate_bars([invalid]))

    def test_validator_rejects_close_above_high(self):
        invalid = OhlcvBar(
            date(2024, 1, 2),
            Decimal("11"),
            Decimal("12"),
            Decimal("10"),
            Decimal("13"),
            1_000,
        )

        self.assertIn("close must be <= high", validate_bars([invalid]))

    def test_validator_rejects_negative_volume(self):
        invalid = OhlcvBar(
            date(2024, 1, 2),
            Decimal("11"),
            Decimal("12"),
            Decimal("10"),
            Decimal("11.5"),
            -1,
        )

        self.assertIn("volume must be non-negative", validate_bars([invalid]))

    def test_validator_rejects_duplicate_and_descending_dates(self):
        first = OhlcvBar(date(2024, 1, 3), Decimal("11"), Decimal("12"), Decimal("10"), Decimal("11.5"), 1)
        duplicate = OhlcvBar(date(2024, 1, 3), Decimal("11"), Decimal("12"), Decimal("10"), Decimal("11.5"), 1)
        descending = OhlcvBar(date(2024, 1, 2), Decimal("11"), Decimal("12"), Decimal("10"), Decimal("11.5"), 1)

        self.assertIn("dates must be strictly increasing", validate_bars([first, duplicate, descending]))


class MarketDataFetchTests(unittest.TestCase):
    def _assert_context(self, error: Exception, market: str, symbol: str, month: str, rule: str) -> None:
        message = str(error)
        self.assertIn(f"market={market}", message)
        self.assertIn(f"symbol={symbol}", message)
        self.assertIn(f"month={month}", message)
        self.assertIn(f"rule={rule}", message)

    def test_fetch_month_downloads_twse_and_writes_market_scoped_cache(self):
        body = json.dumps(load_fixture("twse_stock_day_sample.json"), ensure_ascii=False).encode("utf-8")
        requests: list[tuple[object, object]] = []

        def open_response(request: object, timeout: object) -> FakeResponse:
            requests.append((request, timeout))
            return FakeResponse(200, body)

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_directory = Path(temporary_directory) / "market-data"
            with patch("market_data._urlopen_official_market_data", side_effect=open_response):
                bars = fetch_month("TWSE", "2330", date(2024, 1, 31), cache_directory)

            cache_path = cache_directory / "TWSE" / "2330" / "2024-01.json"
            cached_payload = json.loads(cache_path.read_text(encoding="utf-8"))

        self.assertEqual(27_000_000, bars[0].volume)
        self.assertEqual("OK", cached_payload["stat"])
        self.assertEqual(1, len(requests))
        self.assertEqual(30, requests[0][1])
        self.assertIn("date=20240101", requests[0][0].full_url)
        self.assertIn("stockNo=2330", requests[0][0].full_url)
        self.assertIn("taiwan-stock-candlestick-guide", requests[0][0].get_header("User-agent"))

    def test_fetch_month_retries_twse_without_x509_strict_for_missing_subject_key_identifier(self):
        body = json.dumps(load_fixture("twse_stock_day_sample.json"), ensure_ascii=False).encode("utf-8")
        calls: list[dict[str, object]] = []
        certificate_error = ssl.SSLCertVerificationError(
            1,
            "certificate verify failed: Missing Subject Key Identifier",
        )
        certificate_error.verify_message = "Missing Subject Key Identifier"

        def open_response(request: object, timeout: object, context: object = None) -> FakeResponse:
            calls.append({"request": request, "timeout": timeout, "context": context})
            if len(calls) == 1:
                raise URLError(certificate_error)
            return FakeResponse(200, body)

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_directory = Path(temporary_directory) / "market-data"
            with patch("market_data._urlopen_official_market_data", side_effect=open_response):
                bars = fetch_month("TWSE", "2330", date(2024, 1, 1), cache_directory)

        retry_context = calls[1]["context"]
        self.assertEqual(27_000_000, bars[0].volume)
        self.assertEqual(2, len(calls))
        self.assertIsNone(calls[0]["context"])
        self.assertIsInstance(retry_context, ssl.SSLContext)
        self.assertTrue(retry_context.check_hostname)
        self.assertEqual(ssl.CERT_REQUIRED, retry_context.verify_mode)
        self.assertFalse(retry_context.verify_flags & ssl.VERIFY_X509_STRICT)

    def test_fetch_month_retries_tpex_without_x509_strict_for_missing_subject_key_identifier(self):
        body = json.dumps(load_fixture("tpex_trading_stock_sample.json"), ensure_ascii=False).encode("utf-8")
        calls: list[dict[str, object]] = []
        certificate_error = ssl.SSLCertVerificationError(
            1,
            "certificate verify failed: Missing Subject Key Identifier",
        )
        certificate_error.verify_message = "Missing Subject Key Identifier"

        def open_response(request: object, timeout: object, context: object = None) -> FakeResponse:
            calls.append({"request": request, "timeout": timeout, "context": context})
            if len(calls) == 1:
                raise URLError(certificate_error)
            return FakeResponse(200, body)

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", side_effect=open_response):
                bars = fetch_month("TPEX", "5483", date(2024, 1, 1), Path(temporary_directory))

        retry_context = calls[1]["context"]
        self.assertEqual(6_832_000, bars[0].volume)
        self.assertEqual(2, len(calls))
        self.assertIsNone(calls[0]["context"])
        self.assertIsInstance(retry_context, ssl.SSLContext)
        self.assertTrue(retry_context.check_hostname)
        self.assertEqual(ssl.CERT_REQUIRED, retry_context.verify_mode)
        self.assertFalse(retry_context.verify_flags & ssl.VERIFY_X509_STRICT)

    def test_missing_subject_key_identifier_retry_requires_exact_verify_message(self):
        certificate_error = ssl.SSLCertVerificationError(
            1,
            "certificate verify failed: Missing Subject Key Identifier; unrelated verification detail",
        )
        certificate_error.verify_message = "Missing Subject Key Identifier; unrelated verification detail"

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", side_effect=URLError(certificate_error)) as open_mock:
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "network")
        self.assertEqual(1, open_mock.call_count)

    def test_missing_subject_key_identifier_retry_requires_official_market_host(self):
        certificate_error = ssl.SSLCertVerificationError(
            1,
            "certificate verify failed: Missing Subject Key Identifier",
        )
        certificate_error.verify_message = "Missing Subject Key Identifier"

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data.TWSE_STOCK_DAY_URL", "https://example.com/market-data"):
                with patch("market_data._urlopen_official_market_data", side_effect=URLError(certificate_error)) as open_mock:
                    with self.assertRaises(MarketDataError) as captured:
                        fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "network")
        self.assertEqual(0, open_mock.call_count)

    def test_redirect_handler_rejects_cross_host_http_and_non_default_port_targets(self):
        handler = market_data._OfficialMarketRedirectHandler("www.twse.com.tw")
        request = Request("https://www.twse.com.tw/original")
        targets = (
            "https://example.com/redirected",
            "http://www.twse.com.tw/redirected",
            "https://www.twse.com.tw:444/redirected",
            "https://www.twse.com.tw@example.com/redirected",
        )

        for target in targets:
            with self.subTest(target=target):
                with self.assertRaisesRegex(HTTPError, "official HTTPS host") as captured:
                    handler.redirect_request(request, None, 302, "Found", {}, target)
                captured.exception.close()

    def test_redirect_handler_allows_same_official_https_host(self):
        handler = market_data._OfficialMarketRedirectHandler("www.twse.com.tw")
        request = Request("https://www.twse.com.tw/original")

        redirected = handler.redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            "https://www.twse.com.tw/redirected",
        )

        self.assertEqual("https://www.twse.com.tw/redirected", redirected.full_url)

    def test_official_market_opener_installs_redirect_boundary_and_secure_context(self):
        opener = Mock()
        expected_response = FakeResponse(200, b"{}")
        opener.open.return_value = expected_response
        context = ssl.create_default_context()
        request = Request("https://www.tpex.org.tw/official")

        with patch("market_data.build_opener", return_value=opener) as build_mock:
            response = market_data._urlopen_official_market_data(request, timeout=30, context=context)

        handlers = build_mock.call_args.args
        redirect_handler = next(
            handler for handler in handlers if isinstance(handler, market_data._OfficialMarketRedirectHandler)
        )
        https_handler = next(handler for handler in handlers if isinstance(handler, market_data.HTTPSHandler))
        self.assertIs(expected_response, response)
        self.assertEqual("www.tpex.org.tw", redirect_handler.official_host)
        self.assertIs(context, https_handler._context)
        opener.open.assert_called_once_with(request, timeout=30)

    def test_fetch_month_cache_hit_avoids_network(self):
        body = json.dumps(load_fixture("twse_stock_day_sample.json"), ensure_ascii=False).encode("utf-8")

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_directory = Path(temporary_directory) / "market-data"
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(200, body)) as first_open:
                first = fetch_month("TWSE", "2330", date(2024, 1, 1), cache_directory)

            with patch("market_data._urlopen_official_market_data", side_effect=AssertionError("cache hit made a network request")):
                second = fetch_month("TWSE", "2330", date(2024, 1, 31), cache_directory)

        self.assertEqual(first, second)
        self.assertEqual(1, first_open.call_count)

    def test_fetch_month_rejects_cached_bars_from_another_month(self):
        payload = load_fixture("twse_stock_day_sample.json")

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_directory = Path(temporary_directory) / "market-data"
            cache_path = cache_directory / "TWSE" / "2330" / "2024-02.json"
            cache_path.parent.mkdir(parents=True)
            cache_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            with patch("market_data._urlopen_official_market_data", side_effect=AssertionError("cache hit made a network request")):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 2, 1), cache_directory)

        self._assert_context(captured.exception, "TWSE", "2330", "2024-02", "validation")
        self.assertIn("outside requested month", str(captured.exception))

    def test_fetch_month_rejects_downloaded_bars_from_another_month_without_caching(self):
        body = json.dumps(load_fixture("twse_stock_day_sample.json"), ensure_ascii=False).encode("utf-8")

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_directory = Path(temporary_directory) / "market-data"
            cache_path = cache_directory / "TWSE" / "2330" / "2024-02.json"
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(200, body)):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 2, 1), cache_directory)

            self.assertFalse(cache_path.exists())

        self._assert_context(captured.exception, "TWSE", "2330", "2024-02", "validation")

    def test_fetch_month_does_not_leave_partial_cache_when_atomic_replace_fails(self):
        body = json.dumps(load_fixture("twse_stock_day_sample.json"), ensure_ascii=False).encode("utf-8")

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_directory = Path(temporary_directory) / "market-data"
            cache_path = cache_directory / "TWSE" / "2330" / "2024-01.json"
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(200, body)):
                with patch.object(Path, "replace", side_effect=OSError("simulated replace failure")):
                    with self.assertRaises(MarketDataError) as captured:
                        fetch_month("TWSE", "2330", date(2024, 1, 1), cache_directory)

            temporary_files = list(cache_path.parent.glob("*.tmp")) if cache_path.parent.exists() else []

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "cache-write")
        self.assertFalse(cache_path.exists())
        self.assertEqual([], temporary_files)

    def test_fetch_month_downloads_tpex_with_calendar_month_request(self):
        body = json.dumps(load_fixture("tpex_trading_stock_sample.json"), ensure_ascii=False).encode("utf-8")
        requests: list[tuple[object, object]] = []

        def open_response(request: object, timeout: object) -> FakeResponse:
            requests.append((request, timeout))
            return FakeResponse(200, body)

        with tempfile.TemporaryDirectory() as temporary_directory:
            cache_directory = Path(temporary_directory) / "market-data"
            with patch("market_data._urlopen_official_market_data", side_effect=open_response):
                bars = fetch_month("TPEX", "5483", date(2024, 1, 31), cache_directory)

            cache_path = cache_directory / "TPEX" / "5483" / "2024-01.json"
            self.assertTrue(cache_path.exists())

        query = parse_qs(urlparse(requests[0][0].full_url).query)
        self.assertEqual(6_832_000, bars[0].volume)
        self.assertEqual(["2024/01/01"], query["date"])
        self.assertEqual(["5483"], query["code"])

    def test_fetch_month_reports_non_ok_http_status_with_context(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(503, b"service unavailable")):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "http-status")

    def test_fetch_month_reports_network_failure_with_context(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", side_effect=URLError("certificate verification failed")):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "network")

    def test_fetch_month_reports_non_ok_source_status_with_context(self):
        payload = load_fixture("twse_stock_day_sample.json") | {"stat": "NOT_OK"}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(200, body)):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "source-status")

    def test_fetch_month_reports_missing_status_as_malformed_payload(self):
        payload = copy.deepcopy(load_fixture("twse_stock_day_sample.json"))
        del payload["stat"]
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(200, body)):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "malformed-payload")

    def test_fetch_month_reports_malformed_payload_with_context(self):
        body = b'{"stat":"OK","fields":[]}'

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(200, body)):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "malformed-payload")

    def test_fetch_month_reports_validation_failure_with_context(self):
        payload = copy.deepcopy(load_fixture("twse_stock_day_sample.json"))
        payload["data"][0][3] = "10.00"
        payload["data"][0][5] = "10.50"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch("market_data._urlopen_official_market_data", return_value=FakeResponse(200, body)):
                with self.assertRaises(MarketDataError) as captured:
                    fetch_month("TWSE", "2330", date(2024, 1, 1), Path(temporary_directory))

        self._assert_context(captured.exception, "TWSE", "2330", "2024-01", "validation")


class MarketDataRangeTests(unittest.TestCase):
    def test_fetch_range_enumerates_calendar_months_and_filters_inclusively(self):
        january_bar = OhlcvBar(date(2024, 1, 31), Decimal("11"), Decimal("12"), Decimal("10"), Decimal("11.5"), 1)
        february_bar = OhlcvBar(date(2024, 2, 1), Decimal("12"), Decimal("13"), Decimal("11"), Decimal("12.5"), 2)
        outside_bar = OhlcvBar(date(2024, 2, 2), Decimal("12"), Decimal("13"), Decimal("11"), Decimal("12.5"), 3)
        calls: list[date] = []

        def month_bars(market: str, symbol: str, month: date, cache_dir: Path) -> tuple[OhlcvBar, ...]:
            calls.append(month)
            return {
                date(2024, 1, 1): (january_bar,),
                date(2024, 2, 1): (february_bar, outside_bar),
            }[month]

        with patch("market_data.fetch_month", side_effect=month_bars):
            bars = fetch_range("TWSE", "2330", date(2024, 1, 31), date(2024, 2, 1), Path("unused"))

        self.assertEqual([date(2024, 1, 1), date(2024, 2, 1)], calls)
        self.assertEqual((date(2024, 1, 31), date(2024, 2, 1)), tuple(bar.trading_date for bar in bars))

    def test_fetch_range_rejects_start_after_end(self):
        with self.assertRaisesRegex(ValueError, "start must be <= end"):
            fetch_range("TWSE", "2330", date(2024, 2, 1), date(2024, 1, 31), Path("unused"))

    def test_fetch_range_rejects_duplicate_dates_after_merging(self):
        duplicate = OhlcvBar(date(2024, 1, 31), Decimal("11"), Decimal("12"), Decimal("10"), Decimal("11.5"), 1)

        with patch("market_data.fetch_month", return_value=(duplicate,)):
            with self.assertRaises(MarketDataError) as captured:
                fetch_range("TWSE", "2330", date(2024, 1, 1), date(2024, 2, 29), Path("unused"))

        message = str(captured.exception)
        self.assertIn("market=TWSE", message)
        self.assertIn("symbol=2330", message)
        self.assertIn("month=2024-01..2024-02", message)
        self.assertIn("rule=validation", message)
        self.assertIn("dates must be strictly increasing", message)
