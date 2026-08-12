import { describe, expect, it } from 'vitest';
import type { OhlcvBar } from '../market-data/types';
import { analyzeStructures } from './analyzer';
import { STRUCTURE_ENGINE_CONFIG } from './config';

function bar(index: number, high: number, low: number, close = (high + low) / 2): OhlcvBar {
  return {
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high,
    low,
    close,
    volumeShares: 1_000_000 + index,
    sourcePrecision: 0.01,
    comparisonUnit: 0.01,
    completed: true,
    evidenceStatus: 'complete',
    missingSessionDates: [],
  };
}

function snapshot(bars: readonly OhlcvBar[]) {
  return {
    schemaVersion: 4,
    snapshotVersion: 4,
    snapshotHash: 'a'.repeat(64),
    code: '2330',
    name: '台積電',
    market: 'TWSE' as const,
    securityType: 'common-stock' as const,
    priceMode: 'raw' as const,
    timeframe: '1d' as const,
    currency: 'TWD' as const,
    cutoffDate: bars.at(-1)?.date,
    comparisonUnitPolicy: {
      version: 1,
      effectiveFrom: '2026-01-01',
      sourceUrl: 'https://example.test/comparison-unit',
    },
    bars,
    noQuoteEvidence: [],
    corporateActions: [],
    sourceUrls: ['https://example.test/market-data'],
  };
}

function boxBars(): readonly OhlcvBar[] {
  return [
    bar(0, 108, 102), bar(1, 109, 101), bar(2, 112, 102),
    bar(3, 108, 101), bar(4, 109, 99), bar(5, 108, 102),
    bar(6, 112, 102), bar(7, 108, 101), bar(8, 109, 99),
    bar(9, 108, 102), bar(10, 112, 102), bar(11, 108, 101),
    bar(12, 109, 99), bar(13, 108, 102), bar(14, 109, 101),
  ];
}

function triangleBars(): readonly OhlcvBar[] {
  return [
    bar(0, 112, 98), bar(1, 114, 96), bar(2, 116, 98),
    bar(3, 110, 96), bar(4, 111, 94), bar(5, 109, 98),
    bar(6, 112, 99), bar(7, 107, 97), bar(8, 108, 98),
    bar(9, 106, 101), bar(10, 108, 102), bar(11, 104, 100),
    bar(12, 105, 102), bar(13, 104.8, 103, 104), bar(14, 105, 103.5, 104.25),
  ];
}

describe('analyzeStructures', () => {
  it('emits a versioned, explainable forming box candidate with pivots, ATR, boundaries, window, and one overlay contract', () => {
    const result = analyzeStructures(snapshot(boxBars()));
    const candidate = result.candidates.find((item) => item.structureId === 'range');

    expect(result.matcherVersion).toBe('structure-v1');
    expect(result.features.configVersion).toBe('structure-features-v1');
    expect(result.features.atr.period).toBe(14);
    expect(result.features.pivots.filter((pivot) => pivot.kind === 'high').length).toBeGreaterThan(0);
    expect(result.features.pivots[0]?.version).toBe('structure-pivot-v1');
    expect(candidate).toMatchObject({
      structureId: 'range',
      status: 'forming',
      timeframe: '1d',
      priceMode: 'raw',
      direction: 'undetermined',
    });
    expect(candidate?.window).toMatchObject({
      version: 'structure-window-v1',
      startBarIndex: expect.any(Number),
      endBarIndex: 14,
    });
    expect(candidate?.boundaries).toHaveLength(2);
    expect(candidate?.boundaries.every((boundary) => boundary.version === 'structure-boundary-v1')).toBe(true);
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'confirmation')).toBe(true);
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'invalidation')).toBe(true);
    expect(candidate?.overlay.segments.length).toBeGreaterThanOrEqual(3);
    expect(candidate?.ruleFit).toBeGreaterThanOrEqual(70);
    expect(candidate?.ruleFit).toBeLessThanOrEqual(100);
  });

  it('does not turn a triangle into a directional claim until a completed close leaves its boundary', () => {
    const forming = analyzeStructures(snapshot(triangleBars()));
    const formingCandidate = forming.candidates.find((item) => item.structureId === 'triangle-consolidation');

    expect(formingCandidate).toMatchObject({
      status: 'forming',
      direction: 'undetermined',
    });
    expect(formingCandidate?.overlay.scenario).toBeUndefined();

    const confirmedBars = [...triangleBars(), bar(15, 110, 104, 109)];
    const confirmed = analyzeStructures(snapshot(confirmedBars));
    const confirmedCandidate = confirmed.candidates.find((item) => item.structureId === 'triangle-consolidation');

    expect(confirmedCandidate).toMatchObject({
      status: 'confirmed',
      direction: 'up',
    });
    expect(confirmedCandidate?.overlay.scenario?.label).toContain('條件式情境，非價格預測');
  });

  it('keeps a historical prefix forming when the later breakout is absent, rather than reading ahead', () => {
    const allBars = [...triangleBars(), bar(15, 110, 104, 109)];
    const prefix = analyzeStructures(snapshot(allBars.slice(0, -1)));
    const full = analyzeStructures(snapshot(allBars));

    expect(prefix.candidates.find((item) => item.structureId === 'triangle-consolidation')?.status).toBe('forming');
    expect(full.candidates.find((item) => item.structureId === 'triangle-consolidation')?.status).toBe('confirmed');
  });

  it('keeps every published feature value causal when later completed bars are appended', () => {
    const prefixBars = triangleBars();
    const prefix = analyzeStructures(snapshot(prefixBars));
    const extended = analyzeStructures(snapshot([...prefixBars, bar(15, 110, 104, 109), bar(16, 112, 106, 111)]));

    expect(extended.features.smoothedClose.slice(0, prefix.features.smoothedClose.length))
      .toEqual(prefix.features.smoothedClose);
    expect(extended.features.atr.values.slice(0, prefix.features.atr.values.length))
      .toEqual(prefix.features.atr.values);
  });

  it('keeps an exact boundary touch forming and confirms only after a close actually crosses it', () => {
    const zeroBufferConfig = {
      ...STRUCTURE_ENGINE_CONFIG,
      boundaries: { ...STRUCTURE_ENGINE_CONFIG.boundaries, breakoutAtr: 0 },
    };
    const boundaryTouch = analyzeStructures(snapshot([...boxBars(), bar(15, 114, 104, 112)]), {
      config: zeroBufferConfig,
    });
    const crossing = analyzeStructures(snapshot([...boxBars(), bar(15, 114, 104, 112.01)]), {
      config: zeroBufferConfig,
    });

    expect(boundaryTouch.candidates.find((item) => item.structureId === 'range')?.status).toBe('forming');
    expect(crossing.candidates.find((item) => item.structureId === 'range')?.status).toBe('confirmed');
  });

  it('does not accept a sloped pseudo-box or a non-converging triangle as current structure candidates', () => {
    const slopedBox = boxBars().map((item, index) => ({
      ...item,
      open: item.open + index * 3,
      high: item.high + index * 3,
      low: item.low + index * 3,
      close: item.close + index * 3,
    }));
    const nonConvergingTriangle = triangleBars().map((item, index) => (
      index === 8 || index === 12 ? { ...item, low: 94, open: 98, close: 98 } : item
    ));

    const slopedResult = analyzeStructures(snapshot(slopedBox));
    const nonConvergingResult = analyzeStructures(snapshot(nonConvergingTriangle));

    expect(slopedResult.candidates.some((item) => item.structureId === 'range')).toBe(false);
    expect(nonConvergingResult.candidates.some((item) => item.structureId === 'triangle-consolidation')).toBe(false);
    expect(slopedResult.nearMisses.some((item) => item.structureId === 'range')).toBe(true);
    expect(nonConvergingResult.nearMisses.some((item) => item.structureId === 'triangle-consolidation')).toBe(true);
  });

  it('evaluates the actual box boundary slope instead of forcing the horizontal rule to pass', () => {
    const steadilyRisingRange = boxBars().map((item, index) => ({
      ...item,
      open: item.open + index,
      high: item.high + index,
      low: item.low + index,
      close: item.close + index,
    }));
    const result = analyzeStructures(snapshot(steadilyRisingRange));
    const reference = result.nearMisses.find((item) => item.structureId === 'range');

    expect(result.candidates.some((item) => item.structureId === 'range')).toBe(false);
    expect(reference?.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'box-horizontal-boundaries', state: 'not-met' }),
    ]));
    expect(reference?.missingConditions).not.toContain('確認後未返回原區間');
  });

  it('requires most closes to stay inside the box instead of admitting an 82-point geometry shell', () => {
    const impossibleContainment = {
      ...STRUCTURE_ENGINE_CONFIG,
      boundaries: { ...STRUCTURE_ENGINE_CONFIG.boundaries, insideCloseRatio: 1.01 },
    };
    const result = analyzeStructures(snapshot(boxBars()), { config: impossibleContainment });

    expect(result.candidates.some((item) => item.structureId === 'range')).toBe(false);
    expect(result.nearMisses.find((item) => item.structureId === 'range')?.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'box-inside-closes', group: 'required', state: 'not-met' }),
    ]));
  });

  it('moves a returned-from-breakout box to an invalid teaching reference instead of keeping it as a current candidate', () => {
    const confirmedBars = [...boxBars(), bar(15, 116, 104, 115)];
    const invalidBars = [...confirmedBars, bar(16, 110, 101, 105)];

    expect(analyzeStructures(snapshot(confirmedBars)).candidates.find((item) => item.structureId === 'range')?.status).toBe('confirmed');
    const invalid = analyzeStructures(snapshot(invalidBars));

    expect(invalid.candidates.some((item) => item.structureId === 'range')).toBe(false);
    expect(invalid.nearMisses).toEqual(expect.arrayContaining([
      expect.objectContaining({ structureId: 'range', status: 'invalid' }),
    ]));
  });

  it('moves a returned triangle breakout to an invalid teaching reference and keeps the prefix unconfirmed', () => {
    const confirmedBars = [...triangleBars(), bar(15, 110, 104, 109)];
    const invalidBars = [...confirmedBars, bar(16, 104, 99, 100)];

    expect(analyzeStructures(snapshot(confirmedBars.slice(0, -1))).candidates.find((item) => item.structureId === 'triangle-consolidation')?.status).toBe('forming');
    const invalid = analyzeStructures(snapshot(invalidBars));

    expect(invalid.candidates.some((item) => item.structureId === 'triangle-consolidation')).toBe(false);
    expect(invalid.nearMisses).toEqual(expect.arrayContaining([
      expect.objectContaining({ structureId: 'triangle-consolidation', status: 'invalid' }),
    ]));
  });

  it('does not fill the top three with weak visual references and keeps the deterministic order stable', () => {
    const unstructured = Array.from({ length: 18 }, (_, index) => bar(index, 110 + index, 100 + index, 105 + index));
    const first = analyzeStructures(snapshot(unstructured));
    const second = analyzeStructures(snapshot(unstructured));

    expect(first.candidates).toHaveLength(0);
    expect(first.candidates).toEqual(second.candidates);
    expect(first.nearMisses.length).toBeGreaterThan(0);
  });

  it('refuses incomplete bars and invalid OHLC windows instead of manufacturing pivots or ATR', () => {
    const incomplete = [...boxBars()].map((item, index) => index === 8 ? { ...item, completed: false } : item);
    const malformed = [...boxBars()].map((item, index) => index === 8 ? { ...item, low: item.high + 1 } : item);

    expect(analyzeStructures(snapshot(incomplete)).status).toBe('insufficient-evidence');
    expect(analyzeStructures(snapshot(malformed)).status).toBe('insufficient-evidence');
  });

  it('integrates a confirmed double top after the 120-bar slice without confusing source and local indexes', () => {
    const dated = (index: number, close: number): OhlcvBar => ({
      ...bar(index % 28, close + 1, close - 1, close),
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    });
    const prefix = Array.from({ length: 116 }, (_value, index) => dated(index, 100 + (index % 2) * 0.1));
    const pattern = [100, 104, 109, 105, 100, 104, 109.4, 106, 101.5, 95]
      .map((close, index) => dated(prefix.length + index, close));
    const result = analyzeStructures(snapshot([...prefix, ...pattern]));
    const candidate = result.candidates.find((item) => item.structureId === 'double-top');

    expect(candidate).toMatchObject({ status: 'confirmed', direction: 'down' });
    expect(candidate?.anchors.every((anchor) => anchor.barIndex >= 116)).toBe(true);
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'confirmation')).toBe(true);
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'invalidation')).toBe(true);
  });

  it.each([
    ['flag-consolidation', [100, 102, 104.5, 107, 110, 109.6, 109.2, 109.4, 109, 108.8, 109.1, 110.5]],
    ['false-breakout', [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7, 102, 100.5, 100.2]],
    ['rounding-top', [
      100, 101, 102.2, 103.4, 104.5, 105.4, 106.2,
      106.8, 107.2, 107.5, 107.6, 107.5, 107.3, 106.9,
      106.3, 105.6, 104.8, 104, 103.2, 102.5, 101.8, 99.5,
    ]],
  ] as const)('integrates the confirmed %s core into ranked candidates with three conditional scenarios', (structureId, closes) => {
    const bars = closes.map((close, index) => bar(index, close + 0.6, close - 0.6, close));
    const candidate = analyzeStructures(snapshot(bars)).candidates.find((item) => item.structureId === structureId);

    expect(candidate).toMatchObject({ structureId, status: 'confirmed' });
    expect(candidate?.overlay.scenario?.conditions?.map((condition) => condition.kind)).toEqual([
      'continuation',
      'retest',
      'invalidation',
    ]);
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'confirmation')).toBe(true);
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'invalidation')).toBe(true);
  });

  it('keeps an invalid reversal as an explainable historical reference with anchors, neckline, and thresholds', () => {
    const closes = [100, 104, 109, 105, 100, 104, 109.4, 106, 101.5, 95, 102];
    const bars = closes.map((close, index) => bar(index, close + 1, close - 1, close));
    const reference = analyzeStructures(snapshot(bars)).nearMisses.find((item) => item.structureId === 'double-top');

    expect(reference).toMatchObject({ status: 'invalid' });
    expect(reference?.anchors?.length).toBeGreaterThanOrEqual(3);
    expect(reference?.boundaries?.[0]).toMatchObject({ id: 'lower' });
    expect(reference?.confirmationCondition).toContain('頸線');
    expect(reference?.invalidationCondition).toContain('頸線');
    expect(reference?.overlay?.segments.some((segment) => segment.kind === 'confirmation')).toBe(true);
    expect(reference?.overlay?.segments.some((segment) => segment.kind === 'invalidation')).toBe(true);
  });

  it.each([
    ['false-breakout', [100, 100.4, 99.8, 100.2, 99.9, 100.3, 100.1, 99.7, 102]],
    ['rounding-top', [
      100, 101, 102.2, 103.4, 104.5, 105.4, 106.2,
      106.8, 107.2, 107.5, 107.6, 107.5, 107.3, 106.9,
      106.3, 105.6, 104.8, 104, 103.2, 102.5, 101.8,
    ]],
  ] as const)('keeps a forming %s in candidates so its confirmation and invalidation lines remain inspectable', (structureId, closes) => {
    const bars = closes.map((close, index) => bar(index, close + 0.6, close - 0.6, close));
    const candidate = analyzeStructures(snapshot(bars)).candidates.find((item) => item.structureId === structureId);

    expect(candidate).toMatchObject({ structureId, status: 'forming', direction: 'undetermined' });
    expect(candidate?.overlay.scenario).toBeUndefined();
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'confirmation')).toBe(true);
    expect(candidate?.overlay.segments.some((segment) => segment.kind === 'invalidation')).toBe(true);
  });
});
