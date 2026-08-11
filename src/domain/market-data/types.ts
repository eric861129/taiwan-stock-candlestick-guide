import type { PatternCardId, PatternRuleGroup } from '../patterns/types';

/** 支援的盤後市場。 */
export type Market = 'TWSE' | 'TPEx';

/** 資料截止新鮮度。 */
export type Freshness = 'fresh' | 'one-session-behind' | 'stale' | 'unknown';

/** 原始日線 OHLCV 資料；價格容忍值由資料管線依來源精度與升降單位先行算出。 */
export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeShares: number;
  transactionCount?: number;
  sourcePrecision: number;
  comparisonUnit: number;
  completed?: boolean;
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
  code: string;
  name: string;
  market: Market;
  securityType: 'common-stock';
  priceMode: 'raw';
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
  timeframe: '1d';
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
