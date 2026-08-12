<script setup lang="ts">
import type { MultiTimeframeAnalysisResult } from '../domain/multi-timeframe';
import { getPatternCard } from '../domain/patterns/catalog';
import CandlestickChart from './CandlestickChart.vue';

const props = defineProps<{
  analysis: MultiTimeframeAnalysisResult;
}>();

function timeframeLabel(timeframe: '1m' | '1w' | '1d'): string {
  return ({ '1m': '月 K', '1w': '週 K', '1d': '日 K' })[timeframe];
}

function candidateLabel(structureId: Parameters<typeof getPatternCard>[0] | null): string {
  return structureId ? getPatternCard(structureId).nameZhTw : '沒有可列入的價格結構候選';
}
</script>

<template>
  <section
    class="multi-timeframe-comparison"
    aria-labelledby="multi-timeframe-comparison-title"
  >
    <h2 id="multi-timeframe-comparison-title">
      同一檔股票的月、週、日 K 對照
    </h2>
    <p>三張圖各用自己的 K 棒、候選與疊線；請按月→週→日閱讀，不把不同週期的錨點畫在同一張圖上。</p>

    <div class="multi-timeframe-comparison__grid">
      <article
        v-for="period in props.analysis.timeframes"
        :key="period.timeframe"
        class="multi-timeframe-comparison__period"
        :data-timeframe-chart="period.timeframe"
      >
        <h3>{{ timeframeLabel(period.timeframe) }}</h3>
        <p>
          {{ candidateLabel(period.selectedStructureId) }}；
          {{ period.selectedCandidate ? `規則符合度 ${period.selectedCandidate.ruleFit}` : period.backgroundHint }}
        </p>
        <CandlestickChart
          v-if="period.snapshot.bars.length > 0"
          :snapshot="period.snapshot"
          :structure-overlay="period.selectedCandidate?.overlay ?? null"
        />
        <p v-else>
          這個週期沒有可畫製的完整 K 棒。
        </p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.multi-timeframe-comparison {
  width: min(100% - 2rem, 92rem);
  margin: 2rem auto;
}

.multi-timeframe-comparison__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}

.multi-timeframe-comparison__period {
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.multi-timeframe-comparison__period h3 {
  margin-top: 0;
}

@media (max-width: 980px) {
  .multi-timeframe-comparison__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .multi-timeframe-comparison {
    width: min(100% - 1.25rem, 92rem);
  }
}
</style>
