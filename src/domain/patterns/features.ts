import type { CorporateAction, OhlcvBar } from '../market-data/types';

export type PriorStructure = 'rising' | 'falling' | 'range-or-transition' | 'unavailable';

/** 單根 K 線的可觀察幾何資料。 */
export interface CandleFeatures {
  bodyLow: number | null;
  bodyHigh: number | null;
  bodySize: number | null;
  effectiveBodySize: number | null;
  range: number | null;
  upperWick: number | null;
  lowerWick: number | null;
  closeLocation: number | null;
  comparisonUnit: number | null;
  unavailableReasonCodes: readonly string[];
}

/** 目標 K 線前的固定比較窗，讓規則說明可追溯。 */
export interface ComparisonWindow {
  bodySizes: readonly number[];
  bodyLowerQuartile: number | null;
  bodyUpperQuartile: number | null;
  volumeMedian: number | null;
}

/** 只使用分析截止日及以前 K 線的正規化特徵。 */
export interface CandlestickFeatures {
  bars: readonly OhlcvBar[];
  candles: readonly CandleFeatures[];
  targetIndex: number;
  analysisStartIndex: number;
  comparisonWindow: ComparisonWindow;
  relativeBodyPercentile: number | null;
  relativeVolumeToMedian20: number | null;
  priorAtr14: number | null;
  priorStructure: PriorStructure;
  prior20High: number | null;
  prior20Low: number | null;
  distanceToPrior20HighInAtr: number | null;
  distanceToPrior20LowInAtr: number | null;
  intersectingCorporateActions: readonly CorporateAction[];
  unavailableReasonCodes: readonly string[];
}

const BODY_WINDOW_SIZE = 20;
const ATR_WINDOW_SIZE = 14;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCompleted(bar: OhlcvBar): boolean {
  return bar.completed !== false;
}

export function quantile(values: readonly number[], percentile: number): number | null {
  if (values.length === 0 || !Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    return null;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

function barIsValid(bar: OhlcvBar): boolean {
  return (
    isFiniteNumber(bar.open)
    && isFiniteNumber(bar.high)
    && isFiniteNumber(bar.low)
    && isFiniteNumber(bar.close)
    && isFiniteNumber(bar.volumeShares)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && bar.volumeShares >= 0
  );
}

/** 將單根原始 OHLCV 轉成不會猜測精度的幾何特徵。 */
export function candleFeature(bar: OhlcvBar): CandleFeatures {
  const unavailableReasonCodes: string[] = [];

  if (!barIsValid(bar)) {
    unavailableReasonCodes.push('invalid-ohlcv');
  }

  if (!isCompleted(bar)) {
    unavailableReasonCodes.push('incomplete-bar');
  }

  const sourcePrecision = isFiniteNumber(bar.sourcePrecision) && bar.sourcePrecision > 0
    ? bar.sourcePrecision
    : null;
  const declaredComparisonUnit = isFiniteNumber(bar.comparisonUnit) && bar.comparisonUnit > 0
    ? bar.comparisonUnit
    : null;
  const comparisonUnit = sourcePrecision !== null && declaredComparisonUnit !== null
    ? Math.max(sourcePrecision, declaredComparisonUnit)
    : null;

  if (comparisonUnit === null) {
    unavailableReasonCodes.push('comparison-unit-unavailable');
  }

  if (!barIsValid(bar)) {
    return {
      bodyLow: null,
      bodyHigh: null,
      bodySize: null,
      effectiveBodySize: null,
      range: null,
      upperWick: null,
      lowerWick: null,
      closeLocation: null,
      comparisonUnit,
      unavailableReasonCodes,
    };
  }

  const bodyLow = Math.min(bar.open, bar.close);
  const bodyHigh = Math.max(bar.open, bar.close);
  const bodySize = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;
  const upperWick = bar.high - bodyHigh;
  const lowerWick = bodyLow - bar.low;
  const closeLocation = range > 0 ? (bar.close - bar.low) / range : null;

  if (range === 0) {
    unavailableReasonCodes.push('range-unavailable');
  }

  return {
    bodyLow,
    bodyHigh,
    bodySize,
    effectiveBodySize: comparisonUnit === null ? null : Math.max(bodySize, comparisonUnit),
    range,
    upperWick,
    lowerWick,
    closeLocation,
    comparisonUnit,
    unavailableReasonCodes,
  };
}

function trueRange(current: OhlcvBar, previous: OhlcvBar): number | null {
  if (!barIsValid(current) || !barIsValid(previous) || !isCompleted(current) || !isCompleted(previous)) {
    return null;
  }

  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previous.close),
    Math.abs(current.low - previous.close),
  );
}

function confirmedStructure(bars: readonly OhlcvBar[], endExclusive: number): PriorStructure {
  const highs: number[] = [];
  const lows: number[] = [];

  for (let index = 1; index < endExclusive - 1; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    const next = bars[index + 1];

    if (!previous || !current || !next || !isCompleted(previous) || !isCompleted(current) || !isCompleted(next) || !barIsValid(previous) || !barIsValid(current) || !barIsValid(next)) {
      continue;
    }

    if (current.high > previous.high && current.high > next.high) {
      highs.push(current.high);
    }

    if (current.low < previous.low && current.low < next.low) {
      lows.push(current.low);
    }
  }

  const previousHigh = highs.at(-2);
  const currentHigh = highs.at(-1);
  const previousLow = lows.at(-2);
  const currentLow = lows.at(-1);

  if (
    previousHigh === undefined
    || currentHigh === undefined
    || previousLow === undefined
    || currentLow === undefined
  ) {
    return 'unavailable';
  }

  if (currentHigh > previousHigh && currentLow > previousLow) {
    return 'rising';
  }

  if (currentHigh < previousHigh && currentLow < previousLow) {
    return 'falling';
  }

  return 'range-or-transition';
}

function buildFeatures(
  bars: readonly OhlcvBar[],
  actions: readonly CorporateAction[],
  analysisStartIndex: number,
): CandlestickFeatures {
  const candles = bars.map(candleFeature);
  const targetIndex = bars.length - 1;
  const target = bars[targetIndex];
  const targetFeature = candles[targetIndex];
  const unavailableReasonCodes = new Set<string>();

  if (!target || !targetFeature) {
    unavailableReasonCodes.add('missing-target-bar');
  }

  const history = bars.slice(Math.max(0, analysisStartIndex - BODY_WINDOW_SIZE), analysisStartIndex);
  const historyFeatures = candles.slice(Math.max(0, analysisStartIndex - BODY_WINDOW_SIZE), analysisStartIndex);
  const completeHistory = history.length === BODY_WINDOW_SIZE && history.every((bar) => isCompleted(bar) && barIsValid(bar));
  const bodySizes = completeHistory
    ? historyFeatures
      .map((feature) => feature.bodySize)
      .filter((bodySize): bodySize is number => bodySize !== null && bodySize > 0)
    : [];
  const hasBodyWindow = bodySizes.length === BODY_WINDOW_SIZE;
  const volumeValues = completeHistory
    ? history.map((bar) => bar.volumeShares).filter((volume) => isFiniteNumber(volume) && volume >= 0)
    : [];
  const hasVolumeWindow = volumeValues.length === BODY_WINDOW_SIZE;
  const bodyLowerQuartile = hasBodyWindow ? quantile(bodySizes, 0.25) : null;
  const bodyUpperQuartile = hasBodyWindow ? quantile(bodySizes, 0.75) : null;
  const volumeMedian = hasVolumeWindow ? median(volumeValues) : null;

  if (!hasBodyWindow) {
    unavailableReasonCodes.add('prior-body-window-unavailable');
  }
  if (!hasVolumeWindow || volumeMedian === null || volumeMedian === 0) {
    unavailableReasonCodes.add('prior-volume-window-unavailable');
  }

  const analysisStart = bars[analysisStartIndex];
  const analysisEnd = target;
  const intersectingCorporateActions = analysisStart && analysisEnd
    ? actions.filter((action) => action.date >= analysisStart.date && action.date <= analysisEnd.date)
    : [];

  const atrStartIndex = analysisStartIndex - ATR_WINDOW_SIZE;
  const trueRanges: number[] = [];
  if (atrStartIndex >= 1) {
    for (let index = atrStartIndex; index < analysisStartIndex; index += 1) {
      const current = bars[index];
      const previous = bars[index - 1];
      if (!current || !previous) {
        continue;
      }
      const range = trueRange(current, previous);
      if (range !== null) {
        trueRanges.push(range);
      }
    }
  }
  const priorAtr14 = trueRanges.length === ATR_WINDOW_SIZE
    ? trueRanges.reduce((total, range) => total + range, 0) / ATR_WINDOW_SIZE
    : null;
  if (priorAtr14 === null || priorAtr14 === 0) {
    unavailableReasonCodes.add('prior-atr-unavailable');
  }

  const prior20High = completeHistory ? Math.max(...history.map((bar) => bar.high)) : null;
  const prior20Low = completeHistory ? Math.min(...history.map((bar) => bar.low)) : null;
  const targetClose = targetFeature?.bodyHigh !== null && targetFeature?.bodyHigh !== undefined && target
    ? target.close
    : null;
  const distanceToPrior20HighInAtr = targetClose !== null && prior20High !== null && priorAtr14 !== null && priorAtr14 > 0
    ? (prior20High - targetClose) / priorAtr14
    : null;
  const distanceToPrior20LowInAtr = targetClose !== null && prior20Low !== null && priorAtr14 !== null && priorAtr14 > 0
    ? (targetClose - prior20Low) / priorAtr14
    : null;

  const targetBodySize = targetFeature?.bodySize ?? null;
  const relativeBodyPercentile = targetBodySize !== null && hasBodyWindow
    ? bodySizes.filter((bodySize) => bodySize <= targetBodySize).length / BODY_WINDOW_SIZE
    : null;
  const relativeVolumeToMedian20 = target && volumeMedian !== null && volumeMedian > 0
    ? target.volumeShares / volumeMedian
    : null;

  return {
    bars,
    candles,
    targetIndex,
    analysisStartIndex,
    comparisonWindow: {
      bodySizes,
      bodyLowerQuartile,
      bodyUpperQuartile,
      volumeMedian,
    },
    relativeBodyPercentile,
    relativeVolumeToMedian20,
    priorAtr14,
    priorStructure: confirmedStructure(bars, analysisStartIndex),
    prior20High,
    prior20Low,
    distanceToPrior20HighInAtr,
    distanceToPrior20LowInAtr,
    intersectingCorporateActions,
    unavailableReasonCodes: [...unavailableReasonCodes, ...(targetFeature?.unavailableReasonCodes ?? [])],
  };
}

/** 以最後一根完成日 K 為分析截止日擷取特徵。 */
export function extractCandlestickFeatures(
  bars: readonly OhlcvBar[],
  actions: readonly CorporateAction[],
): CandlestickFeatures {
  return buildFeatures(bars, actions, bars.length - 1);
}

/** 以指定候選使用區間重新計算背景，確保不讀取型態左端以後的資料。 */
export function withAnalysisWindow(
  features: CandlestickFeatures,
  minimumBars: number,
  actions: readonly CorporateAction[],
): CandlestickFeatures {
  const analysisStartIndex = features.targetIndex - minimumBars + 1;
  return buildFeatures(features.bars, actions, analysisStartIndex);
}
