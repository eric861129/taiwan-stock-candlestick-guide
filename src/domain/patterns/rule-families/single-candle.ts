import type { RuleEvaluation } from '../../market-data/types';
import { quantile, type CandlestickFeatures, type CandleFeatures } from '../features';
import type { PatternRuleBinding } from '../types';

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

function target(features: CandlestickFeatures): CandleFeatures | undefined {
  return features.candles[features.targetIndex];
}

function hasUsableRange(feature: CandleFeatures | undefined): feature is CandleFeatures & { range: number } {
  return feature?.range !== null && feature?.range !== undefined && feature.range > 0;
}

function hasComparisonUnit(feature: CandleFeatures | undefined): feature is CandleFeatures & { comparisonUnit: number } {
  return feature?.comparisonUnit !== null && feature?.comparisonUnit !== undefined && feature.comparisonUnit > 0;
}

function hasPositionAndVolume(features: CandlestickFeatures): boolean {
  return (
    features.distanceToPrior20HighInAtr !== null
    && features.distanceToPrior20LowInAtr !== null
    && features.relativeVolumeToMedian20 !== null
  );
}

function comparisonTolerance(unit: number | null): number {
  return Math.max(Number.EPSILON * 128, (unit ?? 0) * 1e-9);
}

function atLeast(value: number, threshold: number, unit: number | null): boolean {
  return value >= threshold - comparisonTolerance(unit);
}

function atMost(value: number, threshold: number, unit: number | null): boolean {
  return value <= threshold + comparisonTolerance(unit);
}

function unavailable(binding: PatternRuleBinding, reasonCode: string): RuleEvaluation {
  return evaluate(binding, 'unavailable', `資料不足，無法核對「${binding.teachingLabel}」。`, reasonCode);
}

function evidenceWindow(features: CandlestickFeatures): readonly CandleFeatures[] {
  const comparisonStart = Math.max(0, features.analysisStartIndex - 20);
  return features.candles.slice(comparisonStart, features.targetIndex + 1);
}

function evaluateUniversalInvalidation(
  features: CandlestickFeatures,
  binding: PatternRuleBinding,
): RuleEvaluation | undefined {
  if (binding.group !== 'invalidating') {
    return undefined;
  }

  const evidence = evidenceWindow(features);
  if (evidence.some((feature) => feature.unavailableReasonCodes.includes('incomplete-bar'))) {
    return evaluate(binding, 'met', '候選或比較資料含未完成 K 線，這張卡不參與計分。', 'incomplete-bar');
  }

  if (evidence.some((feature) => feature.unavailableReasonCodes.includes('invalid-ohlcv'))) {
    return evaluate(binding, 'met', '候選或比較資料的 OHLCV 關係無效，這張卡不參與計分。', 'invalid-ohlcv');
  }

  return undefined;
}

function evaluateStructureContext(
  features: CandlestickFeatures,
  binding: PatternRuleBinding,
): RuleEvaluation {
  const expected = binding.parameters.expected;

  if (features.priorStructure === 'unavailable') {
    return unavailable(binding, 'prior-structure-unavailable');
  }

  if (expected === 'recorded') {
    return evaluate(binding, 'met', `已保留可核對的前段結構：${features.priorStructure}。`);
  }

  if (features.priorStructure === expected) {
    return evaluate(binding, 'met', `前段結構為 ${features.priorStructure}，符合此卡的背景條件。`);
  }

  return evaluate(binding, 'not-met', `前段結構為 ${features.priorStructure}，未符合此卡設定的背景條件。`);
}

function evaluateRecordedContext(
  features: CandlestickFeatures,
  binding: PatternRuleBinding,
): RuleEvaluation {
  const ruleId = binding.ruleId;
  const needsStructure = ruleId.includes('location') || ruleId.includes('structure') || ruleId.includes('zone');
  const needsPosition = ruleId.includes('location') || ruleId.includes('position') || ruleId.includes('zone') || ruleId.includes('price-space');
  const needsVolume = ruleId.includes('volume');
  const structureAvailable = !needsStructure || features.priorStructure !== 'unavailable';
  const positionAvailable = !needsPosition || (
    features.distanceToPrior20HighInAtr !== null && features.distanceToPrior20LowInAtr !== null
  );
  const volumeAvailable = !needsVolume || features.relativeVolumeToMedian20 !== null;

  if (structureAvailable && positionAvailable && volumeAvailable) {
    return evaluate(binding, 'met', `已保留「${binding.teachingLabel}」所需的背景資料。`);
  }

  return unavailable(binding, 'optional-context-unavailable');
}

/** 評估所有規則族共用的背景、輔助與失效綁定。 */
export function evaluateSharedBinding(
  features: CandlestickFeatures,
  binding: PatternRuleBinding,
): RuleEvaluation | undefined {
  const feature = target(features);
  const universalInvalidation = evaluateUniversalInvalidation(features, binding);
  if (universalInvalidation) {
    return universalInvalidation;
  }

  switch (binding.ruleId) {
    case 'same-window-context':
      return features.comparisonWindow.bodySizes.length === Number(binding.parameters.comparisonWindow ?? 20)
        ? evaluate(binding, 'met', '比較窗只包含目標 K 之前的二十根完成 K 線。')
        : unavailable(binding, 'prior-body-window-unavailable');
    case 'prior-structure-falling':
    case 'prior-structure-rising':
    case 'prior-structure-recorded':
      return evaluateStructureContext(features, binding);
    case 'follow-up-not-assumed':
    case 'descriptor-language-limited':
      return evaluate(binding, 'met', '判讀只使用分析截止日及以前資料，說明維持在可觀察條件。');
    case 'relative-window-unavailable':
    case 'harami-window-unavailable':
      return features.comparisonWindow.bodySizes.length < Number(binding.parameters.minimumPriorBodies ?? 20)
        ? evaluate(binding, 'met', '相對實體比較窗不足，這張卡不參與計分。', 'prior-body-window-unavailable')
        : evaluate(binding, 'not-met', '相對實體比較窗完整。');
    case 'invalid-single-candle-data':
    case 'range-or-unit-unavailable': {
      const invalid = !hasUsableRange(feature) || !hasComparisonUnit(feature) || feature?.unavailableReasonCodes.includes('incomplete-bar');
      return invalid
        ? evaluate(binding, 'met', '範圍、比較單位或完成狀態不足，這張卡不參與計分。', 'single-candle-data-unavailable')
        : evaluate(binding, 'not-met', '單根 K 線的範圍、比較單位與完成狀態可用。');
    }
    case 'comparison-unit-unavailable':
    case 'right-edge-or-unit-unavailable': {
      const invalid = !hasComparisonUnit(feature) || feature?.unavailableReasonCodes.includes('incomplete-bar');
      return invalid
        ? evaluate(binding, 'met', '比較單位或完成狀態不足，這張卡不參與計分。', 'comparison-unit-unavailable')
        : evaluate(binding, 'not-met', '比較單位與完成狀態可用。');
    }
    case 'incomplete-or-imprecise-bar': {
      const invalid = !hasComparisonUnit(feature) || feature?.unavailableReasonCodes.includes('incomplete-bar');
      return invalid
        ? evaluate(binding, 'met', '比較單位或完成狀態不足，這張卡不參與計分。', 'comparison-unit-unavailable')
        : evaluate(binding, 'not-met', 'K 線已完成且比較單位可追溯。');
    }
    case 'mixed-price-mode-or-incomplete-window': {
      const invalid = features.candles.slice(features.analysisStartIndex).some((item) => item.unavailableReasonCodes.includes('incomplete-bar'));
      return invalid
        ? evaluate(binding, 'met', '候選窗含未完成 K 線，這張卡不參與計分。', 'incomplete-bar')
        : evaluate(binding, 'not-met', '候選窗的 K 線皆已完成。');
    }
    case 'price-continuity-action-intersects-window':
    case 'star-window-action-or-comparison-unavailable': {
      const priceAction = features.intersectingCorporateActions.some((action) => action.affectsPriceContinuity);
      const bodyWindowMissing = binding.ruleId === 'star-window-action-or-comparison-unavailable'
        && features.comparisonWindow.bodySizes.length < Number(binding.parameters.minimumPriorBodies ?? 20);
      if (priceAction) {
        return evaluate(binding, 'met', '公司行動影響候選窗的價格連續性，這張卡不參與計分。', 'price-continuity-action-intersects-window');
      }
      if (bodyWindowMissing) {
        return evaluate(binding, 'met', '相對實體比較窗不足，這張卡不參與計分。', 'prior-body-window-unavailable');
      }
      return evaluate(binding, 'not-met', '候選窗沒有影響價格連續性的公司行動。');
    }
    case 'position-and-volume-recorded':
    case 'support-zone-or-volume-context':
    case 'resistance-zone-or-volume-context':
    case 'zone-or-volume-context':
    case 'position-and-confirmation-context':
    case 'zone-volume-and-confirmation-context':
    case 'separation-zone-and-volume-context':
    case 'volume-and-price-space-context':
    case 'location-context-recorded':
    case 'relative-body-context-recorded':
    case 'volume-and-gap-context-recorded':
      return hasPositionAndVolume(features) || binding.ruleId === 'location-context-recorded'
        ? evaluateRecordedContext(features, binding)
        : unavailable(binding, 'optional-context-unavailable');
    default:
      return undefined;
  }
}

/** 評估單根與描述型卡片的幾何規則。 */
export function evaluateSingleCandleBinding(
  features: CandlestickFeatures,
  binding: PatternRuleBinding,
): RuleEvaluation {
  const shared = evaluateSharedBinding(features, binding);
  if (shared) {
    return shared;
  }

  const feature = target(features);
  if (!feature) {
    return unavailable(binding, 'missing-target-bar');
  }

  switch (binding.ruleId) {
    case 'relative-body-upper-quartile': {
      const threshold = quantile(features.comparisonWindow.bodySizes, Number(binding.parameters.percentile ?? 0.75));
      if (feature.bodySize === null || threshold === null) {
        return unavailable(binding, 'prior-body-window-unavailable');
      }
      return atLeast(feature.bodySize, threshold, feature.comparisonUnit)
        ? evaluate(binding, 'met', `目標實體 ${feature.bodySize} 位於比較窗上四分位 ${threshold} 以上。`)
        : evaluate(binding, 'not-met', `目標實體 ${feature.bodySize} 未達比較窗上四分位 ${threshold}。`);
    }
    case 'relative-body-lower-quartile': {
      const threshold = quantile(features.comparisonWindow.bodySizes, Number(binding.parameters.percentile ?? 0.25));
      if (feature.bodySize === null || threshold === null) {
        return unavailable(binding, 'prior-body-window-unavailable');
      }
      return atMost(feature.bodySize, threshold, feature.comparisonUnit)
        ? evaluate(binding, 'met', `目標實體 ${feature.bodySize} 位於比較窗下四分位 ${threshold} 以下。`)
        : evaluate(binding, 'not-met', `目標實體 ${feature.bodySize} 超過比較窗下四分位 ${threshold}。`);
    }
    case 'open-close-within-comparison-unit': {
      const maximumUnits = Number(binding.parameters.maximumUnits ?? 1);
      if (feature.bodySize === null || !hasComparisonUnit(feature)) {
        return unavailable(binding, 'comparison-unit-unavailable');
      }
      const threshold = feature.comparisonUnit * maximumUnits;
      return atMost(feature.bodySize, threshold, feature.comparisonUnit)
        ? evaluate(binding, 'met', `開收差 ${feature.bodySize} 不超過 ${maximumUnits} 個比較單位。`)
        : evaluate(binding, 'not-met', `開收差 ${feature.bodySize} 超過 ${maximumUnits} 個比較單位。`);
    }
    case 'hammer-wick-geometry': {
      if (!hasUsableRange(feature) || !hasComparisonUnit(feature) || feature.bodyLow === null || feature.lowerWick === null || feature.upperWick === null || feature.effectiveBodySize === null) {
        return unavailable(binding, 'single-candle-data-unavailable');
      }
      const bar = features.bars[features.targetIndex];
      if (!bar) {
        return unavailable(binding, 'missing-target-bar');
      }
      const bodyPosition = Number(binding.parameters.bodyLowMinimumRange ?? 2 / 3);
      const wickMultiple = Number(binding.parameters.lowerWickBodyMultiple ?? 2);
      const maximumUpperUnits = Number(binding.parameters.upperWickMaximumUnits ?? 1);
      const met = atLeast(feature.bodyLow, bar.low + feature.range * bodyPosition, feature.comparisonUnit)
        && atLeast(feature.lowerWick, feature.effectiveBodySize * wickMultiple, feature.comparisonUnit)
        && atMost(feature.upperWick, feature.comparisonUnit * maximumUpperUnits, feature.comparisonUnit);
      return met
        ? evaluate(binding, 'met', '實體位置、下影與上影都符合錘子形的固定幾何條件。')
        : evaluate(binding, 'not-met', '實體位置、下影或上影未同時符合錘子形的固定幾何條件。');
    }
    case 'shooting-star-wick-geometry': {
      if (!hasUsableRange(feature) || !hasComparisonUnit(feature) || feature.bodyHigh === null || feature.lowerWick === null || feature.upperWick === null || feature.effectiveBodySize === null) {
        return unavailable(binding, 'single-candle-data-unavailable');
      }
      const bar = features.bars[features.targetIndex];
      if (!bar) {
        return unavailable(binding, 'missing-target-bar');
      }
      const bodyPosition = Number(binding.parameters.bodyHighMaximumRange ?? 1 / 3);
      const wickMultiple = Number(binding.parameters.upperWickBodyMultiple ?? 2);
      const maximumLowerUnits = Number(binding.parameters.lowerWickMaximumUnits ?? 1);
      const met = atMost(feature.bodyHigh, bar.low + feature.range * bodyPosition, feature.comparisonUnit)
        && atLeast(feature.upperWick, feature.effectiveBodySize * wickMultiple, feature.comparisonUnit)
        && atMost(feature.lowerWick, feature.comparisonUnit * maximumLowerUnits, feature.comparisonUnit);
      return met
        ? evaluate(binding, 'met', '實體位置、上影與下影都符合射擊之星形的固定幾何條件。')
        : evaluate(binding, 'not-met', '實體位置、上影或下影未同時符合射擊之星形的固定幾何條件。');
    }
    case 'both-wicks-within-comparison-unit': {
      const maximumUnits = Number(binding.parameters.maximumUnits ?? 1);
      if (!hasComparisonUnit(feature) || feature.upperWick === null || feature.lowerWick === null) {
        return unavailable(binding, 'comparison-unit-unavailable');
      }
      const threshold = feature.comparisonUnit * maximumUnits;
      return atMost(feature.upperWick, threshold, feature.comparisonUnit) && atMost(feature.lowerWick, threshold, feature.comparisonUnit)
        ? evaluate(binding, 'met', '上下影線都在設定的比較單位容忍內。')
        : evaluate(binding, 'not-met', '至少一側影線超出設定的比較單位容忍。');
    }
    case 'close-location-or-wick-descriptor': {
      if (!hasUsableRange(feature) || !hasComparisonUnit(feature) || feature.closeLocation === null || feature.upperWick === null || feature.lowerWick === null || feature.effectiveBodySize === null || feature.bodySize === null) {
        return unavailable(binding, 'single-candle-data-unavailable');
      }
      const low = Number(binding.parameters.closeLocationLow ?? 1 / 3);
      const high = Number(binding.parameters.closeLocationHigh ?? 2 / 3);
      const wickMultiple = Number(binding.parameters.wickBodyMultiple ?? 2);
      const met = feature.closeLocation <= low
        || feature.closeLocation >= high
        || feature.upperWick >= feature.effectiveBodySize * wickMultiple
        || feature.lowerWick >= feature.effectiveBodySize * wickMultiple
        || feature.bodySize <= feature.comparisonUnit;
      return met
        ? evaluate(binding, 'met', '收盤位置、影線或小實體符合至少一項描述門檻。')
        : evaluate(binding, 'not-met', '收盤位置、影線與實體都未達描述門檻。');
    }
    default:
      return unavailable(binding, 'unknown-rule-id');
  }
}
