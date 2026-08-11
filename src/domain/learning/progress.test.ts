import { describe, expect, it } from 'vitest';
import {
  exportProgress,
  importProgress,
  loadProgress,
  PROGRESS_STORAGE_KEY,
  saveProgress,
  type LearningProgressV1,
} from './progress';

function createStorage(initial?: string): Storage {
  let value = initial ?? null;
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
    length: value === null ? 0 : 1,
  };
}

const progress: LearningProgressV1 = {
  schemaVersion: 1,
  completedChapterIds: ['chapter-01'],
  passedStageIds: ['stage-1'],
  quizAttempts: { 'stage-1': 2 },
  updatedAt: '2026-08-11T00:00:00.000Z',
};

describe('learning progress v1', () => {
  it('loads an empty v1 progress when storage is empty', () => {
    expect(loadProgress(createStorage())).toEqual({
      schemaVersion: 1,
      completedChapterIds: [],
      passedStageIds: [],
      quizAttempts: {},
      updatedAt: expect.any(String),
    });
  });

  it('saves and loads progress through the versioned storage key', () => {
    const storage = createStorage();
    saveProgress(storage, progress);

    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBe(JSON.stringify(progress));
    expect(loadProgress(storage)).toEqual(progress);
  });

  it('round-trips progress through JSON export and import', () => {
    expect(importProgress(exportProgress(progress))).toEqual(progress);
  });

  it('rejects an unknown or future progress schema', () => {
    expect(() => importProgress('{"schemaVersion":99}')).toThrow('不支援的學習進度版本');
  });

  it('rejects malformed progress data with a Traditional Chinese error', () => {
    expect(() => importProgress('{"schemaVersion":1,"completedChapterIds":"not-an-array"}')).toThrow(
      '學習進度格式無效',
    );
  });

  it('rejects an import larger than 256 KiB before parsing', () => {
    const oversized = 'x'.repeat(256 * 1024 + 1);
    expect(() => importProgress(oversized)).toThrow('學習進度檔案不可超過 256 KiB');
  });

  it.each([
    ['unknown chapter ID', { completedChapterIds: ['chapter-99'] }],
    ['duplicate chapter ID', { completedChapterIds: ['chapter-01', 'chapter-01'] }],
    ['unknown stage ID', { passedStageIds: ['stage-99'] }],
    ['duplicate stage ID', { passedStageIds: ['stage-1', 'stage-1'] }],
    ['unknown quiz attempt stage', { quizAttempts: { 'stage-99': 1 } }],
  ])('rejects %s outside the approved learning allowlist', (_label, override) => {
    const invalidProgress = { ...progress, ...override };
    expect(() => importProgress(JSON.stringify(invalidProgress))).toThrow('學習進度格式無效');
  });
});
