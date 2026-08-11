import { inject, provide, readonly, ref, type InjectionKey, type Ref } from 'vue';
import {
  exportProgress,
  importProgress,
  loadProgress,
  PROGRESS_STORAGE_KEY,
  saveProgress,
  type LearningProgressV1,
  type ProgressStorage,
} from '../domain/learning/progress';
import type { QuizResult } from '../domain/learning/quizzes';

export interface LearningProgressContext {
  readonly progress: Readonly<Ref<LearningProgressV1>>;
  readonly storageError: Readonly<Ref<string>>;
  readonly markChapterComplete: (chapterId: string) => void;
  readonly recordQuizResult: (result: QuizResult) => void;
  readonly clearProgress: () => void;
  readonly exportProgressJson: () => string;
  readonly importProgressJson: (json: string) => void;
}

export const LEARNING_PROGRESS_KEY: InjectionKey<LearningProgressContext> = Symbol('learning-progress');

function createMemoryStorage(): Storage {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
    removeItem: () => {
      value = null;
    },
    clear: () => {
      value = null;
    },
    key: () => null,
    length: 0,
  };
}

function resolveStorage(storage?: ProgressStorage): ProgressStorage {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // 隱私模式或 SSR 無法取得 localStorage 時，改用本次頁面生命週期的記憶體儲存。
  }
  return createMemoryStorage();
}

export function createLearningProgressContext(storage?: ProgressStorage): LearningProgressContext {
  const resolvedStorage = resolveStorage(storage);
  const progress = ref<LearningProgressV1>(loadProgress(resolvedStorage));
  const storageError = ref('');

  function persist(nextProgress: LearningProgressV1): void {
    progress.value = nextProgress;
    try {
      saveProgress(resolvedStorage, nextProgress);
      storageError.value = '';
    } catch {
      storageError.value = '無法儲存學習進度；本頁面會暫時保留目前進度，請稍後再試或匯出備份。';
    }
  }

  return {
    progress: readonly(progress) as unknown as Readonly<Ref<LearningProgressV1>>,
    storageError: readonly(storageError) as unknown as Readonly<Ref<string>>,
    markChapterComplete(chapterId) {
      if (!chapterId || progress.value.completedChapterIds.includes(chapterId)) return;
      persist({
        ...progress.value,
        completedChapterIds: [...progress.value.completedChapterIds, chapterId],
        updatedAt: new Date().toISOString(),
      });
    },
    recordQuizResult(result) {
      const nextAttempts = (progress.value.quizAttempts[result.stageId] ?? 0) + 1;
      persist({
        ...progress.value,
        passedStageIds: result.passed
          ? Array.from(new Set([...progress.value.passedStageIds, result.stageId]))
          : [...progress.value.passedStageIds],
        quizAttempts: { ...progress.value.quizAttempts, [result.stageId]: nextAttempts },
        updatedAt: new Date().toISOString(),
      });
    },
    clearProgress() {
      const removableStorage = resolvedStorage as ProgressStorage & Partial<Pick<Storage, 'removeItem'>>;
      try {
        if (!removableStorage.removeItem) {
          throw new Error('removeItem unavailable');
        }
        removableStorage.removeItem(PROGRESS_STORAGE_KEY);
        progress.value = loadProgress(createMemoryStorage());
        storageError.value = '';
      } catch {
        storageError.value = '無法清除學習進度；原有進度仍保留在本頁面，請稍後再試。';
      }
    },
    exportProgressJson() {
      return exportProgress(progress.value);
    },
    importProgressJson(json) {
      const imported = importProgress(json);
      persist(imported);
    },
  };
}

export function useLearningProgress(): LearningProgressContext {
  return inject(LEARNING_PROGRESS_KEY) ?? createLearningProgressContext();
}

export function provideLearningProgress(storage?: ProgressStorage): LearningProgressContext {
  const context = createLearningProgressContext(storage);
  provide(LEARNING_PROGRESS_KEY, context);
  return context;
}
