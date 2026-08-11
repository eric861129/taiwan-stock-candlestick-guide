import type { RuleEvaluation } from '../market-data/types';
import type { CandlestickFeatures } from './features';
import { evaluateMultiCandleBinding } from './rule-families/multi-candle';
import { evaluateSingleCandleBinding } from './rule-families/single-candle';
import type { PatternRuleBinding, RuleFamilyId } from './types';

/** 可由型態卡版本化綁定呼叫的規則族。 */
export interface RuleFamilyDefinition {
  id: RuleFamilyId;
  version: number;
  evaluate(features: Readonly<CandlestickFeatures>, binding: Readonly<PatternRuleBinding>): RuleEvaluation;
}

function singleFamily(id: Extract<RuleFamilyId, 'relative-body-size' | 'doji' | 'single-candle-wick-geometry' | 'near-marubozu' | 'candle-descriptors'>): RuleFamilyDefinition {
  return {
    id,
    version: 1,
    evaluate: evaluateSingleCandleBinding,
  };
}

function multiFamily(id: Exclude<RuleFamilyId, 'relative-body-size' | 'doji' | 'single-candle-wick-geometry' | 'near-marubozu' | 'candle-descriptors'>): RuleFamilyDefinition {
  return {
    id,
    version: 1,
    evaluate: evaluateMultiCandleBinding,
  };
}

/** 17 張 MVP 卡共享的十個規則族。 */
export const RULE_FAMILIES: Readonly<Record<RuleFamilyId, RuleFamilyDefinition>> = {
  'relative-body-size': singleFamily('relative-body-size'),
  doji: singleFamily('doji'),
  'single-candle-wick-geometry': singleFamily('single-candle-wick-geometry'),
  'near-marubozu': singleFamily('near-marubozu'),
  'candle-descriptors': singleFamily('candle-descriptors'),
  'engulfing-body': multiFamily('engulfing-body'),
  'harami-body': multiFamily('harami-body'),
  'midpoint-penetration': multiFamily('midpoint-penetration'),
  'three-candle-star': multiFamily('three-candle-star'),
  'three-candle-sequence': multiFamily('three-candle-sequence'),
};
