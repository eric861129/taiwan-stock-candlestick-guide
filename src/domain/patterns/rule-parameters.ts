import type { PatternRuleBinding } from './types';

type Parameters = PatternRuleBinding['parameters'];

function positiveInteger(parameters: Parameters, key: string): boolean {
  const value = parameters[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonNegativeNumber(parameters: Parameters, key: string): boolean {
  const value = parameters[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function unitIntervalNumber(parameters: Parameters, key: string): boolean {
  const value = parameters[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function booleanValue(parameters: Parameters, key: string, expected: boolean): boolean {
  return parameters[key] === expected;
}

function stringValue(parameters: Parameters, key: string, expected: string): boolean {
  return parameters[key] === expected;
}

function longParentParameters(parameters: Parameters, direction: 'bullish' | 'bearish'): boolean {
  return (
    unitIntervalNumber(parameters, 'parentPercentile')
    && positiveInteger(parameters, 'comparisonWindow')
    && stringValue(parameters, 'direction', direction)
    && booleanValue(parameters, 'bodyOnly', true)
  );
}

function starParameters(parameters: Parameters, direction: 'bullish' | 'bearish'): boolean {
  return (
    unitIntervalNumber(parameters, 'parentPercentile')
    && positiveInteger(parameters, 'comparisonWindow')
    && stringValue(parameters, 'direction', direction)
    && booleanValue(parameters, 'requiresMidpoint', true)
  );
}

/**
 * 只驗證清冊 binding 已明示的必要鍵、型別與合理範圍，不提供任何門檻預設值。
 * 數值本身仍只由 PatternCardDefinition 的 parameters 提供。
 */
export function hasValidRuleBindingParameters(binding: Readonly<PatternRuleBinding>): boolean {
  const parameters = binding.parameters;

  switch (binding.ruleId) {
    case 'relative-body-upper-quartile':
    case 'relative-body-lower-quartile':
      return (
        positiveInteger(parameters, 'comparisonWindow')
        && unitIntervalNumber(parameters, 'percentile')
        && booleanValue(parameters, 'targetExcluded', true)
      );
    case 'same-window-context':
      return positiveInteger(parameters, 'comparisonWindow') && booleanValue(parameters, 'targetExcluded', true);
    case 'position-and-volume-recorded':
      return stringValue(parameters, 'requiredFields', 'position-volume');
    case 'relative-window-unavailable':
    case 'harami-window-unavailable':
      return positiveInteger(parameters, 'minimumPriorBodies');
    case 'open-close-within-comparison-unit':
    case 'both-wicks-within-comparison-unit':
      return nonNegativeNumber(parameters, 'maximumUnits');
    case 'location-context-recorded':
      return booleanValue(parameters, 'needsLocation', true);
    case 'follow-up-not-assumed':
      return booleanValue(parameters, 'noLookAhead', true);
    case 'incomplete-or-imprecise-bar':
    case 'comparison-unit-unavailable':
    case 'right-edge-or-unit-unavailable':
      return booleanValue(parameters, 'requiresComparisonUnit', true);
    case 'hammer-wick-geometry':
      return (
        unitIntervalNumber(parameters, 'bodyLowMinimumRange')
        && nonNegativeNumber(parameters, 'lowerWickBodyMultiple')
        && nonNegativeNumber(parameters, 'upperWickMaximumUnits')
      );
    case 'shooting-star-wick-geometry':
      return (
        unitIntervalNumber(parameters, 'bodyHighMaximumRange')
        && nonNegativeNumber(parameters, 'upperWickBodyMultiple')
        && nonNegativeNumber(parameters, 'lowerWickMaximumUnits')
      );
    case 'prior-structure-falling':
      return stringValue(parameters, 'expected', 'falling');
    case 'prior-structure-rising':
      return stringValue(parameters, 'expected', 'rising');
    case 'prior-structure-recorded':
      return stringValue(parameters, 'expected', 'recorded');
    case 'support-zone-or-volume-context':
      return stringValue(parameters, 'needs', 'support-volume');
    case 'resistance-zone-or-volume-context':
      return stringValue(parameters, 'needs', 'resistance-volume');
    case 'relative-body-context-recorded':
      return stringValue(parameters, 'needs', 'relative-body-position');
    case 'volume-and-gap-context-recorded':
      return stringValue(parameters, 'needs', 'volume-gap');
    case 'zone-or-volume-context':
      return stringValue(parameters, 'needs', 'zone-volume');
    case 'position-and-confirmation-context':
      return stringValue(parameters, 'needs', 'position-confirmation');
    case 'zone-volume-and-confirmation-context':
      return stringValue(parameters, 'needs', 'zone-volume-confirmation');
    case 'separation-zone-and-volume-context':
      return stringValue(parameters, 'needs', 'separation-zone-volume');
    case 'volume-and-price-space-context':
      return stringValue(parameters, 'needs', 'volume-price-space');
    case 'invalid-single-candle-data':
    case 'range-or-unit-unavailable':
      return (
        booleanValue(parameters, 'requiresRange', true)
        && booleanValue(parameters, 'requiresComparisonUnit', true)
      );
    case 'close-location-or-wick-descriptor': {
      const lower = numberParameter(binding, 'closeLocationLow');
      const upper = numberParameter(binding, 'closeLocationHigh');
      return (
        unitIntervalNumber(parameters, 'closeLocationLow')
        && unitIntervalNumber(parameters, 'closeLocationHigh')
        && lower !== undefined
        && upper !== undefined
        && lower <= upper
        && nonNegativeNumber(parameters, 'wickBodyMultiple')
      );
    }
    case 'descriptor-language-limited':
      return booleanValue(parameters, 'descriptiveOnly', true);
    case 'bullish-opposite-body-engulfing':
      return stringValue(parameters, 'direction', 'bullish') && booleanValue(parameters, 'bodyOnly', true);
    case 'bearish-opposite-body-engulfing':
      return stringValue(parameters, 'direction', 'bearish') && booleanValue(parameters, 'bodyOnly', true);
    case 'mixed-price-mode-or-incomplete-window':
      return booleanValue(parameters, 'requiresRawPriceMode', true);
    case 'bullish-long-parent-contained-child':
      return longParentParameters(parameters, 'bullish');
    case 'bearish-long-parent-contained-child':
      return longParentParameters(parameters, 'bearish');
    case 'bullish-midpoint-penetration':
      return (
        stringValue(parameters, 'direction', 'bullish')
        && booleanValue(parameters, 'requiresMidpoint', true)
        && stringValue(parameters, 'gapConvention', 'below-prior-low-or-close')
      );
    case 'bearish-midpoint-penetration':
      return (
        stringValue(parameters, 'direction', 'bearish')
        && booleanValue(parameters, 'requiresMidpoint', true)
        && stringValue(parameters, 'gapConvention', 'above-prior-high-or-close')
      );
    case 'price-continuity-action-intersects-window':
      return booleanValue(parameters, 'requiresPriceContinuity', true);
    case 'bullish-three-candle-star-midpoint':
      return starParameters(parameters, 'bullish');
    case 'bearish-three-candle-star-midpoint':
      return starParameters(parameters, 'bearish');
    case 'star-window-action-or-comparison-unavailable':
      return (
        booleanValue(parameters, 'requiresPriceContinuity', true)
        && positiveInteger(parameters, 'minimumPriorBodies')
      );
    case 'three-bullish-directional-sequence':
      return (
        stringValue(parameters, 'direction', 'bullish')
        && nonNegativeNumber(parameters, 'maximumOpenGapUnits')
        && booleanValue(parameters, 'requiresIncreasingCloses', true)
      );
    case 'three-bearish-directional-sequence':
      return (
        stringValue(parameters, 'direction', 'bearish')
        && nonNegativeNumber(parameters, 'maximumOpenGapUnits')
        && booleanValue(parameters, 'requiresDecreasingCloses', true)
      );
    default:
      return false;
  }
}

/** 讀取由清冊明示的有限數值；不存在或不是有限數值時不提供替代值。 */
export function numberParameter(binding: Readonly<PatternRuleBinding>, key: string): number | undefined {
  const value = binding.parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 讀取由清冊明示的文字參數；不存在時不提供替代值。 */
export function stringParameter(binding: Readonly<PatternRuleBinding>, key: string): string | undefined {
  const value = binding.parameters[key];
  return typeof value === 'string' ? value : undefined;
}

/** 讀取由清冊明示的布林參數；不存在時不提供替代值。 */
export function booleanParameter(binding: Readonly<PatternRuleBinding>, key: string): boolean | undefined {
  const value = binding.parameters[key];
  return typeof value === 'boolean' ? value : undefined;
}
