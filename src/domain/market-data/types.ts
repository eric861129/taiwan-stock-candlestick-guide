import type { PatternCardId, PatternRuleGroup } from '../patterns/types';

/** 支援的盤後市場。 */
export type Market = 'TWSE' | 'TPEx';

/** 資料截止新鮮度。 */
export type Freshness = 'fresh' | 'one-session-behind' | 'stale' | 'unknown';

/** 可在同一市場快照中切換的 K 線時間週期。 */
export type Timeframe = '1d' | '1w' | '1m';

/** 聚合週期的官方交易日證據是否完整。 */
export type BarEvidenceStatus = 'complete' | 'incomplete';

/** 原始日線 OHLCV 資料；價格容忍值由資料管線依來源精度與升降單位先行算出。 */
export interface OhlcvBar {
  date: string;
  /** 此 K 棒涵蓋期間的第一個交易日；舊測試資料未提供時由資料來源相容層保留。 */
  periodStart?: string;
  /** 此 K 棒涵蓋期間的最後一個交易日，與 date 同為該棒的辨識日期。 */
  periodEnd?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeShares: number;
  transactionCount?: number;
  sourcePrecision: number;
  comparisonUnit: number;
  /** 是否已結束且不會再因同一週期新增交易日而改變。 */
  completed?: boolean;
  /** 聚合期間是否缺少官方可用的交易日證據。 */
  evidenceStatus?: BarEvidenceStatus;
  /** 造成聚合證據不足的交易日；完整 K 棒必須為空陣列。 */
  missingSessionDates?: readonly string[];
}

/** 某一價格模式、某一時間週期的完成與形成中 K 棒。 */
export interface TimeframeSeries {
  completedBars: readonly OhlcvBar[];
  formingBar: OhlcvBar | null;
}

/** 可供圖表與 matcher 使用的價格模式資料。 */
export interface AvailablePriceMode {
  status: 'available';
  reasonCodes: readonly string[];
  warnings: readonly string[];
  timeframes: Readonly<Record<Timeframe, TimeframeSeries>>;
}

/** 因證據或資料工作尚未完成而不可供分析的價格模式。 */
export interface UnavailablePriceMode {
  status: 'unavailable';
  reasonCodes: readonly string[];
  warnings: readonly string[];
}

/** 目前快照中可稽核保留的價格模式集合。 */
export interface PriceModes {
  raw: AvailablePriceMode;
  adjusted: AvailablePriceMode | UnavailablePriceMode;
}

/** 會影響價格連續性判讀的公司行動來源紀錄。 */
export interface CorporateAction {
  date: string;
  type: 'cash-dividend' | 'stock-dividend' | 'capital-reduction' | 'split' | 'other';
  affectsPriceContinuity: boolean;
  sourceUrl: string;
  verifiedAt: string;
}

/** 官方未報價或交易所公告停止買賣時的可稽核證據種類。 */
export type NoQuoteReason = 'official-no-quote' | 'official-suspension';

/** 官方交易日回應明示缺少完整 OHLC，或公告停止買賣時的可稽核證據。 */
export interface NoQuoteEvidence {
  market: Market;
  code: string;
  date: string;
  reason: NoQuoteReason;
  sourceUrl: string;
}

/** 單一支援普通股的版本化盤後快照。 */
export interface StockSnapshot {
  schemaVersion: number;
  /** 發布 JSON 的行情快照版本；v4 起保留三個時間週期。 */
  snapshotVersion?: number;
  code: string;
  name: string;
  market: Market;
  securityType: 'common-stock';
  priceMode: 'raw';
  /** 目前被圖表與 matcher 選取的週期；未指定時視為日 K。 */
  timeframe?: Timeframe;
  /** 所有價格模式與三個時間週期，供切換時重新建立 selected bars。 */
  priceModes?: PriceModes;
  currency: 'TWD';
  comparisonUnitPolicy: {
    version: number;
    effectiveFrom: string;
    sourceUrl: string;
  };
  bars: readonly OhlcvBar[];
  noQuoteEvidence: readonly NoQuoteEvidence[];
  corporateActions: readonly CorporateAction[];
  sourceUrls: readonly string[];
  snapshotHash?: string;
  cutoffDate?: string;
  freshness?: Freshness;
}

/** 規則評估在結果中可呈現的三種狀態。 */
export type RuleState = 'met' | 'not-met' | 'unavailable';

/** 單條卡片規則的可解釋評估結果。 */
export interface RuleEvaluation {
  ruleId: string;
  label: string;
  group: PatternRuleGroup;
  state: RuleState;
  weight: number;
  explanation: string;
  reasonCode?: string;
}

/** 一張通過門檻的型態卡候選。 */
export interface PatternMatchResult {
  cardId: PatternCardId;
  score: number;
  label: '高度符合' | '部分符合';
  dataCompleteness: number;
  analyzedFrom: string;
  analyzedTo: string;
  evaluations: readonly RuleEvaluation[];
  warnings: readonly string[];
}

/** 每次分析都要隨結果保留的資料邊界與可用性。 */
export interface AnalysisContext {
  snapshotVersion: number;
  snapshotHash: string;
  market: Market;
  cutoffDate: string;
  freshness: Freshness;
  timeframe: Timeframe;
  analyzedFrom: string;
  analyzedTo: string;
  analyzedBarCount: number;
  dataCompleteness: number;
  reasonCodes: readonly string[];
  evaluatedCardCount: number;
  unavailableCardIds: readonly PatternCardId[];
  affectedRuleIds: readonly string[];
  suppressedRules: readonly string[];
  corporateActions: readonly CorporateAction[];
  warnings: readonly string[];
}

/** 資料載入或格式失敗時的可呈現原因。 */
export type UnavailableReason = 'not-found' | 'unsupported-security' | 'load-error' | 'schema-error';

/** Matcher 的判讀結果；候選、無候選、證據不足與系統不可用保持可區分。 */
export type AnalysisResult =
  | { status: 'matched'; context: AnalysisContext; matches: readonly PatternMatchResult[] }
  | { status: 'no-clear-pattern'; context: AnalysisContext; matches: readonly [] }
  | { status: 'insufficient-evidence'; context: AnalysisContext; reasonCodes: readonly string[] }
  | { status: 'unavailable'; reason: UnavailableReason; message: string; context?: AnalysisContext };
