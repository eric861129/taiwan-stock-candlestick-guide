import { describe, expect, it } from 'vitest';
import { LEARNING_STAGES } from './stages';
import { PASSING_QUESTION_COUNT, scoreStageQuiz } from './quizzes';
import { STAGE_QUIZZES } from './quizzes';

describe('stage quizzes', () => {
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
