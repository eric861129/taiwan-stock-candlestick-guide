/** 型態卡發布後不變的正規識別碼。 */
export const PATTERN_CARD_IDS = [
  'relative-long-body',
  'relative-small-body',
  'doji',
  'hammer',
  'shooting-star',
  'near-marubozu',
  'close-rejection-indecision',
  'bullish-engulfing',
  'bearish-engulfing',
  'bullish-harami',
  'bearish-harami',
  'piercing-line',
  'dark-cloud-cover',
  'morning-star',
  'evening-star',
  'three-advancing-candles',
  'three-falling-candles',
  'range',
  'triangle-consolidation',
  'flag-consolidation',
  'double-top',
  'double-bottom',
  'head-and-shoulders-top',
  'head-and-shoulders-bottom',
  'false-breakout',
  'volume-expansion',
  'volume-contraction',
  'effort-vs-result',
  'volume-climax-risk',
  'low-liquidity-distortion',
  'failed-signal',
  'insufficient-evidence',
] as const;

/** 型態卡的穩定識別碼。 */
export type PatternCardId = (typeof PATTERN_CARD_IDS)[number];

/** 教材型態卡的閱讀分類。 */
export type PatternCategory =
  | '單根與描述型'
  | '雙根與三根組合'
  | '結構型態'
  | '量價、流動性與守門';

/** 第一版的自動比對支援範圍。 */
export type MatchSupport = 'mvp' | 'catalog-only' | 'guardrail';

/** 第一版可比對卡共用的規則族。 */
export type RuleFamilyId =
  | 'relative-body-size'
  | 'doji'
  | 'single-candle-wick-geometry'
  | 'near-marubozu'
  | 'candle-descriptors'
  | 'engulfing-body'
  | 'harami-body'
  | 'midpoint-penetration'
  | 'three-candle-star'
  | 'three-candle-sequence';

/** 一條規則在計分架構中的角色。 */
export type PatternRuleGroup = 'required' | 'context' | 'supporting' | 'invalidating';

/** 可由後續規則引擎執行的單一型態條件。 */
export interface PatternRuleBinding {
  ruleId: string;
  group: PatternRuleGroup;
  weight: number;
  parameters: Readonly<Record<string, number | string | boolean>>;
  teachingLabel: string;
}

/** 可自動比對型態的版本化規則設定。 */
export interface PatternMatcherDefinition {
  ruleFamilyId: RuleFamilyId;
  minimumBars: number;
  minimumScore: number;
  rules: readonly PatternRuleBinding[];
}

/** 不應被日 OHLCV 自動命名時，卡片提供的守門提醒。 */
export interface PatternGuardrailDefinition {
  title: string;
  whyNotInMvp: string;
  readerAction: string;
}

/** UI 與後續 matcher 共用的唯一型態卡來源。 */
export interface PatternCardDefinition {
  id: PatternCardId;
  slug: string;
  nameZhTw: string;
  nameEn: string;
  aliases: readonly string[];
  category: PatternCategory;
  matchSupport: MatchSupport;
  sourceRow: string;
  sourceNotes: readonly string[];
  oneSentenceMeaning: string;
  observableDefinition: string;
  dataRequirements: readonly string[];
  background: readonly string[];
  commonMisreads: readonly string[];
  invalidationGuidance: readonly string[];
  limitations: readonly string[];
  lessonLinks: readonly string[];
  matcher?: PatternMatcherDefinition;
  guardrail?: PatternGuardrailDefinition;
}

/** SVG 圖例可重用的 K 線資料。 */
export interface CandleIllustrationPrimitive {
  kind: 'candle';
  x: number;
  open: number;
  close: number;
  high: number;
  low: number;
  direction: 'up' | 'down' | 'neutral';
  label: string;
}

/** SVG 圖例可重用的趨勢或結構線資料。 */
export interface TrendLineIllustrationPrimitive {
  kind: 'trend-line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

/** SVG 圖例可重用的區域資料。 */
export interface ZoneIllustrationPrimitive {
  kind: 'zone';
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** SVG 圖例可重用的成交量柱資料。 */
export interface VolumeBarIllustrationPrimitive {
  kind: 'volume-bar';
  x: number;
  height: number;
  label: string;
}

/** SVG 圖例可重用的文字註記資料。 */
export interface AnnotationIllustrationPrimitive {
  kind: 'annotation';
  x: number;
  y: number;
  text: string;
}

/** 型態卡 SVG 圖例的無障礙資料契約。 */
export interface PatternIllustration {
  title: string;
  altTextZhTw: string;
  primitives: readonly (
    | CandleIllustrationPrimitive
    | TrendLineIllustrationPrimitive
    | ZoneIllustrationPrimitive
    | VolumeBarIllustrationPrimitive
    | AnnotationIllustrationPrimitive
  )[];
}
