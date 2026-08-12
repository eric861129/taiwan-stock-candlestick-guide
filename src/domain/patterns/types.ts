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
  'talib-two-crows',
  'talib-three-inside',
  'talib-three-line-strike',
  'talib-three-outside',
  'talib-three-stars-in-the-south',
  'talib-abandoned-baby',
  'talib-advance-block',
  'talib-belt-hold',
  'talib-breakaway',
  'talib-closing-marubozu',
  'talib-concealing-baby-swallow',
  'talib-counterattack',
  'talib-doji-star',
  'talib-dragonfly-doji',
  'talib-evening-doji-star',
  'talib-gap-side-by-side-white-lines',
  'talib-gravestone-doji',
  'talib-hanging-man',
  'talib-harami-cross',
  'talib-high-wave',
  'talib-hikkake',
  'talib-modified-hikkake',
  'talib-homing-pigeon',
  'range',
  'triangle-consolidation',
  'flag-consolidation',
  'double-top',
  'double-bottom',
  'head-and-shoulders-top',
  'head-and-shoulders-bottom',
  'false-breakout',
  'rounding-top',
  'rounding-bottom',
  'triple-top',
  'triple-bottom',
  'symmetrical-triangle',
  'ascending-triangle',
  'descending-triangle',
  'bullish-rectangle',
  'bearish-rectangle',
  'pennant',
  'rising-wedge',
  'falling-wedge',
  'broadening-top',
  'broadening-bottom',
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

/** 同一份正規型態內容可以出現的三個教學入口。 */
export const PATTERN_COLLECTION_IDS = [
  'candlestick-reference',
  'price-structure',
  'talib-advanced',
] as const;

/** 型態集合的穩定識別碼。 */
export type PatternCollectionId = (typeof PATTERN_COLLECTION_IDS)[number];

/** 型態本身的時間尺度與教學用途，避免把短窗 K 棒和完整價格結構混為一談。 */
export type PatternKind =
  | 'candlestick-pattern'
  | 'chart-pattern'
  | 'market-observation'
  | 'guardrail';

/** 新版自動化支援語意；保留舊 matchSupport 供現有 matcher 相容使用。 */
export type AutomationSupport =
  | 'short-window'
  | 'structure'
  | 'teaching-only'
  | 'guardrail';

/** TA-Lib Pattern Recognition 的官方函式名稱格式。 */
export type TalibPatternFunction = `CDL${string}`;

/** 官方 TA-Lib 函式在本站的執行狀態；目前僅提供可查核教材，不執行原生函式。 */
export type TalibImplementationSupport = 'teaching-only';

/** 進階 K 棒卡使用的方向標籤；只描述函式輸出語意，不是未來預測。 */
export type PatternDirection = 'bullish' | 'bearish' | 'both' | 'neutral';

/** 進階 K 棒卡的教學用途。 */
export type PatternPurpose =
  | 'reversal'
  | 'continuation'
  | 'reversal-or-continuation'
  | 'indecision'
  | 'weakening';

/** 教材型態卡的閱讀分類。 */
export type PatternCategory =
  | '單根與描述型'
  | '雙根與三根組合'
  | '進階 K 棒組合'
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
  collections: readonly PatternCollectionId[];
  kind: PatternKind;
  automationSupport: AutomationSupport;
  talibFunction?: TalibPatternFunction;
  talibImplementationSupport?: TalibImplementationSupport;
  talibObservableDefinition?: string;
  talibDataRequirements?: readonly string[];
  minimumBars?: number;
  maximumBars?: number;
  patternDirection?: PatternDirection;
  patternPurpose?: PatternPurpose;
  geometrySteps?: readonly string[];
  relatedPatternIds?: readonly PatternCardId[];
  category: PatternCategory;
  matchSupport: MatchSupport;
  sourceRow: string;
  sourceNotes: readonly string[];
  oneSentenceMeaning: string;
  observableDefinition: string;
  dataRequirements: readonly string[];
  background: readonly string[];
  confirmationGuidance?: readonly string[];
  commonMisreads: readonly string[];
  invalidationGuidance: readonly string[];
  limitations: readonly string[];
  lessonLinks: readonly string[];
  matcher?: PatternMatcherDefinition;
  guardrail?: PatternGuardrailDefinition;
}

/** 建立正規卡片前的內容輸入；集合、種類與支援狀態由單一 factory 衍生。 */
export type PatternCardInput = Omit<
  PatternCardDefinition,
  'slug' | 'collections' | 'kind' | 'automationSupport' | 'talibFunction'
> & { slug?: string };

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
