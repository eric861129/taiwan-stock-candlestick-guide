<script setup lang="ts">
import { computed } from 'vue';
import { getPatternCard } from '../domain/patterns/catalog';
import type {
  StructureAnalysisResult,
  StructureCandidate,
  StructureRuleEvaluation,
} from '../domain/structures/types';
import PatternGlyph from './PatternGlyph.vue';

const props = defineProps<{
  structureResult: StructureAnalysisResult;
  selectedStructureCandidateId?: string | null;
}>();

const emit = defineEmits<{
  'select-structure-candidate': [candidateId: string];
}>();

const candidates = computed(() => props.structureResult.candidates.slice(0, 3));

const effectiveSelectedCandidateId = computed(() => {
  const selectedExists = candidates.value.some(
    (candidate) => candidate.candidateId === props.selectedStructureCandidateId,
  );
  return selectedExists
    ? props.selectedStructureCandidateId
    : candidates.value[0]?.candidateId ?? null;
});

function isSelected(candidate: StructureCandidate): boolean {
  return effectiveSelectedCandidateId.value === candidate.candidateId;
}

function statusLabel(candidate: StructureCandidate): string {
  return candidate.status === 'confirmed' ? '已確認' : '形成中';
}

function directionLabel(candidate: StructureCandidate): string {
  const labels: Record<StructureCandidate['direction'], string> = {
    up: '已向上離開邊界',
    down: '已向下離開邊界',
    undetermined: '尚未離開邊界',
  };
  return labels[candidate.direction];
}

function evaluationStateLabel(evaluation: StructureRuleEvaluation): string {
  if (evaluation.group === 'invalidating' && evaluation.state === 'met') {
    return '失效條件成立';
  }
  const labels: Record<StructureRuleEvaluation['state'], string> = {
    met: '符合',
    'not-met': '未符合',
    unavailable: '目前無法評估',
  };
  return labels[evaluation.state];
}

function selectCandidate(candidate: StructureCandidate): void {
  emit('select-structure-candidate', candidate.candidateId);
}
</script>

<template>
  <section
    class="structure-comparison-panel"
    aria-label="最接近的完整價格結構"
  >
    <header class="structure-comparison-panel__header">
      <h2>最接近的完整價格結構</h2>
      <p>最多呈現三個通過門檻的候選。規則符合度只表示結構接近程度，不是機率或價格預測。</p>
    </header>
    <ol
      v-if="candidates.length > 0"
      class="structure-comparison-panel__list"
    >
      <li
        v-for="(candidate, index) in candidates"
        :key="candidate.candidateId"
      >
        <article
          class="structure-comparison-panel__candidate"
          :class="{ 'structure-comparison-panel__candidate--selected': isSelected(candidate) }"
          data-structure-comparison-candidate
          :data-selected="isSelected(candidate) ? 'true' : 'false'"
        >
          <header class="structure-comparison-panel__candidate-header">
            <h3>第 {{ index + 1 }} 名・{{ getPatternCard(candidate.structureId).nameZhTw }}</h3>
            <span
              class="structure-comparison-panel__status"
              :class="`structure-comparison-panel__status--${candidate.status}`"
            >{{ statusLabel(candidate) }}</span>
          </header>
          <p class="structure-comparison-panel__fit">
            規則符合度 {{ candidate.ruleFit }}
          </p>
          <div class="structure-comparison-panel__candidate-content">
            <figure class="structure-comparison-panel__figure">
              <PatternGlyph :pattern-id="candidate.structureId" />
              <figcaption>{{ getPatternCard(candidate.structureId).nameZhTw }}的標準教學示意圖</figcaption>
            </figure>
            <dl class="structure-comparison-panel__summary">
              <div>
                <dt>形成區間</dt>
                <dd>{{ candidate.window.startDate }} 至 {{ candidate.window.endDate }}（{{ candidate.window.barCount }} 根）</dd>
              </div>
              <div>
                <dt>目前狀態</dt>
                <dd>{{ directionLabel(candidate) }}</dd>
              </div>
            </dl>
            <p><strong>確認條件：</strong>{{ candidate.confirmationCondition }}</p>
            <p><strong>失效條件：</strong>{{ candidate.invalidationCondition }}</p>
          </div>
          <button
            type="button"
            data-select-structure-candidate
            :aria-pressed="isSelected(candidate)"
            @click="selectCandidate(candidate)"
          >
            {{ isSelected(candidate) ? '目前圖表疊線' : '套用到圖表' }}
          </button>
          <details :open="isSelected(candidate)">
            <summary>完整規則與條件式情境</summary>
            <section v-if="candidate.evaluations.length > 0">
              <h4>規則核對</h4>
              <ul>
                <li
                  v-for="evaluation in candidate.evaluations"
                  :key="evaluation.ruleId"
                >
                  <strong>{{ evaluation.label }}：{{ evaluationStateLabel(evaluation) }}</strong>
                  <span>。{{ evaluation.explanation }}</span>
                </li>
              </ul>
            </section>
            <section v-if="candidate.overlay.scenario?.conditions?.length">
              <h4>{{ candidate.overlay.scenario.label }}</h4>
              <ul>
                <li
                  v-for="condition in candidate.overlay.scenario.conditions"
                  :key="condition.kind"
                >
                  <strong>{{ condition.label }}：</strong>{{ condition.condition }}
                </li>
              </ul>
            </section>
            <section v-if="candidate.warnings.length > 0">
              <h4>限制與提醒</h4>
              <ul>
                <li
                  v-for="warning in candidate.warnings"
                  :key="warning"
                >
                  {{ warning }}
                </li>
              </ul>
            </section>
          </details>
        </article>
      </li>
    </ol>
    <p
      v-else
      class="structure-comparison-panel__empty"
      role="status"
    >
      無明顯價格結構；本次不會為了補滿三個而加入低於門檻的結果。
    </p>
  </section>
</template>

<style scoped>
.structure-comparison-panel {
  min-width: 0;
}

.structure-comparison-panel__header h2,
.structure-comparison-panel__header p,
.structure-comparison-panel__candidate h3,
.structure-comparison-panel__candidate h4,
.structure-comparison-panel__candidate p {
  margin-top: 0;
}

.structure-comparison-panel__header h2 {
  font-size: 1.15rem;
}

.structure-comparison-panel__header p {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
}

.structure-comparison-panel__list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.structure-comparison-panel__candidate {
  padding: 0.875rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg);
}

.structure-comparison-panel__candidate--selected {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 1px var(--vp-c-brand-1);
}

.structure-comparison-panel__candidate-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.structure-comparison-panel__candidate-header h3 {
  font-size: 1rem;
  line-height: 1.4;
}

.structure-comparison-panel__status {
  flex: 0 0 auto;
  padding: 0.15rem 0.45rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}

.structure-comparison-panel__status--forming {
  color: #8a5200;
  background: #fff8e5;
}

.structure-comparison-panel__status--confirmed {
  color: #15583a;
  background: #eaf8f0;
}

.structure-comparison-panel__fit {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
  font-weight: 700;
}

.structure-comparison-panel__figure {
  margin: 0 0 0.75rem;
  padding: 0.5rem;
  border-radius: 0.5rem;
  background: var(--vp-c-bg-soft);
}

.structure-comparison-panel__figure :deep(.pattern-glyph) {
  min-height: 7rem;
  max-height: 8rem;
}

.structure-comparison-panel__figure figcaption {
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
  text-align: center;
}

.structure-comparison-panel__summary {
  display: grid;
  gap: 0.4rem;
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
}

.structure-comparison-panel__summary div {
  display: grid;
  grid-template-columns: 4.5rem 1fr;
  gap: 0.5rem;
}

.structure-comparison-panel__summary dt {
  font-weight: 700;
}

.structure-comparison-panel__summary dd {
  margin: 0;
}

.structure-comparison-panel__candidate > p {
  font-size: 0.875rem;
}

.structure-comparison-panel button {
  min-height: 2.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.45rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}

.structure-comparison-panel button[aria-pressed='true'] {
  background: #eef5ff;
  color: #1e3655;
  font-weight: 700;
}

.structure-comparison-panel details {
  margin-top: 0.75rem;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 0.75rem;
  font-size: 0.875rem;
}

.structure-comparison-panel summary {
  cursor: pointer;
  font-weight: 700;
}

.structure-comparison-panel details section {
  margin-top: 0.75rem;
}

.structure-comparison-panel details ul {
  margin-bottom: 0;
  padding-left: 1.25rem;
}

.structure-comparison-panel__empty {
  padding: 1rem;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 0.75rem;
  color: var(--vp-c-text-2);
}

@media (max-width: 767px) {
  .structure-comparison-panel__candidate:not(.structure-comparison-panel__candidate--selected) {
    padding-bottom: 0.75rem;
  }

  .structure-comparison-panel__candidate[data-selected='false'] .structure-comparison-panel__candidate-content,
  .structure-comparison-panel__candidate[data-selected='false'] details {
    display: none;
  }
}
</style>
