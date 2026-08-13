import type { OhlcvBar, PriceMode, StockSnapshot, Timeframe } from '../market-data/types';
import type { PatternCardId } from '../patterns/types';

/** 首批可由結構引擎自動比對的正規價格結構卡。 */
export type StructureId = Extract<PatternCardId,
  | 'range'
  | 'triangle-consolidation'
  | 'flag-consolidation'
  | 'double-top'
  | 'double-bottom'
  | 'head-and-shoulders-top'
  | 'head-and-shoulders-bottom'
  | 'false-breakout'
  | 'rounding-top'
>;

/** 價格結構在指定資料截止日的可觀察狀態。 */
export type StructureStatus = 'forming' | 'confirmed' | 'invalid' | 'insufficient-evidence';

/** 結構候選的方向只描述已觀察到的邊界離開，並非價格預測。 */
export type StructureDirection = 'up' | 'down' | 'undetermined';

/** 結構規則中可呈現的條件群組。 */
export type StructureRuleGroup = 'required' | 'supporting' | 'invalidating';

/** 版本化結構規則的單條可解釋結果。 */
export interface StructureRuleEvaluation {
  ruleId: string;
  label: string;
  group: StructureRuleGroup;
  state: 'met' | 'not-met' | 'unavailable';
  explanation: string;
}

/** 帶有資料列索引、日期與 ATR 顯著度的轉折點。 */
export interface StructurePivot {
  version: 'structure-pivot-v1';
  barIndex: number;
  date: string;
  price: number;
  kind: 'high' | 'low';
  prominenceAtr: number;
}

/** 用同一條公式描述一條已驗證的價格邊界。 */
export interface StructureBoundary {
  version: 'structure-boundary-v1';
  id: 'upper' | 'lower';
  startBarIndex: number;
  endBarIndex: number;
  slopePerBar: number;
  intercept: number;
  startPrice: number;
  endPrice: number;
  touchBarIndexes: readonly number[];
  normalizedResidualAtr: number;
}

/** 候選在原始 K 棒序列中實際使用的連續範圍。 */
export interface StructureWindow {
  version: 'structure-window-v1';
  startBarIndex: number;
  endBarIndex: number;
  startDate: string;
  endDate: string;
  barCount: number;
}

/** 供圖表共用座標轉換的線段資料；圖表不會重新判斷型態。 */
export interface StructureOverlaySegment {
  id: string;
  kind: 'boundary' | 'confirmation' | 'invalidation' | 'outline';
  label: string;
  startBarIndex: number;
  startPrice: number;
  endBarIndex: number;
  endPrice: number;
  lineStyle: 'solid' | 'dashed';
}

/** 圖表上的可朗讀轉折錨點。 */
export interface StructureOverlayAnchor {
  id: string;
  barIndex: number;
  date: string;
  price: number;
  label: string;
}

/** 僅由已確認候選提供、且明確排除價格預測的條件式情境。 */
export interface StructureScenarioOverlay {
  label: '條件式情境，非價格預測';
  direction: Exclude<StructureDirection, 'undetermined'>;
  boundaryId?: 'upper' | 'lower';
  conditions?: readonly {
    kind: 'continuation' | 'retest' | 'invalidation';
    label: string;
    condition: string;
  }[];
}

/** 單一候選可畫到 K 線圖上的一套疊線。 */
export interface StructureOverlay {
  candidateId: string;
  window: StructureWindow;
  segments: readonly StructureOverlaySegment[];
  anchors: readonly StructureOverlayAnchor[];
  scenario?: StructureScenarioOverlay;
}

/** 已通過最低門檻、可進入零至三名排行榜的結構候選。 */
export interface StructureCandidate {
  candidateId: string;
  structureId: StructureId;
  timeframe: Timeframe;
  priceMode: PriceMode;
  ruleFit: number;
  geometryCompleteness: number;
  dataCompleteness: number;
  status: Extract<StructureStatus, 'forming' | 'confirmed'>;
  direction: StructureDirection;
  window: StructureWindow;
  anchors: readonly StructurePivot[];
  boundaries: readonly StructureBoundary[];
  evaluations: readonly StructureRuleEvaluation[];
  confirmationCondition: string;
  invalidationCondition: string;
  warnings: readonly string[];
  matcherVersion: string;
  overlay: StructureOverlay;
}

/** 外觀接近但不可列為目前候選的結構教學參考。 */
export interface StructureNearMiss {
  structureId: StructureId;
  status: Extract<StructureStatus, 'invalid' | 'insufficient-evidence'>;
  ruleFit: number;
  missingConditions: readonly string[];
  window?: StructureWindow;
  anchors?: readonly StructurePivot[];
  boundaries?: readonly StructureBoundary[];
  confirmationCondition?: string;
  invalidationCondition?: string;
  overlay?: StructureOverlay;
  evaluations: readonly StructureRuleEvaluation[];
}

/** 一次分析時 ATR 計算的可稽核資訊。 */
export interface StructureAtrFeatures {
  version: 'atr-v1';
  period: number;
  latest: number | null;
  values: readonly (number | null)[];
}

/** 結構特徵擷取器的版本化輸出。 */
export interface StructureFeatures {
  configVersion: 'structure-features-v2';
  sourceBarCount: number;
  analyzedBarCount: number;
  smoothedClose: readonly (number | null)[];
  atr: StructureAtrFeatures;
  pivots: readonly StructurePivot[];
  warnings: readonly string[];
}

/** 所有結構規則必須經由此版本化設定取得門檻。 */
export interface StructureEngineConfig {
  version: 'structure-features-v2';
  maximumBars: number;
  minimumBars: number;
  atr: {
    period: number;
  };
  pivot: {
    width: number;
    minimumProminenceAtr: number;
    minimumSeparationBars: number;
  };
  boundaries: {
    touchToleranceAtr: number;
    maximumResidualAtr: number;
    breakoutAtr: number;
    insideCloseRatio: number;
  };
  box: {
    minimumWindowBars: number;
    maximumSlopeAtrPerBar: number;
    minimumRuleFit: number;
  };
  triangle: {
    minimumWindowBars: number;
    minimumSlopeAtrPerBar: number;
    minimumCompressionRatio: number;
    minimumApexProgress: number;
    maximumApexProgress: number;
    minimumRuleFit: number;
  };
}

/** 結構引擎僅讀取此資料快照，不進行網路或 UI 副作用。 */
export type StructureAnalysisInput = Pick<
  StockSnapshot,
  'bars' | 'corporateActions' | 'noQuoteEvidence' | 'timeframe' | 'priceMode' | 'cutoffDate'
>;

/** 純函式結構分析的可選明確 cutoff 與版本化設定。 */
export interface AnalyzeStructuresOptions {
  cutoffDate?: string;
  config?: StructureEngineConfig;
}

/** 結構 matcher 的完整、可重播結果。 */
export interface StructureAnalysisResult {
  status: 'matched' | 'no-clear-pattern' | 'insufficient-evidence';
  matcherVersion: 'structure-v2';
  timeframe: Timeframe;
  priceMode: PriceMode;
  cutoffDate: string | null;
  features: StructureFeatures;
  candidates: readonly StructureCandidate[];
  nearMisses: readonly StructureNearMiss[];
  reasonCodes: readonly string[];
}

/** 內部擷取後仍保留原快照資料列索引的 K 棒。 */
export interface IndexedStructureBar {
  sourceIndex: number;
  bar: OhlcvBar;
}
