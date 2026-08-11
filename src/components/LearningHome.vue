<script setup lang="ts">
import { computed, ref } from 'vue';
import { LEARNING_STAGES } from '../domain/learning/stages';
import type { QuizResult } from '../domain/learning/quizzes';
import LearningMap from './LearningMap.vue';
import StageQuiz from './StageQuiz.vue';
import { useLearningProgress } from './learningProgressContext';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const context = useLearningProgress();
const statusMessage = ref('');
const errorMessage = ref('');
const passedCount = computed(() => context.progress.value.passedStageIds.length);
const visibleErrorMessage = computed(() => errorMessage.value || context.storageError.value);

function handleQuiz(result: QuizResult): void {
  context.recordQuizResult(result);
  statusMessage.value = context.storageError.value
    ? '測驗結果已保留在本頁面記憶體，尚未寫入瀏覽器儲存。'
    : result.passed
      ? `已記錄：${result.stageId} 通過。`
      : `已記錄：${result.stageId} 本次未通過，可再試一次。`;
  errorMessage.value = '';
}

function downloadProgress(): void {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('瀏覽器下載功能不可用');
    }
    const blob = new Blob([context.exportProgressJson()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'tw-candlestick-learning-progress-v1.json';
    anchor.click();
    URL.revokeObjectURL(url);
    statusMessage.value = '學習進度已匯出。';
    errorMessage.value = '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? `無法匯出學習進度：${error.message}` : '無法匯出學習進度。';
    statusMessage.value = '';
  }
}

async function importProgress(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    context.importProgressJson(await file.text());
    statusMessage.value = context.storageError.value
      ? '進度已匯入本頁面記憶體，尚未寫入瀏覽器儲存。'
      : '學習進度已匯入。';
    errorMessage.value = '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '無法匯入學習進度';
    statusMessage.value = '';
  } finally {
    input.value = '';
  }
}

function clearProgress(): void {
  context.clearProgress();
  statusMessage.value = context.storageError.value ? '' : '學習進度已清除。';
  errorMessage.value = '';
}
</script>

<template>
  <section
    class="learning-home"
    aria-labelledby="learning-home-title"
  >
    <h2 id="learning-home-title">
      五階段學習旅程
    </h2>
    <p>目前已通過 {{ passedCount }}/5 個階段。所有章節都保持開放，測驗只是幫你整理學習節奏。</p>

    <div
      class="learning-home__actions"
      aria-label="進度管理"
    >
      <button
        type="button"
        @click="downloadProgress"
      >
        匯出進度
      </button>
      <label>
        匯入進度
        <input
          type="file"
          accept="application/json,.json"
          @change="importProgress"
        >
      </label>
      <button
        type="button"
        @click="clearProgress"
      >
        清除進度
      </button>
    </div>
    <p
      v-if="statusMessage"
      aria-live="polite"
    >
      {{ statusMessage }}
    </p>
    <p
      v-if="visibleErrorMessage"
      role="alert"
    >
      {{ visibleErrorMessage }}
    </p>

    <template v-if="!compact">
      <LearningMap
        :progress="context.progress.value"
        @complete-chapter="context.markChapterComplete"
      />
      <section aria-labelledby="quiz-list-title">
        <h3 id="quiz-list-title">
          階段測驗
        </h3>
        <div
          v-for="stage in LEARNING_STAGES"
          :key="stage.id"
          class="learning-home__quiz"
        >
          <h4>{{ stage.title }}</h4>
          <StageQuiz
            :stage-id="stage.id"
            @completed="handleQuiz"
          />
        </div>
      </section>
    </template>
  </section>
</template>
