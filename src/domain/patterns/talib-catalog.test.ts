import { describe, expect, it } from 'vitest';
import { getPatternCard } from './catalog';
import {
  getTalibBatchEntries,
  TALIB_BATCH_1_FUNCTIONS,
  TALIB_BATCH_2_FUNCTIONS,
  TALIB_BATCH_3_FUNCTIONS,
  TALIB_BATCH_4_FUNCTIONS,
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

  it('keeps reviewed batch-two implementation edge cases explicit', () => {
    expect(getPatternCard('talib-hikkake').patternPurpose).toBe('reversal-or-continuation');
    expect(getPatternCard('talib-hikkake').talibObservableDefinition).toContain(
      '官方先輸出新 ±100',
    );
    expect(getPatternCard('talib-modified-hikkake').talibObservableDefinition).toContain(
      '官方先輸出新 ±100',
    );
    expect(getPatternCard('talib-gap-side-by-side-white-lines').talibObservableDefinition).toContain(
      '收盤不低於開盤，包含開收相等',
    );
  });
});

describe('TA-Lib pattern catalog batch 3', () => {
  it('contains the official third fifteen functions exactly once', () => {
    expect(TALIB_BATCH_3_FUNCTIONS).toEqual([
      'CDLIDENTICAL3CROWS',
      'CDLINNECK',
      'CDLINVERTEDHAMMER',
      'CDLKICKING',
      'CDLKICKINGBYLENGTH',
      'CDLLADDERBOTTOM',
      'CDLLONGLEGGEDDOJI',
      'CDLLONGLINE',
      'CDLMARUBOZU',
      'CDLMATCHINGLOW',
      'CDLMATHOLD',
      'CDLMORNINGDOJISTAR',
      'CDLMORNINGSTAR',
      'CDLONNECK',
      'CDLPIERCING',
    ]);

    const entries = getTalibBatchEntries(3);
    expect(entries).toHaveLength(15);
    expect(entries.map((entry) => entry.functionName)).toEqual(TALIB_BATCH_3_FUNCTIONS);
    expect(new Set(entries.map((entry) => entry.functionName)).size).toBe(15);
  });

  it('maps every third-batch function to complete canonical teaching content', () => {
    for (const entry of getTalibBatchEntries(3)) {
      const card = getPatternCard(entry.cardId);
      expect(entry.card).toBe(card);
      expect(card.talibFunction).toBe(entry.functionName);
      expect(card.talibImplementationSupport).toBe('teaching-only');
      expect(card.collections).toContain('talib-advanced');
      expect(card.minimumBars).toBeGreaterThan(0);
      expect(card.maximumBars).toBeGreaterThanOrEqual(card.minimumBars!);
      expect(card.patternDirection).not.toBeUndefined();
      expect(card.patternPurpose).not.toBeUndefined();
      expect(card.geometrySteps?.length).toBeGreaterThan(0);
      expect(card.relatedPatternIds?.length).toBeGreaterThan(0);
      expect(card.confirmationGuidance?.length).toBeGreaterThan(0);
      expect(card.talibObservableDefinition?.length).toBeGreaterThan(0);
      expect(card.talibDataRequirements?.length).toBeGreaterThan(0);
      expect(new Set(card.sourceNotes).size).toBe(card.sourceNotes.length);
    }
  });

  it('reuses the canonical morning-star and piercing-line cards', () => {
    expect(getTalibBatchEntries(3).find((entry) => entry.functionName === 'CDLMORNINGSTAR')?.card)
      .toBe(getPatternCard('morning-star'));
    expect(getTalibBatchEntries(3).find((entry) => entry.functionName === 'CDLPIERCING')?.card)
      .toBe(getPatternCard('piercing-line'));
  });

  it('keeps reviewed batch-three lookbacks and Mat Hold boundaries explicit', () => {
    expect(getPatternCard('talib-identical-three-crows').talibDataRequirements).toContain(
      'ShadowVeryShort、Equal；官方預設 lookback 12 根',
    );
    expect(getPatternCard('talib-ladder-bottom').talibDataRequirements).toContain(
      'ShadowVeryShort；官方預設 lookback 14 根',
    );
    expect(getPatternCard('talib-matching-low').talibDataRequirements).toContain(
      'Equal；官方預設 lookback 6 根',
    );
    expect(getPatternCard('talib-mat-hold').talibObservableDefinition).toContain(
      '第二、三、四根皆為 BodyShort',
    );
    expect(getPatternCard('talib-mat-hold').talibObservableDefinition).toContain(
      '收盤高於第二、三、四根最高價',
    );
  });
});

describe('TA-Lib pattern catalog batch 2', () => {
  it('contains the official second fifteen functions exactly once', () => {
    expect(TALIB_BATCH_2_FUNCTIONS).toEqual([
      'CDLDOJISTAR',
      'CDLDRAGONFLYDOJI',
      'CDLENGULFING',
      'CDLEVENINGDOJISTAR',
      'CDLEVENINGSTAR',
      'CDLGAPSIDESIDEWHITE',
      'CDLGRAVESTONEDOJI',
      'CDLHAMMER',
      'CDLHANGINGMAN',
      'CDLHARAMI',
      'CDLHARAMICROSS',
      'CDLHIGHWAVE',
      'CDLHIKKAKE',
      'CDLHIKKAKEMOD',
      'CDLHOMINGPIGEON',
    ]);

    const entries = getTalibBatchEntries(2);
    expect(entries).toHaveLength(15);
    expect(entries.map((entry) => entry.functionName)).toEqual(TALIB_BATCH_2_FUNCTIONS);
    expect(new Set(entries.map((entry) => entry.functionName)).size).toBe(15);
  });

  it('maps every function to complete canonical teaching content', () => {
    for (const entry of getTalibBatchEntries(2)) {
      const card = getPatternCard(entry.cardId);
      expect(entry.card).toBe(card);
      expect(card.talibFunction).toBe(entry.functionName);
      expect(card.talibImplementationSupport).toBe('teaching-only');
      expect(card.collections).toContain('talib-advanced');
      expect(card.minimumBars).toBeGreaterThan(0);
      expect(card.maximumBars).toBeGreaterThanOrEqual(card.minimumBars!);
      expect(card.patternDirection).not.toBeUndefined();
      expect(card.patternPurpose).not.toBeUndefined();
      expect(card.geometrySteps?.length).toBeGreaterThan(0);
      expect(card.relatedPatternIds?.length).toBeGreaterThan(0);
      expect(card.confirmationGuidance?.length).toBeGreaterThan(0);
      expect(card.talibObservableDefinition?.length).toBeGreaterThan(0);
      expect(card.talibDataRequirements?.length).toBeGreaterThan(0);
      expect(new Set(card.sourceNotes).size).toBe(card.sourceNotes.length);
    }
  });

  it('reuses existing canonical cards for overlapping functions', () => {
    const overlaps = new Map([
      ['CDLENGULFING', 'bullish-engulfing'],
      ['CDLEVENINGSTAR', 'evening-star'],
      ['CDLHAMMER', 'hammer'],
      ['CDLHARAMI', 'bullish-harami'],
    ]);

    for (const [functionName, cardId] of overlaps) {
      const entry = getTalibBatchEntries(2).find((candidate) => candidate.functionName === functionName);
      expect(entry?.card).toBe(getPatternCard(cardId as never));
    }
  });
});

describe('TA-Lib pattern catalog batch 4 and complete official inventory', () => {
  it('contains the official final fifteen functions exactly once', () => {
    expect(TALIB_BATCH_4_FUNCTIONS).toEqual([
      'CDLRICKSHAWMAN',
      'CDLRISEFALL3METHODS',
      'CDLSEPARATINGLINES',
      'CDLSHOOTINGSTAR',
      'CDLSHORTLINE',
      'CDLSPINNINGTOP',
      'CDLSTALLEDPATTERN',
      'CDLSTICKSANDWICH',
      'CDLTAKURI',
      'CDLTASUKIGAP',
      'CDLTHRUSTING',
      'CDLTRISTAR',
      'CDLUNIQUE3RIVER',
      'CDLUPSIDEGAP2CROWS',
      'CDLXSIDEGAP3METHODS',
    ]);
    expect(getTalibBatchEntries(4).map((entry) => entry.functionName)).toEqual(
      TALIB_BATCH_4_FUNCTIONS,
    );
  });

  it('ships exactly 61 official functions without duplicates', () => {
    expect(TALIB_PATTERN_ENTRIES).toHaveLength(61);
    expect(new Set(TALIB_PATTERN_ENTRIES.map((entry) => entry.functionName)).size).toBe(61);
  });

  it('maps every final-batch function to complete canonical teaching content', () => {
    for (const entry of getTalibBatchEntries(4)) {
      const card = getPatternCard(entry.cardId);
      expect(entry.card).toBe(card);
      expect(card.talibFunction).toBe(entry.functionName);
      expect(card.talibImplementationSupport).toBe('teaching-only');
      expect(card.collections).toContain('talib-advanced');
      expect(card.minimumBars).toBeGreaterThan(0);
      expect(card.maximumBars).toBeGreaterThanOrEqual(card.minimumBars!);
      expect(card.patternDirection).not.toBeUndefined();
      expect(card.patternPurpose).not.toBeUndefined();
      expect(card.geometrySteps?.length).toBeGreaterThan(0);
      expect(card.relatedPatternIds?.length).toBeGreaterThan(0);
      expect(card.confirmationGuidance?.length).toBeGreaterThan(0);
      expect(card.talibObservableDefinition?.length).toBeGreaterThan(0);
      expect(card.talibDataRequirements?.length).toBeGreaterThan(0);
      expect(new Set(card.sourceNotes).size).toBe(card.sourceNotes.length);
    }
  });

  it('reuses the canonical shooting-star card', () => {
    expect(getTalibBatchEntries(4).find((entry) => entry.functionName === 'CDLSHOOTINGSTAR')?.card)
      .toBe(getPatternCard('shooting-star'));
  });

  it('does not add a first-candle color requirement to Tasuki Gap', () => {
    const card = getPatternCard('talib-tasuki-gap');
    expect(card.talibObservableDefinition).toContain('第一根顏色不限');
    expect(card.talibObservableDefinition).toContain(
      '向上缺口時第二根為上漲、第三根為下跌，向下缺口時第二根為下跌、第三根為上漲',
    );
    expect(card.geometrySteps).toContain(
      '第一根顏色不限；第二根順缺口方向形成嚴格實體 gap。',
    );
    expect(card.geometrySteps).toContain(
      '第三根與第二根反色，開在第二根實體內。',
    );
  });
});
