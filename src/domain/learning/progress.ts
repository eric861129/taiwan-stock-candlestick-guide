import { LEARNING_STAGES } from './stages';

/** localStorage 與匯出檔案共用的第一版進度格式。 */
export interface LearningProgressV1 {
  readonly schemaVersion: 1;
  readonly completedChapterIds: string[];
  readonly passedStageIds: string[];
  readonly quizAttempts: Record<string, number>;
  readonly updatedAt: string;
}

export const PROGRESS_STORAGE_KEY = 'tw-candlestick-guide:progress:v1' as const;
export const PASSING_QUESTION_COUNT = 4 as const;
export const MAX_IMPORT_BYTES = 256 * 1024;

const validChapterIds = new Set<string>(LEARNING_STAGES.flatMap((stage) => stage.chapters.map((chapter) => chapter.id)));
const validStageIds = new Set<string>(LEARNING_STAGES.map((stage) => stage.id));

export type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;

function createEmptyProgress(): LearningProgressV1 {
  return {
    schemaVersion: 1,
    completedChapterIds: [],
    passedStageIds: [],
    quizAttempts: {},
    updatedAt: new Date().toISOString(),
  };
}

function hasValidStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function hasUniqueKnownIds(value: string[], allowedIds: ReadonlySet<string>): boolean {
  return new Set(value).size === value.length && value.every((id) => allowedIds.has(id));
}

function isValidProgress(value: unknown): value is LearningProgressV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return false;
  if (!hasValidStringArray(candidate.completedChapterIds)) return false;
  if (!hasUniqueKnownIds(candidate.completedChapterIds, validChapterIds)) return false;
  if (!hasValidStringArray(candidate.passedStageIds)) return false;
  if (!hasUniqueKnownIds(candidate.passedStageIds, validStageIds)) return false;
  if (!candidate.quizAttempts || typeof candidate.quizAttempts !== 'object' || Array.isArray(candidate.quizAttempts)) {
    return false;
  }
  if (
    !Object.entries(candidate.quizAttempts).every(
      ([stageId, attempts]) =>
        validStageIds.has(stageId) &&
        typeof attempts === 'number' &&
        Number.isInteger(attempts) &&
        attempts >= 0,
    )
  ) {
    return false;
  }
  return typeof candidate.updatedAt === 'string' && !Number.isNaN(Date.parse(candidate.updatedAt));
}

function assertProgress(value: unknown): asserts value is LearningProgressV1 {
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).schemaVersion !== 1) {
    throw new Error('不支援的學習進度版本');
  }
  if (!isValidProgress(value)) {
    throw new Error('學習進度格式無效');
  }
}

function getByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** 從 localStorage 讀取 v1 進度；損壞資料會安全回到空白進度。 */
export function loadProgress(storage: ProgressStorage): LearningProgressV1 {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return createEmptyProgress();
  }
  if (!raw) return createEmptyProgress();
  try {
    return importProgress(raw);
  } catch {
    return createEmptyProgress();
  }
}

/** 儲存已驗證的 v1 進度。 */
export function saveProgress(storage: ProgressStorage, progress: LearningProgressV1): void {
  assertProgress(progress);
  storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

/** 將進度匯出為可攜式 JSON。 */
export function exportProgress(progress: LearningProgressV1): string {
  assertProgress(progress);
  return JSON.stringify(progress);
}

/** 匯入並驗證 v1 進度；先檢查 256 KiB 大小，再進行 JSON 解析。 */
export function importProgress(json: string): LearningProgressV1 {
  if (typeof json !== 'string') {
    throw new Error('學習進度格式無效');
  }
  if (getByteLength(json) > MAX_IMPORT_BYTES) {
    throw new Error('學習進度檔案不可超過 256 KiB');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('學習進度格式無效');
  }
  assertProgress(parsed);
  return {
    schemaVersion: 1,
    completedChapterIds: [...parsed.completedChapterIds],
    passedStageIds: [...parsed.passedStageIds],
    quizAttempts: { ...parsed.quizAttempts },
    updatedAt: parsed.updatedAt,
  };
}
