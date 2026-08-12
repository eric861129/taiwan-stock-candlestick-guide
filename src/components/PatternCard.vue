<script setup lang="ts">
import { computed, ref } from 'vue';
import { SITE_BASE } from '../domain/site/navigation';
import { getPatternCard } from '../domain/patterns/catalog';
import type { PatternCardDefinition, PatternCollectionId } from '../domain/patterns/types';
import PatternGlyph from './PatternGlyph.vue';

const props = defineProps<{
  card: PatternCardDefinition;
  collection?: PatternCollectionId;
}>();
const isFlipped = ref(false);

const cardContentId = computed(() => `pattern-card-${props.card.id}-content`);
const isTalibContext = computed(() =>
  props.collection === 'talib-advanced' && Boolean(props.card.talibFunction),
);
const displayedDefinition = computed(() =>
  isTalibContext.value
    ? props.card.talibObservableDefinition ?? props.card.observableDefinition
    : props.card.observableDefinition,
);
const displayedDataRequirements = computed(() =>
  isTalibContext.value
    ? props.card.talibDataRequirements ?? props.card.dataRequirements
    : props.card.dataRequirements,
);
const relatedCards = computed(() =>
  (props.card.relatedPatternIds ?? []).map((id) => getPatternCard(id)),
);

const supportLabel = computed(() => {
  if (isTalibContext.value) {
    return props.card.matchSupport === 'mvp'
      ? 'TA-Lib 官方函式只供教學查閱；本站另有短窗規則可比對，但不是官方函式執行結果'
      : 'TA-Lib 官方函式只供教學查閱，第一版不執行此函式的自動辨識';
  }

  switch (props.card.automationSupport) {
    case 'short-window':
      return '短窗規則可參與自動比對';
    case 'structure':
      return '結構引擎可參與自動比對';
    case 'guardrail':
      return '守門提醒：第一版不參與自動比對';
    default:
      return '教學卡：第一版不參與自動比對';
  }
});
const talibMatcherSeparationNotice = computed(() =>
  props.card.talibFunction && props.card.matcher
    ? '本站自動比對使用的是教學用短窗規則，不是 TA-Lib 官方函式執行結果。'
    : undefined,
);

function lessonHref(path: string): string {
  return `${SITE_BASE.replace(/\/$/, '')}${path}`;
}

function toggleCard(): void {
  isFlipped.value = !isFlipped.value;
}

function directionLabel(): string {
  switch (props.card.patternDirection) {
    case 'bullish': return '偏多版本';
    case 'bearish': return '偏空版本';
    case 'both': return '多空皆有';
    default: return '中性／未決';
  }
}

function purposeLabel(): string {
  switch (props.card.patternPurpose) {
    case 'reversal': return '反轉候選';
    case 'continuation': return '延續候選';
    case 'reversal-or-continuation': return '反轉或延續候選';
    case 'weakening': return '動能弱化';
    default: return '猶豫／未決';
  }
}
</script>

<template>
  <article
    class="pattern-card"
    :data-pattern-id="props.card.id"
    :data-match-support="props.card.matchSupport"
  >
    <div
      :id="cardContentId"
      class="pattern-card__content"
      :data-card-side="isFlipped ? 'back' : 'front'"
    >
      <template v-if="!isFlipped">
        <PatternGlyph :pattern-id="props.card.id" />
        <p class="pattern-card__eyebrow">
          {{ props.card.category }}
        </p>
        <h3>{{ props.card.nameZhTw }}</h3>
        <p class="pattern-card__english">
          {{ props.card.nameEn }}
        </p>
        <p
          v-if="props.card.talibFunction"
          class="pattern-card__function"
        >
          TA-Lib：<code>{{ props.card.talibFunction }}</code>
        </p>
        <p
          v-if="talibMatcherSeparationNotice && !isTalibContext"
          class="pattern-card__function-notice"
        >
          {{ talibMatcherSeparationNotice }}
        </p>
        <p>{{ props.card.oneSentenceMeaning }}</p>
        <dl
          v-if="props.card.talibFunction && props.card.minimumBars"
          class="pattern-card__matcher-summary"
          aria-label="TA-Lib 型態摘要"
        >
          <div>
            <dt>使用根數</dt>
            <dd>{{ props.card.minimumBars === props.card.maximumBars ? `${props.card.minimumBars} 根` : `${props.card.minimumBars}～${props.card.maximumBars} 根` }}</dd>
          </div>
          <div>
            <dt>函式方向</dt>
            <dd>{{ directionLabel() }}</dd>
          </div>
          <div>
            <dt>教學用途</dt>
            <dd>{{ purposeLabel() }}</dd>
          </div>
        </dl>
        <p
          class="pattern-card__support"
          :data-support-label="props.card.matchSupport"
        >
          {{ supportLabel }}
        </p>
        <dl
          v-if="props.card.matcher"
          class="pattern-card__matcher-summary"
        >
          <div>
            <dt>規則族</dt>
            <dd>{{ props.card.matcher.ruleFamilyId }}</dd>
          </div>
          <div>
            <dt>最少 K 數</dt>
            <dd>{{ props.card.matcher.minimumBars }}</dd>
          </div>
          <div>
            <dt>最低符合度</dt>
            <dd>{{ props.card.matcher.minimumScore }} 分</dd>
          </div>
        </dl>
        <p
          v-else-if="props.card.guardrail"
          class="pattern-card__guardrail"
        >
          {{ props.card.guardrail.title }}
        </p>
      </template>

      <template v-else>
        <p class="pattern-card__eyebrow">
          {{ props.card.category }}
        </p>
        <h3>{{ props.card.nameZhTw }}：核對細節</h3>
        <section>
          <h4>{{ isTalibContext ? 'TA-Lib 官方函式口徑' : '可觀察定義' }}</h4>
          <p>{{ displayedDefinition }}</p>
        </section>
        <section>
          <h4>解釋前的背景</h4>
          <ul>
            <li
              v-for="item in props.card.background"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </section>
        <section v-if="props.card.confirmationGuidance?.length">
          <h4>確認方式</h4>
          <ul>
            <li
              v-for="item in props.card.confirmationGuidance"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </section>
        <section v-if="props.card.timeframeGuidance?.length">
          <h4>月、週、日 K 解讀順序</h4>
          <ol>
            <li
              v-for="item in props.card.timeframeGuidance"
              :key="item.timeframe"
            >
              <strong>{{ item.label }}</strong>：{{ item.guidance }}
            </li>
          </ol>
        </section>
        <section v-if="props.card.geometrySteps?.length">
          <h4>逐根幾何</h4>
          <ol>
            <li
              v-for="item in props.card.geometrySteps"
              :key="item"
            >
              {{ item }}
            </li>
          </ol>
        </section>
        <section>
          <h4>常見誤讀</h4>
          <ul>
            <li
              v-for="item in props.card.commonMisreads"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </section>
        <section>
          <h4>失效或減弱條件</h4>
          <ul>
            <li
              v-for="item in props.card.invalidationGuidance"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </section>
        <section>
          <h4>使用限制</h4>
          <ul>
            <li
              v-for="item in props.card.limitations"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </section>
        <section v-if="props.card.guardrail">
          <h4>守門提醒</h4>
          <p>{{ props.card.guardrail.whyNotInMvp }}</p>
          <p>{{ props.card.guardrail.readerAction }}</p>
        </section>
        <section v-if="relatedCards.length">
          <h4>相關型態</h4>
          <ul>
            <li
              v-for="relatedCard in relatedCards"
              :key="relatedCard.id"
            >
              {{ relatedCard.nameZhTw }}（{{ relatedCard.nameEn }}）
            </li>
          </ul>
        </section>
        <section>
          <h4>資料與來源</h4>
          <ul>
            <li
              v-for="item in displayedDataRequirements"
              :key="item"
            >
              需要：{{ item }}
            </li>
            <li
              v-for="item in props.card.sourceNotes"
              :key="item"
            >
              來源：{{ item }}
            </li>
          </ul>
        </section>
      </template>
    </div>

    <button
      type="button"
      class="pattern-card__toggle"
      :aria-expanded="isFlipped"
      :aria-controls="cardContentId"
      :aria-label="`${isFlipped ? '收起' : '查看'} ${props.card.nameZhTw}的${isFlipped ? '正面摘要' : '詳細條件'}`"
      @click="toggleCard"
    >
      {{ isFlipped ? '回到正面摘要' : '查看詳細條件' }}
    </button>

    <nav
      v-if="isFlipped"
      class="pattern-card__lessons"
      :aria-label="`${props.card.nameZhTw}對應課程`"
    >
      <a
        v-for="lessonLink in props.card.lessonLinks"
        :key="lessonLink"
        :href="lessonHref(lessonLink)"
      >前往對應課程</a>
    </nav>
  </article>
</template>

<style scoped>
.pattern-card {
  display: grid;
  align-content: start;
  gap: 0.85rem;
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.9rem;
  background: var(--vp-c-bg-soft);
}

.pattern-card__content {
  min-width: 0;
  transition: opacity 160ms ease;
}

.pattern-card__eyebrow,
.pattern-card__english {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}

.pattern-card__function {
  margin: 0.35rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
}

.pattern-card__function-notice {
  margin: 0.35rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
}

.pattern-card h3,
.pattern-card h4 {
  color: var(--vp-c-brand-2);
}

.pattern-card h3 {
  margin: 0.4rem 0 0;
}

.pattern-card h4 {
  margin: 1rem 0 0.35rem;
  font-size: 1rem;
}

.pattern-card__support,
.pattern-card__guardrail {
  margin: 0.75rem 0 0;
  padding: 0.55rem 0.7rem;
  border-left: 4px solid var(--vp-c-brand-1);
  background: var(--vp-c-bg-alt);
  font-weight: 700;
}

.pattern-card__matcher-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0.85rem 0 0;
}

.pattern-card__matcher-summary div {
  min-width: 0;
  padding: 0.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.45rem;
}

.pattern-card__matcher-summary dt {
  color: var(--vp-c-text-2);
  font-size: 0.78rem;
}

.pattern-card__matcher-summary dd {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
  font-weight: 700;
}

.pattern-card ul,
.pattern-card ol {
  padding-left: 1.2rem;
}

.pattern-card li + li {
  margin-top: 0.35rem;
}

.pattern-card__toggle,
.pattern-card__lessons a {
  width: fit-content;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.5rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}

.pattern-card__lessons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 520px) {
  .pattern-card__matcher-summary {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pattern-card__content {
    transition: none;
  }
}
</style>
