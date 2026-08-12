import type { PriceMode, Timeframe } from '../market-data/types';
import { STRUCTURE_ENGINE_CONFIG, STRUCTURE_MATCHER_VERSION } from './config';
import { extractStructureFeatures, isValidStructureBar } from './features';
import { buildStructureOverlay } from './overlay';
import type {
  AnalyzeStructuresOptions,
  IndexedStructureBar,
  StructureAnalysisInput,
  StructureAnalysisResult,
  StructureBoundary,
  StructureCandidate,
  StructureDirection,
  StructureEngineConfig,
  StructureNearMiss,
  StructurePivot,
  StructureRuleEvaluation,
  StructureStatus,
  StructureWindow,
} from './types';

interface PreparedInput {
  bars: readonly IndexedStructureBar[];
  cutoffDate: string | null;
  timeframe: Timeframe;
  priceMode: PriceMode;
  sourceBarCount: number;
  warnings: readonly string[];
}

interface CandidateDraft {
  structureId: 'range' | 'triangle-consolidation';
  anchors: readonly StructurePivot[];
  boundaries: readonly StructureBoundary[];
  window: StructureWindow;
  evaluations: readonly StructureRuleEvaluation[];
  status: StructureStatus;
  direction: StructureDirection;
  confirmationCondition: string;
  invalidationCondition: string;
}

interface BoundaryStatus {
  status: StructureStatus;
  direction: StructureDirection;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultTimeframe(value: Timeframe | undefined): Timeframe {
  return value ?? '1d';
}

function defaultPriceMode(value: PriceMode | undefined): PriceMode {
  return value ?? 'raw';
}

function invalidResult(
  prepared: Pick<PreparedInput, 'cutoffDate' | 'timeframe' | 'priceMode'>,
  sourceBarCount: number,
  config: StructureEngineConfig,
  reasonCodes: readonly string[],
): StructureAnalysisResult {
  return {
    status: 'insufficient-evidence',
    matcherVersion: STRUCTURE_MATCHER_VERSION,
    timeframe: prepared.timeframe,
    priceMode: prepared.priceMode,
    cutoffDate: prepared.cutoffDate,
    features: {
      configVersion: config.version,
      sourceBarCount,
      analyzedBarCount: 0,
      smoothedClose: [],
      atr: {
        version: 'atr-v1',
        period: config.atr.period,
        latest: null,
        values: [],
      },
      pivots: [],
      warnings: reasonCodes,
    },
    candidates: [],
    nearMisses: [],
    reasonCodes: unique(reasonCodes),
  };
}

function hasAscendingUniqueDates(bars: readonly IndexedStructureBar[]): boolean {
  return bars.every((entry, index) => {
    const previous = bars[index - 1];
    return previous === undefined || previous.bar.date < entry.bar.date;
  });
}

/**
 * 將價格連續性中斷後的資料保留為新的候選起點，避免候選窗跨越公司行動或官方未報價日。
 */
function cutAtLatestContinuityBreak(
  bars: readonly IndexedStructureBar[],
  input: StructureAnalysisInput,
): { bars: readonly IndexedStructureBar[]; warnings: readonly string[] } {
  const startDate = bars[0]?.bar.date;
  const endDate = bars.at(-1)?.bar.date;
  if (!startDate || !endDate) return { bars, warnings: [] };

  const breakDates = [
    ...(input.corporateActions ?? [])
      .filter((action) => action.affectsPriceContinuity && action.date >= startDate && action.date <= endDate)
      .map((action) => action.date),
    ...(input.noQuoteEvidence ?? [])
      .filter((evidence) => evidence.date >= startDate && evidence.date <= endDate)
      .map((evidence) => evidence.date),
  ].sort();
  const latestBreak = breakDates.at(-1);
  if (!latestBreak) return { bars, warnings: [] };

  return {
    bars: bars.filter((entry) => entry.bar.date > latestBreak),
    warnings: [`價格連續性在 ${latestBreak} 中斷；候選窗只使用其後的完成 K 棒。`],
  };
}

function prepareInput(
  input: StructureAnalysisInput,
  options: AnalyzeStructuresOptions,
  config: StructureEngineConfig,
): { prepared?: PreparedInput; reasonCodes: readonly string[]; sourceBarCount: number } {
  const timeframe = defaultTimeframe(input.timeframe);
  const priceMode = defaultPriceMode(input.priceMode);
  const rawBars = input.bars ?? [];
  const requestedCutoff = options.cutoffDate ?? input.cutoffDate ?? rawBars.at(-1)?.date ?? null;
  const atCutoff = rawBars
    .map((bar, sourceIndex) => ({ bar, sourceIndex }))
    .filter((entry) => requestedCutoff === null || entry.bar.date <= requestedCutoff);
  const sourceBarCount = atCutoff.length;
  const firstIncomplete = atCutoff.findIndex((entry) => entry.bar.completed === false || entry.bar.evidenceStatus === 'incomplete');

  if (firstIncomplete >= 0 && firstIncomplete < atCutoff.length - 1) {
    return {
      reasonCodes: ['incomplete-or-evidence-gap-inside-window'],
      sourceBarCount,
    };
  }

  const completed = firstIncomplete === atCutoff.length - 1 ? atCutoff.slice(0, -1) : atCutoff;
  if (!hasAscendingUniqueDates(completed)) {
    return { reasonCodes: ['dates-not-strictly-increasing-and-unique'], sourceBarCount };
  }
  if (completed.some((entry) => !isValidStructureBar(entry.bar))) {
    return { reasonCodes: ['invalid-ohlcv-or-price-precision'], sourceBarCount };
  }

  const cut = cutAtLatestContinuityBreak(completed, input);
  const limited = cut.bars.slice(-config.maximumBars);
  const warnings = [
    ...(firstIncomplete === atCutoff.length - 1 ? ['形成中或證據不足的最後一根 K 棒未納入結構比對。'] : []),
    ...cut.warnings,
    ...(cut.bars.length > config.maximumBars ? [`只使用最近 ${config.maximumBars} 根完成 K 棒。`] : []),
  ];

  if (limited.length < config.minimumBars) {
    return {
      reasonCodes: ['insufficient-completed-bars-after-continuity-gate'],
      sourceBarCount,
    };
  }

  return {
    prepared: {
      bars: limited,
      cutoffDate: limited.at(-1)?.bar.date ?? requestedCutoff,
      timeframe,
      priceMode,
      sourceBarCount,
      warnings,
    },
    reasonCodes: [],
    sourceBarCount,
  };
}

function localIndexBySource(bars: readonly IndexedStructureBar[]): ReadonlyMap<number, number> {
  return new Map(bars.map((entry, index) => [entry.sourceIndex, index]));
}

function priceAt(boundary: StructureBoundary, sourceIndex: number): number {
  return boundary.slopePerBar * sourceIndex + boundary.intercept;
}

function leastSquaresBoundary(
  id: StructureBoundary['id'],
  pivots: readonly StructurePivot[],
  window: StructureWindow,
  atr: number,
  horizontal = false,
): StructureBoundary | null {
  if (pivots.length < 2 || atr <= 0) return null;
  const xMean = average(pivots.map((pivot) => pivot.barIndex));
  const yMean = average(pivots.map((pivot) => pivot.price));
  if (xMean === null || yMean === null) return null;
  const numerator = pivots.reduce((sum, pivot) => sum + (pivot.barIndex - xMean) * (pivot.price - yMean), 0);
  const denominator = pivots.reduce((sum, pivot) => sum + (pivot.barIndex - xMean) ** 2, 0);
  const slopePerBar = horizontal || denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slopePerBar * xMean;
  const residuals = pivots.map((pivot) => Math.abs(pivot.price - (slopePerBar * pivot.barIndex + intercept)) / atr);
  const normalizedResidualAtr = average(residuals) ?? Number.POSITIVE_INFINITY;

  return {
    version: 'structure-boundary-v1',
    id,
    startBarIndex: window.startBarIndex,
    endBarIndex: window.endBarIndex,
    slopePerBar,
    intercept,
    startPrice: slopePerBar * window.startBarIndex + intercept,
    endPrice: slopePerBar * window.endBarIndex + intercept,
    touchBarIndexes: pivots.map((pivot) => pivot.barIndex),
    normalizedResidualAtr: round(normalizedResidualAtr),
  };
}

function createWindow(
  bars: readonly IndexedStructureBar[],
  localStart: number,
): StructureWindow | null {
  const start = bars[localStart];
  const end = bars.at(-1);
  if (!start || !end) return null;
  return {
    version: 'structure-window-v1',
    startBarIndex: start.sourceIndex,
    endBarIndex: end.sourceIndex,
    startDate: start.bar.date,
    endDate: end.bar.date,
    barCount: bars.length - localStart,
  };
}

function rule(
  ruleId: string,
  label: string,
  group: StructureRuleEvaluation['group'],
  state: StructureRuleEvaluation['state'],
  explanation: string,
): StructureRuleEvaluation {
  return { ruleId, label, group, state, explanation };
}

function requiredMet(evaluations: readonly StructureRuleEvaluation[]): boolean {
  return evaluations
    .filter((evaluation) => evaluation.group === 'required')
    .every((evaluation) => evaluation.state === 'met');
}

function score(evaluations: readonly StructureRuleEvaluation[]): number {
  const required = evaluations.filter((evaluation) => evaluation.group === 'required');
  const supporting = evaluations.filter((evaluation) => evaluation.group === 'supporting');
  const requiredRatio = required.length === 0 ? 0 : required.filter((evaluation) => evaluation.state === 'met').length / required.length;
  const supportingRatio = supporting.length === 0 ? 1 : supporting.filter((evaluation) => evaluation.state === 'met').length / supporting.length;
  return Math.max(0, Math.min(100, Math.round(requiredRatio * 82 + supportingRatio * 18)));
}

function nearMiss(
  structureId: StructureNearMiss['structureId'],
  status: StructureNearMiss['status'],
  evaluations: readonly StructureRuleEvaluation[],
  window?: StructureWindow,
): StructureNearMiss {
  const missingConditions = evaluations
    .filter((evaluation) => evaluation.group !== 'invalidating' && evaluation.state !== 'met')
    .map((evaluation) => evaluation.label);
  return {
    structureId,
    status,
    ruleFit: score(evaluations),
    missingConditions: missingConditions.length > 0 ? missingConditions : ['目前型態已失效，僅保留為歷史教學參考。'],
    ...(window ? { window } : {}),
    evaluations,
  };
}

function candidateFromDraft(
  draft: CandidateDraft,
  prepared: PreparedInput,
  warnings: readonly string[],
): StructureCandidate {
  const candidateId = `${draft.structureId}:${prepared.timeframe}:${prepared.priceMode}:${draft.window.startDate}:${draft.window.endDate}`;
  const fit = score(draft.evaluations);
  const required = draft.evaluations.filter((evaluation) => evaluation.group === 'required');
  const geometryCompleteness = required.length === 0
    ? 0
    : Math.round(required.filter((evaluation) => evaluation.state === 'met').length / required.length * 100);
  const overlay = buildStructureOverlay({
    candidateId,
    window: draft.window,
    boundaries: draft.boundaries,
    anchors: draft.anchors,
    status: draft.status as Extract<StructureStatus, 'forming' | 'confirmed'>,
    direction: draft.direction,
  });
  return {
    candidateId,
    structureId: draft.structureId,
    timeframe: prepared.timeframe,
    priceMode: prepared.priceMode,
    ruleFit: fit,
    geometryCompleteness,
    dataCompleteness: 100,
    status: draft.status as Extract<StructureStatus, 'forming' | 'confirmed'>,
    direction: draft.direction,
    window: draft.window,
    anchors: draft.anchors,
    boundaries: draft.boundaries,
    evaluations: draft.evaluations,
    confirmationCondition: draft.confirmationCondition,
    invalidationCondition: draft.invalidationCondition,
    warnings,
    matcherVersion: STRUCTURE_MATCHER_VERSION,
    overlay,
  };
}

function boundaryStatus(
  bars: readonly IndexedStructureBar[],
  boundaries: readonly StructureBoundary[],
  firstEligibleSourceIndex: number,
  atr: number,
  atrBySourceIndex: ReadonlyMap<number, number | null>,
  breakoutAtr: number,
): BoundaryStatus {
  const upper = boundaries.find((boundary) => boundary.id === 'upper');
  const lower = boundaries.find((boundary) => boundary.id === 'lower');
  if (!upper || !lower || atr <= 0) return { status: 'insufficient-evidence', direction: 'undetermined' };

  const event = bars.find((entry) => {
    if (entry.sourceIndex < firstEligibleSourceIndex) return false;
    const entryAtr = atrBySourceIndex.get(entry.sourceIndex) ?? atr;
    if (entryAtr === null || entryAtr <= 0) return false;
    const threshold = entryAtr * breakoutAtr;
    const upperPrice = priceAt(upper, entry.sourceIndex);
    const lowerPrice = priceAt(lower, entry.sourceIndex);
    return entry.bar.close > upperPrice + threshold || entry.bar.close < lowerPrice - threshold;
  });
  if (!event) return { status: 'forming', direction: 'undetermined' };

  const last = bars.at(-1);
  if (!last) return { status: 'insufficient-evidence', direction: 'undetermined' };
  const eventAtr = atrBySourceIndex.get(event.sourceIndex) ?? atr;
  const latestAtr = atrBySourceIndex.get(last.sourceIndex) ?? atr;
  if (eventAtr === null || latestAtr === null || eventAtr <= 0 || latestAtr <= 0) {
    return { status: 'insufficient-evidence', direction: 'undetermined' };
  }
  const eventThreshold = eventAtr * breakoutAtr;
  const latestThreshold = latestAtr * breakoutAtr;
  const eventDirection: Exclude<StructureDirection, 'undetermined'> = event.bar.close > priceAt(upper, event.sourceIndex) + eventThreshold
    ? 'up'
    : 'down';
  const eventIsValid = eventDirection === 'up'
    ? event.bar.close > priceAt(upper, event.sourceIndex) + eventThreshold
    : event.bar.close < priceAt(lower, event.sourceIndex) - eventThreshold;
  if (!eventIsValid) return { status: 'insufficient-evidence', direction: 'undetermined' };
  const stillBeyond = eventDirection === 'up'
    ? last.bar.close > priceAt(upper, last.sourceIndex) + latestThreshold
    : last.bar.close < priceAt(lower, last.sourceIndex) - latestThreshold;
  return stillBeyond
    ? { status: 'confirmed', direction: eventDirection }
    : { status: 'invalid', direction: eventDirection };
}

function insideCloseRatio(
  bars: readonly IndexedStructureBar[],
  localStart: number,
  upper: StructureBoundary,
  lower: StructureBoundary,
  atr: number,
  toleranceAtr: number,
): number {
  const selected = bars.slice(localStart);
  if (selected.length === 0 || atr <= 0) return 0;
  const tolerance = atr * toleranceAtr;
  const inside = selected.filter((entry) => {
    const upperPrice = priceAt(upper, entry.sourceIndex);
    const lowerPrice = priceAt(lower, entry.sourceIndex);
    return entry.bar.close <= upperPrice + tolerance && entry.bar.close >= lowerPrice - tolerance;
  });
  return inside.length / selected.length;
}

function recentPivots(
  pivots: readonly StructurePivot[],
  kind: StructurePivot['kind'],
): readonly StructurePivot[] {
  return pivots.filter((pivot) => pivot.kind === kind).slice(-3);
}

function buildBoxDraft(
  bars: readonly IndexedStructureBar[],
  pivots: readonly StructurePivot[],
  atr: number,
  atrBySourceIndex: ReadonlyMap<number, number | null>,
  config: StructureEngineConfig,
): CandidateDraft | StructureNearMiss {
  const highs = recentPivots(pivots, 'high');
  const lows = recentPivots(pivots, 'low');
  if (highs.length < 2 || lows.length < 2) {
    const evaluations = [rule(
      'box-pivot-count',
      '上下邊界各至少兩個有效轉折點',
      'required',
      'not-met',
      '目前可辨識的波峰或波谷不足，不能補畫箱型邊界。',
    )];
    return nearMiss('range', 'insufficient-evidence', evaluations);
  }

  const indexMap = localIndexBySource(bars);
  const localStart = Math.min(...[...highs, ...lows].map((pivot) => indexMap.get(pivot.barIndex) ?? Number.POSITIVE_INFINITY));
  const window = createWindow(bars, localStart);
  if (!window) {
    return nearMiss('range', 'insufficient-evidence', [rule('box-window', '箱型形成區間', 'required', 'unavailable', '無法建立連續形成區間。')]);
  }
  const upper = leastSquaresBoundary('upper', highs, window, atr);
  const lower = leastSquaresBoundary('lower', lows, window, atr);
  if (!upper || !lower) {
    return nearMiss('range', 'insufficient-evidence', [rule('box-boundary', '可計算的上下邊界', 'required', 'unavailable', 'ATR 或轉折點不足，無法建立箱型邊界。')], window);
  }

  const upperSlope = Math.abs(upper.slopePerBar) / atr;
  const lowerSlope = Math.abs(lower.slopePerBar) / atr;
  const closeRatio = insideCloseRatio(bars, localStart, upper, lower, atr, config.boundaries.touchToleranceAtr);
  const latestAnchorIndex = Math.max(...[...highs, ...lows].map((pivot) => pivot.barIndex));
  const status = boundaryStatus(bars, [upper, lower], latestAnchorIndex + 1, atr, atrBySourceIndex, config.boundaries.breakoutAtr);
  const evaluations = [
    rule('box-pivot-count', '上下邊界各至少兩個有效轉折點', 'required', 'met', `上緣 ${highs.length} 個、下緣 ${lows.length} 個轉折點。`),
    rule('box-window', '形成區間至少八根完成 K 棒', 'required', window.barCount >= config.box.minimumWindowBars ? 'met' : 'not-met', `形成區間 ${window.barCount} 根完成 K 棒。`),
    rule('box-horizontal-boundaries', '上下邊界近水平', 'required', upperSlope <= config.box.maximumSlopeAtrPerBar && lowerSlope <= config.box.maximumSlopeAtrPerBar ? 'met' : 'not-met', `上緣斜率 ${round(upperSlope)} ATR／根，下緣斜率 ${round(lowerSlope)} ATR／根。`),
    rule('box-ordered-boundaries', '上方邊界高於下方邊界', 'required', upper.endPrice > lower.endPrice ? 'met' : 'not-met', '以原始高低價驗證區間寬度。'),
    rule('box-touch-residual', '轉折點貼近各自邊界', 'supporting', upper.normalizedResidualAtr <= config.boundaries.maximumResidualAtr && lower.normalizedResidualAtr <= config.boundaries.maximumResidualAtr ? 'met' : 'not-met', `上緣殘差 ${upper.normalizedResidualAtr} ATR，下緣殘差 ${lower.normalizedResidualAtr} ATR。`),
    rule('box-inside-closes', '多數收盤位於區間內', 'required', closeRatio >= config.boundaries.insideCloseRatio ? 'met' : 'not-met', `區間內收盤比例 ${Math.round(closeRatio * 100)}%。`),
    rule('box-returned-after-breakout', '確認後未返回原區間', 'invalidating', status.status === 'invalid' ? 'met' : 'not-met', status.status === 'invalid' ? '先前已離開邊界，最新收盤已返回原區間。' : '目前未觀察到確認後返回原區間。'),
  ];
  const draft: CandidateDraft = {
    structureId: 'range',
    anchors: [...highs, ...lows].sort((left, right) => left.barIndex - right.barIndex),
    boundaries: [upper, lower],
    window,
    evaluations,
    status: status.status,
    direction: status.direction,
    confirmationCondition: '完成 K 棒收盤有效離開上方或下方邊界後才確認。',
    invalidationCondition: '已確認後若完成 K 棒返回原區間，該結構只保留為失效教學參考。',
  };
  return draft;
}

function buildTriangleDraft(
  bars: readonly IndexedStructureBar[],
  pivots: readonly StructurePivot[],
  atr: number,
  atrBySourceIndex: ReadonlyMap<number, number | null>,
  config: StructureEngineConfig,
): CandidateDraft | StructureNearMiss {
  const highs = recentPivots(pivots, 'high');
  const lows = recentPivots(pivots, 'low');
  if (highs.length < 2 || lows.length < 2) {
    const evaluations = [rule(
      'triangle-pivot-count',
      '上下邊界各至少兩個有效轉折點',
      'required',
      'not-met',
      '目前可辨識的波峰或波谷不足，不能補畫三角收斂邊界。',
    )];
    return nearMiss('triangle-consolidation', 'insufficient-evidence', evaluations);
  }

  const indexMap = localIndexBySource(bars);
  const localStart = Math.min(...[...highs, ...lows].map((pivot) => indexMap.get(pivot.barIndex) ?? Number.POSITIVE_INFINITY));
  const window = createWindow(bars, localStart);
  if (!window) {
    return nearMiss('triangle-consolidation', 'insufficient-evidence', [rule('triangle-window', '三角收斂形成區間', 'required', 'unavailable', '無法建立連續形成區間。')]);
  }
  const upper = leastSquaresBoundary('upper', highs.slice(-2), window, atr);
  const lower = leastSquaresBoundary('lower', lows.slice(-2), window, atr);
  if (!upper || !lower) {
    return nearMiss('triangle-consolidation', 'insufficient-evidence', [rule('triangle-boundary', '可計算的收斂邊界', 'required', 'unavailable', 'ATR 或轉折點不足，無法建立收斂邊界。')], window);
  }

  const slopeGap = upper.slopePerBar - lower.slopePerBar;
  const apexSourceIndex = slopeGap === 0 ? null : (lower.intercept - upper.intercept) / slopeGap;
  const apexProgress = apexSourceIndex === null
    ? null
    : (apexSourceIndex - window.startBarIndex) / Math.max(1, window.endBarIndex - window.startBarIndex);
  const startWidth = priceAt(upper, window.startBarIndex) - priceAt(lower, window.startBarIndex);
  const endWidth = priceAt(upper, window.endBarIndex) - priceAt(lower, window.endBarIndex);
  const compression = startWidth > 0 ? endWidth / startWidth : Number.POSITIVE_INFINITY;
  const closeRatio = insideCloseRatio(bars, localStart, upper, lower, atr, config.boundaries.touchToleranceAtr);
  const latestAnchorIndex = Math.max(...[...highs, ...lows].map((pivot) => pivot.barIndex));
  const status = boundaryStatus(bars, [upper, lower], latestAnchorIndex + 1, atr, atrBySourceIndex, config.boundaries.breakoutAtr);
  const upperSlopeAtr = upper.slopePerBar / atr;
  const lowerSlopeAtr = lower.slopePerBar / atr;
  const evaluations = [
    rule('triangle-pivot-count', '上下邊界各至少兩個有效轉折點', 'required', 'met', `上緣 ${highs.length} 個、下緣 ${lows.length} 個轉折點。`),
    rule('triangle-window', '形成區間至少八根完成 K 棒', 'required', window.barCount >= config.triangle.minimumWindowBars ? 'met' : 'not-met', `形成區間 ${window.barCount} 根完成 K 棒。`),
    rule('triangle-converging-slopes', '上緣下降且下緣上升', 'required', upperSlopeAtr <= -config.triangle.minimumSlopeAtrPerBar && lowerSlopeAtr >= config.triangle.minimumSlopeAtrPerBar ? 'met' : 'not-met', `上緣斜率 ${round(upperSlopeAtr)} ATR／根，下緣斜率 ${round(lowerSlopeAtr)} ATR／根。`),
    rule('triangle-compression', '上下邊界距離確實縮小', 'required', compression >= 0 && compression <= config.triangle.minimumCompressionRatio ? 'met' : 'not-met', `起迄寬度比例 ${round(compression)}。`),
    rule('triangle-apex', '交點位於合理的前方範圍', 'required', apexProgress !== null && apexProgress >= config.triangle.minimumApexProgress && apexProgress <= config.triangle.maximumApexProgress ? 'met' : 'not-met', apexProgress === null ? '兩條邊界無法形成可判讀交點。' : `交點進度 ${round(apexProgress)}。`),
    rule('triangle-touch-residual', '轉折點貼近各自邊界', 'supporting', upper.normalizedResidualAtr <= config.boundaries.maximumResidualAtr && lower.normalizedResidualAtr <= config.boundaries.maximumResidualAtr ? 'met' : 'not-met', `上緣殘差 ${upper.normalizedResidualAtr} ATR，下緣殘差 ${lower.normalizedResidualAtr} ATR。`),
    rule('triangle-inside-closes', '多數收盤位於收斂邊界內', 'supporting', closeRatio >= config.boundaries.insideCloseRatio ? 'met' : 'not-met', `邊界內收盤比例 ${Math.round(closeRatio * 100)}%。`),
    rule('triangle-returned-after-breakout', '確認後未返回三角形內', 'invalidating', status.status === 'invalid' ? 'met' : 'not-met', status.status === 'invalid' ? '先前已離開邊界，最新收盤已返回三角形內。' : '目前未觀察到確認後返回三角形內。'),
  ];
  const draft: CandidateDraft = {
    structureId: 'triangle-consolidation',
    anchors: [...highs, ...lows].sort((left, right) => left.barIndex - right.barIndex),
    boundaries: [upper, lower],
    window,
    evaluations,
    status: status.status,
    direction: status.direction,
    confirmationCondition: '完成 K 棒收盤有效離開任一收斂邊界後，才依實際方向確認。',
    invalidationCondition: '已確認後若完成 K 棒返回三角形內，該結構只保留為失效教學參考。',
  };
  return draft;
}

function rank(candidates: readonly StructureCandidate[]): readonly StructureCandidate[] {
  return [...candidates]
    .sort((left, right) => (
      right.ruleFit - left.ruleFit
      || right.geometryCompleteness - left.geometryCompleteness
      || right.dataCompleteness - left.dataCompleteness
      || left.structureId.localeCompare(right.structureId)
      || left.candidateId.localeCompare(right.candidateId)
    ))
    .slice(0, 3);
}

function isNearMiss(value: CandidateDraft | StructureNearMiss): value is StructureNearMiss {
  return 'missingConditions' in value;
}

/**
 * 分析指定週期與指定價格口徑的完成 K 棒。函式沒有網路、時間或 UI 副作用，
 * 並只讀取 cutoff 日及以前的最多 120 根資料。
 */
export function analyzeStructures(
  input: StructureAnalysisInput,
  options: AnalyzeStructuresOptions = {},
): StructureAnalysisResult {
  const config = options.config ?? STRUCTURE_ENGINE_CONFIG;
  const preparedInput = prepareInput(input, options, config);
  const fallback = {
    cutoffDate: options.cutoffDate ?? input.cutoffDate ?? input.bars?.at(-1)?.date ?? null,
    timeframe: defaultTimeframe(input.timeframe),
    priceMode: defaultPriceMode(input.priceMode),
  };
  if (!preparedInput.prepared) {
    return invalidResult(fallback, preparedInput.sourceBarCount, config, preparedInput.reasonCodes);
  }

  const prepared = preparedInput.prepared;
  const features = extractStructureFeatures(prepared.bars, prepared.sourceBarCount, config, prepared.warnings);
  const atr = features.atr.latest;
  if (atr === null || atr <= 0) {
    return {
      status: 'insufficient-evidence',
      matcherVersion: STRUCTURE_MATCHER_VERSION,
      timeframe: prepared.timeframe,
      priceMode: prepared.priceMode,
      cutoffDate: prepared.cutoffDate,
      features,
      candidates: [],
      nearMisses: [],
      reasonCodes: ['atr-unavailable-or-zero'],
    };
  }

  const drafts = [
    buildBoxDraft(
      prepared.bars,
      features.pivots,
      atr,
      new Map(prepared.bars.map((entry, index) => [entry.sourceIndex, features.atr.values[index] ?? null])),
      config,
    ),
    buildTriangleDraft(
      prepared.bars,
      features.pivots,
      atr,
      new Map(prepared.bars.map((entry, index) => [entry.sourceIndex, features.atr.values[index] ?? null])),
      config,
    ),
  ];
  const candidates: StructureCandidate[] = [];
  const nearMisses: StructureNearMiss[] = [];

  drafts.forEach((draft) => {
    if (isNearMiss(draft)) {
      nearMisses.push(draft);
      return;
    }
    const minimumFit = draft.structureId === 'range' ? config.box.minimumRuleFit : config.triangle.minimumRuleFit;
    // 已發生的確認後返回屬於歷史失效事實；不能因後續 K 棒改變形成期幾何而被洗成一般資料不足。
    if (draft.status === 'invalid') {
      nearMisses.push(nearMiss(draft.structureId, 'invalid', draft.evaluations, draft.window));
      return;
    }
    if (!requiredMet(draft.evaluations) || score(draft.evaluations) < minimumFit) {
      nearMisses.push(nearMiss(draft.structureId, 'insufficient-evidence', draft.evaluations, draft.window));
      return;
    }
    if (draft.status === 'insufficient-evidence') {
      nearMisses.push(nearMiss(draft.structureId, 'insufficient-evidence', draft.evaluations, draft.window));
      return;
    }
    candidates.push(candidateFromDraft(draft, prepared, prepared.warnings));
  });

  const ranked = rank(candidates);
  return {
    status: ranked.length > 0 ? 'matched' : 'no-clear-pattern',
    matcherVersion: STRUCTURE_MATCHER_VERSION,
    timeframe: prepared.timeframe,
    priceMode: prepared.priceMode,
    cutoffDate: prepared.cutoffDate,
    features,
    candidates: ranked,
    nearMisses: nearMisses.sort((left, right) => left.structureId.localeCompare(right.structureId)),
    reasonCodes: [],
  };
}
