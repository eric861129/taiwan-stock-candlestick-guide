<script setup lang="ts">
import { reactive, ref } from 'vue';
import { getStageQuiz, scoreStageQuiz, type QuizResult } from '../domain/learning/quizzes';

const props = defineProps<{ stageId: string }>();
const emit = defineEmits<{ completed: [result: QuizResult] }>();
const quiz = getStageQuiz(props.stageId);
const answers = reactive<Record<string, string>>({});
const result = ref<QuizResult | null>(null);

function submitQuiz(): void {
  const selectedAnswers = quiz.questions.map((question) => answers[question.id] ?? '');
  result.value = scoreStageQuiz(props.stageId, selectedAnswers);
  emit('completed', result.value);
}

function retry(): void {
  for (const question of quiz.questions) {
    delete answers[question.id];
  }
  result.value = null;
}
</script>

<template>
  <section
    class="stage-quiz"
    :aria-labelledby="`${props.stageId}-quiz-title`"
  >
    <h2 :id="`${props.stageId}-quiz-title`">
      階段小測驗
    </h2>
    <p>共五題，答對四題即可通過；答錯可以不限次數重試。</p>
    <form @submit.prevent="submitQuiz">
      <fieldset
        v-for="(question, questionIndex) in quiz.questions"
        :key="question.id"
      >
        <legend>{{ questionIndex + 1 }}. {{ question.prompt }}</legend>
        <label
          v-for="option in question.options"
          :key="option.id"
        >
          <input
            v-model="answers[question.id]"
            type="radio"
            :name="question.id"
            :value="option.id"
          >
          <span>{{ option.id.toUpperCase() }}. {{ option.label }}</span>
        </label>
      </fieldset>
      <button type="submit">
        送出答案
      </button>
    </form>

    <div
      aria-live="polite"
      class="stage-quiz__result"
    >
      <template v-if="result">
        <p>
          {{ result.passed ? '恭喜通過！' : '這次還沒通過，再檢查觀察條件。' }}
          得分 {{ result.correctCount }}/{{ result.totalQuestionCount }} 分
        </p>
        <ol>
          <li
            v-for="(explanation, index) in result.explanations"
            :key="`${result.stageId}-${index}`"
          >
            {{ explanation }}
          </li>
        </ol>
        <button
          type="button"
          @click="retry"
        >
          再試一次
        </button>
      </template>
    </div>
  </section>
</template>
