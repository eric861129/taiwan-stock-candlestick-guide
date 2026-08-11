import type { RuleEvaluation } from '../../market-data/types';
import { quantile, type CandlestickFeatures, type CandleFeatures } from '../features';
import {
  booleanParameter,
  numberParameter,
  stringParameter,
} from '../rule-parameters';
import type { PatternRuleBinding } from '../types';
import { evaluateSharedBinding } from './single-candle';

function evaluate(
  binding: PatternRuleBinding,
  state: RuleEvaluation['state'],
  explanation: string,
  reasonCode?: string,
): RuleEvaluation {
  return {
    ruleId: binding.ruleId,
    label: binding.teachingLabel,
    group: binding.group,
    state,
    weight: binding.weight,
    explanation,
    ...(reasonCode ? { reasonCode } : {}),
  };
}

function unavailable(binding: PatternRuleBinding, reasonCode: string): RuleEvaluation {
  return evaluate(binding, 'unavailable', `資料不足，無法核對「${binding.teachingLabel}」。`, reasonCode);
}

function windowFeatures(features: CandlestickFeatures, expected: number): readonly CandleFeatures[] | undefined {
  const window = features.candles.slice(features.analysisStartIndex, features.targetIndex + 1);
  return window.length === expected ? window : undefined;
}

function windowBars(features: CandlestickFeatures, expected: number) {
  const window = features.bars.slice(features.analysisStartIndex, features.targetIndex + 1);
  return window.length === expected ? window : undefined;
}

function validBody(feature: CandleFeatures | undefined): feature is CandleFeatures & {
  bodyLow: number;
  bodyHigh: number;
  bodySize: number;
} {
  return feature?.bodyLow !== null
    && feature?.bodyLow !== undefined
    && feature.bodyHigh !== null
    && feature.bodyHigh !== undefined
    && feature.bodySize !== null
    && feature.bodySize !== undefined;
}

function isBullish(bar: { open: number; close: number }): boolean {
  return bar.close > bar.open;
}

function isBearish(bar: { open: number; close: number }): boolean {
  return bar.close < bar.open;
}

function insideOrNear(
  value: number,
  lower: number,
  upper: number,
  tolerance: number,
): boolean {
  return value >= lower - tolerance && value <= upper + tolerance;
}

function matchesGapConvention(
  previous: { open: number; high: number; low: number; close: number },
  current: { open: number; close: number },
  direction: 'bullish' | 'bearish',
  convention: unknown,
): boolean {
  if (direction === 'bullish' && convention === 'below-prior-low-or-close') {
    return current.open < previous.low || current.open < previous.close;
  }

  if (direction === 'bearish' && convention === 'above-prior-high-or-close') {
    return current.open > previous.high || current.open > previous.close;
  }

  return false;
}

function hasPriceContinuityAction(features: CandlestickFeatures): boolean {
  return features.intersectingCorporateActions.some((action) => action.affectsPriceContinuity);
}

/** 評估雙根與三根組合卡片的必要幾何規則。 */
export function evaluateMultiCandleBinding(
  features: CandlestickFeatures,
  binding: PatternRuleBinding,
): RuleEvaluation {
  const shared = evaluateSharedBinding(features, binding);
  if (shared) {
    return shared;
  }

  switch (binding.ruleId) {
    case 'bullish-opposite-body-engulfing':
    case 'bearish-opposite-body-engulfing': {
      const bars = windowBars(features, 2);
      const candles = windowFeatures(features, 2);
      if (!bars || !candles || !validBody(candles[0]) || !validBody(candles[1])) {
        return unavailable(binding, 'two-candle-window-unavailable');
      }
      const [previousBar, currentBar] = bars;
      const [previous, current] = candles;
      if (!previousBar || !currentBar || !previous || !current || previous.bodySize === 0 || current.bodySize === 0) {
        return unavailable(binding, 'nonzero-body-unavailable');
      }
      const direction = stringParameter(binding, 'direction');
      if (!direction) {
        return unavailable(binding, 'invalid-binding-parameters');
      }
      const bullish = direction === 'bullish';
      const directionMatches = bullish
        ? isBearish(previousBar) && isBullish(currentBar)
        : isBullish(previousBar) && isBearish(currentBar);
      const contains = current.bodyLow <= previous.bodyLow && current.bodyHigh >= previous.bodyHigh;
      return directionMatches && contains
        ? evaluate(binding, 'met', '兩根相反方向的非零實體符合完整包含關係。')
        : evaluate(binding, 'not-met', '兩根實體的方向或完整包含關係未同時成立。');
    }
    case 'bullish-long-parent-contained-child':
    case 'bearish-long-parent-contained-child': {
      const bars = windowBars(features, 2);
      const candles = windowFeatures(features, 2);
      const comparisonWindowSize = numberParameter(binding, 'comparisonWindow');
      const parentPercentile = numberParameter(binding, 'parentPercentile');
      if (comparisonWindowSize === undefined || parentPercentile === undefined) {
        return unavailable(binding, 'invalid-binding-parameters');
      }
      const threshold = quantile(features.comparisonWindow.bodySizes, parentPercentile);
      if (!bars || !candles || !validBody(candles[0]) || !validBody(candles[1]) || features.comparisonWindow.bodySizes.length !== comparisonWindowSize || threshold === null) {
        return unavailable(binding, 'harami-comparison-window-unavailable');
      }
      const [parentBar, childBar] = bars;
      const [parent, child] = candles;
      if (!parentBar || !childBar || !parent || !child) {
        return unavailable(binding, 'two-candle-window-unavailable');
      }
      const direction = stringParameter(binding, 'direction');
      if (!direction) {
        return unavailable(binding, 'invalid-binding-parameters');
      }
      const bullish = direction === 'bullish';
      const parentDirection = bullish ? isBearish(parentBar) : isBullish(parentBar);
      const childDirection = bullish ? isBullish(childBar) : isBearish(childBar);
      const childSmall = child.bodySize <= (child.comparisonUnit ?? 0);
      const childInside = child.bodyLow >= parent.bodyLow && child.bodyHigh <= parent.bodyHigh;
      const met = parentDirection && parent.bodySize >= threshold && childInside && (childDirection || childSmall);
      return met
        ? evaluate(binding, 'met', '相對長母實體與子實體的方向、長度與內包關係都成立。')
        : evaluate(binding, 'not-met', '母實體的方向或長度，或子實體的方向與內包關係未同時成立。');
    }
    case 'bullish-midpoint-penetration':
    case 'bearish-midpoint-penetration': {
      if (hasPriceContinuityAction(features)) {
        return unavailable(binding, 'price-continuity-action-intersects-window');
      }
      const bars = windowBars(features, 2);
      if (!bars) {
        return unavailable(binding, 'two-candle-window-unavailable');
      }
      const [previous, current] = bars;
      if (!previous || !current) {
        return unavailable(binding, 'two-candle-window-unavailable');
      }
      const configuredDirection = stringParameter(binding, 'direction');
      const requiresMidpoint = booleanParameter(binding, 'requiresMidpoint');
      const gapConvention = stringParameter(binding, 'gapConvention');
      if (
        (configuredDirection !== 'bullish' && configuredDirection !== 'bearish')
        || requiresMidpoint === undefined
        || !gapConvention
      ) {
        return unavailable(binding, 'invalid-binding-parameters');
      }
      const midpoint = (previous.open + previous.close) / 2;
      const bullish = configuredDirection === 'bullish';
      const direction: 'bullish' | 'bearish' = configuredDirection;
      const directionMatches = bullish
        ? isBearish(previous) && isBullish(current)
        : isBullish(previous) && isBearish(current);
      const crossesMidpoint = !requiresMidpoint || (
        bullish
          ? current.close > midpoint && current.close < previous.open
          : current.close < midpoint && current.close > previous.open
      );
      const met = directionMatches
        && matchesGapConvention(previous, current, direction, gapConvention)
        && crossesMidpoint;
      return met
        ? evaluate(binding, 'met', '前根方向、固定缺口慣例與實體中點穿越條件都成立。')
        : evaluate(binding, 'not-met', '前根方向、固定缺口慣例或實體中點穿越條件未同時成立。');
    }
    case 'bullish-three-candle-star-midpoint':
    case 'bearish-three-candle-star-midpoint': {
      const bars = windowBars(features, 3);
      const candles = windowFeatures(features, 3);
      const comparisonWindowSize = numberParameter(binding, 'comparisonWindow');
      const parentPercentile = numberParameter(binding, 'parentPercentile');
      const requiresMidpoint = booleanParameter(binding, 'requiresMidpoint');
      if (comparisonWindowSize === undefined || parentPercentile === undefined || requiresMidpoint === undefined) {
        return unavailable(binding, 'invalid-binding-parameters');
      }
      const threshold = quantile(features.comparisonWindow.bodySizes, parentPercentile);
      if (!bars || !candles || !validBody(candles[0]) || !validBody(candles[1]) || features.comparisonWindow.bodySizes.length !== comparisonWindowSize || threshold === null) {
        return unavailable(binding, 'star-comparison-window-unavailable');
      }
      const [firstBar, secondBar, thirdBar] = bars;
      const [first, second] = candles;
      if (!firstBar || !secondBar || !thirdBar || !first || !second) {
        return unavailable(binding, 'three-candle-window-unavailable');
      }
      const direction = stringParameter(binding, 'direction');
      if (!direction) {
        return unavailable(binding, 'invalid-binding-parameters');
      }
      const bullish = direction === 'bullish';
      const firstDirection = bullish ? isBearish(firstBar) : isBullish(firstBar);
      const thirdDirection = bullish ? isBullish(thirdBar) : isBearish(thirdBar);
      const secondSmall = second.bodySize <= (second.comparisonUnit ?? 0) || (
        features.comparisonWindow.bodyLowerQuartile !== null && second.bodySize <= features.comparisonWindow.bodyLowerQuartile
      );
      const midpoint = (firstBar.open + firstBar.close) / 2;
      const crossesMidpoint = !requiresMidpoint || (bullish ? thirdBar.close > midpoint : thirdBar.close < midpoint);
      const met = firstDirection && first.bodySize >= threshold && secondSmall && thirdDirection && crossesMidpoint;
      return met
        ? evaluate(binding, 'met', '第一根相對長實體、第二根小實體與第三根中點穿越條件都成立。')
        : evaluate(binding, 'not-met', '三根的方向、第一根相對長、第二根小實體或中點穿越條件未同時成立。');
    }
    case 'three-bullish-directional-sequence':
    case 'three-bearish-directional-sequence': {
      const bars = windowBars(features, 3);
      const candles = windowFeatures(features, 3);
      if (!bars || !candles || !validBody(candles[0]) || !validBody(candles[1]) || !validBody(candles[2])) {
        return unavailable(binding, 'three-candle-window-unavailable');
      }
      const [firstBar, secondBar, thirdBar] = bars;
      const [first, second] = candles;
      if (!firstBar || !secondBar || !thirdBar || !first || !second) {
        return unavailable(binding, 'three-candle-window-unavailable');
      }
      const unit = Math.max(candles[0].comparisonUnit ?? 0, candles[1].comparisonUnit ?? 0, candles[2].comparisonUnit ?? 0);
      if (unit <= 0) {
        return unavailable(binding, 'comparison-unit-unavailable');
      }
      const direction = stringParameter(binding, 'direction');
      const maximumOpenGapUnits = numberParameter(binding, 'maximumOpenGapUnits');
      if (!direction || maximumOpenGapUnits === undefined) {
        return unavailable(binding, 'invalid-binding-parameters');
      }
      const bullish = direction === 'bullish';
      const directional = bullish
        ? isBullish(firstBar) && isBullish(secondBar) && isBullish(thirdBar)
          && firstBar.close < secondBar.close && secondBar.close < thirdBar.close
        : isBearish(firstBar) && isBearish(secondBar) && isBearish(thirdBar)
          && firstBar.close > secondBar.close && secondBar.close > thirdBar.close;
      const openTolerance = unit * maximumOpenGapUnits;
      const opensNearBodies = insideOrNear(secondBar.open, first.bodyLow, first.bodyHigh, openTolerance)
        && insideOrNear(thirdBar.open, second.bodyLow, second.bodyHigh, openTolerance);
      return directional && opensNearBodies
        ? evaluate(binding, 'met', '三根非零實體同方向、收盤順序與開盤容忍關係都成立。')
        : evaluate(binding, 'not-met', '三根方向、收盤順序或開盤容忍關係未同時成立。');
    }
    default:
      return unavailable(binding, 'unknown-rule-id');
  }
}
