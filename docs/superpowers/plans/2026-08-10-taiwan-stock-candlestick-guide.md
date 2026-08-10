# Taiwan Stock Candlestick Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a beginner-friendly Traditional Chinese guide that teaches Taiwan stock candlestick reading, evidence-based chart interpretation, trade planning, and risk management through twenty chapters, four appendices, reproducible SVG charts, and chart-replay assessments.

**Architecture:** Markdown chapters are the reader-facing source of truth and contain structured case metadata next to each historical example. Python standard-library tools validate the book contract, fetch limited monthly market data into an ignored cache, calculate indicators, and render original accessible SVG figures. Each book part is independently readable and testable; the final release gate validates the complete manifest, data provenance, financial integrity, accessibility, and fresh-reader comprehension.

**Tech Stack:** UTF-8 Markdown, Python 3.14.5 standard library, SVG, `unittest`, Git on Windows PowerShell.

## Global Constraints

- The primary audience is a Taiwan stock beginner; prose uses natural Taiwan Traditional Chinese.
- The core timeframe is daily and weekly candlesticks for swing and medium-term interpretation.
- Technical analysis produces conditional scenarios and never promises a future price outcome.
- Core instruments are TWSE and TPEx common stocks; indices and ETFs provide market context only.
- Warrants, futures, options, ETNs, cryptoassets, automated trading, and live stock recommendations are out of scope.
- Every lesson distinguishes observation from interpretation and uses the fixed eight-step reading process.
- Every historical case records market, symbol, period, timeframe, price mode, source URL, checked date, and corporate-action status.
- Every key method includes valid, failed, and ambiguous examples; a justified no-trade decision can receive full credit.
- Official rules, fees, taxes, and changing links live only in Appendix C and include a checked date.
- Figures are original SVGs with non-color encodings and Traditional Chinese alternative text; commercial-platform and official-site screenshots are prohibited.
- Full downloaded market datasets never enter Git; transient responses live under ignored `.cache/`.
- Stable concepts update their canonical chapter directly; do not create final, v2, dated, summary, handoff, or separate-answer copies.
- Local commits use Conventional Commits. Do not push without an explicit user instruction.

---

## Locked File Map

| Path | Responsibility |
|---|---|
| `README.md` | Single reading entry, scope, disclaimer, learning route, and complete table of contents |
| `CONTEXT.md` | Canonical domain glossary and avoided language |
| `chapters/01-what-candlesticks-can-and-cannot-answer.md` | Technical-analysis purpose, limits, and evidence levels |
| `chapters/02-ohlc-body-wicks-colors.md` | OHLC, real body, wicks, color, and single-candle limits |
| `chapters/03-timeframes-raw-adjusted-prices.md` | Daily and weekly timeframes, raw and adjusted price, corporate actions |
| `chapters/04-volume-liquidity-taiwan-market-basics.md` | Volume, liquidity, and necessary Taiwan market mechanics |
| `chapters/05-swing-highs-lows-trend-structure.md` | Swing points and trend structure |
| `chapters/06-key-zones-support-resistance.md` | Key zones, support, resistance, and role reversal |
| `chapters/07-gaps-breakouts-retests-false-breakouts.md` | Gaps, breakout, retest, and failed breakout |
| `chapters/08-multiple-timeframes-market-state.md` | Multiple timeframes and direction, volatility, liquidity dimensions |
| `chapters/09-single-candlestick-signals.md` | Single-candle strength, rejection, and indecision |
| `chapters/10-two-three-candlestick-patterns.md` | Two- and three-candle combinations |
| `chapters/11-consolidation-reversal-continuation-patterns.md` | Classical consolidation, reversal, and continuation patterns |
| `chapters/12-volume-price-liquidity-failed-signals.md` | Volume-price context, low liquidity, and failed signals |
| `chapters/13-moving-averages-volume-average-atr.md` | Moving averages, volume average, and ATR |
| `chapters/14-rsi-kd-macd-bollinger-bands.md` | Momentum, oscillator, MACD, and volatility-band tools |
| `chapters/15-scenarios-triggers-invalidation-no-trade.md` | Scenario construction, trigger, invalidation, and no-trade rules |
| `chapters/16-stops-position-sizing-r-multiple-expectancy-costs.md` | Stop, position size, R multiple, expectancy, and trading friction |
| `chapters/17-what-candlesticks-cannot-see.md` | Financial reports, news, corporate events, and market rules outside chart evidence |
| `chapters/18-psychology-journal-paper-trading.md` | Biases, journal, review discipline, and paper trading |
| `chapters/19-progressive-chart-replay-lab.md` | Progressive chart-replay exercises |
| `chapters/20-capstone-ten-cases.md` | Ten-case final assessment and scoring rubric |
| `chapters/appendix-a-pattern-reference.md` | Pattern lookup with context and common failure modes |
| `chapters/appendix-b-formulas-and-worksheets.md` | Formula reference and reusable worksheets |
| `chapters/appendix-c-taiwan-market-rules.md` | Volatile Taiwan market rules, costs, official URLs, and checked dates |
| `chapters/appendix-d-glossary.md` | Reader-facing glossary generated from `CONTEXT.md` |
| `tools/book_contract.py` | Expected file manifest, lesson sections, case metadata types, and validation issues |
| `tools/validate_book.py` | Draft and release validation CLI |
| `tools/market_data.py` | TWSE and TPEx monthly OHLCV adapters, normalization, cache, and bar validation |
| `tools/indicators.py` | Deterministic indicator calculations |
| `tools/chart_spec.py` | Structured figure metadata parser and chart specification types |
| `tools/render_chart.py` | Accessible deterministic SVG rendering |
| `tools/render_chapter_figures.py` | CLI that reads chapter figure specs, obtains bars, and writes chapter figures |
| `tools/render_glossary.py` | Generates Appendix D from the canonical glossary |
| `tests/fixtures/valid_lesson.md` | Minimal valid lesson contract fixture |
| `tests/fixtures/twse_stock_day_sample.json` | Small synthetic TWSE-shaped monthly response |
| `tests/fixtures/tpex_trading_stock_sample.json` | Small synthetic TPEx-shaped monthly response |
| `tests/test_book_contract.py` | Manifest and metadata parser tests |
| `tests/test_validate_book.py` | Markdown, UTF-8, section, link, image-alt, and release-manifest tests |
| `tests/test_market_data.py` | TWSE and TPEx normalization, cache, and OHLCV tests |
| `tests/test_indicators.py` | Indicator formula and input-boundary tests |
| `tests/test_chart_spec.py` | Structured figure-spec parser tests |
| `tests/test_render_chart.py` | SVG determinism and accessibility tests |
| `tests/test_render_glossary.py` | Canonical glossary generation tests |
| `assets/figures/` | Generated lesson and assessment SVGs only |

## Structured Case Metadata Contract

Historical and synthetic figure metadata lives beside the explanation in a Markdown HTML comment. The chapter remains the single source for the example.

```markdown
<!-- figure-spec
{
  "id": "ch07-breakout-valid",
  "kind": "historical",
  "market": "TWSE",
  "symbol": "2330",
  "start": "2024-01-02",
  "end": "2024-03-29",
  "timeframe": "1d",
  "price_mode": "raw",
  "source_url": "https://www.twse.com.tw/zh/trading/historical/stock-day.html",
  "checked_on": "2026-08-10",
  "corporate_actions": [],
  "title": "突破後守住壓力轉支撐的歷史案例",
  "alt_text": "日 K 圖顯示價格突破壓力區後回測，收盤仍守在區域上方，成交量高於近期平均。",
  "annotations": [
    {"type": "zone", "start": "2024-02-01", "end": "2024-03-29", "low": "620", "high": "630", "label": "原壓力區"}
  ],
  "output": "assets/figures/ch07-cases.svg"
}
-->
```

The actual symbol and period for every published case must be selected from verified official data during its content task. The example above defines the schema and is not pre-approved as a final Chapter 7 case.

---

### Task 1: Book Contract and Validation CLI

**Files:**
- Create: `tools/book_contract.py`
- Create: `tools/validate_book.py`
- Create: `tests/fixtures/valid_lesson.md`
- Create: `tests/test_book_contract.py`
- Create: `tests/test_validate_book.py`

**Interfaces:**
- Produces: `ChapterSpec(number: int | None, path: str, title: str, kind: Literal["lesson", "lab", "appendix"])`
- Produces: `ValidationIssue(path: str, rule: str, message: str, line: int | None)`
- Produces: `EXPECTED_CHAPTERS: tuple[ChapterSpec, ...]`
- Produces: `extract_figure_specs(markdown: str) -> tuple[dict[str, object], ...]`
- Produces: `validate_book(root: Path, mode: Literal["draft", "release"]) -> list[ValidationIssue]`
- Produces CLI: `python tools/validate_book.py --root . --mode draft|release`

- [ ] **Step 1: Write the manifest and case-parser tests**

```python
# tests/test_book_contract.py
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
from book_contract import EXPECTED_CHAPTERS, extract_figure_specs


class BookContractTests(unittest.TestCase):
    def test_manifest_has_twenty_numbered_lessons_and_four_appendices(self):
        numbered = [item.number for item in EXPECTED_CHAPTERS if item.number is not None]
        appendices = [item for item in EXPECTED_CHAPTERS if item.kind == "appendix"]
        self.assertEqual(list(range(1, 21)), numbered)
        self.assertEqual(4, len(appendices))

    def test_extract_figure_specs_reads_json_comment(self):
        markdown = '''<!-- figure-spec
{"id":"synthetic-1","kind":"synthetic","title":"測試","alt_text":"可讀圖說","output":"assets/figures/test.svg"}
-->'''
        specs = extract_figure_specs(markdown)
        self.assertEqual("synthetic-1", specs[0]["id"])
        self.assertEqual("可讀圖說", specs[0]["alt_text"])
```

- [ ] **Step 2: Run the focused tests and confirm the missing-module failure**

Run: `python -m unittest tests.test_book_contract -v`

Expected: FAIL because `tools/book_contract.py` does not exist.

- [ ] **Step 3: Implement the exact twenty-chapter and four-appendix manifest**

```python
# tools/book_contract.py
from dataclasses import dataclass
import json
import re
from typing import Literal


@dataclass(frozen=True, slots=True)
class ChapterSpec:
    number: int | None
    path: str
    title: str
    kind: Literal["lesson", "lab", "appendix"]


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    path: str
    rule: str
    message: str
    line: int | None = None


EXPECTED_CHAPTERS = (
    ChapterSpec(1, "chapters/01-what-candlesticks-can-and-cannot-answer.md", "K 線能回答什麼，不能回答什麼", "lesson"),
    ChapterSpec(2, "chapters/02-ohlc-body-wicks-colors.md", "開高低收、實體、影線與顏色", "lesson"),
    ChapterSpec(3, "chapters/03-timeframes-raw-adjusted-prices.md", "時間週期、原始價格、還原價格與公司行動", "lesson"),
    ChapterSpec(4, "chapters/04-volume-liquidity-taiwan-market-basics.md", "成交量、流動性與必要的台股交易機制", "lesson"),
    ChapterSpec(5, "chapters/05-swing-highs-lows-trend-structure.md", "波峰、波谷與趨勢結構", "lesson"),
    ChapterSpec(6, "chapters/06-key-zones-support-resistance.md", "關鍵區域、支撐區與壓力區", "lesson"),
    ChapterSpec(7, "chapters/07-gaps-breakouts-retests-false-breakouts.md", "缺口、突破、回測與假突破", "lesson"),
    ChapterSpec(8, "chapters/08-multiple-timeframes-market-state.md", "多時間週期與市場狀態三面向", "lesson"),
    ChapterSpec(9, "chapters/09-single-candlestick-signals.md", "單根 K 線：強弱、拒絕與猶豫", "lesson"),
    ChapterSpec(10, "chapters/10-two-three-candlestick-patterns.md", "雙根與三根 K 線組合", "lesson"),
    ChapterSpec(11, "chapters/11-consolidation-reversal-continuation-patterns.md", "整理、反轉與延續型態", "lesson"),
    ChapterSpec(12, "chapters/12-volume-price-liquidity-failed-signals.md", "量價關係、低流動性與失敗訊號", "lesson"),
    ChapterSpec(13, "chapters/13-moving-averages-volume-average-atr.md", "移動平均、成交量均量與 ATR", "lesson"),
    ChapterSpec(14, "chapters/14-rsi-kd-macd-bollinger-bands.md", "RSI、KD、MACD 與布林通道", "lesson"),
    ChapterSpec(15, "chapters/15-scenarios-triggers-invalidation-no-trade.md", "情境、觸發、失效與放棄交易", "lesson"),
    ChapterSpec(16, "chapters/16-stops-position-sizing-r-multiple-expectancy-costs.md", "停損、部位、R 倍數、期望值與成本", "lesson"),
    ChapterSpec(17, "chapters/17-what-candlesticks-cannot-see.md", "K 線看不到的財報、消息與制度事件", "lesson"),
    ChapterSpec(18, "chapters/18-psychology-journal-paper-trading.md", "心理偏誤、交易紀錄與紙上交易", "lesson"),
    ChapterSpec(19, "chapters/19-progressive-chart-replay-lab.md", "漸進式遮圖案例實驗室", "lab"),
    ChapterSpec(20, "chapters/20-capstone-ten-cases.md", "十組綜合案例與能力驗收", "lab"),
    ChapterSpec(None, "chapters/appendix-a-pattern-reference.md", "型態速查", "appendix"),
    ChapterSpec(None, "chapters/appendix-b-formulas-and-worksheets.md", "公式與表單", "appendix"),
    ChapterSpec(None, "chapters/appendix-c-taiwan-market-rules.md", "台股規則", "appendix"),
    ChapterSpec(None, "chapters/appendix-d-glossary.md", "詞彙表", "appendix"),
)


FIGURE_SPEC_PATTERN = re.compile(r"<!-- figure-spec\s*(\{.*?\})\s*-->", re.DOTALL)


def extract_figure_specs(markdown: str) -> tuple[dict[str, object], ...]:
    return tuple(json.loads(match) for match in FIGURE_SPEC_PATTERN.findall(markdown))
```

- [ ] **Step 4: Run the manifest tests and confirm they pass**

Run: `python -m unittest tests.test_book_contract -v`

Expected: PASS with two tests.

- [ ] **Step 5: Write failing validator tests for UTF-8, required sections, image alt text, local links, and release completeness**

The valid lesson fixture contains these exact headings:

```markdown
# 測試章節
## 學習目標
## 先說結論
## 精確定義與證據等級
## 人工圖例
## 歷史案例
## 八步判讀
## 練習
## 答案與評分
## 重點、限制與來源
```

Add tests named:

```python
test_valid_lesson_has_no_issues
test_replacement_character_is_rejected
test_missing_required_section_is_rejected
test_empty_image_alt_text_is_rejected
test_missing_local_link_target_is_rejected
test_release_mode_requires_readme_all_chapters_and_appendices
test_duplicate_figure_id_is_rejected
test_historical_figure_requires_provenance_fields
```

- [ ] **Step 6: Run validator tests and confirm the missing-function failures**

Run: `python -m unittest tests.test_validate_book -v`

Expected: FAIL because `validate_book` and the validation rules do not exist.

- [ ] **Step 7: Implement draft and release validation**

`validate_book` must:

1. Decode every `.md` file as strict UTF-8 and reject `U+FFFD`.
2. Reject the four configured case-insensitive standalone draft-marker tokens.
3. Require the nine lesson headings for `lesson` files; require learning instructions, cases, scoring, and sources for `lab` files.
4. Require non-empty alt text for every Markdown image.
5. Resolve local Markdown and image links relative to their source file.
6. Parse every `figure-spec`, require unique IDs, and require all provenance fields for `kind="historical"`.
7. In release mode, require `README.md`, all twenty chapters, all four appendices, and every referenced SVG.
8. Print one issue per line as `path:line [rule] message` and exit `1` when issues exist.

Define the marker tuple without placing a literal draft marker in this plan:

```python
DRAFT_MARKERS = ("T" "BD", "T" "ODO", "FIX" "ME", "PLACE" "HOLDER")
```

- [ ] **Step 8: Run all validator tests and both CLI modes**

Run: `python -m unittest tests.test_book_contract tests.test_validate_book -v`

Expected: PASS.

Run: `python tools/validate_book.py --root . --mode draft`

Expected: PASS against the current design-only repository.

- [ ] **Step 9: Review and commit Task 1**

```powershell
git add tools/book_contract.py tools/validate_book.py tests/fixtures/valid_lesson.md tests/test_book_contract.py tests/test_validate_book.py
git diff --cached --check
git diff --cached
git commit -m "build: add book validation contract"
```

---

### Task 2: Official Monthly Market Data Adapters

**Files:**
- Create: `tools/market_data.py`
- Create: `tests/fixtures/twse_stock_day_sample.json`
- Create: `tests/fixtures/tpex_trading_stock_sample.json`
- Create: `tests/test_market_data.py`

**Interfaces:**
- Produces: `OhlcvBar(trading_date: date, open: Decimal, high: Decimal, low: Decimal, close: Decimal, volume: int)`
- Produces: `fetch_month(market: Literal["TWSE", "TPEX"], symbol: str, month: date, cache_dir: Path) -> tuple[OhlcvBar, ...]`
- Produces: `fetch_range(market: Literal["TWSE", "TPEX"], symbol: str, start: date, end: date, cache_dir: Path) -> tuple[OhlcvBar, ...]`
- Produces: `validate_bars(bars: Sequence[OhlcvBar]) -> list[str]`
- Consumes: TWSE endpoint `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY`
- Consumes: TPEx endpoint `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock`

- [ ] **Step 1: Create synthetic official-shape fixtures**

The TWSE fixture uses `stat`, `fields`, and `data`, with ROC date `113/01/02`, comma-separated share volume, and OHLC strings. The TPEx fixture uses `stat`, `tables[0].fields`, and `tables[0].data`; its volume field is `成交仟股` and must normalize to shares by multiplying by `1000`.

- [ ] **Step 2: Write failing parser and invariant tests**

```python
def test_twse_parser_normalizes_roc_date_and_share_volume():
    bars = parse_twse_month(load_fixture("twse_stock_day_sample.json"))
    self.assertEqual(date(2024, 1, 2), bars[0].trading_date)
    self.assertEqual(27_000_000, bars[0].volume)

def test_tpex_parser_converts_thousand_shares_to_shares():
    bars = parse_tpex_month(load_fixture("tpex_trading_stock_sample.json"))
    self.assertEqual(6_832_000, bars[0].volume)

def test_validator_rejects_low_above_open():
    invalid = OhlcvBar(date(2024, 1, 2), Decimal("10"), Decimal("12"), Decimal("11"), Decimal("11.5"), 1000)
    self.assertIn("low must be <= open and close", validate_bars([invalid]))
```

- [ ] **Step 3: Run the market-data tests and confirm the missing-module failure**

Run: `python -m unittest tests.test_market_data -v`

Expected: FAIL because `tools/market_data.py` does not exist.

- [ ] **Step 4: Implement normalization and strict bar validation**

```python
@dataclass(frozen=True, slots=True)
class OhlcvBar:
    trading_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


def roc_to_date(value: str) -> date:
    year, month, day = (int(part) for part in value.strip().split("/"))
    return date(year + 1911, month, day)
```

Parsers must remove commas, reject missing-price markers, sort by date, reject duplicate dates, and preserve `Decimal` prices. Validation requires `low <= open <= high`, `low <= close <= high`, non-negative volume, and strictly increasing dates.

- [ ] **Step 5: Implement one-month network fetch and ignored cache**

Use `urllib.request`, a descriptive user agent, a 30-second timeout, one request per market-symbol-month, and atomic cache replacement. Cache files use `.cache/market-data/{market}/{symbol}/{YYYY-MM}.json`. A non-OK status, malformed payload, or validation issue raises `MarketDataError` with the market, symbol, month, and failing rule.

- [ ] **Step 6: Implement inclusive range composition**

`fetch_range` enumerates calendar months, calls `fetch_month`, merges bars, removes data outside the requested dates, rejects duplicate dates, and calls `validate_bars` before returning.

- [ ] **Step 7: Run tests and a read-only live smoke check**

Run: `python -m unittest tests.test_market_data -v`

Expected: PASS.

Run a smoke test for TWSE `2330` and TPEx `5483` for January 2024, print only the bar count and first/last dates, and confirm no cache file is staged by Git.

- [ ] **Step 8: Review and commit Task 2**

```powershell
git add tools/market_data.py tests/fixtures/twse_stock_day_sample.json tests/fixtures/tpex_trading_stock_sample.json tests/test_market_data.py
git diff --cached --check
git diff --cached
git commit -m "feat(data): add official market data adapters"
```

---

### Task 3: Deterministic Indicator Calculations

**Files:**
- Create: `tools/indicators.py`
- Create: `tests/test_indicators.py`

**Interfaces:**
- Produces: `simple_moving_average(values: Sequence[Decimal], period: int) -> tuple[Decimal | None, ...]`
- Produces: `exponential_moving_average(values: Sequence[Decimal], period: int) -> tuple[Decimal | None, ...]`
- Produces: `average_true_range(bars: Sequence[OhlcvBar], period: int) -> tuple[Decimal | None, ...]`
- Produces: `relative_strength_index(values: Sequence[Decimal], period: int) -> tuple[Decimal | None, ...]`
- Produces: `stochastic_kd(bars: Sequence[OhlcvBar], period: int, smooth_k: int, smooth_d: int) -> tuple[tuple[Decimal | None, Decimal | None], ...]`
- Produces: `macd(values: Sequence[Decimal], fast: int, slow: int, signal: int) -> tuple[tuple[Decimal | None, Decimal | None, Decimal | None], ...]`
- Produces: `bollinger_bands(values: Sequence[Decimal], period: int, deviations: Decimal) -> tuple[tuple[Decimal | None, Decimal | None, Decimal | None], ...]`

- [ ] **Step 1: Write failing tests for warm-up periods, formulas, and invalid inputs**

Required assertions:

- SMA of `1,2,3,4` with period `3` is `None,None,2,3`.
- EMA seeds from the first period SMA and then uses multiplier `2 / (period + 1)`.
- True range uses the maximum of high-low, absolute high-previous-close, and absolute low-previous-close.
- RSI returns `100` when the initialized average loss is zero and average gain is positive.
- Stochastic `%K` returns `50` when the window high equals the window low.
- MACD returns aligned MACD, signal, and histogram series of the input length.
- Bollinger Bands use population standard deviation and return upper, middle, lower.
- Periods below `1`, fast period not below slow period, and insufficient bars raise `ValueError` with the parameter name.

- [ ] **Step 2: Run indicator tests and confirm the missing-module failure**

Run: `python -m unittest tests.test_indicators -v`

Expected: FAIL because `tools/indicators.py` does not exist.

- [ ] **Step 3: Implement SMA, EMA, true range, and ATR**

Use `Decimal` throughout. Preserve input length with `None` during warm-up. ATR uses Wilder smoothing after the initial simple average of true ranges.

- [ ] **Step 4: Run focused moving-average and ATR tests**

Run: `python -m unittest tests.test_indicators.IndicatorTests.test_simple_moving_average tests.test_indicators.IndicatorTests.test_average_true_range -v`

Expected: PASS.

- [ ] **Step 5: Implement RSI and stochastic KD**

RSI uses Wilder average gain and loss. KD calculates raw `%K` from the rolling high-low range, smooths `%K` with `smooth_k`, then smooths `%D` with `smooth_d`.

- [ ] **Step 6: Implement MACD and Bollinger Bands**

MACD is fast EMA minus slow EMA, the signal line is an EMA of available MACD values, and histogram is MACD minus signal. Bollinger middle is SMA; upper and lower add or subtract `deviations * population_standard_deviation`.

- [ ] **Step 7: Run the full indicator suite**

Run: `python -m unittest tests.test_indicators -v`

Expected: PASS.

- [ ] **Step 8: Review and commit Task 3**

```powershell
git add tools/indicators.py tests/test_indicators.py
git diff --cached --check
git diff --cached
git commit -m "feat(indicators): add technical indicator calculations"
```

---

### Task 4: Accessible SVG Figure Pipeline

**Files:**
- Create: `tools/chart_spec.py`
- Create: `tools/render_chart.py`
- Create: `tools/render_chapter_figures.py`
- Create: `tests/test_chart_spec.py`
- Create: `tests/test_render_chart.py`

**Interfaces:**
- Consumes: `extract_figure_specs`, `fetch_range`, `OhlcvBar`, and indicator functions.
- Produces: `FigureSpec` and typed annotation records for zones, lines, arrows, and labels.
- Produces: `parse_figure_spec(raw: dict[str, object], chapter_path: Path) -> FigureSpec`
- Produces: `render_svg(spec: FigureSpec, bars: Sequence[OhlcvBar]) -> str`
- Produces CLI: `python tools/render_chapter_figures.py --chapter <path> --root .`

- [ ] **Step 1: Write failing parser tests for synthetic and historical specs**

Tests require unique ID, supported kind, non-empty Traditional Chinese `alt_text`, `.svg` output under `assets/figures/`, ISO dates for historical cases, valid market, price mode, source URL, checked date, and supported annotation types.

- [ ] **Step 2: Run parser tests and confirm failure**

Run: `python -m unittest tests.test_chart_spec -v`

Expected: FAIL because `tools/chart_spec.py` does not exist.

- [ ] **Step 3: Implement typed chart specifications and validation**

Use frozen dataclasses. `kind="synthetic"` requires inline bars and forbids a market symbol. `kind="historical"` requires market, symbol, start, end, timeframe, price mode, source URL, checked date, and corporate-action list.

- [ ] **Step 4: Write failing renderer tests**

```python
def test_svg_has_accessible_title_and_description(self):
    svg = render_svg(self.spec, self.bars)
    self.assertIn('<title id="chart-title">測試圖</title>', svg)
    self.assertIn('<desc id="chart-desc">可讀的繁體中文替代文字</desc>', svg)
    self.assertIn('role="img"', svg)
    self.assertIn('aria-labelledby="chart-title chart-desc"', svg)

def test_svg_encodes_direction_without_color_only(self):
    svg = render_svg(self.spec, self.bars)
    self.assertIn('data-direction="up"', svg)
    self.assertIn('data-direction="down"', svg)
    self.assertIn('class="candle-body up hollow"', svg)
    self.assertIn('class="candle-body down solid"', svg)

def test_same_input_produces_identical_svg(self):
    self.assertEqual(render_svg(self.spec, self.bars), render_svg(self.spec, self.bars))
```

- [ ] **Step 5: Implement deterministic chart geometry and escaping**

Render price candles, volume bars, axes, labels, legend, optional indicators, and annotations. Escape all text with `html.escape`; sort attributes and annotations; round coordinates to two decimals; omit timestamps and random IDs. Up candles use red plus hollow bodies and `data-direction="up"`; down candles use green plus solid bodies and `data-direction="down"`.

- [ ] **Step 6: Implement chapter rendering CLI**

The CLI reads one chapter, parses every `figure-spec`, fetches historical bars or uses synthetic bars, renders each declared output, writes UTF-8 SVG atomically, and stops without partial output when any spec or data check fails.

- [ ] **Step 7: Run chart tests and a synthetic CLI smoke test**

Run: `python -m unittest tests.test_chart_spec tests.test_render_chart -v`

Expected: PASS.

Run the CLI against a temporary chapter under `.cache/` and confirm a deterministic SVG is produced while Git remains clean.

- [ ] **Step 8: Review and commit Task 4**

```powershell
git add tools/chart_spec.py tools/render_chart.py tools/render_chapter_figures.py tests/test_chart_spec.py tests/test_render_chart.py
git diff --cached --check
git diff --cached
git commit -m "feat(charts): add accessible SVG figure pipeline"
```

---

### Task 5: Reading Entry, Part I, and Taiwan Rules Appendix

**Files:**
- Create: `README.md`
- Create: `chapters/01-what-candlesticks-can-and-cannot-answer.md`
- Create: `chapters/02-ohlc-body-wicks-colors.md`
- Create: `chapters/03-timeframes-raw-adjusted-prices.md`
- Create: `chapters/04-volume-liquidity-taiwan-market-basics.md`
- Create: `chapters/appendix-c-taiwan-market-rules.md`
- Create: `assets/figures/ch01-concept.svg`
- Create: `assets/figures/ch01-cases.svg`
- Create: `assets/figures/ch02-concept.svg`
- Create: `assets/figures/ch02-cases.svg`
- Create: `assets/figures/ch03-concept.svg`
- Create: `assets/figures/ch03-cases.svg`
- Create: `assets/figures/ch04-concept.svg`
- Create: `assets/figures/ch04-cases.svg`

**Interfaces:**
- Consumes: lesson contract, figure-spec schema, market adapters, renderer, and `CONTEXT.md` vocabulary.
- Produces: the canonical reader entry and complete Part I prerequisites for every later chapter.

- [ ] **Step 1: Verify official Part I facts at their current primary sources**

Use TWSE, TPEx, MOPS, and the competent authority for trading session, lots and odd lots, tick sizes, price limits, fees, tax, corporate actions, and risk disclosures. Record exact source URLs and `查核日期：2026-08-10` directly in Appendix C. Do not create a research-notes file.

- [ ] **Step 2: Write `README.md` as the single entry**

Include English and Chinese titles, audience, educational disclaimer, learning outcomes, how to use figures and folded answers, five-part route, links to all existing Part I chapters, planned later parts as plain text without broken links, glossary link, and repository contribution rules that preserve canonical sources.

- [ ] **Step 3: Author Chapter 1**

Cover observation versus interpretation, conditional scenarios, evidence levels, limits of technical analysis, hindsight bias, and the eight-step process overview. Include synthetic and historical examples where the same candle has different meaning by location. End with three-layer exercises and scoring.

- [ ] **Step 4: Author Chapter 2 and render figures**

Cover OHLC, body, upper and lower wick, opening and closing position, Taiwan up/down visual convention with non-color encodings, long and small bodies, and the reason a single candle needs context. Render `ch02-concept.svg` and the valid/failed/ambiguous `ch02-cases.svg`.

- [ ] **Step 5: Author Chapter 3 and render figures**

Cover daily versus weekly bars, incomplete bars, raw versus adjusted price, cash and stock dividends, capital reduction, split, linear versus logarithmic scale, and multi-timeframe comparison. The company-action example must show why a mechanical gap cannot be treated as ordinary selling pressure.

- [ ] **Step 6: Author Chapter 4 and Appendix C**

Chapter 4 covers share volume, turnover context, volume averages, liquidity, spread and slippage concepts, missing volume evidence, and why TPEx thousand-share data must be normalized. Appendix C centralizes current market hours, order-unit rules, price limits, tick sizes, costs, taxes, corporate-action references, official links, and update procedure.

- [ ] **Step 7: Add structured metadata and render all Part I figures**

Every chapter includes one synthetic concept figure and one three-panel historical case figure. Select cases only after reviewing full official data and corporate-action status. Run the renderer once per chapter and manually compare OHLC labels with the source bars.

- [ ] **Step 8: Run Part I checks**

Run: `python -m unittest discover -s tests -p "test_*.py" -v`

Run: `python tools/validate_book.py --root . --mode draft`

Expected: PASS. Manually confirm every official rule exists only in Appendix C and every Part I chapter links to it instead of copying volatile values.

- [ ] **Step 9: Review and commit Task 5**

```powershell
git add README.md chapters/01-what-candlesticks-can-and-cannot-answer.md chapters/02-ohlc-body-wicks-colors.md chapters/03-timeframes-raw-adjusted-prices.md chapters/04-volume-liquidity-taiwan-market-basics.md chapters/appendix-c-taiwan-market-rules.md assets/figures/ch01-concept.svg assets/figures/ch01-cases.svg assets/figures/ch02-concept.svg assets/figures/ch02-cases.svg assets/figures/ch03-concept.svg assets/figures/ch03-cases.svg assets/figures/ch04-concept.svg assets/figures/ch04-cases.svg
git diff --cached --check
git diff --cached
git commit -m "docs(part-1): teach candlestick and market foundations"
```

---

### Task 6: Part II Market Structure and Context

**Files:**
- Create: `chapters/05-swing-highs-lows-trend-structure.md`
- Create: `chapters/06-key-zones-support-resistance.md`
- Create: `chapters/07-gaps-breakouts-retests-false-breakouts.md`
- Create: `chapters/08-multiple-timeframes-market-state.md`
- Create: `assets/figures/ch05-concept.svg`
- Create: `assets/figures/ch05-cases.svg`
- Create: `assets/figures/ch06-concept.svg`
- Create: `assets/figures/ch06-cases.svg`
- Create: `assets/figures/ch07-concept.svg`
- Create: `assets/figures/ch07-cases.svg`
- Create: `assets/figures/ch08-concept.svg`
- Create: `assets/figures/ch08-cases.svg`
- Modify: `README.md`

**Interfaces:**
- Consumes: Part I terminology, fixed eight-step process, data adapters, and chart renderer.
- Produces: canonical structure and context concepts required by every pattern and indicator chapter.

- [ ] **Step 1: Author Chapter 5**

Define swing highs and lows with observable comparison rules; derive rising, falling, and range structures; distinguish trend description from prediction; compare structure reversal with a temporary pullback. Cases must include a clean trend, a failed continuation, and an ambiguous transition.

- [ ] **Step 2: Author Chapter 6**

Teach zones as ranges, repeated reactions, prior congestion, support-resistance role reversal, zone width, and evidence that weakens a zone. Exercises must reject precision lines that have no market basis.

- [ ] **Step 3: Author Chapter 7**

Separate common, breakaway, continuation, and exhaustion gap descriptions from their interpretation; teach closing confirmation, breakout space, retest, rejection, and false breakout. Include a no-trade answer when risk-to-invalidation is unacceptable.

- [ ] **Step 4: Author Chapter 8**

Use weekly context before daily execution. Evaluate market state on three simultaneous dimensions: direction, volatility, and liquidity. Show that high volatility and low liquidity can coexist with an uptrend or downtrend and cannot be forced into mutually exclusive labels.

- [ ] **Step 5: Select cases and render all Part II figures**

Each chapter receives a synthetic concept SVG and a historical three-panel SVG. Verify corporate actions and conceal all bars after the decision date in exercises.

- [ ] **Step 6: Update navigation and run Part II checks**

Add working Part II links to `README.md`. Run all unit tests and draft validation. Search the four chapters for exact-price language and replace unsupported lines with zones.

- [ ] **Step 7: Review and commit Task 6**

```powershell
git add README.md chapters/05-swing-highs-lows-trend-structure.md chapters/06-key-zones-support-resistance.md chapters/07-gaps-breakouts-retests-false-breakouts.md chapters/08-multiple-timeframes-market-state.md assets/figures/ch05-concept.svg assets/figures/ch05-cases.svg assets/figures/ch06-concept.svg assets/figures/ch06-cases.svg assets/figures/ch07-concept.svg assets/figures/ch07-cases.svg assets/figures/ch08-concept.svg assets/figures/ch08-cases.svg
git diff --cached --check
git diff --cached
git commit -m "docs(part-2): teach market structure and context"
```

---

### Task 7: Part III Patterns, Volume, and Pattern Reference

**Files:**
- Create: `chapters/09-single-candlestick-signals.md`
- Create: `chapters/10-two-three-candlestick-patterns.md`
- Create: `chapters/11-consolidation-reversal-continuation-patterns.md`
- Create: `chapters/12-volume-price-liquidity-failed-signals.md`
- Create: `chapters/appendix-a-pattern-reference.md`
- Create: `assets/figures/ch09-concept.svg`
- Create: `assets/figures/ch09-cases.svg`
- Create: `assets/figures/ch10-concept.svg`
- Create: `assets/figures/ch10-cases.svg`
- Create: `assets/figures/ch11-concept.svg`
- Create: `assets/figures/ch11-cases.svg`
- Create: `assets/figures/ch12-concept.svg`
- Create: `assets/figures/ch12-cases.svg`
- Modify: `README.md`

**Interfaces:**
- Consumes: market structure, zones, multi-timeframe state, and evidence levels.
- Produces: context-aware pattern language and the lookup appendix.

- [ ] **Step 1: Establish the evidence boundary for pattern claims**

Use original or primary empirical research for statistical claims, including Lo, Mamaysky, and Wang on technical pattern recognition and empirical candlestick research when applicable. Label definitions as common methods and label sample-specific findings as research results. Do not publish an uncited universal success rate.

- [ ] **Step 2: Author Chapter 9**

Cover long and small bodies, doji, hammer-shaped candles, shooting-star-shaped candles, marubozu, close location, rejection, and indecision. Name shape first and interpret only after trend, zone, volume, and confirmation.

- [ ] **Step 3: Author Chapter 10**

Cover engulfing, harami, piercing and dark-cloud forms, morning and evening stars, three advancing and three declining candles. Explain market-specific color naming carefully and compare pattern completion with actionable confirmation.

- [ ] **Step 4: Author Chapter 11**

Cover ranges, triangles, flags, double top and bottom, head-and-shoulders forms, continuation versus reversal framing, measured-move limitations, and the risk of subjective boundary selection.

- [ ] **Step 5: Author Chapter 12**

Teach volume expansion and contraction relative to context, effort-versus-result observations, climax risk, low-liquidity distortion, failed signals, and the absence of a universal volume threshold.

- [ ] **Step 6: Build Appendix A from the chapters**

For every included pattern, provide exact definition, minimum context, invalidating observation, common misreading, and links to its teaching chapter. Keep explanations short enough for lookup and do not copy full chapter prose.

- [ ] **Step 7: Render Part III figures and run checks**

Render eight SVGs, confirm alt text describes both geometry and context, run all tests and draft validation, and verify every pattern in Appendix A links to a full valid/failed/ambiguous treatment.

- [ ] **Step 8: Review and commit Task 7**

```powershell
git add README.md chapters/09-single-candlestick-signals.md chapters/10-two-three-candlestick-patterns.md chapters/11-consolidation-reversal-continuation-patterns.md chapters/12-volume-price-liquidity-failed-signals.md chapters/appendix-a-pattern-reference.md assets/figures/ch09-concept.svg assets/figures/ch09-cases.svg assets/figures/ch10-concept.svg assets/figures/ch10-cases.svg assets/figures/ch11-concept.svg assets/figures/ch11-cases.svg assets/figures/ch12-concept.svg assets/figures/ch12-cases.svg
git diff --cached --check
git diff --cached
git commit -m "docs(part-3): teach patterns and volume context"
```

---

### Task 8: Part IV Indicators, Trade Plans, and Formula Appendix

**Files:**
- Create: `chapters/13-moving-averages-volume-average-atr.md`
- Create: `chapters/14-rsi-kd-macd-bollinger-bands.md`
- Create: `chapters/15-scenarios-triggers-invalidation-no-trade.md`
- Create: `chapters/16-stops-position-sizing-r-multiple-expectancy-costs.md`
- Create: `chapters/appendix-b-formulas-and-worksheets.md`
- Create: `assets/figures/ch13-concept.svg`
- Create: `assets/figures/ch13-cases.svg`
- Create: `assets/figures/ch14-concept.svg`
- Create: `assets/figures/ch14-cases.svg`
- Create: `assets/figures/ch15-concept.svg`
- Create: `assets/figures/ch15-cases.svg`
- Create: `assets/figures/ch16-concept.svg`
- Create: `assets/figures/ch16-cases.svg`
- Modify: `README.md`

**Interfaces:**
- Consumes: deterministic indicator functions, structure concepts, and Appendix C costs.
- Produces: complete conditional plan and risk-math workflow used by the case labs.

- [ ] **Step 1: Verify primary indicator definitions and cite original sources**

Use Welles Wilder for ATR and RSI, George Lane for stochastic KD, Gerald Appel for MACD, and John Bollinger's primary material for Bollinger Bands. Use current official Taiwan sources only for market costs. Separate original definitions from later empirical performance claims.

- [ ] **Step 2: Author Chapter 13**

Teach SMA and EMA purpose, lag, slope, crossover limitations, volume averages, true range, ATR, and volatility-scaled observations. Show that ATR has no direction and moving-average stacking can repeat trend information already visible in price.

- [ ] **Step 3: Author Chapter 14**

Teach RSI, KD, MACD, and Bollinger Bands by question answered, calculation concept, warm-up period, lag, saturation, range versus trend behavior, and redundant signals. Include a comparison table that prevents indicator voting.

- [ ] **Step 4: Author Chapter 15**

Build bullish, bearish, and no-trade scenarios from the same chart; specify trigger, invalidation, confirmation, available price space, and abandonment conditions. Exercises grade observable conditions rather than market outcome.

- [ ] **Step 5: Author Chapter 16**

Define stop placement from invalidation, planned risk, position size, round-lot constraints, R multiple, win rate, payoff ratio, expectancy, fee, tax, spread, and slippage. Use hypothetical capital only and link volatile values to Appendix C.

- [ ] **Step 6: Build Appendix B**

Include exact formulas, worked examples, a blank eight-step chart-reading worksheet, a position-sizing worksheet, an R-multiple review table, an expectancy worksheet, and a journal template. Every worked example shows units and rounding.

- [ ] **Step 7: Render Part IV figures and verify calculations**

Render eight SVGs. Recalculate every numerical example with a separate test or short Python expression. Run all unit tests and draft validation. Confirm no chapter presents one risk percentage as universally suitable.

- [ ] **Step 8: Review and commit Task 8**

```powershell
git add README.md chapters/13-moving-averages-volume-average-atr.md chapters/14-rsi-kd-macd-bollinger-bands.md chapters/15-scenarios-triggers-invalidation-no-trade.md chapters/16-stops-position-sizing-r-multiple-expectancy-costs.md chapters/appendix-b-formulas-and-worksheets.md assets/figures/ch13-concept.svg assets/figures/ch13-cases.svg assets/figures/ch14-concept.svg assets/figures/ch14-cases.svg assets/figures/ch15-concept.svg assets/figures/ch15-cases.svg assets/figures/ch16-concept.svg assets/figures/ch16-cases.svg
git diff --cached --check
git diff --cached
git commit -m "docs(part-4): teach indicators and risk planning"
```

---

### Task 9: Part V Reality, Discipline, and Generated Glossary

**Files:**
- Create: `chapters/17-what-candlesticks-cannot-see.md`
- Create: `chapters/18-psychology-journal-paper-trading.md`
- Create: `tools/render_glossary.py`
- Create: `tests/test_render_glossary.py`
- Create: `chapters/appendix-d-glossary.md`
- Create: `assets/figures/ch17-concept.svg`
- Create: `assets/figures/ch17-cases.svg`
- Create: `assets/figures/ch18-concept.svg`
- Create: `assets/figures/ch18-cases.svg`
- Modify: `README.md`

**Interfaces:**
- Consumes: MOPS event sources, the eight-step plan, Appendix B worksheets, and canonical `CONTEXT.md`.
- Produces: `parse_context(path: Path) -> tuple[GlossaryEntry, ...]`
- Produces: `render_glossary(entries: Sequence[GlossaryEntry]) -> str`
- Produces CLI: `python tools/render_glossary.py --source CONTEXT.md --output chapters/appendix-d-glossary.md --check`

- [ ] **Step 1: Author Chapter 17**

Cover earnings, dividends, capital actions, material announcements, suspensions, price-limit effects, index context, industry news, and event gaps. Teach readers to consult official disclosures and to reduce or reject a chart scenario when material context is unknown.

- [ ] **Step 2: Author Chapter 18**

Cover FOMO, anchoring, confirmation bias, loss aversion, moving stops, averaging down without a rule, revenge trading, outcome bias, journal fields, paper-trading limits, and review cadence. Embed the eight-step and R-multiple worksheets from Appendix B by link.

- [ ] **Step 3: Write failing glossary-generation tests**

Tests require every `**Term**：` entry and its `_避免使用_` line from `CONTEXT.md` to appear once in Appendix D, preserve source order, include a generated-file notice, and fail check mode when output differs.

- [ ] **Step 4: Implement and run glossary generation**

Run: `python -m unittest tests.test_render_glossary -v`

Expected before implementation: FAIL.

Implement the parser and renderer, then run:

```powershell
python tools/render_glossary.py --source CONTEXT.md --output chapters/appendix-d-glossary.md
python tools/render_glossary.py --source CONTEXT.md --output chapters/appendix-d-glossary.md --check
```

Expected: PASS and no diff after check mode.

- [ ] **Step 5: Render Part V figures and update navigation**

Render four SVGs, add Chapter 17, Chapter 18, and Appendix D links to `README.md`, and confirm every external link is an official source or a primary reference.

- [ ] **Step 6: Run Part V checks**

Run all unit tests and draft validation. Search for personal experiences stated in first person and replace them with sourced scenarios or explicit hypothetical examples.

- [ ] **Step 7: Review and commit Task 9**

```powershell
git add README.md chapters/17-what-candlesticks-cannot-see.md chapters/18-psychology-journal-paper-trading.md chapters/appendix-d-glossary.md tools/render_glossary.py tests/test_render_glossary.py assets/figures/ch17-concept.svg assets/figures/ch17-cases.svg assets/figures/ch18-concept.svg assets/figures/ch18-cases.svg
git diff --cached --check
git diff --cached
git commit -m "docs(part-5): add market limits and trading discipline"
```

---

### Task 10: Progressive Replay Lab and Ten-Case Capstone

**Files:**
- Create: `chapters/19-progressive-chart-replay-lab.md`
- Create: `chapters/20-capstone-ten-cases.md`
- Create: `assets/figures/ch19-replay-01.svg`
- Create: `assets/figures/ch19-replay-02.svg`
- Create: `assets/figures/ch19-replay-03.svg`
- Create: `assets/figures/ch19-replay-04.svg`
- Create: `assets/figures/ch19-replay-05.svg`
- Create: `assets/figures/ch20-case-01.svg`
- Create: `assets/figures/ch20-case-02.svg`
- Create: `assets/figures/ch20-case-03.svg`
- Create: `assets/figures/ch20-case-04.svg`
- Create: `assets/figures/ch20-case-05.svg`
- Create: `assets/figures/ch20-case-06.svg`
- Create: `assets/figures/ch20-case-07.svg`
- Create: `assets/figures/ch20-case-08.svg`
- Create: `assets/figures/ch20-case-09.svg`
- Create: `assets/figures/ch20-case-10.svg`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior chapters, worksheets, market adapters, indicators, and renderer.
- Produces: fifteen unseen-decision charts, folded answers, and a common scoring rubric.

- [ ] **Step 1: Define the shared assessment rubric**

Score each response on observation, timeframe context, zone and market state, two scenarios, trigger, invalidation, risk calculation, no-trade condition, and separation of evidence from hindsight. Use a ten-point rubric with one point per criterion and one point for internally consistent reasoning; future price direction is not a criterion.

- [ ] **Step 2: Select five progressive replay cases for Chapter 19**

Cover trend continuation, range rejection, false breakout, volatility expansion, and low-liquidity ambiguity. Each case reveals bars in three stages and requires the reader to update the plan without seeing the final outcome.

- [ ] **Step 3: Author Chapter 19 and render five replay figures**

For each case, present initial data, first decision, one additional segment, revised decision, final segment, scoring rubric, and folded analysis. Verify no image filename or alt text reveals the final result before the answer section.

- [ ] **Step 4: Select ten capstone cases with balanced outcomes**

Include TWSE and TPEx, daily and weekly context, uptrend, downtrend, range, high volatility, low liquidity, corporate-event risk, indicator disagreement, valid no-trade, and risk-too-large scenarios. Do not choose ten successful textbook signals.

- [ ] **Step 5: Author Chapter 20 and render ten independent figures**

Each prompt asks for the complete eight-step response. Put all scoring and outcome discussion in folded answer sections after the ten prompts so a reader can complete the assessment without accidental answer leakage.

- [ ] **Step 6: Run metadata and future-leakage checks**

Add validator rules that reject `result`, `winner`, `failed`, `profit`, `loss`, `上漲`, or `下跌` in pre-answer capstone image filenames and prompt alt text. Add focused tests for the rule, then run all tests and draft validation.

- [ ] **Step 7: Update complete navigation and run release validation**

Link Chapters 19 and 20 from `README.md`, convert every planned item to a working link, and run:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
python tools/validate_book.py --root . --mode release
python tools/render_glossary.py --source CONTEXT.md --output chapters/appendix-d-glossary.md --check
```

Expected: all commands PASS.

- [ ] **Step 8: Review and commit Task 10**

```powershell
git add README.md chapters/19-progressive-chart-replay-lab.md chapters/20-capstone-ten-cases.md tools/validate_book.py tests/test_validate_book.py assets/figures/ch19-replay-01.svg assets/figures/ch19-replay-02.svg assets/figures/ch19-replay-03.svg assets/figures/ch19-replay-04.svg assets/figures/ch19-replay-05.svg assets/figures/ch20-case-01.svg assets/figures/ch20-case-02.svg assets/figures/ch20-case-03.svg assets/figures/ch20-case-04.svg assets/figures/ch20-case-05.svg assets/figures/ch20-case-06.svg assets/figures/ch20-case-07.svg assets/figures/ch20-case-08.svg assets/figures/ch20-case-09.svg assets/figures/ch20-case-10.svg
git diff --cached --check
git diff --cached
git commit -m "docs(cases): add replay lab and capstone"
```

---

### Task 11: Cross-Book Audit, Fresh-Reader Test, and Local Release Gate

**Files:**
- Modify only files with verified findings from the audit.

**Interfaces:**
- Consumes: complete book, tests, figures, sources, design specification, and canonical glossary.
- Produces: a clean local `main` whose HEAD passes every release gate. No new audit, completion, summary, or handoff document is created.

- [ ] **Step 1: Run the complete automated gate from a clean checkout state**

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
python tools/validate_book.py --root . --mode release
python tools/render_glossary.py --source CONTEXT.md --output chapters/appendix-d-glossary.md --check
git diff --check
git status --short --branch
```

Expected: tests and validators PASS; working tree is clean before reader-driven corrections.

- [ ] **Step 2: Audit specification coverage without creating a report file**

Map each section of `docs/superpowers/specs/2026-08-10-taiwan-stock-candlestick-guide-design.md` to an existing chapter, appendix, tool, test, or figure. Correct missing coverage in its canonical file. Confirm all twenty chapters, four appendices, fixed eight-step process, evidence levels, official provenance, valid/failed/ambiguous cases, risk math, accessibility, and ten-case capstone are present.

- [ ] **Step 3: Run financial-integrity review**

Search all reader-facing Markdown for guarantee language, unsupported success rates, live recommendations, exact-price certainty, universal risk percentages, and outcome-based grading. Inspect every match in context; remove or qualify invalid claims and retain only explicit warnings or quoted terms when clearly labeled.

- [ ] **Step 4: Run source and maintenance review**

Open every external source, confirm it supports the nearby claim, replace dead links with the current primary source, ensure all volatile Taiwan rules are confined to Appendix C, and verify the checked date. Do not replace a missing primary source with an unsourced secondary summary.

- [ ] **Step 5: Run a fresh-reader question test**

Provide a context-free reader with only the completed repository and ask these ten questions:

1. 一根長紅 K 線是否足以判斷隔天上漲？
2. 支撐區與精確支撐價有什麼差別？
3. 如何區分觀察和解釋？
4. 突破後要檢查哪些觸發與失效條件？
5. ATR 能不能判斷上漲方向？
6. 除息造成的缺口為什麼不能直接視為賣壓？
7. 勝率高是否代表策略期望值一定為正？
8. 同一型態在趨勢與區間中如何改變意義？
9. 哪些情況下不交易可以是最佳答案？
10. 如何用完整八步流程回答一張陌生圖表？

Record findings in the active task conversation and correct canonical chapters directly. Do not create a reader-test report file.

- [ ] **Step 6: Run fresh-reader ambiguity and contradiction tests**

Ask a context-free reader to identify undefined terms, assumed knowledge, contradictions, repeated rules, inaccessible figures, and sentences that imply guaranteed profit. Correct every validated finding in the canonical chapter, `CONTEXT.md`, or tool.

- [ ] **Step 7: Re-run all gates after corrections**

Run the commands from Step 1 again. Expected: all PASS, `git diff --check` produces no output, glossary check produces no diff, and only intentional reviewed corrections remain unstaged.

- [ ] **Step 8: Review and commit the final audit corrections**

Stage only files changed by validated findings, inspect `git diff --cached`, and commit:

```powershell
git commit -m "docs: complete beginner reader validation"
```

If no corrections were required, do not create an empty commit.

- [ ] **Step 9: Confirm local delivery without pushing**

```powershell
git status --short --branch
git log --oneline --decorate -12
git remote -v
```

Expected: clean `main`, `origin` points to `https://github.com/eric861129/taiwan-stock-candlestick-guide.git`, and no push occurs without a later explicit instruction.
