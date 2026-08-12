import { describe, expect, it } from 'vitest';
import type { OhlcvBar } from '../market-data/types';
import { CONTINUATION_STRUCTURE_CONFIG, evaluateContinuationStructures } from './continuation';

function bar(index: number, close: number, spread = 1.2, volumeShares = 1_000_000): OhlcvBar {
  return {
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close - 0.2,
    high: close + spread / 2,
    low: close - spread / 2,
    close,
    volumeShares,
    sourcePrecision: 0.01,
    comparisonUnit: 0.01,
    completed: true,
    evidenceStatus: 'complete',
    missingSessionDates: [],
  };
}

function indexed(closes: readonly number[], spreads?: readonly number[]) {
  return closes.map((close, index) => ({
    sourceIndex: index,
    bar: bar(index, close, spreads?.[index] ?? 1.2),
  }));
}

function bullishFlagBody(): readonly number[] {
  return [100, 102, 104.5, 107, 110, 109.6, 109.2, 109.4, 109, 108.8, 109.1];
}

function roundingTopBody(): readonly number[] {
  return [
    100, 101, 102.2, 103.4, 104.5, 105.4, 106.2,
    106.8, 107.2, 107.5, 107.6, 107.5, 107.3, 106.9,
    106.3, 105.6, 104.8, 104, 103.2, 102.5, 101.8,
  ];
}

describe('evaluateContinuationStructures', () => {
  it('keeps a bullish flag forming until a completed close clears its flag boundary', () => {
    const forming = evaluateContinuationStructures({ bars: indexed(bullishFlagBody()) });
    const flag = forming.find((item) => item.structureId === 'flag-consolidation');

    expect(flag).toMatchObject({
      structureId: 'flag-consolidation',
      status: 'forming',
      direction: 'undetermined',
    });
    expect(flag?.segments.map((segment) => segment.kind).sort()).toEqual(['confirmation', 'invalidation']);
    expect(flag?.scenarios).toBeUndefined();

    const confirmed = evaluateContinuationStructures({
      bars: indexed([...bullishFlagBody(), 110.5]),
    }).find((item) => item.structureId === 'flag-consolidation');

    expect(confirmed).toMatchObject({
      status: 'confirmed',
      direction: 'up',
    });
    expect(confirmed?.scenarios?.map((scenario) => scenario.kind)).toEqual([
      'continuation',
      'retest',
      'invalidation',
    ]);
    expect(JSON.stringify(confirmed?.scenarios)).not.toMatch(/機率|勝率|目標價|%/);
  });

  it('treats an exact flag-boundary close as forming rather than confirmed or discarded', () => {
    const result = evaluateContinuationStructures({
      bars: indexed([...bullishFlagBody(), 110.2]),
    }).find((item) => item.structureId === 'flag-consolidation');

    expect(result).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(result?.scenarios).toBeUndefined();
  });

  it('accepts a noisy flag but rejects a short pause without a directional impulse', () => {
    const noisy = [100, 102.2, 104.3, 107.1, 110, 109.7, 109.1, 109.5, 108.9, 109.2, 108.8];
    const flat = [100, 100.3, 99.9, 100.2, 100.1, 100.4, 100, 100.3, 99.8, 100.2, 100];

    expect(evaluateContinuationStructures({ bars: indexed(noisy) })
      .find((item) => item.structureId === 'flag-consolidation')?.status).toBe('forming');
    expect(evaluateContinuationStructures({ bars: indexed(flat) })
      .find((item) => item.structureId === 'flag-consolidation')?.status).toBe('insufficient-evidence');
  });

  it('does not read a later flag breakout into the earlier prefix', () => {
    const prefix = evaluateContinuationStructures({ bars: indexed(bullishFlagBody()) })
      .find((item) => item.structureId === 'flag-consolidation');
    const full = evaluateContinuationStructures({ bars: indexed([...bullishFlagBody(), 110.5]) })
      .find((item) => item.structureId === 'flag-consolidation');

    expect(prefix?.status).toBe('forming');
    expect(prefix?.scenarios).toBeUndefined();
    expect(full?.status).toBe('confirmed');
  });

  it('handles a bearish flag symmetrically without predicting before confirmation', () => {
    const bearish = [110, 108, 105.5, 103, 100, 100.4, 100.8, 100.6, 101, 101.2, 100.9];
    const forming = evaluateContinuationStructures({ bars: indexed(bearish) })
      .find((item) => item.structureId === 'flag-consolidation');
    const confirmed = evaluateContinuationStructures({ bars: indexed([...bearish, 99.5]) })
      .find((item) => item.structureId === 'flag-consolidation');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(forming?.scenarios).toBeUndefined();
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'down' });
  });

  it('keeps an upper false breakout forming until a later completed close returns to the prior range', () => {
    const range = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7];
    const forming = evaluateContinuationStructures({ bars: indexed([...range, 102]) })
      .find((item) => item.structureId === 'false-breakout');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(forming?.segments.map((segment) => segment.kind).sort()).toEqual(['confirmation', 'invalidation']);
    expect(forming?.scenarios).toBeUndefined();

    const returned = evaluateContinuationStructures({ bars: indexed([...range, 102, 100.5]) })
      .find((item) => item.structureId === 'false-breakout');
    expect(returned).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(returned?.scenarios).toBeUndefined();

    const confirmed = evaluateContinuationStructures({ bars: indexed([...range, 102, 100.5, 100.2]) })
      .find((item) => item.structureId === 'false-breakout');
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'down' });
    expect(confirmed?.scenarios?.map((scenario) => scenario.kind)).toEqual([
      'continuation',
      'retest',
      'invalidation',
    ]);
  });

  it('does not call a wick-only probe or a trending base a false breakout', () => {
    const range = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7];
    const wickOnlyBars = indexed([...range, 100.5]);
    wickOnlyBars[8] = { sourceIndex: 8, bar: bar(8, 100.5, 6) };
    const trendingBase = [96, 97, 98, 99, 100, 101, 102, 103, 105];

    expect(evaluateContinuationStructures({ bars: wickOnlyBars })
      .find((item) => item.structureId === 'false-breakout')?.status).toBe('insufficient-evidence');
    expect(evaluateContinuationStructures({ bars: indexed(trendingBase) })
      .find((item) => item.structureId === 'false-breakout')?.status).toBe('insufficient-evidence');
  });

  it('rejects a narrow monotonic base and keeps a visible invalidation segment for a real range', () => {
    const monotonic = [100, 100.3, 100.6, 100.9, 101.2, 101.5, 101.8, 102.1, 103.5, 101.8, 101.6];
    const rejected = evaluateContinuationStructures({ bars: indexed(monotonic) })
      .find((item) => item.structureId === 'false-breakout');
    const range = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7];
    const forming = evaluateContinuationStructures({ bars: indexed([...range, 102]) })
      .find((item) => item.structureId === 'false-breakout');
    const invalidation = forming?.segments.find((segment) => segment.kind === 'invalidation');

    expect(rejected?.status).toBe('insufficient-evidence');
    expect(invalidation?.startBarIndex).not.toBe(invalidation?.endBarIndex);
    expect(invalidation?.endPrice).toBeCloseTo(101.18, 8);
  });

  it('does not read a later false-breakout return into the earlier prefix', () => {
    const range = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7];
    const prefix = evaluateContinuationStructures({ bars: indexed([...range, 102]) })
      .find((item) => item.structureId === 'false-breakout');
    const returned = evaluateContinuationStructures({ bars: indexed([...range, 102, 100.5]) })
      .find((item) => item.structureId === 'false-breakout');
    const full = evaluateContinuationStructures({ bars: indexed([...range, 102, 100.5, 100.2]) })
      .find((item) => item.structureId === 'false-breakout');

    expect(prefix?.status).toBe('forming');
    expect(prefix?.scenarios).toBeUndefined();
    expect(returned?.status).toBe('forming');
    expect(full?.status).toBe('confirmed');
  });

  it('handles a lower false breakout symmetrically and confirms only after the close returns', () => {
    const range = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7];
    const forming = evaluateContinuationStructures({ bars: indexed([...range, 97.5]) })
      .find((item) => item.structureId === 'false-breakout');
    const confirmed = evaluateContinuationStructures({ bars: indexed([...range, 97.5, 99.6, 100]) })
      .find((item) => item.structureId === 'false-breakout');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'up' });
  });

  it('recognizes a broad rounding top and waits for a completed support break before scenarios exist', () => {
    const forming = evaluateContinuationStructures({ bars: indexed(roundingTopBody()) })
      .find((item) => item.structureId === 'rounding-top');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(forming?.segments.map((segment) => segment.kind).sort()).toEqual(['confirmation', 'invalidation']);
    expect(forming?.scenarios).toBeUndefined();

    const confirmed = evaluateContinuationStructures({ bars: indexed([...roundingTopBody(), 99.5]) })
      .find((item) => item.structureId === 'rounding-top');
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'down' });
    expect(confirmed?.scenarios?.map((scenario) => scenario.kind)).toEqual([
      'continuation',
      'retest',
      'invalidation',
    ]);
  });

  it('accepts bounded rounding-top noise without requiring a perfect parabola', () => {
    const noisy = roundingTopBody().map((close, index) => close + [0, 0.1, -0.1, 0.15, -0.05][index % 5]!);
    const result = evaluateContinuationStructures({ bars: indexed(noisy) })
      .find((item) => item.structureId === 'rounding-top');

    expect(result?.status).toBe('forming');
  });

  it('rejects a single spike as a rounding top', () => {
    const singleSpike = [
      100, 100.1, 99.9, 100, 100.2, 99.8, 100,
      100.1, 99.9, 100, 110, 100, 100.1, 99.9,
      100, 100.2, 99.8, 100, 100.1, 99.9, 100,
    ];
    const result = evaluateContinuationStructures({ bars: indexed(singleSpike) })
      .find((item) => item.structureId === 'rounding-top');

    expect(result?.status).toBe('insufficient-evidence');
  });

  it('keeps an exact rounding-top support touch forming and does not read the next break backward', () => {
    const supportTouch = evaluateContinuationStructures({ bars: indexed([...roundingTopBody(), 101.78]) })
      .find((item) => item.structureId === 'rounding-top');
    const prefix = evaluateContinuationStructures({ bars: indexed(roundingTopBody()) })
      .find((item) => item.structureId === 'rounding-top');
    const full = evaluateContinuationStructures({ bars: indexed([...roundingTopBody(), 99.5]) })
      .find((item) => item.structureId === 'rounding-top');

    expect(supportTouch?.status).toBe('forming');
    expect(prefix?.status).toBe('forming');
    expect(prefix?.scenarios).toBeUndefined();
    expect(full?.status).toBe('confirmed');
  });

  it('never emits conditional scenarios before confirmation or attaches probability and target-price claims', () => {
    const datasets = [
      bullishFlagBody(),
      [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7, 102],
      roundingTopBody(),
    ];

    datasets.flatMap((closes) => evaluateContinuationStructures({ bars: indexed(closes) }))
      .forEach((draft) => {
        if (draft.status !== 'confirmed') expect(draft.scenarios).toBeUndefined();
        expect(JSON.stringify(draft.scenarios ?? [])).not.toMatch(/機率|勝率|目標價|%|probability|target/i);
      });
  });

  it('exports one versioned configuration and allows a caller-supplied return window', () => {
    expect(CONTINUATION_STRUCTURE_CONFIG.version).toBe('continuation-structures-v1');
    const range = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7];
    const delayedReturn = [...range, 102, 101.7, 100.5, 100.2];

    const accepted = evaluateContinuationStructures({ bars: indexed(delayedReturn) })
      .find((item) => item.structureId === 'false-breakout');
    const rejected = evaluateContinuationStructures({
      bars: indexed(delayedReturn),
      config: {
        ...CONTINUATION_STRUCTURE_CONFIG,
        falseBreakout: { ...CONTINUATION_STRUCTURE_CONFIG.falseBreakout, returnWindowBars: 1 },
      },
    }).find((item) => item.structureId === 'false-breakout');

    expect(accepted?.status).toBe('confirmed');
    expect(rejected?.status).toBe('invalid');
  });

  it.each([
    ['flag-consolidation', [...bullishFlagBody(), 110.5, 111, 110.8]],
    ['false-breakout', [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7, 102, 100.5, 100.2, 100.1, 100, 99.9]],
    ['rounding-top', [...roundingTopBody(), 99.5, 99, 98.8]],
  ] as const)('keeps the confirmed %s lifecycle visible after unrelated completed bars', (id, bars) => {
    expect(evaluateContinuationStructures({ bars: indexed(bars) })
      .find((item) => item.structureId === id)?.status).toBe('confirmed');
  });

  it.each([
    ['flag-consolidation', [...bullishFlagBody(), 110.5, 107.5, 108]],
    ['false-breakout', [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7, 102, 100.5, 102.2, 100.2]],
    ['rounding-top', [...roundingTopBody(), 99.5, 109, 105]],
  ] as const)('keeps the invalid %s lifecycle visible after more completed bars', (id, bars) => {
    expect(evaluateContinuationStructures({ bars: indexed(bars) })
      .find((item) => item.structureId === id)?.status).toBe('invalid');
  });

  it('allows a false breakout return within the configured window and invalidates an immediate re-break', () => {
    const range = [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7];
    const waiting = evaluateContinuationStructures({ bars: indexed([...range, 102, 101.5, 100.5]) })
      .find((item) => item.structureId === 'false-breakout');
    const held = evaluateContinuationStructures({ bars: indexed([...range, 102, 101.5, 100.5, 100.2]) })
      .find((item) => item.structureId === 'false-breakout');
    const rebroken = evaluateContinuationStructures({ bars: indexed([...range, 102, 100.5, 102.2]) })
      .find((item) => item.structureId === 'false-breakout');
    const didNotHold = evaluateContinuationStructures({ bars: indexed([...range, 102, 100.5, 98]) })
      .find((item) => item.structureId === 'false-breakout');

    expect(waiting?.status).toBe('forming');
    expect(held?.status).toBe('confirmed');
    expect(rebroken?.status).toBe('invalid');
    expect(didNotHold?.status).toBe('invalid');
  });

  it('requires flag overlap and rounding endpoint gates to remain required rules', () => {
    const flag = evaluateContinuationStructures({ bars: indexed(bullishFlagBody()) })
      .find((item) => item.structureId === 'flag-consolidation');
    const rounding = evaluateContinuationStructures({ bars: indexed(roundingTopBody()) })
      .find((item) => item.structureId === 'rounding-top');

    expect(flag?.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'flag-overlap', group: 'required' }),
    ]));
    expect(rounding?.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'rounding-top-endpoints', group: 'required' }),
    ]));
  });

  it('rejects a segmented tent even when it rises, flattens, and falls', () => {
    const segmented = [
      100, 101, 102, 103, 104, 105, 106,
      107, 107.1, 107.2, 107.3, 107.2, 107.1, 107,
      106, 105, 104, 103, 102, 101, 100,
    ];
    const result = evaluateContinuationStructures({ bars: indexed(segmented) })
      .find((item) => item.structureId === 'rounding-top');

    expect(result?.status).toBe('insufficient-evidence');
  });

  it('keeps the rounding geometry causal when later confirmation bars are appended', () => {
    const prefix = evaluateContinuationStructures({ bars: indexed(roundingTopBody()) })
      .find((item) => item.structureId === 'rounding-top');
    const extended = evaluateContinuationStructures({ bars: indexed([...roundingTopBody(), 99.5, 99]) })
      .find((item) => item.structureId === 'rounding-top');

    expect(extended?.boundaries).toEqual(prefix?.boundaries);
    expect(extended?.anchors).toEqual(prefix?.anchors);
    expect(extended?.evaluations.filter((item) => item.ruleId !== 'rounding-top-support-break'))
      .toEqual(prefix?.evaluations.filter((item) => item.ruleId !== 'rounding-top-support-break'));
  });
});
