<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';

type Timeframe = '1m' | '1w' | '1d';
type PriceMode = 'raw' | 'adjusted';
type Background = 'up' | 'down' | 'neutral' | 'undetermined';
type AnalysisStatus = 'matched' | 'no-clear-pattern' | 'insufficient-evidence' | 'unavailable';
type CandidateStatus = 'forming' | 'confirmed' | 'invalid' | 'insufficient-evidence';
type OverallStatus = 'aligned' | 'partially-aligned' | 'divergent' | 'insufficient-evidence';

interface SummaryCandidate {
  candidateId: string;
  name: string;
  ruleFit: number;
  status: CandidateStatus;
}

interface TimeframeSummary {
  timeframe: Timeframe;
  cutoffDate: string | null;
  availableBarCount: number;
  priceMode: PriceMode;
  background: Background;
  analysisStatus: AnalysisStatus;
  candidates: readonly SummaryCandidate[];
}

const props = withDefaults(defineProps<{
  periods: readonly TimeframeSummary[];
  overallStatus: OverallStatus;
  activeTimeframe: Timeframe;
  selectedCandidateIds?: Partial<Record<Timeframe, string | null>>;
}>(), {
  selectedCandidateIds: () => ({}),
});

const emit = defineEmits<{
  'select-timeframe': [timeframe: Timeframe];
  'select-candidate': [selection: { timeframe: Timeframe; candidateId: string }];
}>();

const timeframeOrder: readonly Timeframe[] = ['1m', '1w', '1d'];
const timeframeButtons = ref(new Map<Timeframe, HTMLButtonElement>());

const periodsByTimeframe = computed(() => new Map(props.periods.map((period) => [period.timeframe, period])));
const orderedPeriods = computed(() => timeframeOrder.flatMap((timeframe) => {
  const period = periodsByTimeframe.value.get(timeframe);
  return period ? [period] : [];
}));

function timeframeLabel(timeframe: Timeframe): string {
  return ({ '1m': '月 K', '1w': '週 K', '1d': '日 K' })[timeframe];
}

function priceModeLabel(priceMode: PriceMode): string {
  return priceMode === 'adjusted' ? '向後還原價格' : '官方原始價格';
}

function backgroundLabel(background: Background): string {
  return ({
    up: '偏多背景',
    down: '偏空背景',
    neutral: '中性背景',
    undetermined: '未決背景',
  })[background];
}

function analysisStatusLabel(status: AnalysisStatus | CandidateStatus): string {
  return ({
    matched: '有候選',
    'no-clear-pattern': '無明顯型態',
    'insufficient-evidence': '證據不足',
    unavailable: '暫時無法分析',
    forming: '形成中',
    confirmed: '已確認',
    invalid: '已失效',
  })[status];
}

function overallStatusLabel(status: OverallStatus): string {
  return ({
    aligned: '週期一致',
    'partially-aligned': '部分一致',
    divergent: '週期分歧',
    'insufficient-evidence': '證據不足',
  })[status];
}

function firstCandidate(period: TimeframeSummary): SummaryCandidate | undefined {
  return period.candidates[0];
}

const activePeriod = computed(() => periodsByTimeframe.value.get(props.activeTimeframe));
const activeSelectedCandidate = computed(() => {
  const period = activePeriod.value;
  const selectedCandidateId = props.selectedCandidateIds[props.activeTimeframe];
  return period?.candidates.find((candidate) => candidate.candidateId === selectedCandidateId);
});
const selectionAnnouncement = computed(() => {
  const label = timeframeLabel(props.activeTimeframe);
  const candidate = activeSelectedCandidate.value;
  return candidate
    ? `已選擇 ${label}，候選 ${candidate.name}，規則符合度 ${candidate.ruleFit}。`
    : `已選擇 ${label}。`;
});

function setTimeframeButton(
  timeframe: Timeframe,
  element: Element | ComponentPublicInstance | null,
): void {
  if (element instanceof HTMLButtonElement) {
    timeframeButtons.value.set(timeframe, element);
    return;
  }
  timeframeButtons.value.delete(timeframe);
}

function selectTimeframe(timeframe: Timeframe): void {
  emit('select-timeframe', timeframe);
}

function moveTimeframeSelection(event: KeyboardEvent, currentIndex: number): void {
  const selectablePeriods = orderedPeriods.value;
  if (selectablePeriods.length === 0) return;
  let nextIndex: number | null = null;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + selectablePeriods.length) % selectablePeriods.length;
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % selectablePeriods.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = selectablePeriods.length - 1;
  }
  if (nextIndex === null) return;

  event.preventDefault();
  const nextTimeframe = selectablePeriods[nextIndex]?.timeframe;
  if (!nextTimeframe) return;
  selectTimeframe(nextTimeframe);
  timeframeButtons.value.get(nextTimeframe)?.focus();
}

function isCandidateSelected(period: TimeframeSummary, candidate: SummaryCandidate): boolean {
  return props.selectedCandidateIds[period.timeframe] === candidate.candidateId;
}

function selectCandidate(period: TimeframeSummary, candidate: SummaryCandidate): void {
  emit('select-candidate', { timeframe: period.timeframe, candidateId: candidate.candidateId });
}
</script>

<template>
  <section
    class="multi-timeframe-summary"
    aria-labelledby="multi-timeframe-summary-title"
  >
    <h2 id="multi-timeframe-summary-title">
      多時間週期摘要
    </h2>
    <p>
      整體狀態：<strong data-multitimeframe-overall-status>{{ overallStatusLabel(props.overallStatus) }}</strong>。各週期保留自己的候選與規則符合度，不合併成單一分數。
    </p>

    <div
      class="multi-timeframe-summary__timeframe-controls"
      role="group"
      aria-label="切換詳細檢視週期"
    >
      <button
        v-for="(period, index) in orderedPeriods"
        :key="period.timeframe"
        :ref="(element) => setTimeframeButton(period.timeframe, element)"
        type="button"
        :data-timeframe-tab="period.timeframe"
        :aria-pressed="props.activeTimeframe === period.timeframe"
        @click="selectTimeframe(period.timeframe)"
        @keydown="moveTimeframeSelection($event, index)"
      >
        查看 {{ timeframeLabel(period.timeframe) }} 詳細結果
      </button>
    </div>
    <output
      data-summary-selection-live
      class="multi-timeframe-summary__selection-live"
      aria-live="polite"
      aria-atomic="true"
    >{{ selectionAnnouncement }}</output>

    <div class="multi-timeframe-summary__grid">
      <article
        v-for="period in orderedPeriods"
        :key="period.timeframe"
        class="multi-timeframe-summary__period"
        :data-timeframe-summary="period.timeframe"
      >
        <h3>{{ timeframeLabel(period.timeframe) }}</h3>
        <dl>
          <div>
            <dt>資料截止日</dt>
            <dd>{{ period.cutoffDate ?? '無法判定' }}</dd>
          </div>
          <div>
            <dt>可用根數</dt>
            <dd>{{ period.availableBarCount }} 根</dd>
          </div>
          <div>
            <dt>價格模式</dt>
            <dd>{{ priceModeLabel(period.priceMode) }}</dd>
          </div>
          <div>
            <dt>主要背景</dt>
            <dd>{{ backgroundLabel(period.background) }}</dd>
          </div>
          <div>
            <dt>目前選取候選</dt>
            <dd v-if="firstCandidate(period)">
              {{ firstCandidate(period)?.name }}
            </dd>
            <dd v-else>
              無明顯型態
            </dd>
          </div>
          <div v-if="firstCandidate(period)">
            <dt>規則符合度</dt>
            <dd>規則符合度 {{ firstCandidate(period)?.ruleFit }}</dd>
          </div>
          <div>
            <dt>狀態</dt>
            <dd>{{ analysisStatusLabel(firstCandidate(period)?.status ?? period.analysisStatus) }}</dd>
          </div>
        </dl>
        <div
          v-if="period.candidates.length > 0"
          class="multi-timeframe-summary__candidate-controls"
          :aria-label="`${timeframeLabel(period.timeframe)}候選選擇`"
        >
          <p>保留的候選選擇</p>
          <button
            v-for="candidate in period.candidates"
            :key="candidate.candidateId"
            type="button"
            :data-summary-candidate="candidate.candidateId"
            :aria-pressed="isCandidateSelected(period, candidate)"
            @click="selectCandidate(period, candidate)"
          >
            {{ isCandidateSelected(period, candidate) ? '目前詳細結果：' : '查看詳細結果：' }}{{ candidate.name }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.multi-timeframe-summary {
  width: min(100% - 2rem, 76rem);
  margin: 2rem auto;
}

.multi-timeframe-summary__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.multi-timeframe-summary__timeframe-controls,
.multi-timeframe-summary__candidate-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.multi-timeframe-summary__timeframe-controls {
  margin: 1rem 0 0.5rem;
}

.multi-timeframe-summary__timeframe-controls button,
.multi-timeframe-summary__candidate-controls button {
  min-height: 2.5rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.45rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
}

.multi-timeframe-summary__timeframe-controls button[aria-pressed='true'],
.multi-timeframe-summary__candidate-controls button[aria-pressed='true'] {
  border-width: 2px;
  background: var(--vp-c-brand-soft);
}

.multi-timeframe-summary__selection-live {
  display: block;
  min-height: 1.5rem;
  color: var(--vp-c-text-2);
}

.multi-timeframe-summary__period {
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.multi-timeframe-summary__period h3 {
  margin-top: 0;
}

.multi-timeframe-summary__period dl {
  display: grid;
  gap: 0.75rem;
  margin: 0;
}

.multi-timeframe-summary__period dt {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
}

.multi-timeframe-summary__period dd {
  margin: 0.15rem 0 0;
  font-weight: 700;
}

.multi-timeframe-summary__candidate-controls {
  margin-top: 1rem;
}

.multi-timeframe-summary__candidate-controls p {
  flex-basis: 100%;
  margin: 0;
  color: var(--vp-c-text-2);
  font-weight: 700;
}

@media (max-width: 700px) {
  .multi-timeframe-summary {
    width: min(100% - 1.25rem, 76rem);
  }

  .multi-timeframe-summary__grid {
    grid-template-columns: 1fr;
  }
}
</style>
