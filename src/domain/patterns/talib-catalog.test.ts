import { describe, expect, it } from 'vitest';
import { getPatternCard } from './catalog';
import {
  getTalibBatchEntries,
  TALIB_BATCH_1_FUNCTIONS,
  TALIB_PATTERN_ENTRIES,
} from './talib-catalog';

describe('TA-Lib pattern catalog batch 1', () => {
  it('contains the official first sixteen functions exactly once', () => {
    expect(TALIB_BATCH_1_FUNCTIONS).toEqual([
      'CDL2CROWS',
      'CDL3BLACKCROWS',
      'CDL3INSIDE',
      'CDL3LINESTRIKE',
      'CDL3OUTSIDE',
      'CDL3STARSINSOUTH',
      'CDL3WHITESOLDIERS',
      'CDLABANDONEDBABY',
      'CDLADVANCEBLOCK',
      'CDLBELTHOLD',
      'CDLBREAKAWAY',
      'CDLCLOSINGMARUBOZU',
      'CDLCONCEALBABYSWALL',
      'CDLCOUNTERATTACK',
      'CDLDARKCLOUDCOVER',
      'CDLDOJI',
    ]);

    const entries = getTalibBatchEntries(1);
    expect(entries).toHaveLength(16);
    expect(entries.map((entry) => entry.functionName)).toEqual(TALIB_BATCH_1_FUNCTIONS);
    expect(new Set(entries.map((entry) => entry.functionName)).size).toBe(16);
    expect(TALIB_PATTERN_ENTRIES.filter((entry) => entry.batch === 1)).toEqual(entries);
  });

  it('maps every function to one complete canonical teaching card', () => {
    const reusedMvpCards = new Set([
      'three-falling-candles',
      'three-advancing-candles',
      'dark-cloud-cover',
      'doji',
    ]);

    for (const entry of getTalibBatchEntries(1)) {
      const card = getPatternCard(entry.cardId);

      expect(entry.card).toBe(card);
      expect(card.talibFunction).toBe(entry.functionName);
      expect(card.talibImplementationSupport).toBe('teaching-only');
      expect(card.talibObservableDefinition?.length).toBeGreaterThan(0);
      expect(card.talibDataRequirements?.length).toBeGreaterThan(0);
      expect(card.collections).toContain('talib-advanced');
      expect(card.automationSupport).toBe(
        reusedMvpCards.has(card.id) ? 'short-window' : 'teaching-only',
      );
      expect(card.minimumBars).toBeGreaterThan(0);
      expect(card.maximumBars).toBeGreaterThanOrEqual(card.minimumBars!);
      expect(card.patternDirection).not.toBeUndefined();
      expect(card.patternPurpose).not.toBeUndefined();
      expect(card.geometrySteps?.length).toBeGreaterThan(0);
      expect(card.relatedPatternIds?.length).toBeGreaterThan(0);
      expect(card.confirmationGuidance?.length).toBeGreaterThan(0);
      expect(card.sourceNotes.some((source) => source.includes('TA-Lib'))).toBe(true);
      expect(new Set(card.sourceNotes).size).toBe(card.sourceNotes.length);
    }
  });

  it('keeps official semantics for reviewed boundary cases', () => {
    expect(getPatternCard('talib-three-line-strike').patternPurpose).toBe('continuation');
    expect(getPatternCard('talib-breakaway').talibObservableDefinition).toContain(
      '第三根高低點都比第二根沿原方向推進',
    );
    expect(getPatternCard('talib-three-stars-in-the-south').talibObservableDefinition).toContain(
      '開盤位於第一根高低範圍內且高於第一根收盤',
    );
    expect(getPatternCard('talib-three-stars-in-the-south').talibObservableDefinition).toContain(
      '盤中低點跌破第一根收盤、但不破第一根低點並留下下影',
    );
    expect(getPatternCard('talib-abandoned-baby').talibObservableDefinition).toContain(
      '實體大於 BodyShort 平均',
    );
    expect(getPatternCard('doji').talibObservableDefinition).toContain('BodyDoji');
    expect(getPatternCard('dark-cloud-cover').talibObservableDefinition).toContain(
      '開盤高於第一根最高價',
    );
    expect(getPatternCard('three-falling-candles').talibDataRequirements).toContain(
      '前三黑鴉之前一根 K，加上三根目標完成 K',
    );
  });

  it('reuses existing canonical cards for overlapping functions', () => {
    const overlaps = new Map([
      ['CDL3BLACKCROWS', 'three-falling-candles'],
      ['CDL3WHITESOLDIERS', 'three-advancing-candles'],
      ['CDLDARKCLOUDCOVER', 'dark-cloud-cover'],
      ['CDLDOJI', 'doji'],
    ]);

    for (const [functionName, cardId] of overlaps) {
      const entry = getTalibBatchEntries(1).find((candidate) => candidate.functionName === functionName);
      expect(entry?.card).toBe(getPatternCard(cardId as never));
    }
  });
});
