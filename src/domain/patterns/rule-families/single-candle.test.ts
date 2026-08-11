import { describe, expect, it } from 'vitest';
import { PATTERN_CARDS } from '../catalog';
import { extractCandlestickFeatures } from '../features';
import { evaluateSingleCandleBinding } from './single-candle';

describe('single-candle rule parameters', () => {
  it('treats configured position context as unavailable when no position evidence exists', () => {
    const binding = PATTERN_CARDS
      .find((card) => card.id === 'near-marubozu')
      ?.matcher
      ?.rules.find((rule) => rule.ruleId === 'relative-body-context-recorded');
    if (!binding) {
      throw new Error('找不到相對實體背景規則');
    }

    const features = extractCandlestickFeatures([
      {
        date: '2026-08-10',
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volumeShares: 1_000,
        sourcePrecision: 0.01,
        comparisonUnit: 0.1,
      },
    ], []);

    expect(evaluateSingleCandleBinding(features, binding)).toMatchObject({
      state: 'unavailable',
      reasonCode: 'optional-context-unavailable',
    });
  });
});
