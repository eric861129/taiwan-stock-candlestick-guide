import { getPatternCard } from './catalog';
import type {
  PatternCardDefinition,
  PatternCardId,
  TalibPatternFunction,
} from './types';

/** 依 TA-Lib 官方 Pattern Recognition 清單順序切出的第一批 16 個函式。 */
export const TALIB_BATCH_1_FUNCTIONS = [
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
] as const satisfies readonly TalibPatternFunction[];

const BATCH_1_CARD_BY_FUNCTION = {
  CDL2CROWS: 'talib-two-crows',
  CDL3BLACKCROWS: 'three-falling-candles',
  CDL3INSIDE: 'talib-three-inside',
  CDL3LINESTRIKE: 'talib-three-line-strike',
  CDL3OUTSIDE: 'talib-three-outside',
  CDL3STARSINSOUTH: 'talib-three-stars-in-the-south',
  CDL3WHITESOLDIERS: 'three-advancing-candles',
  CDLABANDONEDBABY: 'talib-abandoned-baby',
  CDLADVANCEBLOCK: 'talib-advance-block',
  CDLBELTHOLD: 'talib-belt-hold',
  CDLBREAKAWAY: 'talib-breakaway',
  CDLCLOSINGMARUBOZU: 'talib-closing-marubozu',
  CDLCONCEALBABYSWALL: 'talib-concealing-baby-swallow',
  CDLCOUNTERATTACK: 'talib-counterattack',
  CDLDARKCLOUDCOVER: 'dark-cloud-cover',
  CDLDOJI: 'doji',
} as const satisfies Record<(typeof TALIB_BATCH_1_FUNCTIONS)[number], PatternCardId>;

/** 依官方順序接續的第二批 15 個函式。 */
export const TALIB_BATCH_2_FUNCTIONS = [
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
] as const satisfies readonly TalibPatternFunction[];

const BATCH_2_CARD_BY_FUNCTION = {
  CDLDOJISTAR: 'talib-doji-star',
  CDLDRAGONFLYDOJI: 'talib-dragonfly-doji',
  CDLENGULFING: 'bullish-engulfing',
  CDLEVENINGDOJISTAR: 'talib-evening-doji-star',
  CDLEVENINGSTAR: 'evening-star',
  CDLGAPSIDESIDEWHITE: 'talib-gap-side-by-side-white-lines',
  CDLGRAVESTONEDOJI: 'talib-gravestone-doji',
  CDLHAMMER: 'hammer',
  CDLHANGINGMAN: 'talib-hanging-man',
  CDLHARAMI: 'bullish-harami',
  CDLHARAMICROSS: 'talib-harami-cross',
  CDLHIGHWAVE: 'talib-high-wave',
  CDLHIKKAKE: 'talib-hikkake',
  CDLHIKKAKEMOD: 'talib-modified-hikkake',
  CDLHOMINGPIGEON: 'talib-homing-pigeon',
} as const satisfies Record<(typeof TALIB_BATCH_2_FUNCTIONS)[number], PatternCardId>;

export const TALIB_BATCH_3_FUNCTIONS = [
  'CDLIDENTICAL3CROWS', 'CDLINNECK', 'CDLINVERTEDHAMMER', 'CDLKICKING',
  'CDLKICKINGBYLENGTH', 'CDLLADDERBOTTOM', 'CDLLONGLEGGEDDOJI', 'CDLLONGLINE',
  'CDLMARUBOZU', 'CDLMATCHINGLOW', 'CDLMATHOLD', 'CDLMORNINGDOJISTAR',
  'CDLMORNINGSTAR', 'CDLONNECK', 'CDLPIERCING',
] as const satisfies readonly TalibPatternFunction[];

const BATCH_3_CARD_BY_FUNCTION = {
  CDLIDENTICAL3CROWS: 'talib-identical-three-crows',
  CDLINNECK: 'talib-in-neck',
  CDLINVERTEDHAMMER: 'talib-inverted-hammer',
  CDLKICKING: 'talib-kicking',
  CDLKICKINGBYLENGTH: 'talib-kicking-by-length',
  CDLLADDERBOTTOM: 'talib-ladder-bottom',
  CDLLONGLEGGEDDOJI: 'talib-long-legged-doji',
  CDLLONGLINE: 'talib-long-line',
  CDLMARUBOZU: 'talib-marubozu',
  CDLMATCHINGLOW: 'talib-matching-low',
  CDLMATHOLD: 'talib-mat-hold',
  CDLMORNINGDOJISTAR: 'talib-morning-doji-star',
  CDLMORNINGSTAR: 'morning-star',
  CDLONNECK: 'talib-on-neck',
  CDLPIERCING: 'piercing-line',
} as const satisfies Record<(typeof TALIB_BATCH_3_FUNCTIONS)[number], PatternCardId>;

/** 進階館的函式到正規卡片投影；card 永遠是 catalog 裡的同一個物件。 */
export interface TalibPatternEntry {
  batch: 1 | 2 | 3 | 4;
  functionName: TalibPatternFunction;
  cardId: PatternCardId;
  card: PatternCardDefinition;
}

function createEntries<const TFunction extends TalibPatternFunction>(
  batch: TalibPatternEntry['batch'],
  functions: readonly TFunction[],
  cardByFunction: Readonly<Record<TFunction, PatternCardId>>,
): readonly TalibPatternEntry[] {
  return functions.map((functionName) => {
    const cardId = cardByFunction[functionName];
    return {
      batch,
      functionName,
      cardId,
      card: getPatternCard(cardId),
    };
  });
}

export const TALIB_PATTERN_ENTRIES: readonly TalibPatternEntry[] = [
  ...createEntries(1, TALIB_BATCH_1_FUNCTIONS, BATCH_1_CARD_BY_FUNCTION),
  ...createEntries(2, TALIB_BATCH_2_FUNCTIONS, BATCH_2_CARD_BY_FUNCTION),
  ...createEntries(3, TALIB_BATCH_3_FUNCTIONS, BATCH_3_CARD_BY_FUNCTION),
];

/** 依交付批次取得穩定排序的進階型態館投影。 */
export function getTalibBatchEntries(batch: TalibPatternEntry['batch']): readonly TalibPatternEntry[] {
  return TALIB_PATTERN_ENTRIES.filter((entry) => entry.batch === batch);
}
