/** 學習路線中的單一章節；available 永遠為 true，確保閱讀不被測驗鎖住。 */
export interface LearningChapter {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly link: string;
  readonly available: true;
}

/** 五階段學習路線的公開資料結構。 */
export interface LearningStage {
  readonly id: `stage-${number}`;
  readonly title: string;
  readonly summary: string;
  readonly chapters: readonly LearningChapter[];
}

const chapterDefinitions = [
  ['第 1 章：K 線能回答與不能回答的問題', '01-what-candlesticks-can-and-cannot-answer'],
  ['第 2 章：OHLC、實體、影線與顏色', '02-ohlc-body-wicks-colors'],
  ['第 3 章：週期、原始價格與調整後價格', '03-timeframes-raw-adjusted-prices'],
  ['第 4 章：成交量、流動性與台股市場基礎', '04-volume-liquidity-taiwan-market-basics'],
  ['第 5 章：波峰、波谷與趨勢結構', '05-swing-highs-lows-trend-structure'],
  ['第 6 章：關鍵區域、支撐區與壓力區', '06-key-zones-support-resistance'],
  ['第 7 章：缺口、突破、回測與假突破', '07-gaps-breakouts-retests-false-breakouts'],
  ['第 8 章：多時間週期與市場狀態三面向', '08-multiple-timeframes-market-state'],
  ['第 9 章：單根 K 線：強弱、拒絕與猶豫', '09-single-candlestick-signals'],
  ['第 10 章：雙根與三根 K 線組合', '10-two-three-candlestick-patterns'],
  ['第 11 章：整理、反轉與延續型態', '11-consolidation-reversal-continuation-patterns'],
  ['第 12 章：量價關係、低流動性與失敗訊號', '12-volume-price-liquidity-failed-signals'],
  ['第 13 章：移動平均、成交量均量與 ATR', '13-moving-averages-volume-average-atr'],
  ['第 14 章：RSI、KD、MACD 與布林通道', '14-rsi-kd-macd-bollinger-bands'],
  ['第 15 章：情境、觸發、失效與放棄交易', '15-scenarios-triggers-invalidation-no-trade'],
  ['第 16 章：停損、部位、R 倍數、期望值與成本', '16-stops-position-sizing-r-multiple-expectancy-costs'],
  ['第 17 章：K 線看不到的財報、消息與制度事件', '17-what-candlesticks-cannot-see'],
  ['第 18 章：心理偏誤、交易紀錄與紙上交易', '18-psychology-journal-paper-trading'],
  ['第 19 章：漸進式遮圖案例實驗室', '19-progressive-chart-replay-lab'],
  ['第 20 章：十組綜合案例與能力驗收', '20-capstone-ten-cases'],
] as const;

const chapters: readonly LearningChapter[] = chapterDefinitions.map(([title, slug], index) => ({
  id: `chapter-${String(index + 1).padStart(2, '0')}`,
  number: index + 1,
  title,
  link: `/chapters/${slug}`,
  available: true,
}));

const stageDefinitions = [
  ['stage-1', '讀懂一根 K 線', '先分辨觀察事實、時間週期與成交量，建立不預測的閱讀起點。', [1, 4]],
  ['stage-2', '看見結構與位置', '把波峰波谷、關鍵區域、缺口與多週期背景接起來。', [5, 8]],
  ['stage-3', '辨識型態與證據', '從單根、組合到量價失敗訊號，練習用條件描述而非背名稱。', [9, 12]],
  ['stage-4', '建立風險邊界', '使用指標、情境、觸發與失效條件，知道何時可以放棄交易。', [13, 18]],
  ['stage-5', '整合與回顧', '在遮圖實驗與綜合案例中記錄證據、檢查偏誤並完成能力驗收。', [19, 20]],
] as const;

/** 核准的五階段路線；所有二十章連結均保持開放。 */
export const LEARNING_STAGES: readonly LearningStage[] = stageDefinitions.map(
  ([id, title, summary, [start, end]]) => ({
    id,
    title,
    summary,
    chapters: chapters.slice(start - 1, end),
  }),
);

export function getLearningStage(stageId: string): LearningStage {
  const stage = LEARNING_STAGES.find((candidate) => candidate.id === stageId);
  if (!stage) {
    throw new Error('找不到學習階段');
  }
  return stage;
}
