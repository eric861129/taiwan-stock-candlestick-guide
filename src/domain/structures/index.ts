/** 價格結構分析的公開純函式接縫。 */
export { analyzeStructures } from './analyzer';
export { STRUCTURE_ENGINE_CONFIG, STRUCTURE_MATCHER_VERSION } from './config';
export { extractAtr, extractPivots, extractStructureFeatures } from './features';
export { buildStructureOverlay } from './overlay';
export type {
  AnalyzeStructuresOptions,
  StructureAnalysisInput,
  StructureAnalysisResult,
  StructureCandidate,
  StructureEngineConfig,
  StructureFeatures,
  StructureNearMiss,
  StructureOverlay,
} from './types';
