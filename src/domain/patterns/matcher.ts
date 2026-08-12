import type {
  AnalysisContext,
  AnalysisResult,
  CorporateAction,
  NoQuoteEvidence,
  OhlcvBar,
  PatternMatchResult,
  RuleEvaluation,
  StockSnapshot,
  UnavailableReason,
} from '../market-data/types';
import { PATTERN_CARDS } from './catalog';
import { extractCandlestickFeatures, withAnalysisWindow } from './features';
import { hasValidRuleBindingParameters } from './rule-parameters';
import { RULE_FAMILIES } from './rule-registry';
import type { PatternCardDefinition, PatternCardId, RuleFamilyId } from './types';

export interface AnalyzePatternsOptions {
  analysisBarLimit?: number;
  snapshotHash?: string;
  freshness?: AnalysisContext['freshness'];
}

interface Candidate extends PatternMatchResult {
  contextScore: number;
}

/** 單張 MVP 卡的未截斷評估結果。 */
export interface PatternCardEvaluation {
  cardId: PatternCardId;
  evaluations: readonly RuleEvaluation[];
  score: number;
  contextScore: number;
  dataCompleteness: number;
  isEvaluatable: boolean;
  isCandidate: boolean;
  reasonCodes: readonly string[];
}

interface EvaluatedCard {
  card: PatternCardDefinition;
  evaluation: PatternCardEvaluation;
}

const DEFAULT_ANALYSIS_BAR_LIMIT = 60;
const CORPORATE_ACTION_TYPES = new Set([
  'cash-dividend',
  'stock-dividend',
  'capital-reduction',
  'split',
  'other',
]);
const FRESHNESS_VALUES = new Set([
  'fresh',
  'one-session-behind',
  'stale',
  'unknown',
]);
const TIMEFRAME_VALUES = new Set(['1d', '1w', '1m']);
const PRICE_MODE_VALUES = new Set(['raw', 'adjusted']);
const BAR_EVIDENCE_STATUS_VALUES = new Set(['complete', 'incomplete']);

const GEOMETRY_BAR_COUNTS: Readonly<Record<RuleFamilyId, number>> = {
  'relative-body-size': 1,
  doji: 1,
  'single-candle-wick-geometry': 1,
  'near-marubozu': 1,
  'candle-descriptors': 1,
  'engulfing-body': 2,
  'harami-body': 2,
  'midpoint-penetration': 2,
  'three-candle-star': 3,
  'three-candle-sequence': 3,
};

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function roundToNearestFive(value: number): number {
  return Math.round(value / 5) * 5;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOhlcvBarRecord(value: unknown): value is OhlcvBar {
  return typeof value === 'object' && value !== null;
}

function isSnapshotRecord(value: unknown): value is StockSnapshot {
  return typeof value === 'object' && value !== null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function hasValidDates(snapshot: StockSnapshot): boolean {
  return snapshot.bars.every((bar, index) => {
    const previous = snapshot.bars[index - 1];
    return isOhlcvBarRecord(bar)
      && isIsoDate(bar.date)
      && (previous === undefined || (isOhlcvBarRecord(previous) && isIsoDate(previous.date) && previous.date < bar.date));
  });
}

function hasValidOhlcvRelationships(snapshot: StockSnapshot): boolean {
  return snapshot.bars.every((bar) => isOhlcvBarRecord(bar) && (
    isFiniteNumber(bar.open)
    && isFiniteNumber(bar.high)
    && isFiniteNumber(bar.low)
    && isFiniteNumber(bar.close)
    && isFiniteNumber(bar.volumeShares)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && bar.volumeShares >= 0
    && (bar.completed === undefined || typeof bar.completed === 'boolean')
    && (bar.evidenceStatus === undefined || BAR_EVIDENCE_STATUS_VALUES.has(bar.evidenceStatus))
    && (bar.missingSessionDates === undefined || (
      Array.isArray(bar.missingSessionDates)
      && bar.missingSessionDates.every(isIsoDate)
    ))
  ));
}

function isCorporateAction(value: unknown): value is CorporateAction {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const action = value as Record<string, unknown>;
  return isIsoDate(action.date)
    && typeof action.type === 'string'
    && CORPORATE_ACTION_TYPES.has(action.type)
    && typeof action.affectsPriceContinuity === 'boolean'
    && typeof action.sourceUrl === 'string'
    && action.sourceUrl.length > 0
    && typeof action.verifiedAt === 'string'
    && action.verifiedAt.length > 0;
}

function isNoQuoteEvidence(value: unknown): value is NoQuoteEvidence {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const evidence = value as Record<string, unknown>;
  return (evidence.market === 'TWSE' || evidence.market === 'TPEx')
    && typeof evidence.code === 'string'
    && /^[0-9]{4,6}$/.test(evidence.code)
    && isIsoDate(evidence.date)
    && (evidence.reason === 'official-no-quote' || evidence.reason === 'official-suspension')
    && typeof evidence.sourceUrl === 'string'
    && evidence.sourceUrl.startsWith('https://');
}

function hasValidCorporateActions(snapshot: StockSnapshot): boolean {
  return Array.isArray(snapshot.corporateActions) && snapshot.corporateActions.every(isCorporateAction);
}

function hasValidNoQuoteEvidence(snapshot: StockSnapshot): boolean {
  if (!Array.isArray(snapshot.noQuoteEvidence)) {
    return false;
  }

  const barDates = new Set(snapshot.bars.map((bar) => bar.date));
  return snapshot.noQuoteEvidence.every((evidence, index) => {
    const previous = snapshot.noQuoteEvidence[index - 1];
    return isNoQuoteEvidence(evidence)
      && evidence.market === snapshot.market
      && evidence.code === snapshot.code
      && !barDates.has(evidence.date)
      && (previous === undefined || (isNoQuoteEvidence(previous) && previous.date < evidence.date));
  });
}

function hasValidSnapshotMetadata(snapshot: StockSnapshot): boolean {
  const policy = snapshot.comparisonUnitPolicy;

  return (
    Number.isInteger(snapshot.schemaVersion) &&
    snapshot.schemaVersion > 0 &&
    (snapshot.snapshotVersion === undefined || (Number.isInteger(snapshot.snapshotVersion) && snapshot.snapshotVersion > 0)) &&
    typeof snapshot.code === 'string' &&
    snapshot.code.trim().length > 0 &&
    typeof snapshot.name === 'string' &&
    snapshot.name.trim().length > 0 &&
    (snapshot.market === 'TWSE' || snapshot.market === 'TPEx') &&
    snapshot.currency === 'TWD' &&
    typeof policy === 'object' &&
    policy !== null &&
    Number.isInteger(policy.version) &&
    policy.version > 0 &&
    isIsoDate(policy.effectiveFrom) &&
    typeof policy.sourceUrl === 'string' &&
    policy.sourceUrl.trim().length > 0 &&
    Array.isArray(snapshot.sourceUrls) &&
    snapshot.sourceUrls.length > 0 &&
    snapshot.sourceUrls.every(
      (sourceUrl) => typeof sourceUrl === 'string' && sourceUrl.trim().length > 0,
    ) &&
    (snapshot.snapshotHash === undefined || typeof snapshot.snapshotHash === 'string') &&
    (snapshot.cutoffDate === undefined || isIsoDate(snapshot.cutoffDate)) &&
    (snapshot.freshness === undefined || FRESHNESS_VALUES.has(snapshot.freshness)) &&
    (snapshot.timeframe === undefined || TIMEFRAME_VALUES.has(snapshot.timeframe))
  );
}

function hasValidSnapshotShape(snapshot: StockSnapshot): boolean {
  return (
    typeof snapshot.securityType === 'string'
    && snapshot.securityType.trim().length > 0
    && typeof snapshot.priceMode === 'string'
    && PRICE_MODE_VALUES.has(snapshot.priceMode)
    && Array.isArray(snapshot.bars)
    && Array.isArray(snapshot.noQuoteEvidence)
    && snapshot.bars.length + snapshot.noQuoteEvidence.length > 0
    && Array.isArray(snapshot.corporateActions)
    && hasValidSnapshotMetadata(snapshot)
    && hasValidDates(snapshot)
    && hasValidOhlcvRelationships(snapshot)
    && hasValidCorporateActions(snapshot)
    && hasValidNoQuoteEvidence(snapshot)
  );
}

function completedLegalBars(snapshot: StockSnapshot): readonly OhlcvBar[] {
  const latestNoQuoteDate = snapshot.noQuoteEvidence.at(-1)?.date;
  const latestIncompleteDate = snapshot.bars
    .filter((bar) => bar.evidenceStatus === 'incomplete')
    .map((bar) => bar.date)
    .sort()
    .at(-1);
  const lastContinuityBreak = [latestNoQuoteDate, latestIncompleteDate]
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1);
  return snapshot.bars.filter((bar) => (
    bar.completed !== false
    && bar.evidenceStatus !== 'incomplete'
    && (lastContinuityBreak === undefined || bar.date > lastContinuityBreak)
  ));
}

function resolveAnalysisBarLimit(options: AnalyzePatternsOptions): number | undefined {
  const analysisBarLimit = options.analysisBarLimit ?? DEFAULT_ANALYSIS_BAR_LIMIT;
  return Number.isInteger(analysisBarLimit) && analysisBarLimit > 0
    ? analysisBarLimit
    : undefined;
}

function unavailable(reason: UnavailableReason, message: string): AnalysisResult {
  return { status: 'unavailable', reason, message };
}

function analysisWarnings(
  cutoffDate: string,
  freshness: AnalysisContext['freshness'],
  priceMode: StockSnapshot['priceMode'],
  actions: readonly CorporateAction[],
  noQuoteEvidence: readonly NoQuoteEvidence[],
  bars: readonly OhlcvBar[],
): string[] {
  const warnings: string[] = [];

  if (priceMode === 'adjusted') {
    warnings.push('已使用可稽核的向後還原價格；公司行動仍保留於結果供對照。');
  }

  if (freshness === 'one-session-behind') {
    warnings.push(`資料截至 ${cutoffDate}，落後一個交易日。`);
  }
  if (freshness === 'stale') {
    warnings.push(`資料截至 ${cutoffDate}，型態只反映已載入的盤後資料。`);
  }
  if (freshness === 'unknown') {
    warnings.push(`無法確認資料截至 ${cutoffDate} 的新鮮度。`);
  }
  if (priceMode === 'raw' && actions.some((action) => action.affectsPriceContinuity)) {
    warnings.push('分析窗內有影響價格連續性的公司行動；候選窗交疊時，相關規則不參與計分。');
  }
  if (noQuoteEvidence.some((evidence) => evidence.reason === 'official-no-quote')) {
    warnings.push('官方曾明示交易日未報價；型態比對只使用該日之後連續的合法日 K。');
  }
  if (noQuoteEvidence.some((evidence) => evidence.reason === 'official-suspension')) {
    warnings.push('交易所公告停止買賣；型態比對不跨越停牌區間。');
  }
  if (bars.some((bar) => bar.evidenceStatus === 'incomplete')) {
    warnings.push('聚合 K 棒缺少官方交易日證據；型態比對只使用其後連續且完整的 K 棒。');
  }

  return warnings;
}

function buildContext(
  snapshot: StockSnapshot,
  options: AnalyzePatternsOptions,
  analyzedFrom: string,
  analyzedTo: string,
  analyzedBarCount: number,
  dataCompleteness: number,
  reasonCodes: readonly string[],
  evaluatedCardCount: number,
  unavailableCardIds: readonly PatternCardId[],
  suppressedRules: readonly string[],
  actions: readonly CorporateAction[],
): AnalysisContext {
  const freshness = options.freshness ?? snapshot.freshness ?? 'unknown';

  return {
    snapshotVersion: snapshot.snapshotVersion ?? snapshot.schemaVersion,
    snapshotHash: options.snapshotHash ?? snapshot.snapshotHash ?? 'unknown',
    market: snapshot.market,
    cutoffDate: snapshot.cutoffDate ?? analyzedTo,
    freshness,
    priceMode: snapshot.priceMode,
    timeframe: snapshot.timeframe ?? '1d',
    analyzedFrom,
    analyzedTo,
    analyzedBarCount,
    dataCompleteness,
    reasonCodes,
    evaluatedCardCount,
    unavailableCardIds,
    affectedRuleIds: suppressedRules,
    suppressedRules,
    corporateActions: actions,
    warnings: analysisWarnings(
      snapshot.cutoffDate ?? analyzedTo,
      freshness,
      snapshot.priceMode,
      actions,
      snapshot.noQuoteEvidence,
      snapshot.bars,
    ),
  };
}

function unavailableCardEvaluation(
  cardId: PatternCardId,
  reasonCode: string,
): PatternCardEvaluation {
  return {
    cardId,
    evaluations: [],
    score: 0,
    contextScore: 0,
    dataCompleteness: 0,
    isEvaluatable: false,
    isCandidate: false,
    reasonCodes: [reasonCode],
  };
}

/**
 * 所需日 K 僅指各卡 matcher.minimumBars 對應的尾端已完成 K 線。
 * 這個數量已包含該規則的幾何窗與必要比較窗（例如晨星為前 20 根加三根候選 K），不擴大檢查整個 60 根分析窗。
 */
function hasRequiredPricePrecision(
  analysisBars: StockSnapshot['bars'],
  minimumBars: number,
): boolean {
  const requiredBars = analysisBars.slice(-minimumBars);
  return (
    requiredBars.length === minimumBars
    && requiredBars.every((bar) => (
      isFiniteNumber(bar.sourcePrecision)
      && bar.sourcePrecision > 0
      && isFiniteNumber(bar.comparisonUnit)
      && bar.comparisonUnit > 0
    ))
  );
}

function evaluateCard(
  card: PatternCardDefinition,
  snapshot: StockSnapshot,
  analysisBars: StockSnapshot['bars'],
): PatternCardEvaluation {
  const matcher = card.matcher;
  if (!matcher) {
    throw new Error(`MVP 卡 ${card.id} 缺少 matcher 設定`);
  }

  if (analysisBars.length < matcher.minimumBars) {
    return unavailableCardEvaluation(card.id, 'insufficient-bars');
  }

  if (!matcher.rules.every((binding) => hasValidRuleBindingParameters(binding))) {
    return unavailableCardEvaluation(card.id, 'invalid-binding-parameters');
  }

  if (!hasRequiredPricePrecision(analysisBars, matcher.minimumBars)) {
    return unavailableCardEvaluation(card.id, 'candidate-price-precision-unavailable');
  }

  const family = RULE_FAMILIES[matcher.ruleFamilyId];
  const continuityActions = snapshot.priceMode === 'raw' ? snapshot.corporateActions : [];
  const baseFeatures = extractCandlestickFeatures(analysisBars, continuityActions);
  const features = withAnalysisWindow(
    baseFeatures,
    GEOMETRY_BAR_COUNTS[matcher.ruleFamilyId],
    continuityActions,
  );
  const evaluations = matcher.rules.map((binding) => family.evaluate(features, binding));
  const required = evaluations.filter((evaluation) => evaluation.group === 'required');
  const invalidating = evaluations.filter((evaluation) => evaluation.group === 'invalidating');
  const requiredUnavailable = required.some((evaluation) => evaluation.state === 'unavailable');
  const invalidated = invalidating.some((evaluation) => evaluation.state === 'met');
  const reasonCodes = unique(evaluations
    .filter((evaluation) => evaluation.state === 'unavailable' || (evaluation.group === 'invalidating' && evaluation.state === 'met'))
    .map((evaluation) => evaluation.reasonCode)
    .filter((reasonCode): reasonCode is string => reasonCode !== undefined));
  const score = roundToNearestFive(evaluations
    .filter((evaluation) => evaluation.group !== 'invalidating' && evaluation.state === 'met')
    .reduce((total, evaluation) => total + evaluation.weight, 0));
  const contextScore = evaluations
    .filter((evaluation) => evaluation.group === 'context' && evaluation.state === 'met')
    .reduce((total, evaluation) => total + evaluation.weight, 0);
  const dataCompleteness = evaluations
    .filter((evaluation) => evaluation.group !== 'invalidating' && evaluation.state !== 'unavailable')
    .reduce((total, evaluation) => total + evaluation.weight, 0);
  const requiredMet = required.every((evaluation) => evaluation.state === 'met');

  return {
    cardId: card.id,
    evaluations,
    score,
    contextScore,
    dataCompleteness,
    isEvaluatable: !requiredUnavailable && !invalidated,
    isCandidate: !requiredUnavailable && !invalidated && requiredMet && score >= matcher.minimumScore,
    reasonCodes,
  };
}

function candidateFrom(
  card: PatternCardDefinition,
  evaluation: PatternCardEvaluation,
  analyzedFrom: string,
  analyzedTo: string,
  warnings: readonly string[],
): Candidate {
  return {
    cardId: card.id,
    score: evaluation.score,
    label: evaluation.score >= 80 ? '高度符合' : '部分符合',
    dataCompleteness: evaluation.dataCompleteness,
    analyzedFrom,
    analyzedTo,
    evaluations: evaluation.evaluations,
    warnings,
    contextScore: evaluation.contextScore,
  };
}

function evaluateMvpCards(
  snapshot: StockSnapshot,
  analysisBars: StockSnapshot['bars'],
): readonly EvaluatedCard[] {
  return PATTERN_CARDS
    .filter((card) => card.matchSupport === 'mvp')
    .map((card) => ({
      card,
      evaluation: evaluateCard(card, snapshot, analysisBars),
    }));
}

/**
 * 僅供 domain 單元測試檢查未截斷的候選資格；UI 與結果元件不得依賴此函式。
 * 有效 fixture 以外的輸入回傳空陣列，正式錯誤語意由 analyzePatterns 提供。
 */
export function evaluateAllMvpCardsForTesting(
  snapshot: StockSnapshot,
  options: AnalyzePatternsOptions = {},
): readonly PatternCardEvaluation[] {
  if (!isSnapshotRecord(snapshot) || !hasValidSnapshotShape(snapshot)) {
    return [];
  }
  if (snapshot.securityType !== 'common-stock' || !PRICE_MODE_VALUES.has(snapshot.priceMode)) {
    return [];
  }

  const analysisBarLimit = resolveAnalysisBarLimit(options);
  if (analysisBarLimit === undefined) {
    return [];
  }

  const analysisBars = completedLegalBars(snapshot)
    .slice(-analysisBarLimit);
  if (analysisBars.length === 0) {
    return [];
  }

  const analyzedFrom = analysisBars[0]?.date;
  const analyzedTo = analysisBars.at(-1)?.date;
  if (!analyzedFrom || !analyzedTo) {
    return [];
  }

  const scopedSnapshot: StockSnapshot = {
    ...snapshot,
    bars: analysisBars,
    corporateActions: snapshot.corporateActions.filter(
      (action) => action.date >= analyzedFrom && action.date <= analyzedTo,
    ),
  };

  return evaluateMvpCards(scopedSnapshot, analysisBars).map(({ evaluation }) => evaluation);
}

/**
 * 將最後一段已完成日 K 與 17 張教學型態卡逐條比對。
 * 結果只描述規則符合度與資料限制，不推導未來價格或交易行動。
 */
export function analyzePatterns(
  snapshot: StockSnapshot,
  options: AnalyzePatternsOptions = {},
): AnalysisResult {
  if (!isSnapshotRecord(snapshot)) {
    return unavailable('schema-error', '快照根物件不符合資料契約。');
  }
  if (!hasValidSnapshotShape(snapshot)) {
    return unavailable('schema-error', '快照必要欄位、日期、OHLCV 或公司行動不符合資料契約。');
  }
  if (snapshot.securityType !== 'common-stock') {
    return unavailable('unsupported-security', '此證券不在第一版支援的普通股範圍內。');
  }
  if (!PRICE_MODE_VALUES.has(snapshot.priceMode)) {
    return unavailable('schema-error', '快照價格模式不符合可支援的價格資料契約。');
  }
  const analysisBarLimit = resolveAnalysisBarLimit(options);
  if (analysisBarLimit === undefined) {
    return unavailable('schema-error', '分析窗大小必須是正整數。');
  }
  const completedBars = completedLegalBars(snapshot);
  if (completedBars.length === 0) {
    const observedDates = [
      ...snapshot.bars.map((bar) => bar.date),
      ...snapshot.noQuoteEvidence.map((evidence) => evidence.date),
    ].sort();
    const analyzedFrom = observedDates[0];
    const analyzedTo = observedDates.at(-1);
    if (!analyzedFrom || !analyzedTo) {
      return unavailable('schema-error', '快照沒有可分析的日 K 資料。');
    }

    const actions = snapshot.corporateActions.filter((action) => action.date >= analyzedFrom && action.date <= analyzedTo);
    const mvpCardIds = PATTERN_CARDS.filter((card) => card.matchSupport === 'mvp').map((card) => card.id);
    const reasonCodes = unique([
      ...snapshot.noQuoteEvidence.map((evidence) => evidence.reason),
      'no-completed-bars',
    ]);
    const context = buildContext(
      snapshot,
      options,
      analyzedFrom,
      analyzedTo,
      0,
      0,
      reasonCodes,
      0,
      mvpCardIds,
      [],
      actions,
    );

    return { status: 'insufficient-evidence', context, reasonCodes };
  }
  const analysisBars = completedBars.slice(-analysisBarLimit);
  const analyzedFrom = analysisBars[0]?.date;
  const analyzedTo = analysisBars.at(-1)?.date;
  if (!analyzedFrom || !analyzedTo) {
    return unavailable('schema-error', '快照沒有可分析的日 K 資料。');
  }

  const actions = snapshot.corporateActions.filter((action) => action.date >= analyzedFrom && action.date <= analyzedTo);
  const scopedSnapshot: StockSnapshot = {
    ...snapshot,
    bars: analysisBars,
    corporateActions: actions,
  };
  const cardEvaluations = evaluateMvpCards(scopedSnapshot, analysisBars);
  const unavailableCardIds = cardEvaluations
    .filter(({ evaluation }) => !evaluation.isEvaluatable)
    .map(({ card }) => card.id);
  const suppressedRules = unique(cardEvaluations
    .flatMap(({ evaluation }) => evaluation.evaluations)
    .filter((evaluation) => evaluation.group === 'invalidating' && evaluation.state === 'met')
    .map((evaluation) => evaluation.ruleId));
  const reasonCodes = unique(cardEvaluations.flatMap(({ evaluation }) => evaluation.reasonCodes));
  const evaluatable = cardEvaluations.filter(({ evaluation }) => evaluation.isEvaluatable);
  const dataCompleteness = evaluatable.length === 0
    ? 0
    : Math.max(...evaluatable.map(({ evaluation }) => evaluation.dataCompleteness));
  const context = buildContext(
    scopedSnapshot,
    options,
    analyzedFrom,
    analyzedTo,
    analysisBars.length,
    dataCompleteness,
    reasonCodes,
    evaluatable.length,
    unavailableCardIds,
    suppressedRules,
    actions,
  );
  const candidates = cardEvaluations
    .filter(({ evaluation }) => evaluation.isCandidate)
    .map(({ card, evaluation }) => candidateFrom(card, evaluation, analyzedFrom, analyzedTo, context.warnings))
    .sort((left, right) => (
      right.score - left.score
      || right.contextScore - left.contextScore
      || right.dataCompleteness - left.dataCompleteness
      || compareText(left.cardId, right.cardId)
    ))
    .slice(0, 3)
    .map(({ contextScore: _contextScore, ...candidate }) => candidate);

  if (candidates.length > 0) {
    return { status: 'matched', context, matches: candidates };
  }

  if (evaluatable.length > 0) {
    return { status: 'no-clear-pattern', context, matches: [] };
  }

  return {
    status: 'insufficient-evidence',
    context,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['insufficient-evidence'],
  };
}
