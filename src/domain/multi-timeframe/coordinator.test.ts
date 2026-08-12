import { describe, expect, it } from 'vitest';
import type { AvailablePriceMode, OhlcvBar, StockSnapshot, TimeframeSeries } from '../market-data/types';
import { analyzePatterns } from '../patterns/matcher';
import { analyzeStructures } from '../structures/analyzer';
import { coordinateMultiTimeframe } from './coordinator';

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

function formingBar(index: number, high: number, low: number, close: number): OhlcvBar {
  return { ...bar(index, high, low, close), completed: false };
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

function upBars(): readonly OhlcvBar[] {
  return [...boxBars(), bar(15, 116, 104, 115)];
}

function downBars(): readonly OhlcvBar[] {
  return [...boxBars(), bar(15, 106, 94, 95)];
}

function series(
  completedBars: readonly OhlcvBar[],
  forming: OhlcvBar | null = null,
): TimeframeSeries {
  return { completedBars, formingBar: forming };
}

function available(
  monthly: TimeframeSeries,
  weekly: TimeframeSeries,
  daily: TimeframeSeries,
): AvailablePriceMode {
  return {
    status: 'available',
    reasonCodes: [],
    warnings: [],
    timeframes: { '1m': monthly, '1w': weekly, '1d': daily },
  };
}

function snapshot(
  monthly: TimeframeSeries,
  weekly: TimeframeSeries,
  daily: TimeframeSeries,
): StockSnapshot {
  const raw = available(monthly, weekly, daily);
  const cutoffDate = [monthly, weekly, daily]
    .flatMap((item) => item.completedBars.map((value) => value.date))
    .sort()
    .at(-1);
  return {
    schemaVersion: 1,
    snapshotVersion: 4,
    snapshotHash: 'a'.repeat(64),
    code: '2330',
    name: '台積電',
    market: 'TWSE',
    securityType: 'common-stock',
    priceMode: 'raw',
    timeframe: '1d',
    priceModes: { raw, adjusted: raw },
    currency: 'TWD',
    cutoffDate,
    freshness: 'fresh',
    comparisonUnitPolicy: {
      version: 1,
      effectiveFrom: '2026-01-01',
      sourceUrl: 'https://www.twse.com.tw/zh/trading/introduce.html',
    },
    bars: daily.completedBars,
    noQuoteEvidence: [],
    corporateActions: [],
    sourceUrls: ['https://openapi.twse.com.tw/'],
  };
}

const selectedRanges = {
  '1m': 'range',
  '1w': 'range',
  '1d': 'range',
} as const;

describe('coordinateMultiTimeframe', () => {
  it.each([
    {
      name: '三個週期方向一致',
      value: snapshot(series(upBars()), series(upBars()), series(upBars())),
      expected: 'aligned',
    },
    {
      name: '月週一致但日線尚在形成',
      value: snapshot(series(upBars()), series(upBars()), series(boxBars())),
      expected: 'partially-aligned',
    },
    {
      name: '月週方向分歧',
      value: snapshot(series(upBars()), series(downBars()), series(upBars())),
      expected: 'divergent',
    },
    {
      name: '月線證據不足',
      value: snapshot(series(upBars().slice(0, 2)), series(upBars()), series(upBars())),
      expected: 'insufficient-evidence',
    },
  ])('returns $expected for $name without a timeframe vote or total score', ({ value, expected }) => {
    const result = coordinateMultiTimeframe(value, {
      priceMode: 'raw',
      selectedStructureIds: selectedRanges,
    });

    expect(result.timeframes.map((item) => item.timeframe)).toEqual(['1m', '1w', '1d']);
    expect(result.summary.state).toBe(expected);
    expect(result.summary).not.toHaveProperty('score');
    expect(result.summary).not.toHaveProperty('totalScore');
    expect(result.timeframes.every((item) => item.structureAnalysis.timeframe === item.timeframe)).toBe(true);
    expect(result.timeframes.every((item) => item.patternAnalysis.status !== 'unavailable')).toBe(true);
    expect(result.timeframes.every((item) => (
      item.snapshot.timeframe === item.timeframe
      && item.snapshot.priceMode === result.priceMode
      && item.snapshot.cutoffDate === result.cutoffDate
    ))).toBe(true);
  });

  it('preserves every matcher score and status while deriving the summary', () => {
    const value = snapshot(series(upBars()), series(downBars()), series(upBars()));
    const originalSnapshot = structuredClone(value);
    const result = coordinateMultiTimeframe(value, {
      priceMode: 'raw',
      selectedStructureIds: selectedRanges,
    });

    result.timeframes.forEach((entry) => {
      const directStructures = analyzeStructures(entry.snapshot, { cutoffDate: result.cutoffDate });
      const directPatterns = analyzePatterns(entry.snapshot);
      expect(entry.structureAnalysis.candidates.map((candidate) => ({
        id: candidate.candidateId,
        score: candidate.ruleFit,
        status: candidate.status,
      }))).toEqual(directStructures.candidates.map((candidate) => ({
        id: candidate.candidateId,
        score: candidate.ruleFit,
        status: candidate.status,
      })));
      expect(entry.patternAnalysis.status).toBe(directPatterns.status);
      if (entry.patternAnalysis.status === 'matched' && directPatterns.status === 'matched') {
        expect(entry.patternAnalysis.matches.map((candidate) => ({
          id: candidate.cardId,
          score: candidate.score,
        }))).toEqual(directPatterns.matches.map((candidate) => ({
          id: candidate.cardId,
          score: candidate.score,
        })));
      }
    });
    expect(value).toEqual(originalSnapshot);
  });

  it('treats an active consolidation as a neutral background instead of missing evidence', () => {
    const value = snapshot(series(boxBars()), series(boxBars()), series(boxBars()));
    const result = coordinateMultiTimeframe(value, {
      priceMode: 'raw',
      selectedStructureIds: selectedRanges,
    });

    expect(result.timeframes.map((entry) => entry.backgroundDirection)).toEqual([
      'neutral',
      'neutral',
      'neutral',
    ]);
    expect(result.summary.state).toBe('aligned');
  });

  it('keeps forming weekly and monthly bars visible but excludes them from both matcher results', () => {
    const baseline = snapshot(series(upBars()), series(upBars()), series(upBars()));
    const withForming = snapshot(
      series(upBars(), formingBar(16, 260, 20, 250)),
      series(upBars(), formingBar(16, 250, 10, 20)),
      series(upBars()),
    );
    const options = {
      priceMode: 'raw' as const,
      cutoffDate: '2026-01-17',
      selectedStructureIds: selectedRanges,
    };

    const expected = coordinateMultiTimeframe(baseline, options);
    const actual = coordinateMultiTimeframe(withForming, options);

    for (const timeframe of ['1m', '1w'] as const) {
      const expectedEntry = expected.timeframes.find((item) => item.timeframe === timeframe)!;
      const actualEntry = actual.timeframes.find((item) => item.timeframe === timeframe)!;
      expect(actualEntry.formingBar?.completed).toBe(false);
      expect(actualEntry.availableCompletedBarCount).toBe(expectedEntry.availableCompletedBarCount);
      expect(actualEntry.structureAnalysis.candidates.map((candidate) => ({
        id: candidate.candidateId,
        score: candidate.ruleFit,
        status: candidate.status,
      }))).toEqual(expectedEntry.structureAnalysis.candidates.map((candidate) => ({
        id: candidate.candidateId,
        score: candidate.ruleFit,
        status: candidate.status,
      })));
      expect(actualEntry.patternAnalysis).toEqual(expectedEntry.patternAnalysis);
    }
  });

  it('falls back all three timeframes to raw prices when adjusted evidence is unavailable', () => {
    const value = snapshot(series(upBars()), series(upBars()), series(upBars()));
    value.priceModes = {
      raw: value.priceModes!.raw,
      adjusted: {
        status: 'unavailable',
        reasonCodes: ['missing-adjustment-evidence'],
        warnings: ['缺少完整公司行動調整證據。'],
      },
    };
    const rawResult = coordinateMultiTimeframe(value, {
      priceMode: 'raw',
      selectedStructureIds: selectedRanges,
    });
    const result = coordinateMultiTimeframe(value, {
      priceMode: 'adjusted',
      selectedStructureIds: selectedRanges,
    });

    expect(result).toMatchObject({
      requestedPriceMode: 'adjusted',
      priceMode: 'raw',
      priceModeResolution: 'fallback-to-raw',
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      '缺少完整公司行動調整證據。',
      '向後還原證據不足，本次保留官方原始價格並停用還原分析。',
    ]));
    expect(result.timeframes.every((entry) => entry.snapshot.priceMode === 'raw')).toBe(true);
    expect(result.timeframes.map((entry) => entry.structureAnalysis.candidates))
      .toEqual(rawResult.timeframes.map((entry) => entry.structureAnalysis.candidates));
  });

  it('preserves snapshot hash and freshness in every short-window audit context', () => {
    const value = snapshot(series(upBars()), series(upBars()), series(upBars()));
    value.snapshotHash = 'b'.repeat(64);
    value.freshness = 'one-session-behind';
    const result = coordinateMultiTimeframe(value, {
      priceMode: 'raw',
      selectedStructureIds: selectedRanges,
    });

    result.timeframes.forEach((entry) => {
      expect(entry.patternAnalysis.status).not.toBe('unavailable');
      if (entry.patternAnalysis.status !== 'unavailable') {
        expect(entry.patternAnalysis.context).toMatchObject({
          snapshotHash: 'b'.repeat(64),
          freshness: 'one-session-behind',
        });
      }
    });
  });

  it('applies one historical cutoff to every snapshot without reading the later confirmation bar', () => {
    const value = snapshot(series(upBars()), series(upBars()), series(upBars()));
    const prefix = coordinateMultiTimeframe(value, {
      priceMode: 'raw',
      cutoffDate: '2026-01-15',
      selectedStructureIds: selectedRanges,
    });
    const full = coordinateMultiTimeframe(value, {
      priceMode: 'raw',
      cutoffDate: '2026-01-16',
      selectedStructureIds: selectedRanges,
    });

    expect(prefix.timeframes.every((entry) => (
      entry.availableCompletedBarCount === 15
      && entry.snapshot.bars.every((item) => item.date <= '2026-01-15')
      && entry.selectedStructureId === 'range'
      && entry.selectedCandidate?.status === 'forming'
    ))).toBe(true);
    expect(full.timeframes.every((entry) => (
      entry.availableCompletedBarCount === 16
      && entry.selectedStructureId === 'range'
      && entry.selectedCandidate?.status === 'confirmed'
    ))).toBe(true);
  });

  it('writes period-specific background hints without hiding which longer timeframe disagrees', () => {
    const result = coordinateMultiTimeframe(
      snapshot(series(upBars()), series(downBars()), series(upBars())),
      { priceMode: 'raw', selectedStructureIds: selectedRanges },
    );

    expect(result.timeframes.find((item) => item.timeframe === '1m')?.backgroundHint)
      .toContain('月 K 長期背景');
    expect(result.timeframes.find((item) => item.timeframe === '1w')?.backgroundHint)
      .toContain('與月 K 的已確認方向相反');
    expect(result.timeframes.find((item) => item.timeframe === '1d')?.backgroundHint)
      .toContain('月 K 與週 K 已分歧');
  });

  it('does not silently replace a remembered selection that is absent at the current cutoff', () => {
    const result = coordinateMultiTimeframe(
      snapshot(series(upBars()), series(upBars()), series(upBars())),
      {
        priceMode: 'raw',
        selectedStructureIds: {
          '1m': 'rounding-top',
          '1w': 'range',
          '1d': 'range',
        },
      },
    );

    const monthly = result.timeframes.find((item) => item.timeframe === '1m');
    expect(monthly?.structureAnalysis.candidates.some((item) => item.structureId === 'range')).toBe(true);
    expect(monthly?.selectedCandidate).toBeNull();
    expect(monthly?.selectedCandidateId).toBeNull();
    expect(monthly?.selectedStructureId).toBeNull();
    expect(result.summary.state).toBe('insufficient-evidence');
  });
});
