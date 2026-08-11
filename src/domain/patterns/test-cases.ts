import type { CorporateAction, OhlcvBar, StockSnapshot } from '../market-data/types';
import type { PatternCardId } from './types';

export type PatternCaseKind = 'positive' | 'boundary' | 'negative';

export interface PatternMatcherCase {
  cardId: PatternCardId;
  caseId: string;
  kind: PatternCaseKind;
  holdout: boolean;
  snapshot: StockSnapshot;
  expected: boolean;
}

const SOURCE_URL = 'https://example.test/official-market-source';

function date(day: number): string {
  return `2026-07-${String(day).padStart(2, '0')}`;
}

function patternDate(day: number): string {
  return `2026-08-${String(day).padStart(2, '0')}`;
}

function candle(
  day: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volumeShares = 1_000,
): OhlcvBar {
  return {
    date: day,
    open,
    high,
    low,
    close,
    volumeShares,
    sourcePrecision: 0.01,
    comparisonUnit: 0.1,
  };
}

function history(
  direction: 'rising' | 'falling',
  count = 25,
  partition: 'development' | 'holdout' = 'development',
): OhlcvBar[] {
  const isHoldout = partition === 'holdout';
  const basePrice = direction === 'rising'
    ? (isHoldout ? 400 : 100)
    : (isHoldout ? 650 : 200);
  const slope = isHoldout ? 1.1 : 0.7;
  const swing = isHoldout ? 1.1 : 0.7;
  const bodySize = isHoldout ? 0.8 : 0.6;
  const wickSize = isHoldout ? 1.6 : 1.2;

  return Array.from({ length: count }, (_, index) => {
    const oscillation = index % 2 === 0 ? swing : -swing;
    const midpoint = direction === 'rising'
      ? basePrice + index * slope + oscillation
      : basePrice - index * slope - oscillation;
    const open = midpoint - bodySize / 2;
    const close = midpoint + bodySize / 2;

    return candle(date(index + 1), open, midpoint + wickSize, midpoint - wickSize, close, (isHoldout ? 2_000 : 1_000) + index * (isHoldout ? 3 : 1));
  });
}

function snapshot(
  bars: readonly OhlcvBar[],
  actions: readonly CorporateAction[] = [],
): StockSnapshot {
  return {
    schemaVersion: 1,
    snapshotHash: 'fixture-hash',
    code: '2330',
    name: '測試普通股',
    market: 'TWSE',
    securityType: 'common-stock',
    priceMode: 'raw',
    currency: 'TWD',
    comparisonUnitPolicy: {
      version: 1,
      effectiveFrom: '2026-01-01',
      sourceUrl: SOURCE_URL,
    },
    bars,
    corporateActions: actions,
    sourceUrls: [SOURCE_URL],
    cutoffDate: bars.at(-1)?.date,
    freshness: 'fresh',
  };
}

function anchor(bars: readonly OhlcvBar[]): number {
  const close = bars.at(-1)?.close;
  if (close === undefined) {
    throw new Error('測試歷史資料不可為空');
  }

  return close;
}

function singlePattern(
  cardId: PatternCardId,
  kind: PatternCaseKind,
  variant: number,
): OhlcvBar[] {
  const direction = cardId === 'shooting-star' ? 'rising' : 'falling';
  const isHoldout = variant >= 3;
  const base = history(direction, 25, isHoldout ? 'holdout' : 'development');
  const value = anchor(base) + variant * 0.01;
  const matching = kind === 'positive';

  switch (cardId) {
    case 'relative-long-body': {
      const body = matching ? 4 + variant * 0.1 : kind === 'boundary' ? (isHoldout ? 0.79 : 0.59) : 0.2;
      return [...base, candle(patternDate(1), value - body / 2, value + body, value - body / 2, value + body / 2, 2_000)];
    }
    case 'relative-small-body': {
      const body = matching ? 0.3 : kind === 'boundary' ? (isHoldout ? 0.81 : 0.61) : 3;
      return [...base, candle(patternDate(1), value - body, value + 0.2, value - body - 0.2, value, 900)];
    }
    case 'doji': {
      const body = matching ? 0.1 : kind === 'boundary' ? 0.11 : 3;
      return [...base, candle(patternDate(1), value, value + 1, value - 1, value + body, 1_100)];
    }
    case 'hammer': {
      if (!matching && kind === 'negative') {
        return [...base, candle(patternDate(1), value - 0.3, value + 0.1, value - 0.5, value + 0.3, 1_100)];
      }
      const upperWick = matching ? 0.1 : 0.11;
      return [...base, candle(patternDate(1), value + 1.5, value + 2.1 + upperWick, value - 9.8, value + 2.1, 1_100)];
    }
    case 'shooting-star': {
      if (!matching && kind === 'negative') {
        return [...base, candle(patternDate(1), value - 0.3, value + 0.5, value - 0.1, value + 0.3, 1_100)];
      }
      const lowerWick = matching ? 0.1 : 0.11;
      return [...base, candle(patternDate(1), value - 2.1, value + 9.8, value - 2.1 - lowerWick, value - 1.7, 1_100)];
    }
    case 'near-marubozu': {
      const wick = matching ? 0.1 : kind === 'boundary' ? 0.11 : 1;
      return [...base, candle(patternDate(1), value - 2, value + 2 + wick, value - 2 - wick, value + 2, 1_100)];
    }
    case 'close-rejection-indecision': {
      if (matching) {
        return [...base, candle(patternDate(1), value - 1, value + 5, value - 5, value + 1, 1_100)];
      }
      const upperWick = kind === 'boundary' ? 7.9 : 3;
      return [...base, candle(patternDate(1), value - 2, value + 2 + upperWick, value - 2, value + 2, 1_100)];
    }
    default:
      throw new Error(`非單根卡片：${cardId}`);
  }
}

function multiPattern(
  cardId: PatternCardId,
  kind: PatternCaseKind,
  variant: number,
): OhlcvBar[] {
  const rising = ['bearish-engulfing', 'bearish-harami', 'dark-cloud-cover', 'evening-star', 'three-falling-candles'].includes(cardId);
  const direction = rising ? 'rising' : 'falling';
  const base = history(direction, 25, variant >= 3 ? 'holdout' : 'development');
  const value = anchor(base) + variant * 0.01;
  const matching = kind === 'positive';

  switch (cardId) {
    case 'bullish-engulfing':
      return matching
        ? [...base, candle(patternDate(1), value + 2, value + 3, value - 2, value - 1), candle(patternDate(2), value - 2, value + 10, value - 11, value + 3)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value + 2, value + 3, value - 2, value - 1), candle(patternDate(2), value - 2, value + 4, value - 4, value + 1.99)]
          : [...base, candle(patternDate(1), value - 2, value + 3, value - 3, value + 1), candle(patternDate(2), value - 1, value + 3, value - 3, value + 2)];
    case 'bearish-engulfing':
      return matching
        ? [...base, candle(patternDate(1), value - 2, value + 2, value - 3, value + 1), candle(patternDate(2), value + 2, value + 11, value - 10, value - 3)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value - 2, value + 2, value - 3, value + 1), candle(patternDate(2), value + 4, value + 4, value - 4, value - 1.99)]
          : [...base, candle(patternDate(1), value + 2, value + 3, value - 3, value - 1), candle(patternDate(2), value + 1, value + 3, value - 3, value - 2)];
    case 'bullish-harami':
      return matching
        ? [...base, candle(patternDate(1), value + 5, value + 6, value - 6, value - 5), candle(patternDate(2), value - 2, value + 6, value - 7, value + 1)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value + 5, value + 6, value - 6, value - 5), candle(patternDate(2), value - 2, value + 6, value - 7, value + 5.01)]
          : [...base, candle(patternDate(1), value + 0.29, value + 1, value - 1, value - 0.29), candle(patternDate(2), value - 0.2, value + 1, value - 1, value + 0.2)];
    case 'bearish-harami':
      return matching
        ? [...base, candle(patternDate(1), value - 5, value + 6, value - 6, value + 5), candle(patternDate(2), value + 2, value + 7, value - 6, value - 1)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value - 5, value + 6, value - 6, value + 5), candle(patternDate(2), value + 7, value + 8, value - 6, value - 1)]
          : [...base, candle(patternDate(1), value - 0.29, value + 1, value - 1, value + 0.29), candle(patternDate(2), value + 0.2, value + 1, value - 1, value - 0.2)];
    case 'piercing-line':
      return matching
        ? [...base, candle(patternDate(1), value + 4, value + 5, value - 5, value - 4), candle(patternDate(2), value - 6, value + 7, value - 7, value + 1)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value + 4, value + 5, value - 5, value - 4), candle(patternDate(2), value - 6, value + 1, value - 7, value)]
          : [...base, candle(patternDate(1), value + 4, value + 5, value - 5, value - 4), candle(patternDate(2), value - 2, value + 2, value - 3, value + 1)];
    case 'dark-cloud-cover':
      return matching
        ? [...base, candle(patternDate(1), value - 4, value + 5, value - 5, value + 4), candle(patternDate(2), value + 6, value + 7, value - 7, value - 1)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value - 4, value + 5, value - 5, value + 4), candle(patternDate(2), value + 6, value + 7, value - 1, value)]
          : [...base, candle(patternDate(1), value - 4, value + 5, value - 5, value + 4), candle(patternDate(2), value + 2, value + 3, value - 2, value - 1)];
    case 'morning-star':
      return matching
        ? [...base, candle(patternDate(1), value + 5, value + 6, value - 6, value - 5), candle(patternDate(2), value - 6, value - 4.9, value - 7, value - 5.9), candle(patternDate(3), value - 4, value + 4, value - 6, value + 2)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value + 5, value + 6, value - 6, value - 5), candle(patternDate(2), value - 6, value - 4.9, value - 7, value - 5.9), candle(patternDate(3), value - 4, value + 4, value - 6, value)]
          : [...base, candle(patternDate(1), value + 0.3, value + 1, value - 1, value - 0.3), candle(patternDate(2), value - 0.1, value + 1, value - 1, value + 0.1), candle(patternDate(3), value - 1, value + 1, value - 2, value - 0.5)];
    case 'evening-star':
      return matching
        ? [...base, candle(patternDate(1), value - 5, value + 6, value - 6, value + 5), candle(patternDate(2), value + 6, value + 7, value + 4.9, value + 5.9), candle(patternDate(3), value + 4, value + 6, value - 4, value - 2)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value - 5, value + 6, value - 6, value + 5), candle(patternDate(2), value + 6, value + 7, value + 4.9, value + 5.9), candle(patternDate(3), value + 6, value + 6, value - 4, value)]
          : [...base, candle(patternDate(1), value - 0.3, value + 1, value - 1, value + 0.3), candle(patternDate(2), value - 0.1, value + 1, value - 1, value + 0.1), candle(patternDate(3), value + 1, value + 2, value - 1, value + 0.5)];
    case 'three-advancing-candles':
      return matching
        ? [...base, candle(patternDate(1), value, value + 1.5, value - 0.5, value + 1), candle(patternDate(2), value + 0.7, value + 2.5, value + 0.2, value + 2), candle(patternDate(3), value + 1.7, value + 3.5, value + 1.2, value + 3)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value, value + 1.5, value - 0.5, value + 1), candle(patternDate(2), value + 0.7, value + 2.5, value + 0.2, value + 2), candle(patternDate(3), value + 1.7, value + 3.5, value + 1.2, value + 2)]
          : [...base, candle(patternDate(1), value, value + 1.5, value - 0.5, value + 1), candle(patternDate(2), value + 0.7, value + 2.5, value + 0.2, value + 2), candle(patternDate(3), value + 2, value + 2.5, value + 0.5, value + 1)];
    case 'three-falling-candles':
      return matching
        ? [...base, candle(patternDate(1), value, value + 0.5, value - 1.5, value - 1), candle(patternDate(2), value - 0.7, value - 0.2, value - 2.5, value - 2), candle(patternDate(3), value - 1.7, value - 1.2, value - 3.5, value - 3)]
        : kind === 'boundary'
          ? [...base, candle(patternDate(1), value, value + 0.5, value - 1.5, value - 1), candle(patternDate(2), value - 0.7, value - 0.2, value - 2.5, value - 2), candle(patternDate(3), value - 1.7, value - 1.2, value - 3.5, value - 2)]
          : [...base, candle(patternDate(1), value, value + 0.5, value - 1.5, value - 1), candle(patternDate(2), value - 0.7, value - 0.2, value - 2.5, value - 2), candle(patternDate(3), value - 2, value - 0.5, value - 2.5, value - 1)];
    default:
      throw new Error(`非多根卡片：${cardId}`);
  }
}

const MVP_CARD_IDS = [
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
] as const satisfies readonly PatternCardId[];

const SINGLE_CARD_IDS = new Set<PatternCardId>([
  'relative-long-body',
  'relative-small-body',
  'doji',
  'hammer',
  'shooting-star',
  'near-marubozu',
  'close-rejection-indecision',
]);

function barsFor(cardId: PatternCardId, kind: PatternCaseKind, variant: number): OhlcvBar[] {
  return SINGLE_CARD_IDS.has(cardId)
    ? singlePattern(cardId, kind, variant)
    : multiPattern(cardId, kind, variant);
}

function casesFor(cardId: PatternCardId): PatternMatcherCase[] {
  const kinds: readonly PatternCaseKind[] = ['positive', 'boundary', 'negative'];

  return kinds.flatMap((kind) =>
    Array.from({ length: 5 }, (_, index) => ({
      cardId,
      caseId: `${cardId}-${kind}-${index + 1}`,
      kind,
      holdout: index >= 3,
      snapshot: snapshot(barsFor(cardId, kind, index)),
      expected: kind === 'positive',
    })),
  );
}

/** 17 張 MVP 卡的固定規則案例；matcher 不得匯入本測試資料。 */
export const MVP_CASES: readonly PatternMatcherCase[] = MVP_CARD_IDS.flatMap(casesFor);

export function makeSnapshot(bars: readonly OhlcvBar[], actions: readonly CorporateAction[] = []): StockSnapshot {
  return snapshot(bars, actions);
}
