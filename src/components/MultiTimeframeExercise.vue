<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';

type LongTermDirection = 'up' | 'down' | 'neutral' | 'undetermined';
type WeeklyRelationship = 'aligned' | 'partially-aligned' | 'divergent' | 'insufficient-evidence';
type DailyCheck = 'forming' | 'confirmed' | 'invalid' | 'insufficient-evidence';
type ExerciseStep = '1m' | '1w' | '1d';

interface ExerciseAnswers {
  monthlyDirection: LongTermDirection | null;
  monthlyKeyArea: string;
  weeklyRelationship: WeeklyRelationship | null;
  dailyCheck: DailyCheck | null;
}

const props = withDefaults(defineProps<{
  stockName: string;
  stockCode: string;
  cutoffDate: string | null;
  answers: ExerciseAnswers;
  activeTimeframe?: ExerciseStep;
  revealed?: boolean;
  monthlyHint?: string;
  weeklyHint?: string;
  dailyHint?: string;
  summaryLabel?: string;
}>(), {
  activeTimeframe: undefined,
  revealed: false,
  monthlyHint: '先記錄月 K 的長期背景與值得持續觀察的區域。',
  weeklyHint: '月 K 完成後，再比較週 K 的中期背景；這個判斷不會改變任何週期的規則符合度。',
  dailyHint: '最後只核對近期完成 K 棒是否已滿足確認或失效條件，不把形成中的輪廓當成定案。',
  summaryLabel: '三週期摘要',
});

const emit = defineEmits<{
  'update:answers': [answers: ExerciseAnswers];
  'select-timeframe': [timeframe: ExerciseStep];
  'reveal-summary': [answers: ExerciseAnswers];
}>();

const monthlyComplete = computed(() => (
  props.answers.monthlyDirection !== null && props.answers.monthlyKeyArea.trim().length > 0
));
const weeklyComplete = computed(() => monthlyComplete.value && props.answers.weeklyRelationship !== null);
const dailyComplete = computed(() => weeklyComplete.value && props.answers.dailyCheck !== null);
const isComplete = computed(() => dailyComplete.value);
const summaryRevealed = computed(() => props.revealed && isComplete.value);
const activeStep = ref<ExerciseStep>('1m');
const stepButtons = ref(new Map<ExerciseStep, HTMLButtonElement>());
const stepOrder: readonly ExerciseStep[] = ['1m', '1w', '1d'];
const displayedStep = computed<ExerciseStep>(() => {
  const requestedStep = props.activeTimeframe ?? activeStep.value;
  if (requestedStep === '1d' && !weeklyComplete.value) return monthlyComplete.value ? '1w' : '1m';
  if (requestedStep === '1w' && !monthlyComplete.value) return '1m';
  return requestedStep;
});
const progressMessage = computed(() => {
  if (!monthlyComplete.value) return '第一步：先完成月 K 的長期背景與關鍵區記錄。';
  if (!weeklyComplete.value) return '第二步：月 K 已完成，請判斷週 K 是否呼應較長週期背景。';
  if (!dailyComplete.value) return '第三步：週 K 已完成，請核對日 K 的近期確認或失效狀態。';
  return summaryRevealed.value
    ? '月 K、週 K、日 K 練習已完成，三週期摘要已揭露。'
    : '三個步驟已完成，可以揭露三週期摘要。';
});

const monthlyDirections: readonly { value: LongTermDirection; label: string }[] = [
  { value: 'up', label: '偏多背景' },
  { value: 'down', label: '偏空背景' },
  { value: 'neutral', label: '中性背景' },
  { value: 'undetermined', label: '未決背景' },
];

const weeklyRelationships: readonly { value: WeeklyRelationship; label: string }[] = [
  { value: 'aligned', label: '與月 K 背景一致' },
  { value: 'partially-aligned', label: '與月 K 部分一致' },
  { value: 'divergent', label: '與月 K 出現分歧' },
  { value: 'insufficient-evidence', label: '週 K 證據不足' },
];

const dailyChecks: readonly { value: DailyCheck; label: string }[] = [
  { value: 'forming', label: '形成中，尚未確認' },
  { value: 'confirmed', label: '已確認' },
  { value: 'invalid', label: '已失效' },
  { value: 'insufficient-evidence', label: '證據不足' },
];

function stepLabel(step: ExerciseStep): string {
  return ({
    '1m': '第一步：月 K',
    '1w': '第二步：週 K',
    '1d': '第三步：日 K',
  })[step];
}

function isStepUnlocked(step: ExerciseStep): boolean {
  if (step === '1m') return true;
  if (step === '1w') return monthlyComplete.value;
  return weeklyComplete.value;
}

function setStepButton(
  step: ExerciseStep,
  element: Element | ComponentPublicInstance | null,
): void {
  if (element instanceof HTMLButtonElement) {
    stepButtons.value.set(step, element);
    return;
  }
  stepButtons.value.delete(step);
}

function selectStep(step: ExerciseStep): void {
  if (!isStepUnlocked(step)) return;
  activeStep.value = step;
  emit('select-timeframe', step);
}

function moveStep(event: KeyboardEvent, currentStep: ExerciseStep): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const unlockedSteps = stepOrder.filter(isStepUnlocked);
  if (unlockedSteps.length === 0) return;
  const currentIndex = Math.max(0, unlockedSteps.indexOf(currentStep));
  let nextIndex = currentIndex;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + unlockedSteps.length) % unlockedSteps.length;
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % unlockedSteps.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = unlockedSteps.length - 1;
  }
  const nextStep = unlockedSteps[nextIndex];
  if (!nextStep) return;
  event.preventDefault();
  selectStep(nextStep);
  stepButtons.value.get(nextStep)?.focus();
}

function updateAnswers(patch: Partial<ExerciseAnswers>): void {
  emit('update:answers', { ...props.answers, ...patch });
}

function updateMonthlyDirection(event: Event): void {
  updateAnswers({ monthlyDirection: (event.target as HTMLInputElement).value as LongTermDirection });
}

function updateMonthlyKeyArea(event: Event): void {
  updateAnswers({ monthlyKeyArea: (event.target as HTMLTextAreaElement).value });
}

function updateWeeklyRelationship(event: Event): void {
  updateAnswers({ weeklyRelationship: (event.target as HTMLInputElement).value as WeeklyRelationship });
}

function updateDailyCheck(event: Event): void {
  updateAnswers({ dailyCheck: (event.target as HTMLInputElement).value as DailyCheck });
}

function revealSummary(): void {
  if (!isComplete.value) return;
  emit('reveal-summary', props.answers);
}
</script>

<template>
  <section
    class="multi-timeframe-exercise"
    data-multitimeframe-practice
    aria-labelledby="multi-timeframe-exercise-title"
  >
    <h2 id="multi-timeframe-exercise-title">
      月 K 到日 K 互動練習
    </h2>
    <p>
      以同一股票、同一資料截止日逐步記錄可觀察事實，不用後續走勢替前一步補答案。
    </p>
    <dl class="multi-timeframe-exercise__context">
      <div>
        <dt>股票</dt>
        <dd>{{ props.stockName }}（{{ props.stockCode }}）</dd>
      </div>
      <div>
        <dt>資料截止日</dt>
        <dd>{{ props.cutoffDate ? `資料截止日 ${props.cutoffDate}` : '資料截止日無法判定' }}</dd>
      </div>
    </dl>

    <output
      data-exercise-progress
      class="multi-timeframe-exercise__progress"
      aria-live="polite"
      aria-atomic="true"
    >{{ progressMessage }}</output>

    <div
      class="multi-timeframe-exercise__step-controls"
      role="group"
      aria-label="月 K 到日 K 練習步驟"
    >
      <button
        v-for="step in stepOrder"
        :key="step"
        :ref="(element) => setStepButton(step, element)"
        type="button"
        :data-exercise-step-button="step"
        :aria-pressed="displayedStep === step"
        :disabled="!isStepUnlocked(step)"
        @click="selectStep(step)"
        @keydown="moveStep($event, step)"
      >
        {{ stepLabel(step) }}
      </button>
    </div>

    <form
      class="multi-timeframe-exercise__steps"
      @submit.prevent
    >
      <fieldset
        v-show="displayedStep === '1m'"
        data-exercise-step="1m"
      >
        <legend>第一步：月 K 記錄長期方向與關鍵區</legend>
        <p>{{ props.monthlyHint }}</p>
        <div class="multi-timeframe-exercise__options">
          <label
            v-for="option in monthlyDirections"
            :key="option.value"
          >
            <input
              name="monthly-direction"
              type="radio"
              :value="option.value"
              :checked="props.answers.monthlyDirection === option.value"
              @change="updateMonthlyDirection"
            >
            {{ option.label }}
          </label>
        </div>
        <label class="multi-timeframe-exercise__text-answer">
          關鍵區記錄
          <textarea
            name="monthly-key-area"
            rows="3"
            :value="props.answers.monthlyKeyArea"
            placeholder="例如：月 K 前高壓力區、長期支撐區，或需要再核對的價格範圍"
            @input="updateMonthlyKeyArea"
          />
        </label>
      </fieldset>

      <fieldset
        v-show="displayedStep === '1w'"
        data-exercise-step="1w"
        :disabled="!monthlyComplete"
      >
        <legend>第二步：週 K 判斷中期結構是否呼應</legend>
        <p>{{ props.weeklyHint }}</p>
        <div class="multi-timeframe-exercise__options">
          <label
            v-for="option in weeklyRelationships"
            :key="option.value"
          >
            <input
              name="weekly-relationship"
              type="radio"
              :value="option.value"
              :checked="props.answers.weeklyRelationship === option.value"
              @change="updateWeeklyRelationship"
            >
            {{ option.label }}
          </label>
        </div>
      </fieldset>

      <fieldset
        v-show="displayedStep === '1d'"
        data-exercise-step="1d"
        :disabled="!weeklyComplete"
      >
        <legend>第三步：日 K 核對近期確認與失效</legend>
        <p>{{ props.dailyHint }}</p>
        <div class="multi-timeframe-exercise__options">
          <label
            v-for="option in dailyChecks"
            :key="option.value"
          >
            <input
              name="daily-check"
              type="radio"
              :value="option.value"
              :checked="props.answers.dailyCheck === option.value"
              @change="updateDailyCheck"
            >
            {{ option.label }}
          </label>
        </div>
      </fieldset>
    </form>

    <section
      v-if="!summaryRevealed"
      data-exercise-summary-locked
      class="multi-timeframe-exercise__summary-lock"
      aria-label="已鎖住的三週期摘要"
    >
      <p v-if="!isComplete">
        完成月 K、週 K、日 K 三個步驟後，才會揭露{{ props.summaryLabel }}。
      </p>
      <template v-else>
        <p>三個步驟已完成。你可以查看{{ props.summaryLabel }}，核對自己的觀察與各週期的獨立結果。</p>
        <button
          type="button"
          data-exercise-reveal
          @click="revealSummary"
        >
          查看{{ props.summaryLabel }}
        </button>
      </template>
    </section>
    <section
      v-else
      data-exercise-summary-revealed
      class="multi-timeframe-exercise__summary-revealed"
      aria-label="已揭露的三週期摘要"
    >
      <slot name="summary">
        <p>{{ props.summaryLabel }}已揭露。請比較月 K、週 K、日 K 的獨立背景、候選與狀態。</p>
      </slot>
    </section>
  </section>
</template>

<style scoped>
.multi-timeframe-exercise {
  width: min(100% - 2rem, 76rem);
  margin: 2rem auto;
}

.multi-timeframe-exercise__context {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  margin: 1rem 0;
}

.multi-timeframe-exercise__context div {
  display: grid;
  gap: 0.15rem;
}

.multi-timeframe-exercise__context dt {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
}

.multi-timeframe-exercise__context dd {
  margin: 0;
  font-weight: 700;
}

.multi-timeframe-exercise__progress {
  display: block;
  min-height: 1.5rem;
  margin: 1rem 0;
  color: var(--vp-c-text-2);
}

.multi-timeframe-exercise__steps {
  display: grid;
  gap: 1rem;
}

.multi-timeframe-exercise__step-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}

.multi-timeframe-exercise fieldset,
.multi-timeframe-exercise__summary-lock,
.multi-timeframe-exercise__summary-revealed {
  margin: 0;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.multi-timeframe-exercise fieldset:disabled {
  opacity: 0.65;
}

.multi-timeframe-exercise legend {
  padding: 0 0.35rem;
  font-weight: 700;
}

.multi-timeframe-exercise__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1rem;
}

.multi-timeframe-exercise__options label {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
}

.multi-timeframe-exercise__text-answer {
  display: grid;
  gap: 0.35rem;
  margin-top: 1rem;
  font-weight: 700;
}

.multi-timeframe-exercise textarea,
.multi-timeframe-exercise button {
  min-height: 2.5rem;
  padding: 0.45rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.45rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
}

.multi-timeframe-exercise__step-controls button[aria-pressed='true'] {
  border-width: 2px;
  background: var(--vp-c-brand-soft);
}

.multi-timeframe-exercise__summary-lock,
.multi-timeframe-exercise__summary-revealed {
  margin-top: 1rem;
}

@media (max-width: 700px) {
  .multi-timeframe-exercise {
    width: min(100% - 1.25rem, 76rem);
  }

  .multi-timeframe-exercise__options {
    display: grid;
  }
}
</style>
