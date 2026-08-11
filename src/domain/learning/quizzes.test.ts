import { describe, expect, it } from 'vitest';
import { LEARNING_STAGES } from './stages';
import { PASSING_QUESTION_COUNT, scoreStageQuiz } from './quizzes';
import { STAGE_QUIZZES } from './quizzes';

describe('stage quizzes', () => {
  const expectedCorrectAnswers = [
    ['stage-1-question-1', 'b', '開盤價'],
    ['stage-1-question-2', 'a', '週期內曾到達但未必收在那裡的價格範圍'],
    ['stage-1-question-3', 'c', '時間週期與原始或調整價格口徑'],
    ['stage-1-question-4', 'd', '該段交易活動的相對程度'],
    ['stage-1-question-5', 'b', '型態是條件式觀察，需要背景與失效條件'],
    ['stage-2-question-1', 'b', '描述價格結構與高低點關係'],
    ['stage-2-question-2', 'c', '可能出現反應的價格區域'],
    ['stage-2-question-3', 'd', '檢查收盤位置、後續回測與背景'],
    ['stage-2-question-4', 'a', '讓較大週期提供背景，再用小週期描述觸發'],
    ['stage-2-question-5', 'a', '缺口大小與所在背景'],
    ['stage-3-question-1', 'a', '上方曾有較高成交但收回的痕跡'],
    ['stage-3-question-2', 'a', '發生位置與前後背景'],
    ['stage-3-question-3', 'a', '條件未被確認或後續被否定'],
    ['stage-3-question-4', 'a', '價差與零星成交可能放大形狀'],
    ['stage-3-question-5', 'a', '提醒名稱不能取代證據'],
    ['stage-4-question-1', 'a', '波動程度的參考尺度'],
    ['stage-4-question-2', 'a', '先寫情境，再列觸發與失效條件'],
    ['stage-4-question-3', 'a', '把單筆風險控制在可承受範圍'],
    ['stage-4-question-4', 'a', '條件不完整或失效界線無法清楚定義'],
    ['stage-4-question-5', 'a', '風險報酬與長期紀錄'],
    ['stage-5-question-1', 'a', '先寫下當下可見證據'],
    ['stage-5-question-2', 'a', '讓事後回顧能對照原先條件'],
    ['stage-5-question-3', 'a', '辨識自己如何跳過證據或風險界線'],
    ['stage-5-question-4', 'a', '可查核的觀察、條件與風險紀錄'],
    ['stage-5-question-5', 'a', '所有章節仍可自由開啟'],
  ] as const;

  it('keeps all 25 approved answer IDs and answer text aligned', () => {
    const actual = STAGE_QUIZZES.flatMap((quiz) =>
      quiz.questions.map((question) => {
        const correctOption = question.options.find((option) => option.id === question.correctOptionId);
        return [question.id, question.correctOptionId, correctOption?.label ?? ''] as const;
      }),
    );

    expect(actual).toEqual(expectedCorrectAnswers);
    expect(actual.every(([, , label]) => !/必然|保證|目標價|隔日一定|未來方向/.test(label))).toBe(true);
  });

  it('contains exactly five questions for each of the five stages', () => {
    expect(LEARNING_STAGES).toHaveLength(5);
    expect(STAGE_QUIZZES).toHaveLength(5);
    expect(STAGE_QUIZZES.every((quiz) => Array.isArray(quiz.questions))).toBe(true);
    expect(STAGE_QUIZZES.every((quiz) => quiz.questions.length === 5)).toBe(true);

    const questionIds = STAGE_QUIZZES.flatMap((quiz) => quiz.questions.map((question) => question.id));
    expect(new Set(questionIds).size).toBe(25);
    expect(
      STAGE_QUIZZES.flatMap((quiz) => quiz.questions).every(
        (question) =>
          question.options.length >= 2 &&
          question.options.some((option) => option.id === question.correctOptionId) &&
          question.explanation.trim().length > 0,
      ),
    ).toBe(true);
  });

  it('passes a stage with four of five answers and never locks chapters', () => {
    const result = scoreStageQuiz('stage-1', ['b', 'a', 'c', 'd', 'a']);

    expect(result.correctCount).toBe(4);
    expect(result.totalQuestionCount).toBe(5);
    expect(result.passed).toBe(true);
    expect(PASSING_QUESTION_COUNT).toBe(4);
    expect(LEARNING_STAGES.flatMap((stage) => stage.chapters)).toHaveLength(20);
    expect(new Set(LEARNING_STAGES.flatMap((stage) => stage.chapters.map((chapter) => chapter.id))).size).toBe(20);
    expect(LEARNING_STAGES.every((stage) => stage.chapters.every((chapter) => chapter.available))).toBe(true);
  });

  it('allows retrying a failed quiz without changing the question set', () => {
    const result = scoreStageQuiz('stage-2', ['a', 'a', 'a', 'a', 'a']);
    expect(result.passed).toBe(false);
    expect(result.correctCount).toBeLessThan(4);
    expect(scoreStageQuiz('stage-2', result.correctOptionIds)).toMatchObject({ passed: true });
  });

  it('rejects unknown stages', () => {
    expect(() => scoreStageQuiz('stage-99', [])).toThrow('找不到學習階段');
  });
});
