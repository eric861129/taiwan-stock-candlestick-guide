import { describe, expect, it } from 'vitest';
import { PATTERN_CARDS } from '../catalog';
import { extractCandlestickFeatures, withAnalysisWindow } from '../features';
import { MVP_CASES } from '../test-cases';
import { evaluateMultiCandleBinding } from './multi-candle';

describe('multi-candle rule parameters', () => {
  it('uses maximumOpenGapUnits from the configured binding', () => {
    const snapshot = MVP_CASES.find((item) => item.caseId === 'three-advancing-candles-positive-1')?.snapshot;
    if (!snapshot) {
      throw new Error('找不到三根上行 K 線測試資料');
    }
    const bars = [...snapshot.bars];
    const second = bars.at(-2);
    const third = bars.at(-1);
    if (!second || !third) {
      throw new Error('三根 K 線測試資料不足');
    }

    bars[bars.length - 1] = {
      ...third,
      open: Math.max(second.open, second.close) + 0.05,
    };
    const matcher = PATTERN_CARDS.find((card) => card.id === 'three-advancing-candles')?.matcher;
    const rule = matcher?.rules.find((item) => item.ruleId === 'three-bullish-directional-sequence');
    if (!rule) {
      throw new Error('找不到三根上行 K 線規則');
    }

    const features = withAnalysisWindow(extractCandlestickFeatures(bars, []), 3, []);
    const strictRule = {
      ...rule,
      parameters: { ...rule.parameters, maximumOpenGapUnits: 0 },
    };

    expect(evaluateMultiCandleBinding(features, strictRule).state).toBe('not-met');
  });

  it('marks gap-sensitive midpoint geometry unavailable when a company action intersects it', () => {
    const snapshot = MVP_CASES.find((item) => item.caseId === 'piercing-line-positive-1')?.snapshot;
    if (!snapshot) {
      throw new Error('找不到穿刺線測試資料');
    }

    const actionDate = snapshot.bars.at(-1)?.date;
    const actions = [{
      date: actionDate ?? '2026-08-02',
      type: 'split' as const,
      affectsPriceContinuity: true,
      sourceUrl: 'https://example.test/actions',
      verifiedAt: '2026-08-10T12:00:00+08:00',
    }];
    const rule = PATTERN_CARDS
      .find((card) => card.id === 'piercing-line')
      ?.matcher
      ?.rules.find((item) => item.ruleId === 'bullish-midpoint-penetration');
    if (!rule) {
      throw new Error('找不到穿刺線中點規則');
    }

    const features = withAnalysisWindow(extractCandlestickFeatures(snapshot.bars, actions), 2, actions);

    expect(evaluateMultiCandleBinding(features, rule)).toMatchObject({
      state: 'unavailable',
      reasonCode: 'price-continuity-action-intersects-window',
    });
  });
});
