import { describe, expect, it } from 'vitest';
import type { OhlcvBar, StockSnapshot } from '../market-data/types';
import { PATTERN_CARDS } from './catalog';
import { analyzePatterns, evaluateAllMvpCardsForTesting } from './matcher';
import { RULE_FAMILIES } from './rule-registry';
import { makeSnapshot, MVP_CASES } from './test-cases';
import type { PatternCardId } from './types';

function resultFor(result: ReturnType<typeof analyzePatterns>, cardId: PatternCardId): boolean {
  return result.status === 'matched' && result.matches.some((match) => match.cardId === cardId);
}

function candidateFor(snapshot: StockSnapshot, cardId: PatternCardId): boolean {
  const evaluation = evaluateAllMvpCardsForTesting(snapshot).find((item) => item.cardId === cardId);
  if (!evaluation) {
    throw new Error(`找不到卡片評估結果：${cardId}`);
  }

  return evaluation.isCandidate;
}

function caseFor(cardId: PatternCardId, kind: 'positive' | 'boundary' | 'negative') {
  const testCase = MVP_CASES.find((item) => item.cardId === cardId && item.kind === kind);
  if (!testCase) {
    throw new Error(`找不到測試案例：${cardId}/${kind}`);
  }

  return testCase;
}

function bar(day: string, open: number, high: number, low: number, close: number): OhlcvBar {
  return {
    date: day,
    open,
    high,
    low,
    close,
    volumeShares: 1_000,
    sourcePrecision: 0.01,
    comparisonUnit: 0.1,
  };
}

function neutralSnapshot(): StockSnapshot {
  const prior = Array.from({ length: 20 }, (_, index) => {
    const body = index + 1;
    return bar(`2026-07-${String(index + 1).padStart(2, '0')}`, 100, 100 + body + 1, 100, 100 + body);
  });
  const target = bar('2026-08-10', 95, 115, 95, 105);

  return makeSnapshot([...prior, target]);
}

describe('explainable 17-pattern matcher', () => {
  it('uses the card catalog as the only MVP rule source and gives every card fifteen labeled cases', () => {
    const mvpCards = PATTERN_CARDS.filter((card) => card.matchSupport === 'mvp');

    expect(mvpCards).toHaveLength(17);
    expect(Object.keys(RULE_FAMILIES).sort()).toEqual(
      [...new Set(mvpCards.map((card) => card.matcher?.ruleFamilyId))].sort(),
    );
    expect(MVP_CASES).toHaveLength(255);

    for (const card of mvpCards) {
      const cases = MVP_CASES.filter((testCase) => testCase.cardId === card.id);
      expect(cases.filter((testCase) => testCase.kind === 'positive')).toHaveLength(5);
      expect(cases.filter((testCase) => testCase.kind === 'boundary')).toHaveLength(5);
      expect(cases.filter((testCase) => testCase.kind === 'negative')).toHaveLength(5);
      expect(cases.filter((testCase) => testCase.holdout).length).toBeGreaterThanOrEqual(5);

      const developmentHistories = new Set(cases
        .filter((testCase) => !testCase.holdout)
        .map((testCase) => JSON.stringify(testCase.snapshot.bars.slice(0, 25))));
      expect(cases
        .filter((testCase) => testCase.holdout)
        .every((testCase) => !developmentHistories.has(JSON.stringify(testCase.snapshot.bars.slice(0, 25)))))
        .toBe(true);
    }
  });

  it.each(MVP_CASES)('$cardId $caseId', ({ cardId, snapshot, expected }) => {
    expect(candidateFor(snapshot, cardId)).toBe(expected);
  });

  it('rounds scores to five, preserves unavailable optional weight as zero, and labels only 80-plus as highly matching', () => {
    const result = analyzePatterns(makeSnapshot([
      bar('2026-08-10', 100, 101, 99, 100.1),
    ]));

    expect(result.status).toBe('matched');
    if (result.status !== 'matched') {
      return;
    }

    const doji = result.matches.find((match) => match.cardId === 'doji');
    expect(doji).toMatchObject({
      score: 70,
      label: '部分符合',
      dataCompleteness: 70,
    });
  });

  it('sorts deterministic ties and returns only the first three candidates without padding', () => {
    const hammer = caseFor('hammer', 'positive');
    const candidates = evaluateAllMvpCardsForTesting(hammer.snapshot)
      .filter((evaluation) => evaluation.isCandidate);
    const result = analyzePatterns(hammer.snapshot);

    expect(result.status).toBe('matched');
    if (result.status !== 'matched') {
      return;
    }

    expect(result.matches.map((match) => match.cardId)).toEqual([
      'close-rejection-indecision',
      'hammer',
      'relative-long-body',
    ]);
    expect(result.matches).toHaveLength(Math.min(3, candidates.length));
  });

  it('suppresses price-continuity rules when a verified corporate action intersects their candidate window', () => {
    const piercing = caseFor('piercing-line', 'positive');
    const cutoff = piercing.snapshot.bars.at(-1)?.date;
    const result = analyzePatterns(makeSnapshot(piercing.snapshot.bars, [
      {
        date: cutoff ?? '2026-08-02',
        type: 'split',
        affectsPriceContinuity: true,
        sourceUrl: 'https://example.test/actions',
        verifiedAt: '2026-08-10T12:00:00+08:00',
      },
    ]));

    expect(resultFor(result, 'piercing-line')).toBe(false);
    expect(result.status).not.toBe('unavailable');
    if (result.status === 'unavailable') {
      return;
    }

    expect(result.context.unavailableCardIds).toContain('piercing-line');
    expect(result.context.suppressedRules).toContain('price-continuity-action-intersects-window');
    expect(result.context.corporateActions).toHaveLength(1);
  });

  it('keeps pure candle geometry evaluatable when an action only affects price continuity', () => {
    const hammer = caseFor('hammer', 'positive');
    const cutoff = hammer.snapshot.bars.at(-1)?.date;
    const result = analyzePatterns(makeSnapshot(hammer.snapshot.bars, [
      {
        date: cutoff ?? '2026-08-02',
        type: 'cash-dividend',
        affectsPriceContinuity: true,
        sourceUrl: 'https://example.test/actions',
        verifiedAt: '2026-08-10T12:00:00+08:00',
      },
    ]));

    expect(resultFor(result, 'hammer')).toBe(true);
    expect(result.status).not.toBe('unavailable');
    if (result.status === 'unavailable') {
      return;
    }

    expect(result.context.unavailableCardIds).not.toContain('hammer');
    expect(result.context.suppressedRules).toContain('price-continuity-action-intersects-window');
  });

  it('uses only completed daily bars for the latest analysis window', () => {
    const hammer = caseFor('hammer', 'positive');
    const completedTarget = hammer.snapshot.bars.at(-1);
    if (!completedTarget) {
      throw new Error('錘子形案例必須有目標 K 線。');
    }

    const result = analyzePatterns(makeSnapshot([
      ...hammer.snapshot.bars,
      {
        ...completedTarget,
        date: '2026-08-02',
        completed: false,
      },
    ]));

    expect(resultFor(result, 'hammer')).toBe(true);
    expect(result.status).not.toBe('unavailable');
    if (result.status !== 'unavailable') {
      expect(result.context.analyzedTo).toBe(completedTarget.date);
      expect(result.context.analyzedBarCount).toBe(hammer.snapshot.bars.length);
    }
  });

  it('does not emit a precision-sensitive match when source precision is missing', () => {
    const nearMarubozu = caseFor('near-marubozu', 'positive');
    const bars = nearMarubozu.snapshot.bars.map((item, index) => (
      index === nearMarubozu.snapshot.bars.length - 1
        ? { ...item, sourcePrecision: 0 }
        : item
    ));
    const result = analyzePatterns(makeSnapshot(bars));

    expect(resultFor(result, 'near-marubozu')).toBe(false);
    expect(result.status).not.toBe('unavailable');
    if (result.status === 'unavailable') {
      return;
    }

    expect(result.context.unavailableCardIds).toContain('near-marubozu');
    expect(result.context.reasonCodes).toContain('candidate-price-precision-unavailable');
  });

  it.each([
    'bullish-engulfing',
    'piercing-line',
    'morning-star',
  ] as const)('returns insufficient evidence when %s candidate bars lack source precision or comparison units', (cardId) => {
    const positive = caseFor(cardId, 'positive');
    const finalIndex = positive.snapshot.bars.length - 1;
    const missingSourcePrecision = positive.snapshot.bars.map((item, index) => (
      index === finalIndex ? { ...item, sourcePrecision: 0 } : item
    ));
    const missingComparisonUnit = positive.snapshot.bars.map((item, index) => (
      index === finalIndex ? { ...item, comparisonUnit: 0 } : item
    ));

    for (const bars of [missingSourcePrecision, missingComparisonUnit]) {
      const result = analyzePatterns(makeSnapshot(bars));
      expect(result.status).toBe('insufficient-evidence');
      if (result.status === 'insufficient-evidence') {
        expect(result.reasonCodes).toContain('candidate-price-precision-unavailable');
        expect(result.context.unavailableCardIds).toContain(cardId);
        expect(result.context.analyzedBarCount).toBe(positive.snapshot.bars.length);
        expect(result.context.analyzedFrom).toBe(positive.snapshot.bars[0]?.date);
        expect(result.context.analyzedTo).toBe(positive.snapshot.bars.at(-1)?.date);
      }
    }
  });

  it('does not reject a candidate because an unrelated earlier analysis bar lacks price precision', () => {
    const positive = caseFor('bullish-engulfing', 'positive');
    const result = analyzePatterns(makeSnapshot(positive.snapshot.bars.map((item, index) => (
      index === 0 ? { ...item, sourcePrecision: 0, comparisonUnit: 0 } : item
    ))));

    expect(resultFor(result, 'bullish-engulfing')).toBe(true);
  });

  it('keeps normal no-match, evidence gaps, and system-unavailable conditions distinct with analysis context', () => {
    const noClear = analyzePatterns(neutralSnapshot());
    expect(noClear.status).toBe('no-clear-pattern');
    if (noClear.status === 'no-clear-pattern') {
      expect(noClear.context.evaluatedCardCount).toBeGreaterThan(0);
      expect(noClear.context.timeframe).toBe('1d');
      expect(noClear.context.analyzedFrom).toBe('2026-07-01');
      expect(noClear.context.analyzedTo).toBe('2026-08-10');
    }

    const insufficient = analyzePatterns(makeSnapshot([
      {
        ...bar('2026-08-10', 100, 101, 99, 100),
        comparisonUnit: 0,
      },
    ]));
    expect(insufficient.status).toBe('insufficient-evidence');
    if (insufficient.status === 'insufficient-evidence') {
      expect(insufficient.reasonCodes).toContain('candidate-price-precision-unavailable');
      expect(insufficient.context.dataCompleteness).toBe(0);
    }

    const noCompletedBars = analyzePatterns(makeSnapshot([
      { ...bar('2026-08-10', 100, 101, 99, 100), completed: false },
    ]));
    expect(noCompletedBars.status).toBe('insufficient-evidence');
    if (noCompletedBars.status === 'insufficient-evidence') {
      expect(noCompletedBars.reasonCodes).toContain('no-completed-bars');
      expect(noCompletedBars.context.analyzedBarCount).toBe(0);
    }

    const noQuoteAfterLastLegalBar = analyzePatterns({
      ...makeSnapshot([bar('2026-08-10', 100, 101, 99, 100)]),
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-11',
        reason: 'official-no-quote',
        sourceUrl: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
      }],
    });
    expect(noQuoteAfterLastLegalBar.status).toBe('insufficient-evidence');
    if (noQuoteAfterLastLegalBar.status === 'insufficient-evidence') {
      expect(noQuoteAfterLastLegalBar.reasonCodes).toContain('official-no-quote');
      expect(noQuoteAfterLastLegalBar.context.analyzedBarCount).toBe(0);
    }

    const suspensionBreak = analyzePatterns({
      ...makeSnapshot([
        bar('2026-08-09', 100, 101, 99, 100),
        bar('2026-08-11', 100, 101, 99, 100),
      ]),
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-suspension',
        sourceUrl: 'https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB',
      }],
    });
    expect(suspensionBreak.status).not.toBe('unavailable');
    if (suspensionBreak.status !== 'unavailable') {
      expect(suspensionBreak.context.analyzedFrom).toBe('2026-08-11');
      expect(suspensionBreak.context.warnings).toContain('交易所公告停止買賣；型態比對不跨越停牌區間。');
    }

    const unsupported = analyzePatterns({
      ...neutralSnapshot(),
      securityType: 'ETF' as 'common-stock',
    });
    expect(unsupported).toMatchObject({
      status: 'unavailable',
      reason: 'unsupported-security',
    });

    const missingFields = analyzePatterns({} as StockSnapshot);
    expect(missingFields).toMatchObject({
      status: 'unavailable',
      reason: 'schema-error',
    });

    const missingSecurityType = analyzePatterns({
      ...neutralSnapshot(),
      securityType: null as unknown as 'common-stock',
    });
    expect(missingSecurityType).toMatchObject({
      status: 'unavailable',
      reason: 'schema-error',
    });

    const malformedActions = analyzePatterns({
      ...neutralSnapshot(),
      corporateActions: [null] as unknown as StockSnapshot['corporateActions'],
    });
    expect(malformedActions).toMatchObject({
      status: 'unavailable',
      reason: 'schema-error',
    });

    const malformedBars = analyzePatterns({
      ...neutralSnapshot(),
      bars: [null] as unknown as StockSnapshot['bars'],
    });
    expect(malformedBars).toMatchObject({
      status: 'unavailable',
      reason: 'schema-error',
    });

    const unsupportedMarket = analyzePatterns({
      ...neutralSnapshot(),
      market: 'OTHER' as StockSnapshot['market'],
    });
    expect(unsupportedMarket).toMatchObject({
      status: 'unavailable',
      reason: 'schema-error',
    });

    const malformedDate = analyzePatterns({
      ...neutralSnapshot(),
      bars: [{ ...bar('2026-08-10', 100, 101, 99, 100), date: 'not-a-date' }],
    });
    expect(malformedDate).toMatchObject({
      status: 'unavailable',
      reason: 'schema-error',
    });

    const missingSnapshot = analyzePatterns(null as unknown as StockSnapshot);
    expect(missingSnapshot).toMatchObject({
      status: 'unavailable',
      reason: 'schema-error',
    });
  });

  it('keeps generated teaching explanations within observable, non-predictive language', () => {
    const result = analyzePatterns(caseFor('bullish-engulfing', 'positive').snapshot);
    const rendered = JSON.stringify(result);

    expect(rendered).not.toMatch(/未來線|目標價|買進|賣出|方向機率|AI 信心|保證/);
  });
});
