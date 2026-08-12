import { describe, expect, it } from 'vitest';
import {
  getPatternCard,
  getPatternCardsByCollection,
  PATTERN_CARDS,
  PATTERN_COLLECTIONS,
} from './catalog';
import { PATTERN_ILLUSTRATIONS } from './illustrations';
import { hasValidRuleBindingParameters } from './rule-parameters';
import type { PatternCardId } from './types';

const CANONICAL_IDS = [
  'relative-long-body',
  'relative-small-body',
  'doji',
  'hammer',
  'shooting-star',
  'near-marubozu',
  'close-rejection-indecision',
  'bullish-engulfing',
  'bearish-engulfing',
  'bullish-harami',
  'bearish-harami',
  'piercing-line',
  'dark-cloud-cover',
  'morning-star',
  'evening-star',
  'three-advancing-candles',
  'three-falling-candles',
  'talib-two-crows',
  'talib-three-inside',
  'talib-three-line-strike',
  'talib-three-outside',
  'talib-three-stars-in-the-south',
  'talib-abandoned-baby',
  'talib-advance-block',
  'talib-belt-hold',
  'talib-breakaway',
  'talib-closing-marubozu',
  'talib-concealing-baby-swallow',
  'talib-counterattack',
  'talib-doji-star',
  'talib-dragonfly-doji',
  'talib-evening-doji-star',
  'talib-gap-side-by-side-white-lines',
  'talib-gravestone-doji',
  'talib-hanging-man',
  'talib-harami-cross',
  'talib-high-wave',
  'talib-hikkake',
  'talib-modified-hikkake',
  'talib-homing-pigeon',
  'talib-identical-three-crows',
  'talib-in-neck',
  'talib-inverted-hammer',
  'talib-kicking',
  'talib-kicking-by-length',
  'talib-ladder-bottom',
  'talib-long-legged-doji',
  'talib-long-line',
  'talib-marubozu',
  'talib-matching-low',
  'talib-mat-hold',
  'talib-morning-doji-star',
  'talib-on-neck',
  'talib-rickshaw-man',
  'talib-rise-fall-three-methods',
  'talib-separating-lines',
  'talib-short-line',
  'talib-spinning-top',
  'talib-stalled-pattern',
  'talib-stick-sandwich',
  'talib-takuri',
  'talib-tasuki-gap',
  'talib-thrusting',
  'talib-tristar',
  'talib-unique-three-river',
  'talib-upside-gap-two-crows',
  'talib-x-side-gap-three-methods',
  'range',
  'triangle-consolidation',
  'flag-consolidation',
  'double-top',
  'double-bottom',
  'head-and-shoulders-top',
  'head-and-shoulders-bottom',
  'false-breakout',
  'rounding-top',
  'rounding-bottom',
  'triple-top',
  'triple-bottom',
  'symmetrical-triangle',
  'ascending-triangle',
  'descending-triangle',
  'bullish-rectangle',
  'bearish-rectangle',
  'pennant',
  'rising-wedge',
  'falling-wedge',
  'broadening-top',
  'broadening-bottom',
  'volume-expansion',
  'volume-contraction',
  'effort-vs-result',
  'volume-climax-risk',
  'low-liquidity-distortion',
  'failed-signal',
  'insufficient-evidence',
] as const satisfies readonly PatternCardId[];

const ADDITIONAL_STRUCTURE_IDS = [
  'rounding-top',
  'rounding-bottom',
  'triple-top',
  'triple-bottom',
  'symmetrical-triangle',
  'ascending-triangle',
  'descending-triangle',
  'bullish-rectangle',
  'bearish-rectangle',
  'pennant',
  'rising-wedge',
  'falling-wedge',
  'broadening-top',
  'broadening-bottom',
] as const satisfies readonly PatternCardId[];

const MVP_IDS = [
  'relative-long-body',
  'relative-small-body',
  'doji',
  'hammer',
  'shooting-star',
  'near-marubozu',
  'close-rejection-indecision',
  'bullish-engulfing',
  'bearish-engulfing',
  'bullish-harami',
  'bearish-harami',
  'piercing-line',
  'dark-cloud-cover',
  'morning-star',
  'evening-star',
  'three-advancing-candles',
  'three-falling-candles',
] as const satisfies readonly PatternCardId[];

describe('canonical Pattern Card catalog', () => {
  it('contains the 96 approved IDs exactly once and 17 MVP matcher cards', () => {
    expect(PATTERN_CARDS).toHaveLength(96);
    expect(PATTERN_CARDS.map((card) => card.id)).toEqual(CANONICAL_IDS);
    expect(new Set(PATTERN_CARDS.map((card) => card.id)).size).toBe(96);
    expect(PATTERN_CARDS.filter((card) => card.matchSupport === 'mvp').map((card) => card.id)).toEqual(
      MVP_IDS,
    );
  });

  it('keeps every card traceable and safe to teach without a directional promise', () => {
    for (const card of PATTERN_CARDS) {
      expect(card.nameZhTw).not.toHaveLength(0);
      expect(card.category).not.toHaveLength(0);
      expect(card.sourceRow).not.toHaveLength(0);
      expect(card.sourceNotes.length).toBeGreaterThan(0);
      expect(card.observableDefinition).not.toHaveLength(0);
      expect(card.oneSentenceMeaning).not.toHaveLength(0);
      expect(card.background.length).toBeGreaterThan(0);
      expect(card.invalidationGuidance.length).toBeGreaterThan(0);
      expect(card.limitations.length).toBeGreaterThan(0);
      expect(card.lessonLinks.length).toBeGreaterThan(0);
      expect(`${card.oneSentenceMeaning} ${card.observableDefinition}`).not.toMatch(
        /預測|買進|賣出|機率|必漲|必跌|保證/,
      );
    }
  });

  it('keeps matcher metadata complete and score groups calibrated only for MVP cards', () => {
    const mvpCards = PATTERN_CARDS.filter((card) => card.matchSupport === 'mvp');
    const nonMvpCards = PATTERN_CARDS.filter((card) => card.matchSupport !== 'mvp');

    expect(mvpCards).toHaveLength(17);
    expect(nonMvpCards.every((card) => card.matcher === undefined)).toBe(true);

    for (const card of mvpCards) {
      const matcher = card.matcher;
      expect(matcher).toBeDefined();
      expect(matcher?.ruleFamilyId).not.toHaveLength(0);
      expect(matcher?.minimumBars).toBeGreaterThanOrEqual(1);
      expect(matcher?.minimumScore).toBeGreaterThanOrEqual(60);
      expect(matcher?.minimumScore).toBeLessThanOrEqual(75);
      expect(new Set(matcher?.rules.map((rule) => rule.ruleId)).size).toBe(matcher?.rules.length);
      expect(
        matcher?.rules
          .filter((rule) => rule.group === 'required')
          .reduce((total, rule) => total + rule.weight, 0),
      ).toBe(50);
      expect(
        matcher?.rules
          .filter((rule) => rule.group === 'context')
          .reduce((total, rule) => total + rule.weight, 0),
      ).toBe(30);
      expect(
        matcher?.rules
          .filter((rule) => rule.group === 'supporting')
          .reduce((total, rule) => total + rule.weight, 0),
      ).toBe(20);
      expect(
        matcher?.rules
          .filter((rule) => rule.group === 'invalidating')
          .every((rule) => rule.weight === 0),
      ).toBe(true);
      expect(matcher?.rules.every((rule) => hasValidRuleBindingParameters(rule))).toBe(true);
    }
  });

  it('labels unsupported structural cards as catalog-only and evidence protections as guardrails', () => {
    expect(PATTERN_CARDS.filter((card) => card.category === '結構型態').every((card) => card.matchSupport === 'catalog-only')).toBe(true);

    const guardrailCards = PATTERN_CARDS.filter((card) => card.matchSupport === 'guardrail');
    expect(guardrailCards.map((card) => card.id)).toEqual([
      'low-liquidity-distortion',
      'failed-signal',
      'insufficient-evidence',
    ]);
    expect(guardrailCards.every((card) => card.guardrail?.whyNotInMvp.length)).toBeTruthy();
  });

  it('gives every canonical card an accessible illustration made from structural primitives', () => {
    expect(Object.keys(PATTERN_ILLUSTRATIONS)).toEqual(CANONICAL_IDS);

    for (const card of PATTERN_CARDS) {
      const illustration = PATTERN_ILLUSTRATIONS[card.id];
      expect(illustration.title).not.toHaveLength(0);
      expect(illustration.altTextZhTw).not.toHaveLength(0);
      expect(illustration.primitives.length).toBeGreaterThan(0);
      expect(illustration.primitives.some((primitive) => primitive.kind !== 'annotation')).toBe(true);
    }
  });

  it('looks up a canonical card and rejects an unknown ID', () => {
    expect(getPatternCard('hammer')).toMatchObject({ id: 'hammer', nameZhTw: '錘子形' });
    expect(() => getPatternCard('not-a-pattern' as PatternCardId)).toThrow('找不到型態卡');
  });

  it('projects the same canonical cards into three stable gallery collections', () => {
    expect(PATTERN_COLLECTIONS.map((collection) => collection.id)).toEqual([
      'candlestick-reference',
      'price-structure',
      'talib-advanced',
    ]);

    const candlestickCards = getPatternCardsByCollection('candlestick-reference');
    const structureCards = getPatternCardsByCollection('price-structure');
    const talibCards = getPatternCardsByCollection('talib-advanced');

    expect(candlestickCards.map((card) => card.id)).toContain('hammer');
    expect(structureCards.map((card) => card.id)).toContain('range');
    expect(talibCards.map((card) => card.id)).toContain('hammer');
    expect(talibCards.find((card) => card.id === 'hammer')).toBe(getPatternCard('hammer'));
    expect(PATTERN_CARDS.every((card) => card.collections.length > 0)).toBe(true);
  });

  it('keeps pattern kind and automation support explicit without changing legacy matcher support', () => {
    expect(getPatternCard('hammer')).toMatchObject({
      kind: 'candlestick-pattern',
      automationSupport: 'short-window',
      matchSupport: 'mvp',
      talibFunction: 'CDLHAMMER',
    });
    expect(getPatternCard('range')).toMatchObject({
      kind: 'chart-pattern',
      automationSupport: 'teaching-only',
      matchSupport: 'catalog-only',
    });
    expect(getPatternCard('volume-expansion')).toMatchObject({
      kind: 'market-observation',
      automationSupport: 'teaching-only',
    });
    expect(getPatternCard('insufficient-evidence')).toMatchObject({
      kind: 'guardrail',
      automationSupport: 'guardrail',
    });
  });

  it('ships every additional price structure as a complete teaching card', () => {
    const cards = ADDITIONAL_STRUCTURE_IDS.map(getPatternCard);

    expect(cards.every((card) => card.collections.includes('price-structure'))).toBe(true);
    expect(cards.every((card) => card.kind === 'chart-pattern')).toBe(true);
    expect(cards.every((card) => card.automationSupport === 'teaching-only')).toBe(true);
    expect(cards.every((card) => card.matchSupport === 'catalog-only')).toBe(true);

    for (const card of cards) {
      expect(card.background.length).toBeGreaterThan(0);
      expect(card.confirmationGuidance?.length).toBeGreaterThan(0);
      expect(card.invalidationGuidance.length).toBeGreaterThan(0);
      expect(card.commonMisreads.length).toBeGreaterThan(0);
      expect(card.limitations.length).toBeGreaterThan(0);
      expect(card.sourceNotes.length).toBeGreaterThan(0);
      expect(PATTERN_ILLUSTRATIONS[card.id].altTextZhTw).not.toHaveLength(0);
      expect(PATTERN_ILLUSTRATIONS[card.id].primitives.length).toBeGreaterThan(2);
    }
  });
});
