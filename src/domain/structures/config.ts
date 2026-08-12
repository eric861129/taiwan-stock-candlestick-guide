import type { StructureEngineConfig } from './types';

/**
 * 結構特徵與首批規則族共用的固定門檻。
 * 版本變更時必須連同 fixture 與 matcher 版本一起校準，不能由畫面自行覆寫。
 */
export const STRUCTURE_ENGINE_CONFIG: StructureEngineConfig = {
  version: 'structure-features-v1',
  maximumBars: 120,
  minimumBars: 8,
  atr: {
    period: 14,
  },
  pivot: {
    width: 2,
    minimumProminenceAtr: 0.45,
    minimumSeparationBars: 2,
  },
  boundaries: {
    touchToleranceAtr: 0.8,
    maximumResidualAtr: 0.8,
    breakoutAtr: 0.35,
    insideCloseRatio: 0.7,
  },
  box: {
    minimumWindowBars: 8,
    maximumSlopeAtrPerBar: 0.055,
    minimumRuleFit: 70,
  },
  triangle: {
    minimumWindowBars: 8,
    minimumSlopeAtrPerBar: 0.055,
    minimumCompressionRatio: 0.72,
    minimumApexProgress: 0.75,
    maximumApexProgress: 3,
    minimumRuleFit: 70,
  },
};

/** 結構 matcher 的公開版本，作為快取與結果可稽核識別的一部分。 */
export const STRUCTURE_MATCHER_VERSION = 'structure-v1' as const;
