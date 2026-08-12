import type {
  AnalysisResult,
  OhlcvBar,
  PriceMode,
  StockSnapshot,
  Timeframe,
} from '../market-data/types';
import type { StructureId } from '../structures/types';
import type {
  StructureAnalysisResult,
  StructureCandidate,
  StructureDirection,
} from '../structures/types';

/** 由長到短的固定學習順序。 */
export const MULTI_TIMEFRAME_ORDER = ['1m', '1w', '1d'] as const satisfies readonly Timeframe[];

/** 跨週期只描述背景關係，不代表交易訊號或未來價格。 */
export type MultiTimeframeSummaryState =
  | 'aligned'
  | 'partially-aligned'
  | 'divergent'
  | 'insufficient-evidence';

/** 個別週期的可比較背景；整理結構可明確保留為中性。 */
export type MultiTimeframeBackgroundDirection = StructureDirection | 'neutral';

/** 協調器的價格模式及歷史截止設定。 */
export interface CoordinateMultiTimeframeOptions {
  priceMode: PriceMode;
  cutoffDate?: string;
  selectedStructureIds?: Partial<Readonly<Record<Timeframe, StructureId>>>;
}

/** 一個時間週期的兩套 matcher 原始輸出與教學背景。 */
export interface TimeframeAnalysis {
  timeframe: Timeframe;
  learningRole: 'long-term-background' | 'medium-term-structure' | 'short-term-check';
  snapshot: StockSnapshot;
  cutoffDate: string;
  latestCompletedBarDate: string | null;
  availableCompletedBarCount: number;
  formingBar: OhlcvBar | null;
  structureAnalysis: StructureAnalysisResult;
  patternAnalysis: AnalysisResult;
  selectedCandidate: StructureCandidate | null;
  selectedCandidateId: string | null;
  selectedStructureId: StructureId | null;
  backgroundDirection: MultiTimeframeBackgroundDirection;
  backgroundHint: string;
  warnings: readonly string[];
}

/** 跨週期摘要不含總分，只保留背景關係與可朗讀說明。 */
export interface MultiTimeframeSummary {
  state: MultiTimeframeSummaryState;
  label: string;
  explanation: string;
}

/** 單次純函式協調的完整結果。 */
export interface MultiTimeframeAnalysisResult {
  code: StockSnapshot['code'];
  requestedPriceMode: PriceMode;
  priceMode: PriceMode;
  priceModeResolution: 'requested' | 'fallback-to-raw';
  cutoffDate: string;
  timeframes: readonly TimeframeAnalysis[];
  summary: MultiTimeframeSummary;
  warnings: readonly string[];
}
