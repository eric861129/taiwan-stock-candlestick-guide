import type {
  IndexedStructureBar,
  StructureBoundary,
  StructureDirection,
  StructureOverlaySegment,
  StructurePivot,
  StructureRuleEvaluation,
  StructureStatus,
  StructureWindow,
} from './types';

/** 本模組可辨識、稍後由結構引擎 adapter 納入排行的三種正規卡片。 */
export type ContinuationStructureId = 'flag-consolidation' | 'false-breakout' | 'rounding-top';

/** 三種結構辨識使用的單一版本化門檻來源。 */
export interface ContinuationStructureConfig {
  version: 'continuation-structures-v1';
  minimumRuleFit: number;
  atrPeriod: number;
  breakoutBufferAtr: number;
  lifecycleLookbackBars: number;
  flag: {
    impulseBars: number;
    consolidationBars: number;
    minimumImpulseAtr: number;
    maximumRangeToImpulse: number;
    minimumCounterSlopeAtrPerBar: number;
    maximumCounterSlopeAtrPerBar: number;
    minimumOverlapRatio: number;
  };
  falseBreakout: {
    rangeBars: number;
    maximumRangeAtr: number;
    maximumTrendSlopeAtrPerBar: number;
    minimumDirectionChanges: number;
    returnWindowBars: number;
    holdBars: number;
  };
  roundingTop: {
    bodyBars: number;
    smoothingBars: number;
    minimumSegmentSlopeAtrPerBar: number;
    maximumFlatSlopeAtrPerBar: number;
    minimumPeakProgress: number;
    maximumPeakProgress: number;
    minimumBroadPeakBars: number;
    broadPeakToleranceAtr: number;
    maximumSingleStepAtr: number;
    endpointBars: number;
    maximumEndpointDifferenceAtr: number;
    minimumDownwardCurvatureAtr: number;
    maximumQuadraticResidualAtr: number;
  };
}

export const CONTINUATION_STRUCTURE_CONFIG: ContinuationStructureConfig = {
  version: 'continuation-structures-v1',
  minimumRuleFit: 70,
  atrPeriod: 14,
  breakoutBufferAtr: 0.15,
  lifecycleLookbackBars: 120,
  flag: {
    impulseBars: 5,
    consolidationBars: 6,
    minimumImpulseAtr: 3,
    maximumRangeToImpulse: 0.45,
    minimumCounterSlopeAtrPerBar: -0.35,
    maximumCounterSlopeAtrPerBar: 0.08,
    minimumOverlapRatio: 0.6,
  },
  falseBreakout: {
    rangeBars: 8,
    maximumRangeAtr: 3,
    maximumTrendSlopeAtrPerBar: 0.12,
    minimumDirectionChanges: 2,
    returnWindowBars: 3,
    holdBars: 1,
  },
  roundingTop: {
    bodyBars: 21,
    smoothingBars: 3,
    minimumSegmentSlopeAtrPerBar: 0.16,
    maximumFlatSlopeAtrPerBar: 0.2,
    minimumPeakProgress: 0.3,
    maximumPeakProgress: 0.7,
    minimumBroadPeakBars: 3,
    broadPeakToleranceAtr: 0.5,
    maximumSingleStepAtr: 1.25,
    endpointBars: 3,
    maximumEndpointDifferenceAtr: 1.5,
    minimumDownwardCurvatureAtr: 2,
    maximumQuadraticResidualAtr: 0.32,
  },
};

/** 已確認候選才可提供的條件式情境，不攜帶機率、目標價或未來座標。 */
export interface ContinuationStructureScenario {
  kind: 'continuation' | 'retest' | 'invalidation';
  label: string;
  condition: string;
}

/** 主結構引擎只需轉接此最小草稿，不必重算本模組的幾何。 */
export interface ContinuationStructureDraft {
  structureId: ContinuationStructureId;
  status: StructureStatus;
  direction: StructureDirection;
  window?: StructureWindow;
  anchors: readonly StructurePivot[];
  boundaries: readonly StructureBoundary[];
  evaluations: readonly StructureRuleEvaluation[];
  confirmationCondition: string;
  invalidationCondition: string;
  segments: readonly StructureOverlaySegment[];
  scenarios?: readonly ContinuationStructureScenario[];
}

/** 純函式分析 seam；呼叫端負責先完成資料、cutoff 與連續性守門。 */
export interface ContinuationStructureInput {
  bars: readonly IndexedStructureBar[];
  config?: ContinuationStructureConfig;
}

interface FlagGeometry {
  impulse: readonly IndexedStructureBar[];
  flag: readonly IndexedStructureBar[];
  direction: Exclude<StructureDirection, 'undetermined'>;
  atr: number;
  upper: StructureBoundary;
  lower: StructureBoundary;
  evaluations: readonly StructureRuleEvaluation[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageTrueRange(bars: readonly IndexedStructureBar[], period: number): number {
  const ranges = bars.map((entry, index) => {
    const previousClose = bars[index - 1]?.bar.close ?? entry.bar.open;
    return Math.max(
      entry.bar.high - entry.bar.low,
      Math.abs(entry.bar.high - previousClose),
      Math.abs(entry.bar.low - previousClose),
    );
  });
  return average(ranges.slice(-period));
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

function windowOf(bars: readonly IndexedStructureBar[]): StructureWindow | undefined {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return undefined;
  return {
    version: 'structure-window-v1',
    startBarIndex: first.sourceIndex,
    endBarIndex: last.sourceIndex,
    startDate: first.bar.date,
    endDate: last.bar.date,
    barCount: bars.length,
  };
}

function horizontalBoundary(
  id: StructureBoundary['id'],
  price: number,
  bars: readonly IndexedStructureBar[],
  touchBarIndexes: readonly number[],
): StructureBoundary {
  const startBarIndex = bars[0]?.sourceIndex ?? 0;
  const endBarIndex = bars.at(-1)?.sourceIndex ?? startBarIndex;
  return {
    version: 'structure-boundary-v1',
    id,
    startBarIndex,
    endBarIndex,
    slopePerBar: 0,
    intercept: price,
    startPrice: price,
    endPrice: price,
    touchBarIndexes,
    normalizedResidualAtr: 0,
  };
}

function pivot(
  entry: IndexedStructureBar,
  kind: StructurePivot['kind'],
  price: number,
  prominenceAtr: number,
): StructurePivot {
  return {
    version: 'structure-pivot-v1',
    barIndex: entry.sourceIndex,
    date: entry.bar.date,
    price,
    kind,
    prominenceAtr: round(prominenceAtr),
  };
}

function overlapRatio(bars: readonly IndexedStructureBar[]): number {
  if (bars.length < 2) return 0;
  let overlaps = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    if (previous && current && Math.min(previous.bar.high, current.bar.high) >= Math.max(previous.bar.low, current.bar.low)) {
      overlaps += 1;
    }
  }
  return overlaps / (bars.length - 1);
}

function flagGeometry(
  impulse: readonly IndexedStructureBar[],
  flag: readonly IndexedStructureBar[],
  config: ContinuationStructureConfig,
): FlagGeometry | undefined {
  const firstImpulse = impulse[0];
  const lastImpulse = impulse.at(-1);
  const firstFlag = flag[0];
  const lastFlag = flag.at(-1);
  if (!firstImpulse || !lastImpulse || !firstFlag || !lastFlag
    || impulse.length < config.flag.impulseBars || flag.length < config.flag.consolidationBars) return undefined;

  const atr = averageTrueRange([...impulse, ...flag], config.atrPeriod);
  if (!Number.isFinite(atr) || atr <= 0) return undefined;
  const impulseMove = lastImpulse.bar.close - firstImpulse.bar.close;
  const direction = impulseMove > 0 ? 'up' : 'down';
  const flagHigh = Math.max(...flag.map((entry) => entry.bar.high));
  const flagLow = Math.min(...flag.map((entry) => entry.bar.low));
  const flagRange = flagHigh - flagLow;
  const normalizedSlope = ((lastFlag.bar.close - firstFlag.bar.close) / Math.max(1, flag.length - 1)) / atr;
  const overlap = overlapRatio(flag);
  const impulseMet = Math.abs(impulseMove) >= atr * config.flag.minimumImpulseAtr;
  const compactMet = flagRange <= Math.abs(impulseMove) * config.flag.maximumRangeToImpulse;
  const counterOrFlat = direction === 'up'
    ? normalizedSlope >= config.flag.minimumCounterSlopeAtrPerBar && normalizedSlope <= config.flag.maximumCounterSlopeAtrPerBar
    : normalizedSlope <= -config.flag.minimumCounterSlopeAtrPerBar && normalizedSlope >= -config.flag.maximumCounterSlopeAtrPerBar;
  const overlapMet = overlap >= config.flag.minimumOverlapRatio;
  const evaluations = [
    rule('flag-directional-move', '前段具有明確方向性移動', 'required', impulseMet ? 'met' : 'not-met', `前段移動為 ${round(Math.abs(impulseMove) / atr)} ATR。`),
    rule('flag-compact-range', '整理振幅明顯小於前段移動', 'required', compactMet ? 'met' : 'not-met', `整理振幅為前段移動的 ${round(flagRange / Math.max(Math.abs(impulseMove), Number.EPSILON))} 倍。`),
    rule('flag-counter-or-flat', '短整理方向與前段相反或近乎橫向', 'required', counterOrFlat ? 'met' : 'not-met', `整理收盤斜率為 ${round(normalizedSlope)} ATR／根。`),
    rule('flag-overlap', '整理期間多數相鄰 K 棒重疊', 'required', overlapMet ? 'met' : 'not-met', `相鄰 K 棒重疊比例 ${Math.round(overlap * 100)}%。`),
  ];
  if (!impulseMet || !compactMet || !counterOrFlat || !overlapMet) return undefined;

  return {
    impulse,
    flag,
    direction,
    atr,
    upper: horizontalBoundary('upper', flagHigh, flag, [flag.find((entry) => entry.bar.high === flagHigh)?.sourceIndex ?? firstFlag.sourceIndex]),
    lower: horizontalBoundary('lower', flagLow, flag, [flag.find((entry) => entry.bar.low === flagLow)?.sourceIndex ?? firstFlag.sourceIndex]),
    evaluations,
  };
}

function flagSegments(
  geometry: FlagGeometry,
  status: StructureStatus,
): readonly StructureOverlaySegment[] {
  const confirmation = geometry.direction === 'up' ? geometry.upper : geometry.lower;
  const invalidation = geometry.direction === 'up' ? geometry.lower : geometry.upper;
  const base: StructureOverlaySegment[] = [
    {
      id: 'flag-confirmation',
      kind: 'confirmation',
      label: '旗形確認邊界',
      startBarIndex: confirmation.startBarIndex,
      startPrice: confirmation.startPrice,
      endBarIndex: confirmation.endBarIndex,
      endPrice: confirmation.endPrice,
      lineStyle: 'dashed',
    },
    {
      id: 'flag-invalidation',
      kind: 'invalidation',
      label: '旗形失效邊界',
      startBarIndex: invalidation.startBarIndex,
      startPrice: invalidation.startPrice,
      endBarIndex: invalidation.endBarIndex,
      endPrice: invalidation.endPrice,
      lineStyle: 'dashed',
    },
  ];
  if (status === 'forming') return base;
  return [
    ...base,
    ...[geometry.upper, geometry.lower].map((boundary): StructureOverlaySegment => ({
      id: `flag-${boundary.id}`,
      kind: 'boundary',
      label: boundary.id === 'upper' ? '旗形上緣' : '旗形下緣',
      startBarIndex: boundary.startBarIndex,
      startPrice: boundary.startPrice,
      endBarIndex: boundary.endBarIndex,
      endPrice: boundary.endPrice,
      lineStyle: 'solid',
    })),
  ];
}

function scenarios(direction: Exclude<StructureDirection, 'undetermined'>): readonly ContinuationStructureScenario[] {
  const directionLabel = direction === 'up' ? '向上' : '向下';
  return [
    { kind: 'continuation', label: '延續情境', condition: `後續完成 K 棒仍守在${directionLabel}確認邊界之外。` },
    { kind: 'retest', label: '回測情境', condition: '價格回測確認邊界後，以完成 K 棒重新守住。' },
    { kind: 'invalidation', label: '失效情境', condition: '完成 K 棒返回原整理區或越過失效邊界。' },
  ];
}

function flagDraft(
  bars: readonly IndexedStructureBar[],
  config: ContinuationStructureConfig,
): ContinuationStructureDraft {
  const baseBars = config.flag.impulseBars + config.flag.consolidationBars;
  const empty: ContinuationStructureDraft = {
    structureId: 'flag-consolidation',
    status: 'insufficient-evidence',
    direction: 'undetermined',
    anchors: [],
    boundaries: [],
    evaluations: [rule('flag-minimum-bars', `至少 ${baseBars} 根完成 K 棒`, 'required', 'not-met', `目前只有 ${bars.length} 根。`)],
    confirmationCondition: '完成 K 棒依前段方向離開短整理邊界後，才確認旗形。',
    invalidationCondition: '完成 K 棒由反方向離開短整理邊界時，旗形失效。',
    segments: [],
  };
  if (bars.length < baseBars) return empty;

  const terminalDrafts: ContinuationStructureDraft[] = [];
  const formingDrafts: ContinuationStructureDraft[] = [];
  const firstStart = Math.max(0, bars.length - config.lifecycleLookbackBars);
  for (let start = firstStart; start <= bars.length - baseBars; start += 1) {
    const geometry = flagGeometry(
      bars.slice(start, start + config.flag.impulseBars),
      bars.slice(start + config.flag.impulseBars, start + baseBars),
      config,
    );
    if (!geometry) continue;
    const buffer = geometry.atr * config.breakoutBufferAtr;
    let status: StructureStatus = 'forming';
    let direction: StructureDirection = 'undetermined';
    for (const entry of bars.slice(start + baseBars)) {
      const confirms = geometry.direction === 'up'
        ? entry.bar.close > geometry.upper.endPrice + buffer
        : entry.bar.close < geometry.lower.endPrice - buffer;
      const invalidates = geometry.direction === 'up'
        ? entry.bar.close < geometry.lower.endPrice - buffer
        : entry.bar.close > geometry.upper.endPrice + buffer;
      if (invalidates) {
        status = 'invalid';
        direction = 'undetermined';
        break;
      }
      if (confirms) {
        status = 'confirmed';
        direction = geometry.direction;
      }
    }
    const structureBars = bars.slice(start);
    const draft: ContinuationStructureDraft = {
      structureId: 'flag-consolidation',
      status,
      direction,
      window: windowOf(structureBars),
      anchors: [
        pivot(geometry.impulse[0]!, geometry.direction === 'up' ? 'low' : 'high', geometry.impulse[0]!.bar.close, Math.abs(geometry.impulse.at(-1)!.bar.close - geometry.impulse[0]!.bar.close) / geometry.atr),
        pivot(geometry.impulse.at(-1)!, geometry.direction === 'up' ? 'high' : 'low', geometry.impulse.at(-1)!.bar.close, Math.abs(geometry.impulse.at(-1)!.bar.close - geometry.impulse[0]!.bar.close) / geometry.atr),
      ],
      boundaries: [geometry.upper, geometry.lower],
      evaluations: geometry.evaluations,
      confirmationCondition: '完成 K 棒依前段方向離開短整理邊界後，才確認旗形。',
      invalidationCondition: '完成 K 棒由反方向離開短整理邊界時，旗形失效。',
      segments: flagSegments(geometry, status),
      ...(status === 'confirmed' ? { scenarios: scenarios(geometry.direction) } : {}),
    };
    (status === 'forming' ? formingDrafts : terminalDrafts).push(draft);
  }
  return terminalDrafts.at(-1) ?? formingDrafts.at(-1) ?? empty;
}

interface RangeGeometry {
  range: readonly IndexedStructureBar[];
  atr: number;
  upper: StructureBoundary;
  lower: StructureBoundary;
  evaluations: readonly StructureRuleEvaluation[];
}

function rangeGeometry(
  rangeBars: readonly IndexedStructureBar[],
  config: ContinuationStructureConfig,
): RangeGeometry | undefined {
  const first = rangeBars[0];
  if (!first || rangeBars.length < config.falseBreakout.rangeBars) return undefined;
  const atr = averageTrueRange(rangeBars, config.atrPeriod);
  if (!Number.isFinite(atr) || atr <= 0) return undefined;
  const upperPrice = Math.max(...rangeBars.map((entry) => entry.bar.high));
  const lowerPrice = Math.min(...rangeBars.map((entry) => entry.bar.low));
  const rangeWidth = upperPrice - lowerPrice;
  const closes = rangeBars.map((entry) => entry.bar.close);
  const xMean = (rangeBars.length - 1) / 2;
  const closeMean = average(closes);
  const slopeNumerator = closes.reduce((sum, close, index) => sum + (index - xMean) * (close - closeMean), 0);
  const slopeDenominator = closes.reduce((sum, _close, index) => sum + (index - xMean) ** 2, 0);
  const normalizedSlope = slopeDenominator === 0 ? 0 : slopeNumerator / slopeDenominator / atr;
  const directions = closes.slice(1).map((close, index) => Math.sign(close - closes[index]!)).filter((value) => value !== 0);
  const directionChanges = directions.slice(1).filter((direction, index) => direction !== directions[index]).length;
  const compact = rangeWidth <= atr * config.falseBreakout.maximumRangeAtr;
  const stable = Math.abs(normalizedSlope) <= config.falseBreakout.maximumTrendSlopeAtrPerBar
    && directionChanges >= config.falseBreakout.minimumDirectionChanges;
  const evaluations = [
    rule(
      'false-breakout-prior-range',
      '突破前已有事前可重現的橫向區間',
      'required',
      compact && stable ? 'met' : 'not-met',
      `區間寬 ${round(rangeWidth / atr)} ATR，收盤趨勢斜率 ${round(normalizedSlope)} ATR／根，方向改變 ${directionChanges} 次。`,
    ),
  ];
  if (!compact || !stable) return undefined;
  return {
    range: rangeBars,
    atr,
    upper: horizontalBoundary('upper', upperPrice, rangeBars, rangeBars.filter((entry) => entry.bar.high === upperPrice).map((entry) => entry.sourceIndex)),
    lower: horizontalBoundary('lower', lowerPrice, rangeBars, rangeBars.filter((entry) => entry.bar.low === lowerPrice).map((entry) => entry.sourceIndex)),
    evaluations,
  };
}

function falseBreakoutSegments(
  geometry: RangeGeometry,
  failedSide: 'upper' | 'lower',
  breakout: IndexedStructureBar,
  status: StructureStatus,
  buffer: number,
): readonly StructureOverlaySegment[] {
  const returnBoundary = failedSide === 'upper' ? geometry.upper : geometry.lower;
  const invalidationPrice = failedSide === 'upper'
    ? geometry.upper.endPrice + buffer
    : geometry.lower.endPrice - buffer;
  const formingSegments: StructureOverlaySegment[] = [
    {
      id: 'false-breakout-confirmation',
      kind: 'confirmation',
      label: '收盤返回原區間才確認假突破',
      startBarIndex: returnBoundary.startBarIndex,
      startPrice: returnBoundary.startPrice,
      endBarIndex: breakout.sourceIndex,
      endPrice: returnBoundary.endPrice,
      lineStyle: 'dashed',
    },
    {
      id: 'false-breakout-invalidation',
      kind: 'invalidation',
      label: '離開後守住則假突破論點失效',
      startBarIndex: geometry.range[0]?.sourceIndex ?? breakout.sourceIndex,
      startPrice: invalidationPrice,
      endBarIndex: breakout.sourceIndex,
      endPrice: invalidationPrice,
      lineStyle: 'dashed',
    },
  ];
  if (status === 'forming') return formingSegments;
  return [
    ...formingSegments,
    ...[geometry.upper, geometry.lower].map((boundary): StructureOverlaySegment => ({
      id: `false-breakout-${boundary.id}`,
      kind: 'boundary',
      label: boundary.id === 'upper' ? '原區間上緣' : '原區間下緣',
      startBarIndex: boundary.startBarIndex,
      startPrice: boundary.startPrice,
      endBarIndex: boundary.endBarIndex,
      endPrice: boundary.endPrice,
      lineStyle: 'solid',
    })),
  ];
}

function falseBreakoutDraft(
  bars: readonly IndexedStructureBar[],
  config: ContinuationStructureConfig,
): ContinuationStructureDraft {
  const minimumBars = config.falseBreakout.rangeBars + 1;
  const empty: ContinuationStructureDraft = {
    structureId: 'false-breakout',
    status: 'insufficient-evidence',
    direction: 'undetermined',
    anchors: [],
    boundaries: [],
    evaluations: [rule('false-breakout-minimum-bars', `至少 ${minimumBars} 根完成 K 棒`, 'required', 'not-met', `目前只有 ${bars.length} 根。`)],
    confirmationCondition: `收盤先有效離開事前區間，於 ${config.falseBreakout.returnWindowBars} 根內收回並至少守住 ${config.falseBreakout.holdBars} 根完成 K 棒後，才確認假突破。`,
    invalidationCondition: '未在返回窗內收回，或收回後立即再次離開原側邊界時，假突破論點失效。',
    segments: [],
  };
  if (bars.length < minimumBars) return empty;

  const terminalDrafts: ContinuationStructureDraft[] = [];
  const formingDrafts: ContinuationStructureDraft[] = [];
  const firstStart = Math.max(0, bars.length - config.lifecycleLookbackBars);
  for (let start = firstStart; start <= bars.length - minimumBars; start += 1) {
    const rangeBars = bars.slice(start, start + config.falseBreakout.rangeBars);
    const breakout = bars[start + config.falseBreakout.rangeBars];
    const geometry = rangeGeometry(rangeBars, config);
    if (!geometry || !breakout) continue;
    const buffer = geometry.atr * config.breakoutBufferAtr;
    const failedSide = breakout.bar.close > geometry.upper.endPrice + buffer
      ? 'upper'
      : breakout.bar.close < geometry.lower.endPrice - buffer
        ? 'lower'
        : undefined;
    if (!failedSide) continue;

    const lifecycle = bars.slice(start + minimumBars);
    const insideRange = (entry: IndexedStructureBar): boolean => (
      entry.bar.close <= geometry.upper.endPrice && entry.bar.close >= geometry.lower.endPrice
    );
    const rebreaksFailedSide = (entry: IndexedStructureBar): boolean => failedSide === 'upper'
      ? entry.bar.close > geometry.upper.endPrice + buffer
      : entry.bar.close < geometry.lower.endPrice - buffer;
    const returnIndex = lifecycle
      .slice(0, config.falseBreakout.returnWindowBars)
      .findIndex(insideRange);
    let status: StructureStatus = 'forming';
    let direction: StructureDirection = 'undetermined';
    let returned = false;
    let held = false;
    if (returnIndex >= 0) {
      returned = true;
      const holdStart = returnIndex + 1;
      const holdBars = lifecycle.slice(holdStart, holdStart + config.falseBreakout.holdBars);
      const laterBars = lifecycle.slice(holdStart);
      if (laterBars.some(rebreaksFailedSide)) {
        status = 'invalid';
      } else if (holdBars.length >= config.falseBreakout.holdBars) {
        if (holdBars.every(insideRange)) {
          held = true;
          status = 'confirmed';
          direction = failedSide === 'upper' ? 'down' : 'up';
        } else {
          status = 'invalid';
        }
      }
    } else if (lifecycle.length >= config.falseBreakout.returnWindowBars) {
      status = 'invalid';
    }
    const evaluations = [
      ...geometry.evaluations,
      rule('false-breakout-close-left-range', '先有完成 K 棒收盤離開原區間', 'required', 'met', `收盤由${failedSide === 'upper' ? '上方' : '下方'}離開原區間。`),
      rule('false-breakout-close-returned', `在 ${config.falseBreakout.returnWindowBars} 根內收回原區間`, 'supporting', returned ? 'met' : 'not-met', returned ? '完成 K 棒已在返回窗內收回原區間。' : '尚未在返回窗內收回原區間。'),
      rule('false-breakout-close-held', `收回後至少守住 ${config.falseBreakout.holdBars} 根完成 K 棒`, 'supporting', held ? 'met' : 'not-met', held ? '收回後已守住原區間。' : '收回後尚未累積足夠守住證據。'),
    ];
    const draft: ContinuationStructureDraft = {
      structureId: 'false-breakout',
      status,
      direction,
      window: windowOf(bars.slice(start)),
      anchors: [
        pivot(breakout, failedSide === 'upper' ? 'high' : 'low', failedSide === 'upper' ? breakout.bar.high : breakout.bar.low, Math.abs(breakout.bar.close - (failedSide === 'upper' ? geometry.upper.endPrice : geometry.lower.endPrice)) / geometry.atr),
      ],
      boundaries: [geometry.upper, geometry.lower],
      evaluations,
      confirmationCondition: `收盤先有效離開事前區間，於 ${config.falseBreakout.returnWindowBars} 根內收回並至少守住 ${config.falseBreakout.holdBars} 根完成 K 棒後，才確認假突破。`,
      invalidationCondition: '未在返回窗內收回，或收回後立即再次離開原側邊界時，假突破論點失效。',
      segments: falseBreakoutSegments(geometry, failedSide, breakout, status, buffer),
      ...(status === 'confirmed' ? { scenarios: scenarios(direction as Exclude<StructureDirection, 'undetermined'>) } : {}),
    };
    (status === 'forming' ? formingDrafts : terminalDrafts).push(draft);
  }
  return terminalDrafts.at(-1) ?? formingDrafts.at(-1) ?? empty;
}

interface RoundingTopGeometry {
  body: readonly IndexedStructureBar[];
  atr: number;
  support: StructureBoundary;
  invalidation: StructureBoundary;
  peak: IndexedStructureBar;
  evaluations: readonly StructureRuleEvaluation[];
}

function normalizedSegmentSlope(
  values: readonly number[],
  atr: number,
): number {
  const first = values[0];
  const last = values.at(-1);
  if (first === undefined || last === undefined || values.length < 2 || atr <= 0) return 0;
  return ((last - first) / (values.length - 1)) / atr;
}

function trailingSmooth(values: readonly number[], width: number): readonly number[] {
  return values.map((_, index) => average(values.slice(Math.max(0, index - width + 1), index + 1)));
}

function quadraticFit(values: readonly number[]): { curvature: number; residual: number } | undefined {
  if (values.length < 3) return undefined;
  const x = values.map((_, index) => -1 + 2 * index / (values.length - 1));
  const sumX2 = x.reduce((sum, value) => sum + value ** 2, 0);
  const sumX4 = x.reduce((sum, value) => sum + value ** 4, 0);
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = x.reduce((sum, value, index) => sum + value * values[index]!, 0);
  const sumX2Y = x.reduce((sum, value, index) => sum + value ** 2 * values[index]!, 0);
  const determinant = sumX4 * values.length - sumX2 ** 2;
  if (determinant === 0 || sumX2 === 0) return undefined;
  const curvature = (sumX2Y * values.length - sumY * sumX2) / determinant;
  const slope = sumXY / sumX2;
  const intercept = (sumX4 * sumY - sumX2 * sumX2Y) / determinant;
  const residual = Math.sqrt(average(values.map((value, index) => {
    const fitted = curvature * x[index]! ** 2 + slope * x[index]! + intercept;
    return (value - fitted) ** 2;
  })));
  return { curvature, residual };
}

function roundingTopGeometry(
  body: readonly IndexedStructureBar[],
  config: ContinuationStructureConfig,
): RoundingTopGeometry | undefined {
  if (body.length < config.roundingTop.bodyBars) return undefined;
  const normalizedBody = body.slice(-config.roundingTop.bodyBars);
  const atr = averageTrueRange(normalizedBody, config.atrPeriod);
  if (!Number.isFinite(atr) || atr <= 0) return undefined;
  const smoothed = trailingSmooth(
    normalizedBody.map((entry) => entry.bar.close),
    config.roundingTop.smoothingBars,
  );
  const thirdSize = Math.floor(smoothed.length / 3);
  const firstThird = smoothed.slice(0, thirdSize);
  const middleThird = smoothed.slice(thirdSize, smoothed.length - thirdSize);
  const finalThird = smoothed.slice(-thirdSize);
  const firstSlope = normalizedSegmentSlope(firstThird, atr);
  const middleSlope = normalizedSegmentSlope(middleThird, atr);
  const finalSlope = normalizedSegmentSlope(finalThird, atr);
  const maximumClose = Math.max(...smoothed);
  const peakIndex = smoothed.findIndex((close) => close === maximumClose);
  const peak = normalizedBody[peakIndex];
  if (!peak) return undefined;
  const broadPeakCount = smoothed.filter((close) => close >= maximumClose - atr * config.roundingTop.broadPeakToleranceAtr).length;
  const singleStepAtr = Math.max(...normalizedBody.slice(1).map((entry, index) => (
    Math.abs(entry.bar.close - normalizedBody[index]!.bar.close) / atr
  )));
  const endpointCloses = [
    ...normalizedBody.slice(0, config.roundingTop.endpointBars).map((entry) => entry.bar.close),
    ...normalizedBody.slice(-config.roundingTop.endpointBars).map((entry) => entry.bar.close),
  ];
  const supportPrice = average(endpointCloses);
  const peakProgress = peakIndex / Math.max(1, normalizedBody.length - 1);
  const fit = quadraticFit(smoothed);
  if (!fit) return undefined;
  const normalizedCurvature = fit.curvature / atr;
  const normalizedResidual = fit.residual / atr;
  const rising = firstSlope >= config.roundingTop.minimumSegmentSlopeAtrPerBar;
  const flattening = Math.abs(middleSlope) <= config.roundingTop.maximumFlatSlopeAtrPerBar;
  const falling = finalSlope <= -config.roundingTop.minimumSegmentSlopeAtrPerBar;
  const centered = peakProgress >= config.roundingTop.minimumPeakProgress && peakProgress <= config.roundingTop.maximumPeakProgress;
  const broad = broadPeakCount >= config.roundingTop.minimumBroadPeakBars;
  const noSingleJump = singleStepAtr <= config.roundingTop.maximumSingleStepAtr;
  const firstEndpoint = average(normalizedBody.slice(0, config.roundingTop.endpointBars).map((entry) => entry.bar.close));
  const finalEndpoint = average(normalizedBody.slice(-config.roundingTop.endpointBars).map((entry) => entry.bar.close));
  const endpointsComparable = Math.abs(firstEndpoint - finalEndpoint) <= atr * config.roundingTop.maximumEndpointDifferenceAtr;
  const downwardCurvature = normalizedCurvature <= -config.roundingTop.minimumDownwardCurvatureAtr;
  const residualMet = normalizedResidual <= config.roundingTop.maximumQuadraticResidualAtr;
  const evaluations = [
    rule('rounding-top-slope-sequence', '平滑輪廓斜率由正轉平再轉負', 'required', rising && flattening && falling ? 'met' : 'not-met', `三段斜率依序為 ${round(firstSlope)}、${round(middleSlope)}、${round(finalSlope)} ATR／根。`),
    rule('rounding-top-centered-peak', '高點位於寬弧中段', 'required', centered ? 'met' : 'not-met', `最高收盤位於區間進度 ${Math.round(peakProgress * 100)}%。`),
    rule('rounding-top-broad-peak', '頂部由多根 K 棒共同形成', 'required', broad ? 'met' : 'not-met', `頂部附近共有 ${broadPeakCount} 根完成 K 棒。`),
    rule('rounding-top-no-single-spike', '輪廓不是單一尖峰造成', 'required', noSingleJump ? 'met' : 'not-met', `最大單步變動 ${round(singleStepAtr)} ATR。`),
    rule('rounding-top-endpoints', '弧形兩端回到可比較的支撐區', 'required', endpointsComparable ? 'met' : 'not-met', `兩端平均收盤相差 ${round(Math.abs(firstEndpoint - finalEndpoint) / atr)} ATR。`),
    rule('rounding-top-downward-curvature', '因果平滑後具有向下二次曲率', 'required', downwardCurvature ? 'met' : 'not-met', `二次曲率為 ${round(normalizedCurvature)} ATR。`),
    rule('rounding-top-fit-residual', '寬弧擬合殘差在固定門檻內', 'required', residualMet ? 'met' : 'not-met', `擬合殘差為 ${round(normalizedResidual)} ATR。`),
  ];
  if (!rising || !flattening || !falling || !centered || !broad || !noSingleJump
    || !endpointsComparable || !downwardCurvature || !residualMet) return undefined;

  return {
    body: normalizedBody,
    atr,
    support: horizontalBoundary('lower', supportPrice, normalizedBody, [normalizedBody[0]!.sourceIndex, normalizedBody.at(-1)!.sourceIndex]),
    invalidation: horizontalBoundary('upper', peak.bar.close, normalizedBody, [peak.sourceIndex]),
    peak,
    evaluations,
  };
}

function roundingTopSegments(
  geometry: RoundingTopGeometry,
  status: StructureStatus,
): readonly StructureOverlaySegment[] {
  const base: StructureOverlaySegment[] = [
    {
      id: 'rounding-top-confirmation',
      kind: 'confirmation',
      label: '圓弧頂支撐確認區',
      startBarIndex: geometry.support.startBarIndex,
      startPrice: geometry.support.startPrice,
      endBarIndex: geometry.support.endBarIndex,
      endPrice: geometry.support.endPrice,
      lineStyle: 'dashed',
    },
    {
      id: 'rounding-top-invalidation',
      kind: 'invalidation',
      label: '圓弧頂失效區',
      startBarIndex: geometry.invalidation.startBarIndex,
      startPrice: geometry.invalidation.startPrice,
      endBarIndex: geometry.invalidation.endBarIndex,
      endPrice: geometry.invalidation.endPrice,
      lineStyle: 'dashed',
    },
  ];
  if (status === 'forming') return base;
  const first = geometry.body[0]!;
  const last = geometry.body.at(-1)!;
  return [
    ...base,
    {
      id: 'rounding-top-outline-left',
      kind: 'outline',
      label: '圓弧頂左側輪廓',
      startBarIndex: first.sourceIndex,
      startPrice: first.bar.close,
      endBarIndex: geometry.peak.sourceIndex,
      endPrice: geometry.peak.bar.close,
      lineStyle: 'solid',
    },
    {
      id: 'rounding-top-outline-right',
      kind: 'outline',
      label: '圓弧頂右側輪廓',
      startBarIndex: geometry.peak.sourceIndex,
      startPrice: geometry.peak.bar.close,
      endBarIndex: last.sourceIndex,
      endPrice: last.bar.close,
      lineStyle: 'solid',
    },
  ];
}

function roundingTopDraft(
  bars: readonly IndexedStructureBar[],
  config: ContinuationStructureConfig,
): ContinuationStructureDraft {
  const empty: ContinuationStructureDraft = {
    structureId: 'rounding-top',
    status: 'insufficient-evidence',
    direction: 'undetermined',
    anchors: [],
    boundaries: [],
    evaluations: [rule('rounding-top-minimum-bars', `至少 ${config.roundingTop.bodyBars} 根完成 K 棒`, 'required', 'not-met', `目前只有 ${bars.length} 根。`)],
    confirmationCondition: '完成 K 棒收盤有效跌破事前建立的支撐區後，才確認圓弧頂。',
    invalidationCondition: '價格重新站回圓弧高點失效區時，圓弧頂論點失效。',
    segments: [],
  };
  if (bars.length < config.roundingTop.bodyBars) return empty;

  const terminalDrafts: ContinuationStructureDraft[] = [];
  const formingDrafts: ContinuationStructureDraft[] = [];
  const firstStart = Math.max(0, bars.length - config.lifecycleLookbackBars);
  for (let start = firstStart; start <= bars.length - config.roundingTop.bodyBars; start += 1) {
    const geometry = roundingTopGeometry(
      bars.slice(start, start + config.roundingTop.bodyBars),
      config,
    );
    if (!geometry) continue;
    const buffer = geometry.atr * config.breakoutBufferAtr;
    let status: StructureStatus = 'forming';
    for (const entry of bars.slice(start + config.roundingTop.bodyBars)) {
      if (entry.bar.close > geometry.invalidation.endPrice + buffer) {
        status = 'invalid';
        break;
      }
      if (entry.bar.close < geometry.support.endPrice - buffer) status = 'confirmed';
    }
    const confirmed = status === 'confirmed';
    const draft: ContinuationStructureDraft = {
      structureId: 'rounding-top',
      status,
      direction: confirmed ? 'down' : 'undetermined',
      window: windowOf(bars.slice(start)),
      anchors: [
        pivot(geometry.body[0]!, 'low', geometry.body[0]!.bar.close, 0),
        pivot(geometry.peak, 'high', geometry.peak.bar.close, (geometry.peak.bar.close - geometry.support.endPrice) / geometry.atr),
        pivot(geometry.body.at(-1)!, 'low', geometry.body.at(-1)!.bar.close, 0),
      ],
      boundaries: [geometry.invalidation, geometry.support],
      evaluations: [
        ...geometry.evaluations,
        rule('rounding-top-support-break', '完成 K 棒收盤跌破支撐區', 'supporting', confirmed ? 'met' : 'not-met', confirmed ? '後續完成 K 棒已收盤跌破支撐區。' : '尚在等待完成 K 棒收盤跌破支撐區。'),
      ],
      confirmationCondition: '完成 K 棒收盤有效跌破事前建立的支撐區後，才確認圓弧頂。',
      invalidationCondition: '價格重新站回圓弧高點失效區時，圓弧頂論點失效。',
      segments: roundingTopSegments(geometry, status),
      ...(confirmed ? { scenarios: scenarios('down') } : {}),
    };
    (status === 'forming' ? formingDrafts : terminalDrafts).push(draft);
  }
  return terminalDrafts.at(-1) ?? formingDrafts.at(-1) ?? empty;
}

/** 對指定 cutoff 已完成資料評估旗形、假突破與圓弧頂；沒有時間或網路副作用。 */
export function evaluateContinuationStructures(
  input: ContinuationStructureInput,
): readonly ContinuationStructureDraft[] {
  const config = input.config ?? CONTINUATION_STRUCTURE_CONFIG;
  return [
    flagDraft(input.bars, config),
    falseBreakoutDraft(input.bars, config),
    roundingTopDraft(input.bars, config),
  ];
}
