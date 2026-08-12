<script setup lang="ts">
import { computed, ref } from 'vue';
import { SITE_BASE } from '../domain/site/navigation';
import type { PatternCardDefinition } from '../domain/patterns/types';
import PatternGlyph from './PatternGlyph.vue';

const props = defineProps<{ card: PatternCardDefinition }>();
const isFlipped = ref(false);

const cardContentId = computed(() => `pattern-card-${props.card.id}-content`);

const supportLabel = computed(() => {
  switch (props.card.matchSupport) {
    case 'mvp':
      return '第一版可參與自動比對';
    case 'guardrail':
      return '守門提醒：第一版不參與自動比對';
    default:
      return '教學卡：第一版不參與自動比對';
  }
});

function lessonHref(path: string): string {
  return `${SITE_BASE.replace(/\/$/, '')}${path}`;
}

function toggleCard(): void {
  isFlipped.value = !isFlipped.value;
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
        <p>{{ props.card.oneSentenceMeaning }}</p>
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
          <h4>可觀察定義</h4>
          <p>{{ props.card.observableDefinition }}</p>
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
        <section>
          <h4>資料與來源</h4>
          <ul>
            <li
              v-for="item in props.card.dataRequirements"
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

.pattern-card ul {
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
