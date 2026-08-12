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

/** 進階館的函式到正規卡片投影；card 永遠是 catalog 裡的同一個物件。 */
export interface TalibPatternEntry {
  batch: 1 | 2 | 3 | 4;
  functionName: TalibPatternFunction;
  cardId: PatternCardId;
  card: PatternCardDefinition;
}

export const TALIB_PATTERN_ENTRIES: readonly TalibPatternEntry[] = TALIB_BATCH_1_FUNCTIONS.map(
  (functionName) => {
    const cardId = BATCH_1_CARD_BY_FUNCTION[functionName];
    return {
      batch: 1,
      functionName,
      cardId,
      card: getPatternCard(cardId),
    };
  },
);

/** 依交付批次取得穩定排序的進階型態館投影。 */
export function getTalibBatchEntries(batch: TalibPatternEntry['batch']): readonly TalibPatternEntry[] {
  return TALIB_PATTERN_ENTRIES.filter((entry) => entry.batch === batch);
}
