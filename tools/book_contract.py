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
