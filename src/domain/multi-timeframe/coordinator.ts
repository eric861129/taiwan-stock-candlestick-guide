import {
  selectStockPriceMode,
  selectStockTimeframe,
} from '../market-data/client';
import type {
  AnalysisResult,
  AvailablePriceMode,
  PriceMode,
  StockSnapshot,
  Timeframe,
} from '../market-data/types';
import { analyzePatterns } from '../patterns/matcher';
import { analyzeStructures } from '../structures/analyzer';
import type {
  StructureCandidate,
  StructureId,
} from '../structures/types';
import {
  MULTI_TIMEFRAME_ORDER,
  type CoordinateMultiTimeframeOptions,
  type MultiTimeframeAnalysisResult,
  type MultiTimeframeBackgroundDirection,
  type MultiTimeframeSummary,
  type TimeframeAnalysis,
} from './types';

const LEARNING_ROLES: Readonly<Record<Timeframe, TimeframeAnalysis['learningRole']>> = {
  '1m': 'long-term-background',
  '1w': 'medium-term-structure',
  '1d': 'short-term-check',
};

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function resolveCutoffDate(snapshot: StockSnapshot, mode: AvailablePriceMode): string {
  if (snapshot.cutoffDate) return snapshot.cutoffDate;
  const latest = Object.values(mode.timeframes)
    .flatMap((series) => [
      ...series.completedBars.map((bar) => bar.date),
      ...(series.formingBar ? [series.formingBar.date] : []),
    ])
    .sort()
    .at(-1);
  if (!latest) {
    throw new Error('多時間週期快照沒有可用的截止日期。');
  }
  return latest;
}

function resolvePriceMode(
  snapshot: StockSnapshot,
  requested: PriceMode,
): {
  priceMode: PriceMode;
  resolution: MultiTimeframeAnalysisResult['priceModeResolution'];
  mode: AvailablePriceMode;
  warnings: readonly string[];
} {
  const modes = snapshot.priceModes;
  if (!modes) {
    throw new Error('多時間週期協調器需要已驗證的 v4 價格模式資料。');
  }
  const requestedMode = modes[requested];
  if (requestedMode.status === 'available') {
    return {
      priceMode: requested,
      resolution: 'requested',
      mode: requestedMode,
      warnings: requestedMode.warnings,
    };
  }
  return {
    priceMode: 'raw',
    resolution: 'fallback-to-raw',
    mode: modes.raw,
    warnings: unique([
      ...requestedMode.warnings,
      '向後還原證據不足，本次保留官方原始價格並停用還原分析。',
    ]),
  };
}

function scopedSnapshot(
  snapshot: StockSnapshot,
  priceMode: PriceMode,
  timeframe: Timeframe,
  cutoffDate: string,
): StockSnapshot {
  const priced = selectStockPriceMode(snapshot, priceMode);
  const selected = selectStockTimeframe(priced, timeframe);
  return {
    ...selected,
    cutoffDate,
    bars: selected.bars.filter((bar) => bar.date <= cutoffDate),
    noQuoteEvidence: selected.noQuoteEvidence.filter((evidence) => evidence.date <= cutoffDate),
    corporateActions: selected.corporateActions.filter((action) => action.date <= cutoffDate),
  };
}

function patternWarnings(result: AnalysisResult): readonly string[] {
  return result.status === 'unavailable'
    ? [result.message]
    : result.context.warnings;
}

function selectedCandidate(
  candidates: readonly StructureCandidate[],
  requestedStructureId: StructureId | undefined,
): StructureCandidate | null {
  if (requestedStructureId) {
    return candidates.find((candidate) => candidate.structureId === requestedStructureId) ?? null;
  }
  return candidates[0] ?? null;
}

function directionText(direction: MultiTimeframeBackgroundDirection): string {
  if (direction === 'up') return '已確認向上離開結構邊界';
  if (direction === 'down') return '已確認向下離開結構邊界';
  if (direction === 'neutral') return '價格仍在整理結構中，背景中性';
  return '尚無已確認的邊界方向';
}

function provisionalHint(timeframe: Timeframe, direction: MultiTimeframeBackgroundDirection): string {
  if (timeframe === '1m') return `月 K 長期背景：${directionText(direction)}。`;
  if (timeframe === '1w') return `週 K 中期結構：${directionText(direction)}。`;
  return `日 K 近期核對：${directionText(direction)}。`;
}

function backgroundDirection(candidate: StructureCandidate | null): MultiTimeframeBackgroundDirection {
  if (!candidate) return 'undetermined';
  if (candidate.direction !== 'undetermined') return candidate.direction;
  return ['range', 'triangle-consolidation', 'flag-consolidation'].includes(candidate.structureId)
    ? 'neutral'
    : 'undetermined';
}

function analyzeTimeframe(
  snapshot: StockSnapshot,
  priceMode: PriceMode,
  timeframe: Timeframe,
  cutoffDate: string,
  options: CoordinateMultiTimeframeOptions,
  modeWarnings: readonly string[],
): TimeframeAnalysis {
  const selected = scopedSnapshot(snapshot, priceMode, timeframe, cutoffDate);
  const structureAnalysis = analyzeStructures(selected, { cutoffDate });
  const patternAnalysis = analyzePatterns(selected, {
    freshness: selected.freshness,
    snapshotHash: selected.snapshotHash,
  });
  const candidate = selectedCandidate(
    structureAnalysis.candidates,
    options.selectedStructureIds?.[timeframe],
  );
  const completedBars = selected.bars.filter((bar) => (
    bar.completed !== false && bar.evidenceStatus !== 'incomplete'
  ));
  const formingBar = selected.bars.find((bar) => bar.completed === false) ?? null;
  const warnings = unique([
    ...modeWarnings,
    ...structureAnalysis.features.warnings,
    ...patternWarnings(patternAnalysis),
  ]);

  return {
    timeframe,
    learningRole: LEARNING_ROLES[timeframe],
    snapshot: selected,
    cutoffDate,
    latestCompletedBarDate: completedBars.at(-1)?.date ?? null,
    availableCompletedBarCount: completedBars.length,
    formingBar,
    structureAnalysis,
    patternAnalysis,
    selectedCandidate: candidate,
    selectedCandidateId: candidate?.candidateId ?? null,
    selectedStructureId: candidate?.structureId ?? null,
    backgroundDirection: backgroundDirection(candidate),
    backgroundHint: provisionalHint(timeframe, backgroundDirection(candidate)),
    warnings,
  };
}

function directionsOppose(
  left: MultiTimeframeBackgroundDirection,
  right: MultiTimeframeBackgroundDirection,
): boolean {
  return (left === 'up' && right === 'down') || (left === 'down' && right === 'up');
}

function summaryFor(timeframes: readonly TimeframeAnalysis[]): MultiTimeframeSummary {
  const monthly = timeframes.find((item) => item.timeframe === '1m');
  const weekly = timeframes.find((item) => item.timeframe === '1w');
  const daily = timeframes.find((item) => item.timeframe === '1d');
  const monthDirection = monthly?.backgroundDirection ?? 'undetermined';
  const weekDirection = weekly?.backgroundDirection ?? 'undetermined';
  const dayDirection = daily?.backgroundDirection ?? 'undetermined';

  if (monthDirection === 'undetermined' || weekDirection === 'undetermined') {
    return {
      state: 'insufficient-evidence',
      label: '較長週期證據不足',
      explanation: '月 K 或週 K 尚無可比較的已確認方向，保留各週期原始結果。',
    };
  }
  if (
    directionsOppose(monthDirection, weekDirection)
    || directionsOppose(dayDirection, monthDirection)
    || directionsOppose(dayDirection, weekDirection)
  ) {
    return {
      state: 'divergent',
      label: '週期背景分歧',
      explanation: '至少兩個週期的已確認邊界方向不同，需分開閱讀各週期條件。',
    };
  }
  if (monthDirection !== weekDirection || dayDirection !== monthDirection) {
    return {
      state: 'partially-aligned',
      label: '三個週期部分一致',
      explanation: '週期之間沒有相反方向，但仍有中性或未決背景，保留各週期獨立結果。',
    };
  }
  return {
    state: 'aligned',
    label: '三個週期背景一致',
    explanation: '月 K、週 K 與日 K 的已確認邊界方向一致。',
  };
}

function hintFor(
  analysis: TimeframeAnalysis,
  timeframes: readonly TimeframeAnalysis[],
): string {
  if (analysis.timeframe === '1m') return provisionalHint('1m', analysis.backgroundDirection);
  const monthDirection = timeframes.find((item) => item.timeframe === '1m')?.backgroundDirection
    ?? 'undetermined';
  if (analysis.timeframe === '1w') {
    if (monthDirection === 'undetermined' || analysis.backgroundDirection === 'undetermined') {
      return '週 K 或月 K 尚無可比較的已確認方向。';
    }
    if (directionsOppose(analysis.backgroundDirection, monthDirection)) {
      return '週 K 與月 K 的已確認方向相反，保留分開判讀。';
    }
    return analysis.backgroundDirection === monthDirection
      ? '週 K 背景與月 K 一致。'
      : '週 K 與月 K 沒有相反方向，但其中一個背景中性。';
  }

  const weekDirection = timeframes.find((item) => item.timeframe === '1w')?.backgroundDirection
    ?? 'undetermined';
  if (monthDirection === 'undetermined' || weekDirection === 'undetermined') {
    return '月 K 或週 K 尚無可供日 K 核對的已確認方向。';
  }
  if (directionsOppose(monthDirection, weekDirection)) {
    return '月 K 與週 K 已分歧，日 K 僅保留獨立核對結果。';
  }
  if (analysis.backgroundDirection === 'undetermined') {
    return '日 K 尚無已確認方向；月 K 與週 K 的一致背景保持不變。';
  }
  if (
    directionsOppose(analysis.backgroundDirection, monthDirection)
    || directionsOppose(analysis.backgroundDirection, weekDirection)
  ) {
    return '日 K 與至少一個較長週期的已確認方向相反，保留分開判讀。';
  }
  return analysis.backgroundDirection === monthDirection
    && analysis.backgroundDirection === weekDirection
    ? '日 K 背景與月 K、週 K 一致。'
    : '三個週期沒有相反方向，但仍含中性背景。';
}

/**
 * 以相同價格模式與 cutoff 依月、週、日順序協調兩套 matcher。
 * 摘要只讀取個別結果，不修改候選、規則符合度或短窗分數。
 */
export function coordinateMultiTimeframe(
  snapshot: StockSnapshot,
  options: CoordinateMultiTimeframeOptions,
): MultiTimeframeAnalysisResult {
  const priceResolution = resolvePriceMode(snapshot, options.priceMode);
  const cutoffDate = options.cutoffDate ?? resolveCutoffDate(snapshot, priceResolution.mode);
  const analyzed = MULTI_TIMEFRAME_ORDER.map((timeframe) => analyzeTimeframe(
    snapshot,
    priceResolution.priceMode,
    timeframe,
    cutoffDate,
    options,
    priceResolution.warnings,
  ));
  const summary = summaryFor(analyzed);
  const timeframes = analyzed.map((analysis) => ({
    ...analysis,
    backgroundHint: hintFor(analysis, analyzed),
  }));

  return {
    code: snapshot.code,
    requestedPriceMode: options.priceMode,
    priceMode: priceResolution.priceMode,
    priceModeResolution: priceResolution.resolution,
    cutoffDate,
    timeframes,
    summary,
    warnings: unique([
      ...priceResolution.warnings,
      ...timeframes.flatMap((analysis) => analysis.warnings),
    ]),
  };
}
