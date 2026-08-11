<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { loadManifest, loadStockSnapshot } from '../domain/market-data/client';
import { computeFreshness } from '../domain/market-data/freshness';
import type { MarketDataManifest, MarketDataSymbol } from '../domain/market-data/schema';
import type { AnalysisResult, StockSnapshot } from '../domain/market-data/types';
import { analyzePatterns } from '../domain/patterns/matcher';
import AnalysisResultPanel from './AnalysisResultPanel.vue';
import CandlestickChart from './CandlestickChart.vue';
import StockCodeSearch from './StockCodeSearch.vue';

type LoadState = 'loading-manifest' | 'ready' | 'loading-stock' | 'error';

const manifest = ref<MarketDataManifest | null>(null);
const snapshot = ref<StockSnapshot | null>(null);
const result = ref<AnalysisResult | null>(null);
const loadState = ref<LoadState>('loading-manifest');
const statusMessage = ref('正在載入支援股票清冊；此頁不會直接呼叫交易所。');
const errorMessage = ref('');

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return '無法完成查詢。請稍後重新查詢。';
}

async function prepareManifest(): Promise<void> {
  loadState.value = 'loading-manifest';
  statusMessage.value = '正在載入支援股票清冊；此頁不會直接呼叫交易所。';
  errorMessage.value = '';
  try {
    manifest.value = await loadManifest();
    loadState.value = 'ready';
    statusMessage.value = `清冊已載入，可輸入 ${manifest.value.symbols.length} 檔支援的上市或上櫃普通股代碼。`;
  } catch (error) {
    manifest.value = null;
    loadState.value = 'error';
    statusMessage.value = '';
    errorMessage.value = messageFromError(error);
  }
}

async function selectStock(symbol: MarketDataSymbol): Promise<void> {
  if (!manifest.value) {
    errorMessage.value = '支援股票清冊尚未載入，請先重新載入。';
    return;
  }

  loadState.value = 'loading-stock';
  errorMessage.value = '';
  result.value = null;
  snapshot.value = null;
  statusMessage.value = `已確認 ${symbol.code} ${symbol.name}，正在載入單一股票的盤後資料。`;
  try {
    const loaded = await loadStockSnapshot(manifest.value, symbol.code);
    const marketCutoff = manifest.value.markets[loaded.market];
    const freshness = computeFreshness({
      tradingSessions: marketCutoff.tradingSessions,
      validThrough: marketCutoff.calendarValidThrough,
    }, marketCutoff.cutoffDate);
    const scopedSnapshot: StockSnapshot = {
      ...loaded,
      cutoffDate: marketCutoff.cutoffDate,
      freshness,
      snapshotHash: manifest.value.snapshotHash,
    };
    snapshot.value = scopedSnapshot;
    result.value = analyzePatterns(scopedSnapshot, {
      freshness,
      snapshotHash: manifest.value.snapshotHash,
    });
    loadState.value = 'ready';
    statusMessage.value = `已載入 ${scopedSnapshot.code} ${scopedSnapshot.name} 的原始盤後日 K，可查看圖表與規則比對。`;
  } catch (error) {
    loadState.value = 'ready';
    statusMessage.value = '';
    errorMessage.value = messageFromError(error);
  }
}

function resetQuery(): void {
  snapshot.value = null;
  result.value = null;
  errorMessage.value = '';
  statusMessage.value = manifest.value
    ? '可輸入另一個支援的上市或上櫃普通股代碼。'
    : '請先載入支援股票清冊。';
}

onMounted(() => {
  void prepareManifest();
});
</script>

<template>
  <section
    class="stock-analyzer"
    aria-labelledby="stock-analyzer-title"
  >
    <h2 id="stock-analyzer-title">
      股票型態比對
    </h2>
    <p>先確認資料截止日，再把最近 60 根原始盤後日 K 與教學卡規則逐條比對。</p>
    <p class="stock-analyzer__disclaimer">
      本工具比較歷史價格資料與教學型態規則，不預測未來價格，也不構成投資建議。
    </p>

    <StockCodeSearch
      :manifest="manifest"
      :disabled="loadState === 'loading-manifest' || loadState === 'loading-stock'"
      @selected="selectStock"
    />

    <p
      class="stock-analyzer__status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ statusMessage }}
    </p>
    <p
      v-if="errorMessage"
      class="stock-analyzer__error"
      role="alert"
    >
      {{ errorMessage }}
      <span>請輸入上市或上櫃普通股代碼，或稍後重新查詢。</span>
    </p>
    <button
      v-if="loadState === 'error'"
      type="button"
      @click="prepareManifest"
    >
      重新載入支援清冊
    </button>

    <template v-if="snapshot">
      <section
        class="stock-analyzer__selection"
        aria-label="已選擇的股票"
      >
        <h3>已選擇：{{ snapshot.code }} {{ snapshot.name }}</h3>
        <p>{{ snapshot.market === 'TWSE' ? '上市' : '上櫃' }}普通股，原始盤後日 K，資料截止日 {{ snapshot.cutoffDate }}。</p>
        <button
          type="button"
          @click="resetQuery"
        >
          重新查詢
        </button>
      </section>
      <CandlestickChart :snapshot="snapshot" />
    </template>

    <AnalysisResultPanel
      v-if="result"
      :result="result"
      :snapshot="snapshot"
    />
  </section>
</template>

<style scoped>
.stock-analyzer {
  width: min(100% - 2rem, 76rem);
  margin: 2rem auto;
}

.stock-analyzer__disclaimer {
  padding: 0.9rem;
  border-left: 4px solid #855b00;
  background: #fff6dc;
  color: #4d3b1c;
  font-weight: 700;
}

.stock-analyzer__status {
  min-height: 1.5rem;
  margin: 0.75rem 0;
}

.stock-analyzer__error {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border-left: 4px solid #b54a3c;
  background: #fff0ed;
  color: #7f2b22;
}

.stock-analyzer__selection {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-alt);
}

.stock-analyzer__selection h3 {
  margin-top: 0;
}

.stock-analyzer__selection button,
.stock-analyzer > button {
  min-height: 2.5rem;
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.45rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}

@media (max-width: 600px) {
  .stock-analyzer {
    width: min(100% - 1.25rem, 76rem);
  }
}
</style>
