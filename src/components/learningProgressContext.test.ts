import { describe, expect, it } from 'vitest';
import { createLearningProgressContext } from './learningProgressContext';

function createThrowingStorage(): Storage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => {
      throw new Error('storage unavailable');
    },
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
}

describe('learning progress storage boundaries', () => {
  it('keeps in-memory progress and reports a Traditional Chinese warning when setItem fails', () => {
    const context = createLearningProgressContext(createThrowingStorage());

    expect(() => context.markChapterComplete('chapter-01')).not.toThrow();
    expect(context.progress.value.completedChapterIds).toEqual(['chapter-01']);
    expect(context.storageError.value).toContain('無法儲存學習進度');
  });

  it('keeps in-memory progress and reports a Traditional Chinese warning when removeItem fails', () => {
    const context = createLearningProgressContext(createThrowingStorage());
    context.markChapterComplete('chapter-01');

    expect(() => context.clearProgress()).not.toThrow();
    expect(context.progress.value.completedChapterIds).toEqual(['chapter-01']);
    expect(context.storageError.value).toContain('無法清除學習進度');
  });
});
