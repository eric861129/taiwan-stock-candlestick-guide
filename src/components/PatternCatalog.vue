<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  MATCH_SUPPORTS,
  PATTERN_CARDS,
  PATTERN_CATEGORIES,
  getPatternCardsByCollection,
} from '../domain/patterns/catalog';
import type {
  MatchSupport,
  PatternCategory,
  PatternCollectionId,
  PatternDirection,
  PatternPurpose,
} from '../domain/patterns/types';
import { PATTERN_COLLECTIONS } from '../domain/patterns/collections';
import PatternCard from './PatternCard.vue';

const props = withDefaults(
  defineProps<{
    mode?: 'catalog' | 'reference';
    collection?: PatternCollectionId;
  }>(),
  { mode: 'catalog', collection: undefined },
);

const selectedCategory = ref<PatternCategory | 'all'>('all');
const selectedSupport = ref<MatchSupport | 'all'>('all');
const query = ref('');
const selectedBars = ref<'all' | '1' | '2' | '3' | '4' | '5'>('all');
const selectedDirection = ref<PatternDirection | 'all'>('all');
const selectedPurpose = ref<PatternPurpose | 'all'>('all');

const collectionDefinition = computed(() =>
  PATTERN_COLLECTIONS.find((collection) => collection.id === props.collection),
);
const isTalibCollection = computed(() => props.collection === 'talib-advanced');
const collectionCards = computed(() =>
  props.collection ? getPatternCardsByCollection(props.collection) : PATTERN_CARDS,
);

const filteredCards = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase('zh-TW');
  const bars = selectedBars.value === 'all' ? undefined : Number(selectedBars.value);

  return collectionCards.value.filter((card) => {
    const searchableText = [
      card.nameZhTw,
      card.nameEn,
      card.talibFunction ?? '',
      ...card.aliases,
    ].join(' ').toLocaleLowerCase('zh-TW');
    const matchesBars = !isTalibCollection.value || bars === undefined || (
      card.minimumBars !== undefined &&
      card.maximumBars !== undefined &&
      card.minimumBars <= bars &&
      card.maximumBars >= bars
    );

    return (
      (!normalizedQuery || searchableText.includes(normalizedQuery)) &&
      (selectedCategory.value === 'all' || card.category === selectedCategory.value) &&
      (selectedSupport.value === 'all' || card.matchSupport === selectedSupport.value) &&
      matchesBars &&
      (!isTalibCollection.value || selectedDirection.value === 'all' || card.patternDirection === selectedDirection.value) &&
      (!isTalibCollection.value || selectedPurpose.value === 'all' || card.patternPurpose === selectedPurpose.value)
    );
  });
});

const heading = computed(() =>
  collectionDefinition.value?.nameZhTw ?? (props.mode === 'reference' ? '型態卡速查' : '型態卡目錄'),
);

function supportOptionLabel(support: MatchSupport): string {
  switch (support) {
    case 'mvp':
      return '第一版可比對';
    case 'catalog-only':
      return '教學卡，尚不比對';
    default:
      return '守門提醒，尚不比對';
  }
}

const directionOptions: readonly { value: PatternDirection; label: string }[] = [
  { value: 'bullish', label: '偏多版本' },
  { value: 'bearish', label: '偏空版本' },
  { value: 'both', label: '多空皆有' },
  { value: 'neutral', label: '中性／未決' },
];

const purposeOptions: readonly { value: PatternPurpose; label: string }[] = [
  { value: 'reversal', label: '反轉候選' },
  { value: 'continuation', label: '延續候選' },
  { value: 'indecision', label: '猶豫／未決' },
  { value: 'weakening', label: '動能弱化' },
];
</script>

<template>
  <section
    class="pattern-catalog"
    :class="`pattern-catalog--${props.mode}`"
    aria-labelledby="pattern-catalog-title"
  >
    <h2 id="pattern-catalog-title">
      {{ heading }}
    </h2>
    <p>
      {{ collectionDefinition?.description ?? '卡片先整理可觀察條件、背景與失效方式；第一版只比對標示為「第一版可比對」的 17 張短窗卡，其他卡不會被假裝成自動結果。' }}
    </p>

    <form
      class="pattern-catalog__filters"
      aria-label="篩選型態卡"
      @submit.prevent
    >
      <label class="pattern-catalog__search">
        搜尋名稱或 TA-Lib 函式
        <input
          v-model="query"
          name="pattern-query"
          type="search"
          autocomplete="off"
          placeholder="例如：十字線、Doji、CDLDOJI"
        >
      </label>
      <label>
        分類
        <select
          v-model="selectedCategory"
          name="category"
        >
          <option value="all">全部分類</option>
          <option
            v-for="category in PATTERN_CATEGORIES"
            :key="category"
            :value="category"
          >{{ category }}</option>
        </select>
      </label>
      <label>
        第一版支援範圍
        <select
          v-model="selectedSupport"
          name="match-support"
        >
          <option value="all">全部範圍</option>
          <option
            v-for="support in MATCH_SUPPORTS"
            :key="support"
            :value="support"
          >{{ supportOptionLabel(support) }}</option>
        </select>
      </label>
      <label v-if="isTalibCollection">
        使用根數
        <select
          v-model="selectedBars"
          name="bars"
        >
          <option value="all">全部根數</option>
          <option
            v-for="bars in 5"
            :key="bars"
            :value="String(bars)"
          >{{ bars }} 根</option>
        </select>
      </label>
      <label v-if="isTalibCollection">
        函式方向
        <select
          v-model="selectedDirection"
          name="direction"
        >
          <option value="all">全部方向</option>
          <option
            v-for="option in directionOptions"
            :key="option.value"
            :value="option.value"
          >{{ option.label }}</option>
        </select>
      </label>
      <label v-if="isTalibCollection">
        教學用途
        <select
          v-model="selectedPurpose"
          name="purpose"
        >
          <option value="all">全部用途</option>
          <option
            v-for="option in purposeOptions"
            :key="option.value"
            :value="option.value"
          >{{ option.label }}</option>
        </select>
      </label>
    </form>

    <output
      class="pattern-catalog__result-count"
      aria-live="polite"
      aria-atomic="true"
    >
      目前顯示 {{ filteredCards.length }} 張型態卡。
    </output>

    <div
      v-if="filteredCards.length > 0"
      class="pattern-catalog__grid"
    >
      <PatternCard
        v-for="card in filteredCards"
        :key="card.id"
        :card="card"
        :collection="props.collection"
      />
    </div>
    <p
      v-else
      class="pattern-catalog__empty"
    >
      沒有符合這組篩選條件的型態卡。請調整分類或第一版支援範圍。
    </p>
  </section>
</template>

<style scoped>
.pattern-catalog {
  width: min(100% - 2rem, 76rem);
  margin: 2rem auto;
}

.pattern-catalog__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: end;
  margin: 1.25rem 0 0.75rem;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.pattern-catalog__filters label {
  display: grid;
  gap: 0.35rem;
  min-width: min(100%, 15rem);
  color: var(--vp-c-text-1);
  font-weight: 700;
}

.pattern-catalog__filters select,
.pattern-catalog__filters input {
  min-height: 2.75rem;
  padding: 0.45rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.45rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
}

.pattern-catalog__search {
  flex: 1 1 22rem;
}

.pattern-catalog__result-count {
  display: block;
  min-height: 1.5rem;
  margin: 0.75rem 0;
  color: var(--vp-c-text-2);
}

.pattern-catalog__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
  gap: 1rem;
}

.pattern-catalog__empty {
  padding: 1rem;
  border-left: 4px solid var(--vp-c-brand-1);
  background: var(--vp-c-bg-alt);
}

@media (max-width: 600px) {
  .pattern-catalog {
    width: min(100% - 1.25rem, 76rem);
  }

  .pattern-catalog__filters label {
    width: 100%;
  }
}
</style>
