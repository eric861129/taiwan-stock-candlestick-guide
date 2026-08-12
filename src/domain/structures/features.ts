import type { OhlcvBar } from '../market-data/types';
import type {
  IndexedStructureBar,
  StructureAtrFeatures,
  StructureEngineConfig,
  StructureFeatures,
  StructurePivot,
} from './types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 驗證可用於結構幾何的完成 K 棒，不以猜測補足任一價格欄位。 */
export function isValidStructureBar(bar: OhlcvBar): boolean {
  return (
    isFiniteNumber(bar.open)
    && isFiniteNumber(bar.high)
    && isFiniteNumber(bar.low)
    && isFiniteNumber(bar.close)
    && isFiniteNumber(bar.volumeShares)
    && isFiniteNumber(bar.sourcePrecision)
    && isFiniteNumber(bar.comparisonUnit)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && bar.volumeShares >= 0
    && bar.sourcePrecision > 0
    && bar.comparisonUnit > 0
  );
}

function trueRange(current: OhlcvBar, previous: OhlcvBar): number {
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previous.close),
    Math.abs(current.low - previous.close),
  );
}

/**
 * ATR 只使用該列及以前的已完成 K 棒；早期資料採可用前綴平均，避免讀取 cutoff 後資料。
 */
export function extractAtr(
  indexedBars: readonly IndexedStructureBar[],
  period: number,
): StructureAtrFeatures {
  const ranges: Array<number | null> = indexedBars.map((_entry, index) => {
    if (index === 0) return null;
    const current = indexedBars[index]?.bar;
    const previous = indexedBars[index - 1]?.bar;
    return current && previous ? trueRange(current, previous) : null;
  });

  const values = ranges.map((_range, index) => {
    const rangeStart = Math.max(1, index - period + 1);
    const observed = ranges.slice(rangeStart, index + 1).filter((value): value is number => value !== null);
    if (observed.length === 0) return null;
    return observed.reduce((sum, value) => sum + value, 0) / observed.length;
  });

  return {
    version: 'atr-v1',
    period,
    latest: values.at(-1) ?? null,
    values,
  };
}

/** 固定落後窗平滑收盤價；每一點只讀取當下及以前資料，幾何驗證仍回到原始 high、low、close。 */
export function smoothClose(indexedBars: readonly IndexedStructureBar[], width: number): readonly (number | null)[] {
  return indexedBars.map((_entry, index) => {
    const start = Math.max(0, index - width);
    const closes = indexedBars.slice(start, index + 1).map((item) => item.bar.close);
    return closes.length > 0 ? closes.reduce((sum, value) => sum + value, 0) / closes.length : null;
  });
}

function localProminence(
  bars: readonly IndexedStructureBar[],
  index: number,
  kind: StructurePivot['kind'],
  width: number,
): number | null {
  const current = bars[index]?.bar;
  if (!current) return null;
  const neighborhood = bars.slice(index - width, index + width + 1);
  if (neighborhood.length < width * 2 + 1) return null;
  if (kind === 'high') {
    const adjacentLow = Math.min(...neighborhood.map((entry) => entry.bar.low));
    return current.high - adjacentLow;
  }
  const adjacentHigh = Math.max(...neighborhood.map((entry) => entry.bar.high));
  return adjacentHigh - current.low;
}

function isStrictPivot(
  bars: readonly IndexedStructureBar[],
  index: number,
  kind: StructurePivot['kind'],
  width: number,
): boolean {
  const current = bars[index]?.bar;
  if (!current || index < width || index + width >= bars.length) return false;
  const currentPrice = kind === 'high' ? current.high : current.low;
  for (let offset = -width; offset <= width; offset += 1) {
    if (offset === 0) continue;
    const other = bars[index + offset]?.bar;
    if (!other) return false;
    const otherPrice = kind === 'high' ? other.high : other.low;
    if (kind === 'high' ? otherPrice >= currentPrice : otherPrice <= currentPrice) {
      return false;
    }
  }
  return true;
}

/**
 * 以固定寬度、最小間隔與 ATR 顯著度建立轉折點。相同價格平臺不強制挑選其中一根，避免任意偏移。
 */
export function extractPivots(
  indexedBars: readonly IndexedStructureBar[],
  atr: StructureAtrFeatures,
  config: StructureEngineConfig['pivot'],
): readonly StructurePivot[] {
  const pivots: StructurePivot[] = [];

  (['high', 'low'] as const).forEach((kind) => {
    let lastAcceptedLocalIndex = Number.NEGATIVE_INFINITY;
    for (let index = config.width; index + config.width < indexedBars.length; index += 1) {
      if (index - lastAcceptedLocalIndex < config.minimumSeparationBars) continue;
      if (!isStrictPivot(indexedBars, index, kind, config.width)) continue;
      const significanceBase = atr.values[index] ?? atr.latest;
      const prominence = localProminence(indexedBars, index, kind, config.width);
      if (significanceBase === null || significanceBase <= 0 || prominence === null) continue;
      const prominenceAtr = prominence / significanceBase;
      if (prominenceAtr < config.minimumProminenceAtr) continue;
      const item = indexedBars[index];
      if (!item) continue;
      pivots.push({
        version: 'structure-pivot-v1',
        barIndex: item.sourceIndex,
        date: item.bar.date,
        price: kind === 'high' ? item.bar.high : item.bar.low,
        kind,
        prominenceAtr,
      });
      lastAcceptedLocalIndex = index;
    }
  });

  return pivots.sort((left, right) => left.barIndex - right.barIndex || left.kind.localeCompare(right.kind));
}

/** 從已通過資料守門的 K 棒擷取版本化結構特徵。 */
export function extractStructureFeatures(
  indexedBars: readonly IndexedStructureBar[],
  sourceBarCount: number,
  config: StructureEngineConfig,
  warnings: readonly string[] = [],
): StructureFeatures {
  const atr = extractAtr(indexedBars, config.atr.period);
  return {
    configVersion: config.version,
    sourceBarCount,
    analyzedBarCount: indexedBars.length,
    smoothedClose: smoothClose(indexedBars, config.pivot.width),
    atr,
    pivots: extractPivots(indexedBars, atr, config.pivot),
    warnings,
  };
}
