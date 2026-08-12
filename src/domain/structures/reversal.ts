import type { OhlcvBar } from '../market-data/types';
import type {
  StructureBoundary,
  StructureDirection,
  StructureOverlaySegment,
  StructurePivot,
  StructureRuleEvaluation,
  StructureStatus,
  StructureWindow,
} from './types';

/** 反轉價格結構卡的穩定識別碼。 */
export type ReversalStructureId =
  | 'double-top'
  | 'double-bottom'
  | 'head-and-shoulders-top'
  | 'head-and-shoulders-bottom';

/** 反轉結構 matcher 的固定、版本化門檻。 */
export interface ReversalStructureConfig {
  version: 'reversal-structure-v1';
  minimumRuleFit: number;
  minimumBars: number;
  minimumPivotSeparationBars: number;
  maximumPivotSeparationBars: number;
  maximumLevelDifferenceAtr: number;
  minimumDoubleDepthAtr: number;
  breakoutAtr: number;
  invalidationAtr: number;
  minimumHeadClearanceAtr: number;
  maximumShoulderDifferenceAtr: number;
  maximumSpacingRatio: number;
  maximumNecklineSlopeAtrPerBar: number;
}

/** 反轉結構的預設門檻集中於此，畫面與教學文字不得另行改寫。 */
export const REVERSAL_STRUCTURE_CONFIG: ReversalStructureConfig = {
  version: 'reversal-structure-v1',
  minimumRuleFit: 70,
  minimumBars: 7,
  minimumPivotSeparationBars: 2,
  maximumPivotSeparationBars: 60,
  maximumLevelDifferenceAtr: 0.8,
  minimumDoubleDepthAtr: 1.2,
  breakoutAtr: 0.25,
  invalidationAtr: 0.5,
  minimumHeadClearanceAtr: 0.8,
  maximumShoulderDifferenceAtr: 0.8,
  maximumSpacingRatio: 2,
  maximumNecklineSlopeAtrPerBar: 0.3,
};

/**
 * 反轉 matcher 的純函式輸入；barIndex 與 ATR 陣列皆沿用呼叫端資料座標。
 * 呼叫端必須先完成 K 棒合法性、日期排序及公司行動連續性守門。
 */
export interface MatchReversalStructuresInput {
  bars: readonly OhlcvBar[];
  pivots: readonly StructurePivot[];
  atrValues: readonly (number | null)[];
  cutoffBarIndex?: number;
  config?: ReversalStructureConfig;
}

/** 四種反轉結構共用的可解釋輸出，供主結構引擎轉成候選或教學參考。 */
export interface ReversalMatchResult {
  structureId: ReversalStructureId;
  candidateId: string;
  status: StructureStatus;
  direction: StructureDirection;
  ruleFit: number;
  window?: StructureWindow;
  anchors: readonly StructurePivot[];
  boundaries: readonly StructureBoundary[];
  overlaySegments: readonly StructureOverlaySegment[];
  evaluations: readonly StructureRuleEvaluation[];
  confirmationCondition: string;
  invalidationCondition: string;
  missingConditions: readonly string[];
  matcherVersion: 'reversal-structure-v1';
}

interface MatchContext {
  bars: readonly OhlcvBar[];
  pivots: readonly StructurePivot[];
  atrValues: readonly (number | null)[];
  config: ReversalStructureConfig;
  cutoffBarIndex: number;
}

function thresholdSegments(
  context: MatchContext,
  options: {
    id: string;
    kind: Extract<StructureOverlaySegment['kind'], 'confirmation' | 'invalidation'>;
    label: string;
    startBarIndex: number;
    endBarIndex: number;
    fallbackAtr: number;
    priceAt: (barIndex: number, atr: number) => number;
  },
): readonly StructureOverlaySegment[] {
  const start = Math.max(0, options.startBarIndex);
  const end = Math.min(context.cutoffBarIndex, Math.max(start, options.endBarIndex));
  if (start === end) return [];

  return Array.from({ length: end - start }, (_value, offset) => {
    const firstIndex = start + offset;
    const secondIndex = firstIndex + 1;
    const firstAtr = atrAt(context, firstIndex) ?? options.fallbackAtr;
    const secondAtr = atrAt(context, secondIndex) ?? options.fallbackAtr;
    return {
      id: `${options.id}-${firstIndex}-${secondIndex}`,
      kind: options.kind,
      label: options.label,
      startBarIndex: firstIndex,
      startPrice: options.priceAt(firstIndex, firstAtr),
      endBarIndex: secondIndex,
      endPrice: options.priceAt(secondIndex, secondAtr),
      lineStyle: 'dashed' as const,
    };
  });
}

function geometrySegments(
  structureId: ReversalStructureId,
  boundary: StructureBoundary,
  anchors: readonly StructurePivot[],
): readonly StructureOverlaySegment[] {
  return [
    {
      id: `${structureId}-neckline`,
      kind: 'boundary',
      label: '型態頸線',
      startBarIndex: boundary.startBarIndex,
      startPrice: boundary.startPrice,
      endBarIndex: boundary.endBarIndex,
      endPrice: boundary.endPrice,
      lineStyle: 'solid',
    },
    ...anchors.slice(1).flatMap((anchor, index): readonly StructureOverlaySegment[] => {
      const previous = anchors[index];
      return previous
        ? [{
          id: `${structureId}-outline-${index}`,
          kind: 'outline',
          label: '反轉結構輪廓',
          startBarIndex: previous.barIndex,
          startPrice: previous.price,
          endBarIndex: anchor.barIndex,
          endPrice: anchor.price,
          lineStyle: 'solid',
        }]
        : [];
    }),
  ];
}

function atrAt(context: MatchContext, barIndex: number): number | null {
  const value = context.atrValues[Math.min(barIndex, context.cutoffBarIndex)];
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function boundaryPrice(boundary: StructureBoundary, barIndex: number): number {
  return boundary.intercept + boundary.slopePerBar * barIndex;
}

function horizontalBoundary(
  pivot: StructurePivot,
  endBarIndex: number,
  id: StructureBoundary['id'],
): StructureBoundary {
  return {
    version: 'structure-boundary-v1',
    id,
    startBarIndex: pivot.barIndex,
    endBarIndex,
    slopePerBar: 0,
    intercept: pivot.price,
    startPrice: pivot.price,
    endPrice: pivot.price,
    touchBarIndexes: [pivot.barIndex],
    normalizedResidualAtr: 0,
  };
}

function slopedBoundary(
  first: StructurePivot,
  second: StructurePivot,
  endBarIndex: number,
  id: StructureBoundary['id'],
): StructureBoundary {
  const slopePerBar = (second.price - first.price) / (second.barIndex - first.barIndex);
  const intercept = first.price - slopePerBar * first.barIndex;
  return {
    version: 'structure-boundary-v1',
    id,
    startBarIndex: first.barIndex,
    endBarIndex,
    slopePerBar,
    intercept,
    startPrice: first.price,
    endPrice: intercept + slopePerBar * endBarIndex,
    touchBarIndexes: [first.barIndex, second.barIndex],
    normalizedResidualAtr: 0,
  };
}

function windowFrom(
  context: MatchContext,
  startBarIndex: number,
): StructureWindow | undefined {
  const start = context.bars[startBarIndex];
  const end = context.bars[context.cutoffBarIndex];
  if (!start || !end) return undefined;
  return {
    version: 'structure-window-v1',
    startBarIndex,
    endBarIndex: context.cutoffBarIndex,
    startDate: start.date,
    endDate: end.date,
    barCount: context.cutoffBarIndex - startBarIndex + 1,
  };
}

function evaluation(
  ruleId: string,
  label: string,
  state: StructureRuleEvaluation['state'],
  explanation: string,
  group: StructureRuleEvaluation['group'] = 'required',
): StructureRuleEvaluation {
  return { ruleId, label, group, state, explanation };
}

function fitScore(evaluations: readonly StructureRuleEvaluation[]): number {
  const scored = evaluations.filter((item) => item.group !== 'invalidating' && item.state !== 'unavailable');
  if (scored.length === 0) return 0;
  return Math.round(scored.filter((item) => item.state === 'met').length / scored.length * 100);
}

function emptyResult(
  structureId: ReversalStructureId,
  missingCondition: string,
): ReversalMatchResult {
  return {
    structureId,
    candidateId: `${structureId}-insufficient`,
    status: 'insufficient-evidence',
    direction: 'undetermined',
    ruleFit: 0,
    anchors: [],
    boundaries: [],
    overlaySegments: [],
    evaluations: [evaluation(
      `${structureId}-pivot-sequence`,
      '具備完整轉折序列',
      'unavailable',
      missingCondition,
    )],
    confirmationCondition: '需先形成完整轉折序列。',
    invalidationCondition: '證據不足時不判定失效。',
    missingConditions: [missingCondition],
    matcherVersion: 'reversal-structure-v1',
  };
}

function latestSequence(
  pivots: readonly StructurePivot[],
  kinds: readonly StructurePivot['kind'][],
): readonly StructurePivot[] | null {
  for (let start = pivots.length - kinds.length; start >= 0; start -= 1) {
    const sequence = pivots.slice(start, start + kinds.length);
    if (sequence.every((item, index) => item.kind === kinds[index])) return sequence;
  }
  return null;
}

function evaluateDoubleTop(context: MatchContext): ReversalMatchResult {
  const anchors = latestSequence(context.pivots, ['high', 'low', 'high']);
  if (!anchors) return emptyResult('double-top', '至少需要波峰、波谷、波峰三個依序轉折。');
  const [first, necklinePivot, second] = anchors;
  if (!first || !necklinePivot || !second) {
    return emptyResult('double-top', '雙重頂轉折序列不完整。');
  }
  const atr = atrAt(context, second.barIndex);
  if (atr === null) return emptyResult('double-top', '第二個波峰缺少可用 ATR。');

  const peakDifferenceAtr = Math.abs(first.price - second.price) / atr;
  const depthAtr = (Math.min(first.price, second.price) - necklinePivot.price) / atr;
  const separation = second.barIndex - first.barIndex;
  const evaluations = [
    evaluation(
      'double-top-level-similarity',
      '兩個波峰位於相近價格區域',
      peakDifferenceAtr <= context.config.maximumLevelDifferenceAtr ? 'met' : 'not-met',
      `波峰差距為 ${peakDifferenceAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'double-top-valley-depth',
      '中間波谷深度足以辨識',
      depthAtr >= context.config.minimumDoubleDepthAtr ? 'met' : 'not-met',
      `中間波谷深度為 ${depthAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'double-top-separation',
      '兩個波峰間距位於固定範圍',
      separation >= context.config.minimumPivotSeparationBars
        && separation <= context.config.maximumPivotSeparationBars ? 'met' : 'not-met',
      `兩個波峰相隔 ${separation} 根 K 棒。`,
    ),
  ];
  const boundary = horizontalBoundary(necklinePivot, context.cutoffBarIndex, 'lower');
  const geometryMet = evaluations.every((item) => item.state === 'met');
  const observedAfterPattern = context.bars.slice(second.barIndex + 1, context.cutoffBarIndex + 1);
  const confirmationOffset = observedAfterPattern.findIndex((item, offset) => {
    const index = second.barIndex + 1 + offset;
    const observedAtr = atrAt(context, index) ?? atr;
    return item.close < boundaryPrice(boundary, index) - observedAtr * context.config.breakoutAtr;
  });
  const confirmationBarIndex = confirmationOffset < 0
    ? null
    : second.barIndex + 1 + confirmationOffset;
  const preConfirmationInvalid = context.bars
    .slice(second.barIndex + 1, (confirmationBarIndex ?? context.cutoffBarIndex) + 1)
    .some((item, offset) => {
      const index = second.barIndex + 1 + offset;
      return item.close > Math.max(first.price, second.price)
        + (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const postConfirmationInvalid = confirmationBarIndex !== null && context.bars
    .slice(confirmationBarIndex + 1, context.cutoffBarIndex + 1)
    .some((item, offset) => {
      const index = confirmationBarIndex + 1 + offset;
      return item.close > boundaryPrice(boundary, index)
        + (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const invalid = preConfirmationInvalid || postConfirmationInvalid;
  const status: StructureStatus = !geometryMet
    ? 'insufficient-evidence'
    : invalid ? 'invalid' : confirmationBarIndex === null ? 'forming' : 'confirmed';
  const invalidEvaluation = evaluation(
    'double-top-invalidation',
    '型態未被失效收盤破壞',
    invalid ? 'not-met' : 'met',
    invalid ? '幾何門檻未通過，或收盤已越過型態失效線。' : '尚未觀察到失效收盤。',
    'invalidating',
  );
  const allEvaluations = [...evaluations, invalidEvaluation];
  const confirmationSegments = thresholdSegments(context, {
    id: 'double-top-confirmation',
    kind: 'confirmation',
    label: '跌破 ATR 緩衝後確認',
    startBarIndex: boundary.startBarIndex,
    endBarIndex: context.cutoffBarIndex,
    fallbackAtr: atr,
    priceAt: (index, currentAtr) => boundaryPrice(boundary, index) - currentAtr * context.config.breakoutAtr,
  });
  const invalidationSegments = confirmationBarIndex === null
    ? thresholdSegments(context, {
      id: 'double-top-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前高點失效線',
      startBarIndex: first.barIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
      priceAt: (_index, currentAtr) => Math.max(first.price, second.price) + currentAtr * context.config.invalidationAtr,
    })
    : [
      ...thresholdSegments(context, {
        id: 'double-top-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前高點失效線',
        startBarIndex: first.barIndex, endBarIndex: confirmationBarIndex, fallbackAtr: atr,
        priceAt: (_index, currentAtr) => Math.max(first.price, second.price) + currentAtr * context.config.invalidationAtr,
      }),
      ...thresholdSegments(context, {
        id: 'double-top-post-confirmation-invalidation', kind: 'invalidation', label: '確認後頸線失效線',
        startBarIndex: confirmationBarIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
        priceAt: (index, currentAtr) => boundaryPrice(boundary, index) + currentAtr * context.config.invalidationAtr,
      }),
    ];

  return {
    structureId: 'double-top',
    candidateId: `double-top-${first.barIndex}-${second.barIndex}`,
    status,
    direction: status === 'confirmed' ? 'down' : 'undetermined',
    ruleFit: fitScore(allEvaluations),
    window: windowFrom(context, first.barIndex),
    anchors,
    boundaries: [boundary],
    overlaySegments: [...geometrySegments('double-top', boundary, anchors), ...confirmationSegments, ...invalidationSegments],
    evaluations: allEvaluations,
    confirmationCondition: '完成 K 棒收盤有效跌破中間波谷頸線。',
    invalidationCondition: '確認前收盤有效高於兩峰，或確認後收盤返回頸線上方。',
    missingConditions: allEvaluations
      .filter((item) => item.state !== 'met')
      .map((item) => item.label),
    matcherVersion: 'reversal-structure-v1',
  };
}

function evaluateDoubleBottom(context: MatchContext): ReversalMatchResult {
  const anchors = latestSequence(context.pivots, ['low', 'high', 'low']);
  if (!anchors) return emptyResult('double-bottom', '至少需要波谷、波峰、波谷三個依序轉折。');
  const [first, necklinePivot, second] = anchors;
  if (!first || !necklinePivot || !second) {
    return emptyResult('double-bottom', '雙重底轉折序列不完整。');
  }
  const atr = atrAt(context, second.barIndex);
  if (atr === null) return emptyResult('double-bottom', '第二個波谷缺少可用 ATR。');

  const troughDifferenceAtr = Math.abs(first.price - second.price) / atr;
  const heightAtr = (necklinePivot.price - Math.max(first.price, second.price)) / atr;
  const separation = second.barIndex - first.barIndex;
  const evaluations = [
    evaluation(
      'double-bottom-level-similarity',
      '兩個波谷位於相近價格區域',
      troughDifferenceAtr <= context.config.maximumLevelDifferenceAtr ? 'met' : 'not-met',
      `波谷差距為 ${troughDifferenceAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'double-bottom-peak-height',
      '中間波峰高度足以辨識',
      heightAtr >= context.config.minimumDoubleDepthAtr ? 'met' : 'not-met',
      `中間波峰高度為 ${heightAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'double-bottom-separation',
      '兩個波谷間距位於固定範圍',
      separation >= context.config.minimumPivotSeparationBars
        && separation <= context.config.maximumPivotSeparationBars ? 'met' : 'not-met',
      `兩個波谷相隔 ${separation} 根 K 棒。`,
    ),
  ];
  const boundary = horizontalBoundary(necklinePivot, context.cutoffBarIndex, 'upper');
  const geometryMet = evaluations.every((item) => item.state === 'met');
  const observedAfterPattern = context.bars.slice(second.barIndex + 1, context.cutoffBarIndex + 1);
  const confirmationOffset = observedAfterPattern.findIndex((item, offset) => {
    const index = second.barIndex + 1 + offset;
    const observedAtr = atrAt(context, index) ?? atr;
    return item.close > boundaryPrice(boundary, index) + observedAtr * context.config.breakoutAtr;
  });
  const confirmationBarIndex = confirmationOffset < 0
    ? null
    : second.barIndex + 1 + confirmationOffset;
  const preConfirmationInvalid = context.bars
    .slice(second.barIndex + 1, (confirmationBarIndex ?? context.cutoffBarIndex) + 1)
    .some((item, offset) => {
      const index = second.barIndex + 1 + offset;
      return item.close < Math.min(first.price, second.price)
        - (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const postConfirmationInvalid = confirmationBarIndex !== null && context.bars
    .slice(confirmationBarIndex + 1, context.cutoffBarIndex + 1)
    .some((item, offset) => {
      const index = confirmationBarIndex + 1 + offset;
      return item.close < boundaryPrice(boundary, index)
        - (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const invalid = preConfirmationInvalid || postConfirmationInvalid;
  const status: StructureStatus = !geometryMet
    ? 'insufficient-evidence'
    : invalid ? 'invalid' : confirmationBarIndex === null ? 'forming' : 'confirmed';
  const invalidEvaluation = evaluation(
    'double-bottom-invalidation',
    '型態未被失效收盤破壞',
    invalid ? 'not-met' : 'met',
    invalid ? '幾何門檻未通過，或收盤已越過型態失效線。' : '尚未觀察到失效收盤。',
    'invalidating',
  );
  const allEvaluations = [...evaluations, invalidEvaluation];
  const confirmationSegments = thresholdSegments(context, {
    id: 'double-bottom-confirmation', kind: 'confirmation', label: '突破 ATR 緩衝後確認',
    startBarIndex: boundary.startBarIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
    priceAt: (index, currentAtr) => boundaryPrice(boundary, index) + currentAtr * context.config.breakoutAtr,
  });
  const invalidationSegments = confirmationBarIndex === null
    ? thresholdSegments(context, {
      id: 'double-bottom-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前低點失效線',
      startBarIndex: first.barIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
      priceAt: (_index, currentAtr) => Math.min(first.price, second.price) - currentAtr * context.config.invalidationAtr,
    })
    : [
      ...thresholdSegments(context, {
        id: 'double-bottom-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前低點失效線',
        startBarIndex: first.barIndex, endBarIndex: confirmationBarIndex, fallbackAtr: atr,
        priceAt: (_index, currentAtr) => Math.min(first.price, second.price) - currentAtr * context.config.invalidationAtr,
      }),
      ...thresholdSegments(context, {
        id: 'double-bottom-post-confirmation-invalidation', kind: 'invalidation', label: '確認後頸線失效線',
        startBarIndex: confirmationBarIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
        priceAt: (index, currentAtr) => boundaryPrice(boundary, index) - currentAtr * context.config.invalidationAtr,
      }),
    ];

  return {
    structureId: 'double-bottom',
    candidateId: `double-bottom-${first.barIndex}-${second.barIndex}`,
    status,
    direction: status === 'confirmed' ? 'up' : 'undetermined',
    ruleFit: fitScore(allEvaluations),
    window: windowFrom(context, first.barIndex),
    anchors,
    boundaries: [boundary],
    overlaySegments: [...geometrySegments('double-bottom', boundary, anchors), ...confirmationSegments, ...invalidationSegments],
    evaluations: allEvaluations,
    confirmationCondition: '完成 K 棒收盤有效突破中間波峰頸線。',
    invalidationCondition: '確認前收盤有效低於兩谷，或確認後收盤返回頸線下方。',
    missingConditions: allEvaluations
      .filter((item) => item.state !== 'met')
      .map((item) => item.label),
    matcherVersion: 'reversal-structure-v1',
  };
}

function evaluateHeadAndShouldersTop(context: MatchContext): ReversalMatchResult {
  const anchors = latestSequence(context.pivots, ['high', 'low', 'high', 'low', 'high']);
  if (!anchors) {
    return emptyResult('head-and-shoulders-top', '至少需要肩、頸、頭、頸、肩五個依序轉折。');
  }
  const [leftShoulder, firstNeck, head, secondNeck, rightShoulder] = anchors;
  if (!leftShoulder || !firstNeck || !head || !secondNeck || !rightShoulder) {
    return emptyResult('head-and-shoulders-top', '頭肩頂轉折序列不完整。');
  }
  const atr = atrAt(context, rightShoulder.barIndex);
  if (atr === null) return emptyResult('head-and-shoulders-top', '右肩缺少可用 ATR。');
  const boundary = slopedBoundary(firstNeck, secondNeck, context.cutoffBarIndex, 'lower');
  const shoulderDifferenceAtr = Math.abs(leftShoulder.price - rightShoulder.price) / atr;
  const headClearanceAtr = (head.price - Math.max(leftShoulder.price, rightShoulder.price)) / atr;
  const leftSpacing = head.barIndex - leftShoulder.barIndex;
  const rightSpacing = rightShoulder.barIndex - head.barIndex;
  const spacingRatio = Math.max(leftSpacing, rightSpacing) / Math.min(leftSpacing, rightSpacing);
  const necklineSlopeAtr = Math.abs(boundary.slopePerBar) / atr;
  const minimumStep = Math.min(
    firstNeck.barIndex - leftShoulder.barIndex,
    head.barIndex - firstNeck.barIndex,
    secondNeck.barIndex - head.barIndex,
    rightShoulder.barIndex - secondNeck.barIndex,
  );
  const evaluations = [
    evaluation(
      'head-shoulders-top-head-clearance',
      '頭部明顯高於兩肩',
      headClearanceAtr >= context.config.minimumHeadClearanceAtr ? 'met' : 'not-met',
      `頭部高出較高肩部 ${headClearanceAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'head-shoulders-top-shoulder-similarity',
      '左右肩位於相近價格區域',
      shoulderDifferenceAtr <= context.config.maximumShoulderDifferenceAtr ? 'met' : 'not-met',
      `兩肩差距為 ${shoulderDifferenceAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'head-shoulders-top-spacing',
      '左右結構間距合理',
      minimumStep >= context.config.minimumPivotSeparationBars
        && rightShoulder.barIndex - leftShoulder.barIndex <= context.config.maximumPivotSeparationBars
        && spacingRatio <= context.config.maximumSpacingRatio ? 'met' : 'not-met',
      `左右跨度比為 ${spacingRatio.toFixed(2)}，最短相鄰轉折間距為 ${minimumStep} 根。`,
    ),
    evaluation(
      'head-shoulders-top-neckline-slope',
      '頸線傾斜仍在固定容忍範圍',
      necklineSlopeAtr <= context.config.maximumNecklineSlopeAtrPerBar ? 'met' : 'not-met',
      `頸線每根傾斜 ${necklineSlopeAtr.toFixed(2)} ATR。`,
    ),
  ];
  const geometryMet = evaluations.every((item) => item.state === 'met');
  const observedAfterPattern = context.bars.slice(rightShoulder.barIndex + 1, context.cutoffBarIndex + 1);
  const confirmationOffset = observedAfterPattern.findIndex((item, offset) => {
    const index = rightShoulder.barIndex + 1 + offset;
    return item.close < boundaryPrice(boundary, index)
      - (atrAt(context, index) ?? atr) * context.config.breakoutAtr;
  });
  const confirmationBarIndex = confirmationOffset < 0
    ? null
    : rightShoulder.barIndex + 1 + confirmationOffset;
  const preConfirmationInvalid = context.bars
    .slice(rightShoulder.barIndex + 1, (confirmationBarIndex ?? context.cutoffBarIndex) + 1)
    .some((item, offset) => {
      const index = rightShoulder.barIndex + 1 + offset;
      return item.close > head.price + (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const postConfirmationInvalid = confirmationBarIndex !== null && context.bars
    .slice(confirmationBarIndex + 1, context.cutoffBarIndex + 1)
    .some((item, offset) => {
      const index = confirmationBarIndex + 1 + offset;
      return item.close > boundaryPrice(boundary, index)
        + (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const invalid = preConfirmationInvalid || postConfirmationInvalid;
  const status: StructureStatus = !geometryMet
    ? 'insufficient-evidence'
    : invalid ? 'invalid' : confirmationBarIndex === null ? 'forming' : 'confirmed';
  const invalidEvaluation = evaluation(
    'head-shoulders-top-invalidation',
    '型態未被失效收盤破壞',
    invalid ? 'not-met' : 'met',
    invalid ? '幾何門檻未通過，或收盤已越過型態失效線。' : '尚未觀察到失效收盤。',
    'invalidating',
  );
  const allEvaluations = [...evaluations, invalidEvaluation];
  const confirmationSegments = thresholdSegments(context, {
    id: 'head-shoulders-top-confirmation', kind: 'confirmation', label: '跌破 ATR 緩衝後確認',
    startBarIndex: boundary.startBarIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
    priceAt: (index, currentAtr) => boundaryPrice(boundary, index) - currentAtr * context.config.breakoutAtr,
  });
  const invalidationSegments = confirmationBarIndex === null
    ? thresholdSegments(context, {
      id: 'head-shoulders-top-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前頭部失效線',
      startBarIndex: leftShoulder.barIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
      priceAt: (_index, currentAtr) => head.price + currentAtr * context.config.invalidationAtr,
    })
    : [
      ...thresholdSegments(context, {
        id: 'head-shoulders-top-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前頭部失效線',
        startBarIndex: leftShoulder.barIndex, endBarIndex: confirmationBarIndex, fallbackAtr: atr,
        priceAt: (_index, currentAtr) => head.price + currentAtr * context.config.invalidationAtr,
      }),
      ...thresholdSegments(context, {
        id: 'head-shoulders-top-post-confirmation-invalidation', kind: 'invalidation', label: '確認後頸線失效線',
        startBarIndex: confirmationBarIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
        priceAt: (index, currentAtr) => boundaryPrice(boundary, index) + currentAtr * context.config.invalidationAtr,
      }),
    ];

  return {
    structureId: 'head-and-shoulders-top',
    candidateId: `head-and-shoulders-top-${leftShoulder.barIndex}-${rightShoulder.barIndex}`,
    status,
    direction: status === 'confirmed' ? 'down' : 'undetermined',
    ruleFit: fitScore(allEvaluations),
    window: windowFrom(context, leftShoulder.barIndex),
    anchors,
    boundaries: [boundary],
    overlaySegments: [...geometrySegments('head-and-shoulders-top', boundary, anchors), ...confirmationSegments, ...invalidationSegments],
    evaluations: allEvaluations,
    confirmationCondition: '完成 K 棒收盤有效跌破由兩個波谷錨點形成的可傾斜頸線。',
    invalidationCondition: '確認前收盤有效高於頭部，或確認後收盤返回頸線上方。',
    missingConditions: allEvaluations
      .filter((item) => item.state !== 'met')
      .map((item) => item.label),
    matcherVersion: 'reversal-structure-v1',
  };
}

function evaluateHeadAndShouldersBottom(context: MatchContext): ReversalMatchResult {
  const anchors = latestSequence(context.pivots, ['low', 'high', 'low', 'high', 'low']);
  if (!anchors) {
    return emptyResult('head-and-shoulders-bottom', '至少需要肩、頸、頭、頸、肩五個依序轉折。');
  }
  const [leftShoulder, firstNeck, head, secondNeck, rightShoulder] = anchors;
  if (!leftShoulder || !firstNeck || !head || !secondNeck || !rightShoulder) {
    return emptyResult('head-and-shoulders-bottom', '頭肩底轉折序列不完整。');
  }
  const atr = atrAt(context, rightShoulder.barIndex);
  if (atr === null) return emptyResult('head-and-shoulders-bottom', '右肩缺少可用 ATR。');
  const boundary = slopedBoundary(firstNeck, secondNeck, context.cutoffBarIndex, 'upper');
  const shoulderDifferenceAtr = Math.abs(leftShoulder.price - rightShoulder.price) / atr;
  const headClearanceAtr = (Math.min(leftShoulder.price, rightShoulder.price) - head.price) / atr;
  const leftSpacing = head.barIndex - leftShoulder.barIndex;
  const rightSpacing = rightShoulder.barIndex - head.barIndex;
  const spacingRatio = Math.max(leftSpacing, rightSpacing) / Math.min(leftSpacing, rightSpacing);
  const necklineSlopeAtr = Math.abs(boundary.slopePerBar) / atr;
  const minimumStep = Math.min(
    firstNeck.barIndex - leftShoulder.barIndex,
    head.barIndex - firstNeck.barIndex,
    secondNeck.barIndex - head.barIndex,
    rightShoulder.barIndex - secondNeck.barIndex,
  );
  const evaluations = [
    evaluation(
      'head-shoulders-bottom-head-clearance',
      '頭部明顯低於兩肩',
      headClearanceAtr >= context.config.minimumHeadClearanceAtr ? 'met' : 'not-met',
      `頭部低於較低肩部 ${headClearanceAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'head-shoulders-bottom-shoulder-similarity',
      '左右肩位於相近價格區域',
      shoulderDifferenceAtr <= context.config.maximumShoulderDifferenceAtr ? 'met' : 'not-met',
      `兩肩差距為 ${shoulderDifferenceAtr.toFixed(2)} ATR。`,
    ),
    evaluation(
      'head-shoulders-bottom-spacing',
      '左右結構間距合理',
      minimumStep >= context.config.minimumPivotSeparationBars
        && rightShoulder.barIndex - leftShoulder.barIndex <= context.config.maximumPivotSeparationBars
        && spacingRatio <= context.config.maximumSpacingRatio ? 'met' : 'not-met',
      `左右跨度比為 ${spacingRatio.toFixed(2)}，最短相鄰轉折間距為 ${minimumStep} 根。`,
    ),
    evaluation(
      'head-shoulders-bottom-neckline-slope',
      '頸線傾斜仍在固定容忍範圍',
      necklineSlopeAtr <= context.config.maximumNecklineSlopeAtrPerBar ? 'met' : 'not-met',
      `頸線每根傾斜 ${necklineSlopeAtr.toFixed(2)} ATR。`,
    ),
  ];
  const geometryMet = evaluations.every((item) => item.state === 'met');
  const observedAfterPattern = context.bars.slice(rightShoulder.barIndex + 1, context.cutoffBarIndex + 1);
  const confirmationOffset = observedAfterPattern.findIndex((item, offset) => {
    const index = rightShoulder.barIndex + 1 + offset;
    return item.close > boundaryPrice(boundary, index)
      + (atrAt(context, index) ?? atr) * context.config.breakoutAtr;
  });
  const confirmationBarIndex = confirmationOffset < 0
    ? null
    : rightShoulder.barIndex + 1 + confirmationOffset;
  const preConfirmationInvalid = context.bars
    .slice(rightShoulder.barIndex + 1, (confirmationBarIndex ?? context.cutoffBarIndex) + 1)
    .some((item, offset) => {
      const index = rightShoulder.barIndex + 1 + offset;
      return item.close < head.price - (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const postConfirmationInvalid = confirmationBarIndex !== null && context.bars
    .slice(confirmationBarIndex + 1, context.cutoffBarIndex + 1)
    .some((item, offset) => {
      const index = confirmationBarIndex + 1 + offset;
      return item.close < boundaryPrice(boundary, index)
        - (atrAt(context, index) ?? atr) * context.config.invalidationAtr;
    });
  const invalid = preConfirmationInvalid || postConfirmationInvalid;
  const status: StructureStatus = !geometryMet
    ? 'insufficient-evidence'
    : invalid ? 'invalid' : confirmationBarIndex === null ? 'forming' : 'confirmed';
  const invalidEvaluation = evaluation(
    'head-shoulders-bottom-invalidation',
    '型態未被失效收盤破壞',
    invalid ? 'not-met' : 'met',
    invalid ? '幾何門檻未通過，或收盤已越過型態失效線。' : '尚未觀察到失效收盤。',
    'invalidating',
  );
  const allEvaluations = [...evaluations, invalidEvaluation];
  const confirmationSegments = thresholdSegments(context, {
    id: 'head-shoulders-bottom-confirmation', kind: 'confirmation', label: '突破 ATR 緩衝後確認',
    startBarIndex: boundary.startBarIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
    priceAt: (index, currentAtr) => boundaryPrice(boundary, index) + currentAtr * context.config.breakoutAtr,
  });
  const invalidationSegments = confirmationBarIndex === null
    ? thresholdSegments(context, {
      id: 'head-shoulders-bottom-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前頭部失效線',
      startBarIndex: leftShoulder.barIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
      priceAt: (_index, currentAtr) => head.price - currentAtr * context.config.invalidationAtr,
    })
    : [
      ...thresholdSegments(context, {
        id: 'head-shoulders-bottom-pre-confirmation-invalidation', kind: 'invalidation', label: '確認前頭部失效線',
        startBarIndex: leftShoulder.barIndex, endBarIndex: confirmationBarIndex, fallbackAtr: atr,
        priceAt: (_index, currentAtr) => head.price - currentAtr * context.config.invalidationAtr,
      }),
      ...thresholdSegments(context, {
        id: 'head-shoulders-bottom-post-confirmation-invalidation', kind: 'invalidation', label: '確認後頸線失效線',
        startBarIndex: confirmationBarIndex, endBarIndex: context.cutoffBarIndex, fallbackAtr: atr,
        priceAt: (index, currentAtr) => boundaryPrice(boundary, index) - currentAtr * context.config.invalidationAtr,
      }),
    ];

  return {
    structureId: 'head-and-shoulders-bottom',
    candidateId: `head-and-shoulders-bottom-${leftShoulder.barIndex}-${rightShoulder.barIndex}`,
    status,
    direction: status === 'confirmed' ? 'up' : 'undetermined',
    ruleFit: fitScore(allEvaluations),
    window: windowFrom(context, leftShoulder.barIndex),
    anchors,
    boundaries: [boundary],
    overlaySegments: [...geometrySegments('head-and-shoulders-bottom', boundary, anchors), ...confirmationSegments, ...invalidationSegments],
    evaluations: allEvaluations,
    confirmationCondition: '完成 K 棒收盤有效突破由兩個波峰錨點形成的可傾斜頸線。',
    invalidationCondition: '確認前收盤有效低於頭部，或確認後收盤返回頸線下方。',
    missingConditions: allEvaluations
      .filter((item) => item.state !== 'met')
      .map((item) => item.label),
    matcherVersion: 'reversal-structure-v1',
  };
}

/**
 * 依指定 cutoff 比對四種反轉價格結構；函式不讀取 cutoff 之後的 K 棒、轉折或 ATR。
 */
export function matchReversalStructures(
  input: MatchReversalStructuresInput,
): readonly ReversalMatchResult[] {
  const requestedCutoff = input.cutoffBarIndex ?? input.bars.length - 1;
  const cutoffBarIndex = Math.min(requestedCutoff, input.bars.length - 1);
  const context: MatchContext = {
    bars: input.bars.slice(0, cutoffBarIndex + 1),
    pivots: input.pivots.filter((pivot) => pivot.barIndex <= cutoffBarIndex),
    atrValues: input.atrValues.slice(0, cutoffBarIndex + 1),
    config: input.config ?? REVERSAL_STRUCTURE_CONFIG,
    cutoffBarIndex,
  };

  if (cutoffBarIndex < 0 || context.bars.length < context.config.minimumBars) {
    return [
      emptyResult('double-top', '完成 K 棒數不足。'),
      emptyResult('double-bottom', '完成 K 棒數不足。'),
      emptyResult('head-and-shoulders-top', '完成 K 棒數不足。'),
      emptyResult('head-and-shoulders-bottom', '完成 K 棒數不足。'),
    ];
  }

  return [
    evaluateDoubleTop(context),
    evaluateDoubleBottom(context),
    evaluateHeadAndShouldersTop(context),
    evaluateHeadAndShouldersBottom(context),
  ];
}
