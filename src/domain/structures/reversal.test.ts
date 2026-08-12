import { describe, expect, it } from 'vitest';
import type { OhlcvBar } from '../market-data/types';
import type { StructurePivot } from './types';
import { matchReversalStructures } from './reversal';

function bar(index: number, close: number): OhlcvBar {
  return {
    date: `2026-03-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volumeShares: 1_000_000,
    sourcePrecision: 0.01,
    comparisonUnit: 0.01,
    completed: true,
    evidenceStatus: 'complete',
    missingSessionDates: [],
  };
}

function pivot(
  bars: readonly OhlcvBar[],
  barIndex: number,
  kind: StructurePivot['kind'],
  price: number,
): StructurePivot {
  return {
    version: 'structure-pivot-v1',
    barIndex,
    date: bars[barIndex]!.date,
    price,
    kind,
    prominenceAtr: 2,
  };
}

function input(closes: readonly number[], definitions: readonly [number, StructurePivot['kind'], number][]) {
  const bars = closes.map((close, index) => bar(index, close));
  return {
    bars,
    pivots: definitions.map(([index, kind, price]) => pivot(bars, index, kind, price)),
    atrValues: bars.map(() => 2),
  };
}

describe('matchReversalStructures', () => {
  it('keeps a double top forming until a completed close crosses below its neckline', () => {
    const formingInput = input(
      [100, 104, 109, 105, 100, 104, 109.4, 106, 101.5],
      [[2, 'high', 110], [4, 'low', 99], [6, 'high', 110.4]],
    );
    const confirmedInput = input(
      [...formingInput.bars.map((item) => item.close), 98],
      [[2, 'high', 110], [4, 'low', 99], [6, 'high', 110.4]],
    );

    const forming = matchReversalStructures(formingInput)
      .find((item) => item.structureId === 'double-top');
    const confirmed = matchReversalStructures(confirmedInput)
      .find((item) => item.structureId === 'double-top');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'down' });
    expect(confirmed?.boundaries[0]?.touchBarIndexes).toEqual([4]);
    expect(confirmed?.overlaySegments.find((segment) => segment.kind === 'confirmation')?.endPrice).toBe(98.5);
    expect(confirmed?.overlaySegments.find((segment) => segment.id.startsWith('double-top-post-confirmation-invalidation'))).toBeUndefined();
    expect(confirmed?.overlaySegments.find((segment) => segment.id.startsWith('double-top-pre-confirmation-invalidation'))?.startPrice).toBe(111.4);
    expect(confirmed?.overlaySegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'double-top-neckline', kind: 'boundary', startPrice: 99, endPrice: 99 }),
      expect.objectContaining({ kind: 'outline' }),
    ]));
    expect(confirmed?.overlaySegments.every((segment) => (
      segment.startBarIndex !== segment.endBarIndex || segment.startPrice !== segment.endPrice
    ))).toBe(true);
  });

  it('confirms a double bottom only after a completed close crosses above its neckline', () => {
    const formingInput = input(
      [100, 96, 91, 95, 101, 96, 90.6, 94, 100.5],
      [[2, 'low', 90], [4, 'high', 102], [6, 'low', 90.4]],
    );
    const confirmedInput = input(
      [...formingInput.bars.map((item) => item.close), 103],
      [[2, 'low', 90], [4, 'high', 102], [6, 'low', 90.4]],
    );

    const forming = matchReversalStructures(formingInput)
      .find((item) => item.structureId === 'double-bottom');
    const confirmed = matchReversalStructures(confirmedInput)
      .find((item) => item.structureId === 'double-bottom');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'up' });
    expect(confirmed?.boundaries[0]).toMatchObject({ id: 'upper', touchBarIndexes: [4] });
  });

  it('preserves both anchors of a reasonably sloped head-and-shoulders top neckline', () => {
    const formingInput = input(
      [100, 105, 109, 105, 101, 109, 117, 110, 103, 108, 109.5, 104],
      [
        [2, 'high', 110], [4, 'low', 100], [6, 'high', 118],
        [8, 'low', 102], [10, 'high', 110.4],
      ],
    );
    const confirmedInput = input(
      [...formingInput.bars.map((item) => item.close), 101],
      [
        [2, 'high', 110], [4, 'low', 100], [6, 'high', 118],
        [8, 'low', 102], [10, 'high', 110.4],
      ],
    );

    const forming = matchReversalStructures(formingInput)
      .find((item) => item.structureId === 'head-and-shoulders-top');
    const confirmed = matchReversalStructures(confirmedInput)
      .find((item) => item.structureId === 'head-and-shoulders-top');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'down' });
    expect(confirmed?.boundaries[0]).toMatchObject({
      id: 'lower',
      slopePerBar: 0.5,
      touchBarIndexes: [4, 8],
    });
    expect(confirmed?.anchors.map((anchor) => anchor.barIndex)).toEqual([2, 4, 6, 8, 10]);
    expect(confirmed?.overlaySegments.some((segment) => segment.kind === 'confirmation' && segment.endPrice === 103.5)).toBe(true);
    expect(confirmed?.overlaySegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'head-and-shoulders-top-neckline', kind: 'boundary', startPrice: 100, endPrice: 104 }),
    ]));
  });

  it('confirms a head-and-shoulders bottom through the same anchored neckline output', () => {
    const formingInput = input(
      [110, 105, 101, 106, 112, 104, 94, 103, 110, 104, 100.6, 109],
      [
        [2, 'low', 100], [4, 'high', 112], [6, 'low', 94],
        [8, 'high', 110], [10, 'low', 100.4],
      ],
    );
    const confirmedInput = input(
      [...formingInput.bars.map((item) => item.close), 114],
      [
        [2, 'low', 100], [4, 'high', 112], [6, 'low', 94],
        [8, 'high', 110], [10, 'low', 100.4],
      ],
    );

    const forming = matchReversalStructures(formingInput)
      .find((item) => item.structureId === 'head-and-shoulders-bottom');
    const confirmed = matchReversalStructures(confirmedInput)
      .find((item) => item.structureId === 'head-and-shoulders-bottom');

    expect(forming).toMatchObject({ status: 'forming', direction: 'undetermined' });
    expect(confirmed).toMatchObject({ status: 'confirmed', direction: 'up' });
    expect(confirmed?.boundaries[0]).toMatchObject({
      id: 'upper',
      slopePerBar: -0.5,
      touchBarIndexes: [4, 8],
    });
  });

  it('accepts double-structure geometry exactly at the ATR thresholds and rejects the next price step', () => {
    const exactTop = input(
      [100, 104, 109, 108, 107.6, 109, 110.6],
      [[2, 'high', 110], [4, 'low', 107.6], [6, 'high', 111.6]],
    );
    const outsideTop = input(
      [100, 104, 109, 108, 107.6, 109, 110.61],
      [[2, 'high', 110], [4, 'low', 107.6], [6, 'high', 111.61]],
    );
    const exactBottom = input(
      [100, 96, 91, 90, 91.4, 90, 89.4],
      [[2, 'low', 90], [4, 'high', 92.4], [6, 'low', 88.4]],
    );
    const outsideBottom = input(
      [100, 96, 91, 90, 91.4, 90, 89.39],
      [[2, 'low', 90], [4, 'high', 92.4], [6, 'low', 88.39]],
    );

    expect(matchReversalStructures(exactTop).find((item) => item.structureId === 'double-top')?.status)
      .toBe('forming');
    expect(matchReversalStructures(outsideTop).find((item) => item.structureId === 'double-top')?.status)
      .toBe('insufficient-evidence');
    expect(matchReversalStructures(exactBottom).find((item) => item.structureId === 'double-bottom')?.status)
      .toBe('forming');
    expect(matchReversalStructures(outsideBottom).find((item) => item.structureId === 'double-bottom')?.status)
      .toBe('insufficient-evidence');
  });

  it('keeps shoulder, head-clearance, spacing, and neckline-slope thresholds inclusive', () => {
    const topCloses = [100, 105, 109, 105, 101, 108, 112.2, 108, 106, 107, 102.6, 106, 108, 109, 110.6];
    const exactTop = input(topCloses, [
      [2, 'high', 110], [4, 'low', 100], [6, 'high', 113.2],
      [10, 'low', 103.6], [14, 'high', 111.6],
    ]);
    const outsideTop = input([...topCloses.slice(0, 10), 102.61, ...topCloses.slice(11)], [
      [2, 'high', 110], [4, 'low', 100], [6, 'high', 113.2],
      [10, 'low', 103.61], [14, 'high', 111.6],
    ]);
    const bottomCloses = [110, 105, 101, 106, 111, 104, 97.8, 103, 106, 105, 107.4, 104, 102, 101, 99.4];
    const exactBottom = input(bottomCloses, [
      [2, 'low', 100], [4, 'high', 112], [6, 'low', 96.8],
      [10, 'high', 108.4], [14, 'low', 98.4],
    ]);
    const outsideBottom = input([...bottomCloses.slice(0, 10), 107.39, ...bottomCloses.slice(11)], [
      [2, 'low', 100], [4, 'high', 112], [6, 'low', 96.8],
      [10, 'high', 108.39], [14, 'low', 98.4],
    ]);

    expect(matchReversalStructures(exactTop).find((item) => item.structureId === 'head-and-shoulders-top')?.status)
      .toBe('forming');
    expect(matchReversalStructures(outsideTop).find((item) => item.structureId === 'head-and-shoulders-top')?.status)
      .toBe('insufficient-evidence');
    expect(matchReversalStructures(exactBottom).find((item) => item.structureId === 'head-and-shoulders-bottom')?.status)
      .toBe('forming');
    expect(matchReversalStructures(outsideBottom).find((item) => item.structureId === 'head-and-shoulders-bottom')?.status)
      .toBe('insufficient-evidence');
  });

  it('moves all four structures to an explainable invalid reference after a confirmed neckline return', () => {
    const doubleTop = input(
      [100, 104, 109, 105, 100, 104, 109.4, 106, 101.5, 98, 101],
      [[2, 'high', 110], [4, 'low', 99], [6, 'high', 110.4]],
    );
    const doubleBottom = input(
      [100, 96, 91, 95, 101, 96, 90.6, 94, 100.5, 103, 100],
      [[2, 'low', 90], [4, 'high', 102], [6, 'low', 90.4]],
    );
    const headTop = input(
      [100, 105, 109, 105, 101, 109, 117, 110, 103, 108, 109.5, 104, 101, 107],
      [
        [2, 'high', 110], [4, 'low', 100], [6, 'high', 118],
        [8, 'low', 102], [10, 'high', 110.4],
      ],
    );
    const headBottom = input(
      [110, 105, 101, 106, 112, 104, 94, 103, 110, 104, 100.6, 109, 114, 105],
      [
        [2, 'low', 100], [4, 'high', 112], [6, 'low', 94],
        [8, 'high', 110], [10, 'low', 100.4],
      ],
    );

    expect(matchReversalStructures(doubleTop).find((item) => item.structureId === 'double-top'))
      .toMatchObject({ status: 'invalid', direction: 'undetermined' });
    expect(matchReversalStructures(doubleBottom).find((item) => item.structureId === 'double-bottom'))
      .toMatchObject({ status: 'invalid', direction: 'undetermined' });
    expect(matchReversalStructures(headTop).find((item) => item.structureId === 'head-and-shoulders-top'))
      .toMatchObject({ status: 'invalid', direction: 'undetermined' });
    expect(matchReversalStructures(headBottom).find((item) => item.structureId === 'head-and-shoulders-bottom'))
      .toMatchObject({ status: 'invalid', direction: 'undetermined' });
  });

  it('rejects lookalikes that fail each reversal family required geometry', () => {
    const mismatchedDoubleTop = input(
      [100, 104, 109, 106, 104, 108, 115],
      [[2, 'high', 110], [4, 'low', 103], [6, 'high', 116]],
    );
    const shallowDoubleBottom = input(
      [100, 96, 91, 91, 91.5, 91, 90.6],
      [[2, 'low', 90], [4, 'high', 92], [6, 'low', 90.4]],
    );
    const flatHeadTop = input(
      [100, 105, 109, 105, 101, 108, 109.5, 106, 102, 108, 109],
      [
        [2, 'high', 110], [4, 'low', 100], [6, 'high', 110.5],
        [8, 'low', 101], [10, 'high', 110],
      ],
    );
    const unevenHeadBottom = input(
      [110, 105, 101, 106, 112, 103, 94, 104, 110, 100, 95],
      [
        [2, 'low', 100], [4, 'high', 112], [6, 'low', 94],
        [8, 'high', 110], [10, 'low', 94],
      ],
    );

    expect(matchReversalStructures(mismatchedDoubleTop).find((item) => item.structureId === 'double-top'))
      .toMatchObject({ status: 'insufficient-evidence', missingConditions: expect.arrayContaining(['兩個波峰位於相近價格區域']) });
    expect(matchReversalStructures(shallowDoubleBottom).find((item) => item.structureId === 'double-bottom'))
      .toMatchObject({ status: 'insufficient-evidence', missingConditions: expect.arrayContaining(['中間波峰高度足以辨識']) });
    expect(matchReversalStructures(flatHeadTop).find((item) => item.structureId === 'head-and-shoulders-top'))
      .toMatchObject({ status: 'insufficient-evidence', missingConditions: expect.arrayContaining(['頭部明顯高於兩肩']) });
    expect(matchReversalStructures(unevenHeadBottom).find((item) => item.structureId === 'head-and-shoulders-bottom'))
      .toMatchObject({ status: 'insufficient-evidence', missingConditions: expect.arrayContaining(['左右肩位於相近價格區域']) });
  });

  it('returns explicit insufficient evidence for all four structures when bars, pivots, or ATR are missing', () => {
    const tooShort = input(
      [100, 105, 110, 104, 100, 105],
      [[2, 'high', 111], [4, 'low', 99]],
    );
    const noSequences = input(
      [100, 101, 102, 103, 104, 105, 106],
      [],
    );
    const missingAtr = {
      ...input(
        [100, 104, 109, 105, 100, 104, 109.4],
        [[2, 'high', 110], [4, 'low', 99], [6, 'high', 110.4]],
      ),
      atrValues: Array.from({ length: 7 }, () => null),
    };

    expect(matchReversalStructures(tooShort)).toHaveLength(4);
    expect(matchReversalStructures(tooShort).every((item) => item.status === 'insufficient-evidence')).toBe(true);
    expect(matchReversalStructures(noSequences).every((item) => item.status === 'insufficient-evidence')).toBe(true);
    expect(matchReversalStructures(missingAtr).find((item) => item.structureId === 'double-top'))
      .toMatchObject({
        status: 'insufficient-evidence',
        missingConditions: ['第二個波峰缺少可用 ATR。'],
      });
  });

  it('uses only bars, pivots, and ATR at or before the requested cutoff', () => {
    const extended = input(
      [100, 104, 109, 105, 100, 104, 109.4, 106, 101.5, 98, 108, 90, 120],
      [
        [2, 'high', 110], [4, 'low', 99], [6, 'high', 110.4],
        [10, 'high', 109], [11, 'low', 89], [12, 'high', 121],
      ],
    );
    const prefixInput = {
      bars: extended.bars.slice(0, 9),
      pivots: extended.pivots.filter((item) => item.barIndex <= 8),
      atrValues: extended.atrValues.slice(0, 9),
    };

    const prefix = matchReversalStructures(prefixInput);
    const cutoff = matchReversalStructures({
      ...extended,
      cutoffBarIndex: 8,
      atrValues: [...extended.atrValues.slice(0, 9), 999, 999, 999, 999],
    });
    const full = matchReversalStructures(extended);

    expect(cutoff).toEqual(prefix);
    expect(cutoff.find((item) => item.structureId === 'double-top')?.status).toBe('forming');
    expect(full.find((item) => item.structureId === 'double-top')?.candidateId).not
      .toBe(cutoff.find((item) => item.structureId === 'double-top')?.candidateId);
  });

  it('keeps an exact neckline breakout buffer touch forming and confirms beyond the next price step', () => {
    const topTouch = input(
      [100, 104, 109, 105, 100, 104, 109.4, 106, 98.5],
      [[2, 'high', 110], [4, 'low', 99], [6, 'high', 110.4]],
    );
    const topCross = input(
      [100, 104, 109, 105, 100, 104, 109.4, 106, 98.49],
      [[2, 'high', 110], [4, 'low', 99], [6, 'high', 110.4]],
    );
    const bottomTouch = input(
      [100, 96, 91, 95, 101, 96, 90.6, 94, 102.5],
      [[2, 'low', 90], [4, 'high', 102], [6, 'low', 90.4]],
    );
    const bottomCross = input(
      [100, 96, 91, 95, 101, 96, 90.6, 94, 102.51],
      [[2, 'low', 90], [4, 'high', 102], [6, 'low', 90.4]],
    );

    expect(matchReversalStructures(topTouch).find((item) => item.structureId === 'double-top')?.status)
      .toBe('forming');
    expect(matchReversalStructures(topCross).find((item) => item.structureId === 'double-top')?.status)
      .toBe('confirmed');
    expect(matchReversalStructures(bottomTouch).find((item) => item.structureId === 'double-bottom')?.status)
      .toBe('forming');
    expect(matchReversalStructures(bottomCross).find((item) => item.structureId === 'double-bottom')?.status)
      .toBe('confirmed');
  });
});
