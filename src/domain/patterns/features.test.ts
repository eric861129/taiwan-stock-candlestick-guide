import { describe, expect, it } from 'vitest';
import { candleFeature, extractCandlestickFeatures } from './features';

function bar(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volumeShares = 1_000,
) {
  return {
    date,
    open,
    high,
    low,
    close,
    volumeShares,
    sourcePrecision: 0.01,
    comparisonUnit: 0.5,
  };
}

describe('candlestick feature normalization', () => {
  it('computes body, wick, close location, and comparison-unit floor', () => {
    const feature = candleFeature({
      date: '2026-08-10',
      open: 100,
      high: 106,
      low: 95,
      close: 102,
      volumeShares: 1_000,
      sourcePrecision: 0.01,
      comparisonUnit: 0.5,
    });

    expect(feature).toMatchObject({
      bodyLow: 100,
      bodyHigh: 102,
      bodySize: 2,
      effectiveBodySize: 2,
      upperWick: 4,
      lowerWick: 5,
      comparisonUnit: 0.5,
    });
    expect(feature.closeLocation).toBeCloseTo(7 / 11);
  });

  it('marks range-dependent geometry and comparison-unit-dependent geometry unavailable instead of guessing', () => {
    const feature = candleFeature({
      date: '2026-08-10',
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volumeShares: 1_000,
      sourcePrecision: 0,
      comparisonUnit: 0,
    });

    expect(feature.closeLocation).toBeNull();
    expect(feature.effectiveBodySize).toBeNull();
    expect(feature.unavailableReasonCodes).toEqual(
      expect.arrayContaining(['range-unavailable', 'comparison-unit-unavailable']),
    );
  });

  it('uses only the twenty completed prior candles for body and volume comparison windows', () => {
    const prior = Array.from({ length: 20 }, (_, index) =>
      bar(`2026-07-${String(index + 1).padStart(2, '0')}`, 100, 102 + index, 99, 101 + index, index + 1),
    );
    const target = bar('2026-08-10', 100, 201, 99, 200, 210);

    const features = extractCandlestickFeatures([...prior, target], []);

    expect(features.comparisonWindow.bodySizes).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(features.comparisonWindow.bodyLowerQuartile).toBe(5.75);
    expect(features.comparisonWindow.bodyUpperQuartile).toBe(15.25);
    expect(features.relativeBodyPercentile).toBe(1);
    expect(features.comparisonWindow.volumeMedian).toBe(10.5);
    expect(features.relativeVolumeToMedian20).toBe(20);
  });

  it('keeps the analysis target out of ATR, zones, and action-independent comparison history', () => {
    const prior = Array.from({ length: 20 }, (_, index) =>
      bar(`2026-07-${String(index + 1).padStart(2, '0')}`, 100, 102, 99, 101, 1_000),
    );
    const target = bar('2026-08-10', 100, 200, 50, 180, 9_999);

    const features = extractCandlestickFeatures([...prior, target], [
      {
        date: '2026-08-10',
        type: 'split',
        affectsPriceContinuity: true,
        sourceUrl: 'https://example.test/actions',
        verifiedAt: '2026-08-10T12:00:00+08:00',
      },
    ]);

    expect(features.priorAtr14).toBe(3);
    expect(features.prior20High).toBe(102);
    expect(features.prior20Low).toBe(99);
    expect(features.intersectingCorporateActions).toHaveLength(1);
    expect(features.intersectingCorporateActions[0]?.date).toBe('2026-08-10');
  });

  it('does not use an incomplete prior bar for ATR or a confirmed structure', () => {
    const prior = Array.from({ length: 20 }, (_, index) => ({
      ...bar(`2026-07-${String(index + 1).padStart(2, '0')}`, 100, 102, 99, 101, 1_000),
      ...(index === 10 ? { completed: false } : {}),
    }));
    const target = bar('2026-08-10', 100, 102, 99, 101, 1_000);

    const features = extractCandlestickFeatures([...prior, target], []);

    expect(features.priorAtr14).toBeNull();
    expect(features.priorStructure).toBe('unavailable');
  });
});
