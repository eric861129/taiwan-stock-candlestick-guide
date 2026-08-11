import type {
  AnalysisContext,
  AnalysisResult,
  CorporateAction,
  OhlcvBar,
  PatternMatchResult,
  RuleEvaluation,
  StockSnapshot,
  UnavailableReason,
} from '../market-data/types';
import { PATTERN_CARDS } from './catalog';
import { extractCandlestickFeatures, withAnalysisWindow } from './features';
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

interface CardEvaluation {
  cardId: PatternCardId;
  evaluations: readonly RuleEvaluation[];
  score: number;
  contextScore: number;
  dataCompleteness: number;
  isEvaluatable: boolean;
  isCandidate: boolean;
  reasonCodes: readonly string[];
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

function hasValidCorporateActions(snapshot: StockSnapshot): boolean {
  return Array.isArray(snapshot.corporateActions) && snapshot.corporateActions.every(isCorporateAction);
}

function hasValidSnapshotMetadata(snapshot: StockSnapshot): boolean {
  const policy = snapshot.comparisonUnitPolicy;

  return (
    Number.isInteger(snapshot.schemaVersion) &&
    snapshot.schemaVersion > 0 &&
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
    (snapshot.freshness === undefined || FRESHNESS_VALUES.has(snapshot.freshness))
  );
}

function unavailable(reason: UnavailableReason, message: string): AnalysisResult {
  return { status: 'unavailable', reason, message };
}

function analysisWarnings(
  cutoffDate: string,
  freshness: AnalysisContext['freshness'],
  actions: readonly CorporateAction[],
): string[] {
  const warnings: string[] = [];

  if (freshness === 'one-session-behind') {
    warnings.push(`資料截至 ${cutoffDate}，落後一個交易日。`);
  }
  if (freshness === 'stale') {
    warnings.push(`資料截至 ${cutoffDate}，型態只反映已載入的盤後資料。`);
  }
  if (freshness === 'unknown') {
    warnings.push(`無法確認資料截至 ${cutoffDate} 的新鮮度。`);
  }
  if (actions.some((action) => action.affectsPriceContinuity)) {
    warnings.push('分析窗內有影響價格連續性的公司行動；候選窗交疊時，相關規則不參與計分。');
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
    snapshotVersion: snapshot.schemaVersion,
    snapshotHash: options.snapshotHash ?? snapshot.snapshotHash ?? 'unknown',
    market: snapshot.market,
    cutoffDate: snapshot.cutoffDate ?? analyzedTo,
    freshness,
    timeframe: '1d',
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
    warnings: analysisWarnings(snapshot.cutoffDate ?? analyzedTo, freshness, actions),
  };
}

function evaluateCard(
  card: PatternCardDefinition,
  snapshot: StockSnapshot,
  analysisBars: StockSnapshot['bars'],
): CardEvaluation {
  const matcher = card.matcher;
  if (!matcher) {
    throw new Error(`MVP 卡 ${card.id} 缺少 matcher 設定`);
  }

  if (analysisBars.length < matcher.minimumBars) {
    return {
      cardId: card.id,
      evaluations: [],
      score: 0,
      contextScore: 0,
      dataCompleteness: 0,
      isEvaluatable: false,
      isCandidate: false,
      reasonCodes: ['insufficient-bars'],
    };
  }

  const family = RULE_FAMILIES[matcher.ruleFamilyId];
  const baseFeatures = extractCandlestickFeatures(analysisBars, snapshot.corporateActions);
  const features = withAnalysisWindow(
    baseFeatures,
    GEOMETRY_BAR_COUNTS[matcher.ruleFamilyId],
    snapshot.corporateActions,
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
  evaluation: CardEvaluation,
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
  if (snapshot.securityType !== 'common-stock') {
    return unavailable('unsupported-security', '此證券不在第一版支援的普通股範圍內。');
  }
  if (snapshot.priceMode !== 'raw') {
    return unavailable('schema-error', '快照價格模式不符合原始盤後日 K 資料契約。');
  }
  if (!Array.isArray(snapshot.bars) || snapshot.bars.length === 0) {
    return unavailable('schema-error', '快照沒有可分析的日 K 資料。');
  }
  if (
    !hasValidSnapshotMetadata(snapshot) ||
    !hasValidDates(snapshot) ||
    !hasValidOhlcvRelationships(snapshot) ||
    !hasValidCorporateActions(snapshot)
  ) {
    return unavailable('schema-error', '快照日期或 OHLCV 關係不符合資料契約。');
  }

  const analysisBarLimit = options.analysisBarLimit ?? DEFAULT_ANALYSIS_BAR_LIMIT;
  const completedBars = snapshot.bars.filter((bar) => bar.completed !== false);
  if (completedBars.length === 0) {
    const analyzedFrom = snapshot.bars[0]?.date;
    const analyzedTo = snapshot.bars.at(-1)?.date;
    if (!analyzedFrom || !analyzedTo) {
      return unavailable('schema-error', '快照沒有可分析的日 K 資料。');
    }

    const actions = snapshot.corporateActions.filter((action) => action.date >= analyzedFrom && action.date <= analyzedTo);
    const mvpCardIds = PATTERN_CARDS
      .filter((card) => card.matchSupport === 'mvp')
      .map((card) => card.id);
    const reasonCodes = ['no-completed-bars'];
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
  const mvpCards = PATTERN_CARDS.filter((card) => card.matchSupport === 'mvp');
  const cardEvaluations = mvpCards.map((card) => ({
    card,
    evaluation: evaluateCard(card, scopedSnapshot, analysisBars),
  }));
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
