<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  loadManifest,
  loadStockSnapshot,
  selectStockPriceMode,
  selectStockTimeframe,
} from '../domain/market-data/client';
import { computeFreshness, mostConservativeFreshness } from '../domain/market-data/freshness';
import type { MarketDataManifest, MarketDataSymbol } from '../domain/market-data/schema';
import type {
  AnalysisResult,
  PriceMode,
  StockSnapshot,
  Timeframe,
  UnavailableReason,
} from '../domain/market-data/types';
import { coordinateMultiTimeframe } from '../domain/multi-timeframe';
import type { MultiTimeframeAnalysisResult } from '../domain/multi-timeframe';
import { getPatternCard } from '../domain/patterns/catalog';
import { analyzePatterns } from '../domain/patterns/matcher';
import { analyzeStructures } from '../domain/structures/analyzer';
import type { StructureAnalysisResult, StructureId } from '../domain/structures/types';
import AnalysisResultPanel from './AnalysisResultPanel.vue';
import CandlestickChart from './CandlestickChart.vue';
import MultiTimeframeComparison from './MultiTimeframeComparison.vue';
import MultiTimeframeExercise from './MultiTimeframeExercise.vue';
import MultiTimeframeSummary from './MultiTimeframeSummary.vue';
import StockCodeSearch from './StockCodeSearch.vue';

type LoadState = 'loading-manifest' | 'ready' | 'loading-stock' | 'error';

const manifest = ref<MarketDataManifest | null>(null);
const snapshot = ref<StockSnapshot | null>(null);
const result = ref<AnalysisResult | null>(null);
const structureResult = ref<StructureAnalysisResult | null>(null);
const selectedStructureCandidateId = ref<string | null>(null);
const multiTimeframeResult = ref<MultiTimeframeAnalysisResult | null>(null);
const selectedStructureIds = ref<Partial<Record<Timeframe, StructureId>>>({});
const showMultiTimeframeComparison = ref(false);
const multiTimeframeExerciseAnswers = ref<{
  monthlyDirection: 'up' | 'down' | 'neutral' | 'undetermined' | null;
  monthlyKeyArea: string;
  weeklyRelationship: 'aligned' | 'partially-aligned' | 'divergent' | 'insufficient-evidence' | null;
  dailyCheck: 'forming' | 'confirmed' | 'invalid' | 'insufficient-evidence' | null;
}>({ monthlyDirection: null, monthlyKeyArea: '', weeklyRelationship: null, dailyCheck: null });
const multiTimeframeExerciseRevealed = ref(false);
const loadState = ref<LoadState>('loading-manifest');
const statusMessage = ref('正在載入支援股票清冊；此頁不會直接呼叫交易所。');
const errorMessage = ref('');
const marketCutoffDate = ref<string | null>(null);
const marketExpectedCutoffDate = ref<string | null>(null);
const selectedTimeframe = ref<Timeframe>('1d');
const selectedPriceMode = ref<PriceMode>('raw');
const stockDataLastDate = computed(() => snapshot.value?.bars.at(-1)?.date ?? null);
const latestNoQuoteEvidence = computed(() => snapshot.value?.noQuoteEvidence.at(-1));
const latestNoQuoteDescription = computed(() => {
  if (latestNoQuoteEvidence.value?.reason === 'official-suspension') {
    return '交易所公告停止買賣；系統保留官方停牌證據、不補成 K 線，型態比對不跨越該區間。';
  }
  return '官方未報價；該日沒有完整 OHLC，因此不會補成 K 線。';
});
const marketSnapshotMetadata = computed(() => ({
  marketSnapshotCutoffDate: marketCutoffDate.value,
  officialExpectedCutoffDate: marketExpectedCutoffDate.value,
}));
const selectedStructureCandidate = computed(() => (
  structureResult.value?.candidates.find((candidate) => candidate.candidateId === selectedStructureCandidateId.value) ?? null
));
const multiTimeframePeriods = computed(() => multiTimeframeResult.value?.timeframes.map((period) => {
  const candidates = period.selectedCandidate
    ? [
        period.selectedCandidate,
        ...period.structureAnalysis.candidates.filter((candidate) => (
          candidate.candidateId !== period.selectedCandidateId
        )),
      ]
    : period.structureAnalysis.candidates;
  return {
    timeframe: period.timeframe,
    cutoffDate: period.latestCompletedBarDate,
    availableBarCount: period.availableCompletedBarCount,
    priceMode: period.snapshot.priceMode,
    background: period.backgroundDirection,
    analysisStatus: period.structureAnalysis.status,
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      name: getPatternCard(candidate.structureId).nameZhTw,
      ruleFit: candidate.ruleFit,
      status: candidate.status,
    })),
  };
}) ?? []);
const multiTimeframeSelectedCandidateIds = computed(() => Object.fromEntries(
  (multiTimeframeResult.value?.timeframes ?? []).map((period) => [
    period.timeframe,
    period.selectedCandidateId,
  ]),
) as Partial<Record<Timeframe, string | null>>);

let latestRequestId = 0;

const timeframeLabels: Readonly<Record<Timeframe, string>> = {
  '1d': '日 K',
  '1w': '週 K',
  '1m': '月 K',
};

const timeframeOptions: readonly Timeframe[] = ['1d', '1w', '1m'];
const priceModeOptions: readonly PriceMode[] = ['adjusted', 'raw'];
const priceModeLabels: Readonly<Record<PriceMode, string>> = {
  adjusted: '向後還原價格',
  raw: '官方原始價格',
};

const adjustedUnavailableWarning = computed(() => {
  const adjusted = snapshot.value?.priceModes?.adjusted;
  return adjusted?.status === 'unavailable' ? adjusted.warnings[0] ?? null : null;
});

function timeframeLabel(timeframe: Timeframe): string {
  return timeframeLabels[timeframe];
}

function priceModeLabel(priceMode: PriceMode): string {
  return priceModeLabels[priceMode];
}

function priceModeAvailable(priceMode: PriceMode): boolean {
  if (priceMode === 'raw') {
    return true;
  }
  return snapshot.value?.priceModes?.adjusted.status === 'available';
}

function timeframeAvailableForExercise(timeframe: Timeframe): boolean {
  if (!multiTimeframeResult.value) return true;
  if (timeframe === '1m') return true;
  const monthlyComplete = multiTimeframeExerciseAnswers.value.monthlyDirection !== null
    && multiTimeframeExerciseAnswers.value.monthlyKeyArea.trim().length > 0;
  if (timeframe === '1w') return monthlyComplete;
  return monthlyComplete && multiTimeframeExerciseAnswers.value.weeklyRelationship !== null;
}

function latestObservedStockDate(loaded: StockSnapshot): string | null {
  const rawDailyBars = loaded.priceModes?.raw.status === 'available'
    ? loaded.priceModes.raw.timeframes['1d'].completedBars
    : loaded.bars;
  const lastLegalBarDate = rawDailyBars.at(-1)?.date;
  const lastNoQuoteDate = loaded.noQuoteEvidence.at(-1)?.date;
  if (lastLegalBarDate === undefined) {
    return lastNoQuoteDate ?? null;
  }
  if (lastNoQuoteDate === undefined) {
    return lastLegalBarDate;
  }
  return lastLegalBarDate > lastNoQuoteDate ? lastLegalBarDate : lastNoQuoteDate;
}

function beginRequest(): number {
  latestRequestId += 1;
  return latestRequestId;
}

function isCurrentRequest(requestId: number): boolean {
  return requestId === latestRequestId;
}

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
  return '資料載入失敗，請稍後重新查詢。';
}

function unavailableReasonFromError(error: unknown): UnavailableReason {
  if (error !== null && typeof error === 'object' && 'reason' in error) {
    const reason = (error as { reason?: unknown }).reason;
    if (
      reason === 'not-found'
      || reason === 'unsupported-security'
      || reason === 'load-error'
      || reason === 'schema-error'
    ) {
      return reason;
    }
  }
  return 'load-error';
}

/** 以同一快照分別執行短窗 K 棒與完整價格結構；兩者不共用排行榜。 */
function analyzeSelectedSnapshot(
  selected: StockSnapshot,
  matcherOptions: Parameters<typeof analyzePatterns>[1],
): void {
  result.value = analyzePatterns(selected, matcherOptions);
  structureResult.value = analyzeStructures(selected);
  selectedStructureCandidateId.value = null;
}

/** 以同一 cutoff 與價格口徑建立月、週、日獨立結果，再把目前週期投影到詳細面板。 */
function coordinateSelectedSnapshot(selected: StockSnapshot): void {
  if (!selected.priceModes) {
    analyzeSelectedSnapshot(selected, {
      freshness: selected.freshness,
      snapshotHash: selected.snapshotHash,
    });
    multiTimeframeResult.value = null;
    return;
  }
  const coordinated = coordinateMultiTimeframe(selected, {
    priceMode: selected.priceMode,
    cutoffDate: selected.cutoffDate,
    selectedStructureIds: selectedStructureIds.value,
  });
  multiTimeframeResult.value = coordinated;
  const active = coordinated.timeframes.find((period) => period.timeframe === selectedTimeframe.value);
  if (!active) {
    throw new Error('多時間週期結果缺少目前選取的 K 線週期。');
  }
  snapshot.value = active.snapshot;
  result.value = active.patternAnalysis;
  structureResult.value = active.structureAnalysis;
  selectedStructureCandidateId.value = active.selectedCandidateId;
}

function selectSummaryCandidate(selection: { timeframe: Timeframe; candidateId: string }): void {
  const current = multiTimeframeResult.value;
  const baseSnapshot = snapshot.value;
  const period = current?.timeframes.find((item) => item.timeframe === selection.timeframe);
  const candidate = period?.structureAnalysis.candidates.find((item) => item.candidateId === selection.candidateId);
  if (!candidate || !baseSnapshot) return;
  selectedStructureIds.value = { ...selectedStructureIds.value, [selection.timeframe]: candidate.structureId };
  coordinateSelectedSnapshot(baseSnapshot);
  changeTimeframe(selection.timeframe);
}

function selectDetailedCandidate(candidateId: string): void {
  const candidate = structureResult.value?.candidates.find((item) => item.candidateId === candidateId);
  if (!candidate) {
    selectedStructureCandidateId.value = candidateId;
    return;
  }
  selectedStructureIds.value = { ...selectedStructureIds.value, [selectedTimeframe.value]: candidate.structureId };
  if (snapshot.value?.priceModes) {
    coordinateSelectedSnapshot(snapshot.value);
  } else {
    selectedStructureCandidateId.value = candidateId;
  }
}

function resetMultiTimeframeExercise(): void {
  multiTimeframeExerciseAnswers.value = {
    monthlyDirection: null,
    monthlyKeyArea: '',
    weeklyRelationship: null,
    dailyCheck: null,
  };
  multiTimeframeExerciseRevealed.value = false;
  showMultiTimeframeComparison.value = false;
}

async function prepareManifest(): Promise<void> {
  const requestId = beginRequest();
  loadState.value = 'loading-manifest';
  snapshot.value = null;
  result.value = null;
  structureResult.value = null;
  selectedStructureCandidateId.value = null;
  multiTimeframeResult.value = null;
  selectedStructureIds.value = {};
  resetMultiTimeframeExercise();
  marketCutoffDate.value = null;
  marketExpectedCutoffDate.value = null;
  statusMessage.value = '正在載入支援股票清冊；此頁不會直接呼叫交易所。';
  errorMessage.value = '';
  try {
    const loadedManifest = await loadManifest();
    if (!isCurrentRequest(requestId)) {
      return;
    }
    manifest.value = loadedManifest;
    loadState.value = 'ready';
    statusMessage.value = `清冊已載入，可輸入 ${loadedManifest.symbols.length} 檔支援的上市或上櫃普通股代碼。`;
  } catch (error) {
    if (!isCurrentRequest(requestId)) {
      return;
    }
    manifest.value = null;
    loadState.value = 'error';
    statusMessage.value = '';
    errorMessage.value = messageFromError(error);
  }
}

async function selectStock(symbol: MarketDataSymbol): Promise<void> {
  const activeManifest = manifest.value;
  if (!activeManifest) {
    errorMessage.value = '支援股票清冊尚未載入，請先重新載入。';
    return;
  }

  const requestId = beginRequest();
  loadState.value = 'loading-stock';
  errorMessage.value = '';
  result.value = null;
  structureResult.value = null;
  selectedStructureCandidateId.value = null;
  multiTimeframeResult.value = null;
  selectedStructureIds.value = {};
  resetMultiTimeframeExercise();
  snapshot.value = null;
  selectedTimeframe.value = '1d';
  selectedPriceMode.value = 'raw';
  marketCutoffDate.value = null;
  marketExpectedCutoffDate.value = null;
  statusMessage.value = `已確認 ${symbol.code} ${symbol.name}，正在載入單一股票的盤後資料。`;
  try {
    const loaded = await loadStockSnapshot(activeManifest, symbol.code);
    if (!isCurrentRequest(requestId)) {
      return;
    }
    const marketCutoff = activeManifest.markets[loaded.market];
    const stockCutoffDate = latestObservedStockDate(loaded);
    if (!stockCutoffDate) {
      throw new Error('股票快照沒有可稽核的日 K 或官方未報價證據。');
    }
    const freshness = mostConservativeFreshness(
      marketCutoff.freshness,
      computeFreshness({
        tradingSessions: marketCutoff.tradingSessions,
        validThrough: marketCutoff.calendarValidThrough,
      }, stockCutoffDate),
    );
    const scopedSnapshot: StockSnapshot = {
      ...loaded,
      timeframe: loaded.timeframe ?? '1d',
      cutoffDate: stockCutoffDate,
      freshness,
      snapshotHash: activeManifest.snapshotHash,
    };
    snapshot.value = scopedSnapshot;
    selectedTimeframe.value = scopedSnapshot.priceModes ? '1m' : scopedSnapshot.timeframe ?? '1d';
    selectedPriceMode.value = scopedSnapshot.priceMode;
    marketCutoffDate.value = marketCutoff.cutoffDate;
    marketExpectedCutoffDate.value = marketCutoff.expectedCutoffDate;
    coordinateSelectedSnapshot(scopedSnapshot);
    loadState.value = 'ready';
    const label = timeframeLabel(selectedTimeframe.value);
    statusMessage.value = (snapshot.value?.bars.length ?? 0) > 0
      ? `已載入 ${scopedSnapshot.code} ${scopedSnapshot.name} 的${priceModeLabel(scopedSnapshot.priceMode)}${label}，可查看圖表與規則比對。`
      : `已載入 ${scopedSnapshot.code} ${scopedSnapshot.name} 的官方未報價證據；沒有可畫製的${label}。`;
  } catch (error) {
    if (!isCurrentRequest(requestId)) {
      return;
    }
    loadState.value = 'ready';
    statusMessage.value = '';
    const reason = unavailableReasonFromError(error);
    if (reason === 'load-error' || reason === 'schema-error') {
      result.value = {
        status: 'unavailable',
        reason,
        message: messageFromError(error),
      };
      errorMessage.value = '';
      return;
    }
    errorMessage.value = messageFromError(error);
  }
}

/** 切換價格口徑後，圖表與 matcher 以同一組日、週或月 K 立即重算。 */
function changePriceMode(priceMode: PriceMode): void {
  const current = snapshot.value;
  if (!current || priceMode === selectedPriceMode.value || !priceModeAvailable(priceMode)) {
    return;
  }

  try {
    const selected = selectStockPriceMode(current, priceMode);
    selectedStructureIds.value = {};
    resetMultiTimeframeExercise();
    selectedTimeframe.value = '1m';
    selectedPriceMode.value = priceMode;
    snapshot.value = selected;
    coordinateSelectedSnapshot(selected);
    statusMessage.value = `已切換為${priceModeLabel(priceMode)}；圖表與型態比對已使用同一價格口徑重算。`;
  } catch (error) {
    const reason = unavailableReasonFromError(error);
    result.value = { status: 'unavailable', reason, message: messageFromError(error) };
    statusMessage.value = '';
  }
}

/** 切換已驗證快照中的日、週、月 K，並立刻以同一資料邊界重跑規則比對。 */
function changeTimeframe(timeframe: Timeframe): void {
  const current = snapshot.value;
  if (!current || timeframe === selectedTimeframe.value) {
    return;
  }

  try {
    selectedTimeframe.value = timeframe;
    if (multiTimeframeResult.value) {
      const active = multiTimeframeResult.value.timeframes.find((period) => period.timeframe === timeframe);
      if (!active) throw new Error('多時間週期結果缺少指定週期。');
      snapshot.value = active.snapshot;
      result.value = active.patternAnalysis;
      structureResult.value = active.structureAnalysis;
      selectedStructureCandidateId.value = active.selectedCandidateId;
    } else {
      const selected = selectStockTimeframe(current, timeframe);
      snapshot.value = selected;
      analyzeSelectedSnapshot(selected, {
        freshness: selected.freshness,
        snapshotHash: selected.snapshotHash,
      });
    }
    statusMessage.value = `已切換為${timeframeLabel(timeframe)}；圖表可顯示形成中 K 棒，但型態比對只使用完成且證據完整的 K 棒。`;
  } catch (error) {
    const reason = unavailableReasonFromError(error);
    result.value = { status: 'unavailable', reason, message: messageFromError(error) };
    statusMessage.value = '';
  }
}

function resetQuery(): void {
  beginRequest();
  snapshot.value = null;
  selectedTimeframe.value = '1d';
  selectedPriceMode.value = 'raw';
  result.value = null;
  structureResult.value = null;
  selectedStructureCandidateId.value = null;
  multiTimeframeResult.value = null;
  selectedStructureIds.value = {};
  resetMultiTimeframeExercise();
  marketCutoffDate.value = null;
  marketExpectedCutoffDate.value = null;
  errorMessage.value = '';
  if (manifest.value) {
    loadState.value = 'ready';
  }
  statusMessage.value = manifest.value
    ? '可輸入另一個支援的普通股代碼重新查詢。'
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
    <p>先確認資料截止日，再把最近 60 根{{ priceModeLabel(selectedPriceMode) }}{{ timeframeLabel(selectedTimeframe) }}與教學卡規則逐條比對。</p>
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
      <span>請輸入上市或上櫃普通股代碼，並確認代碼後重新查詢。</span>
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
        <p>{{ snapshot.market === 'TWSE' ? '上市' : '上櫃' }}普通股，{{ priceModeLabel(selectedPriceMode) }}{{ timeframeLabel(selectedTimeframe) }}，股票{{ timeframeLabel(selectedTimeframe) }}最後資料日 {{ stockDataLastDate ?? '無合法日 K' }}。</p>
        <fieldset class="stock-analyzer__timeframes">
          <legend>選擇價格口徑</legend>
          <label
            v-for="priceMode in priceModeOptions"
            :key="priceMode"
          >
            <input
              :data-price-mode="priceMode"
              type="radio"
              name="analysis-price-mode"
              :value="priceMode"
              :checked="selectedPriceMode === priceMode"
              :disabled="!priceModeAvailable(priceMode)"
              @change="changePriceMode(priceMode)"
            >
            {{ priceModeLabel(priceMode) }}
          </label>
        </fieldset>
        <p
          v-if="adjustedUnavailableWarning"
          class="stock-analyzer__mode-warning"
        >
          {{ adjustedUnavailableWarning }} 向後還原價格已停用，仍可查看官方原始價格。
        </p>
        <fieldset class="stock-analyzer__timeframes">
          <legend>選擇 K 線週期</legend>
          <label
            v-for="timeframe in timeframeOptions"
            :key="timeframe"
          >
            <input
              :data-timeframe="timeframe"
              type="radio"
              name="analysis-timeframe"
              :value="timeframe"
              :checked="selectedTimeframe === timeframe"
              :disabled="!timeframeAvailableForExercise(timeframe)"
              @change="changeTimeframe(timeframe)"
            >
            {{ timeframeLabel(timeframe) }}
          </label>
        </fieldset>
        <p v-if="latestNoQuoteEvidence">
          官方{{ latestNoQuoteEvidence.reason === 'official-suspension' ? '停牌' : '未報價' }}證據 {{ latestNoQuoteEvidence.date }}；{{ latestNoQuoteDescription }}
          <a
            :href="latestNoQuoteEvidence.sourceUrl"
            target="_blank"
            rel="noreferrer"
          >查看官方來源</a>
        </p>
        <p>市場快照截止日 {{ marketCutoffDate ?? '無法判定' }}；官方預期截止日 {{ marketExpectedCutoffDate ?? '無法判定' }}。</p>
        <button
          type="button"
          @click="resetQuery"
        >
          重新查詢
        </button>
      </section>
      <CandlestickChart
        v-if="snapshot.bars.length > 0"
        :snapshot="snapshot"
        :structure-overlay="selectedStructureCandidate?.overlay ?? null"
      />
    </template>

    <template v-if="multiTimeframeResult">
      <MultiTimeframeExercise
        :stock-name="snapshot?.name ?? ''"
        :stock-code="multiTimeframeResult.code"
        :cutoff-date="multiTimeframeResult.cutoffDate"
        :answers="multiTimeframeExerciseAnswers"
        :active-timeframe="selectedTimeframe"
        :revealed="multiTimeframeExerciseRevealed"
        @update:answers="multiTimeframeExerciseAnswers = $event"
        @select-timeframe="changeTimeframe"
        @reveal-summary="multiTimeframeExerciseRevealed = true"
      >
        <template #summary>
          <MultiTimeframeSummary
            :periods="multiTimeframePeriods"
            :overall-status="multiTimeframeResult.summary.state"
            :active-timeframe="selectedTimeframe"
            :selected-candidate-ids="multiTimeframeSelectedCandidateIds"
            @select-timeframe="changeTimeframe"
            @select-candidate="selectSummaryCandidate"
          />
        </template>
      </MultiTimeframeExercise>
      <section
        v-if="multiTimeframeExerciseRevealed"
        class="stock-analyzer__comparison-control"
      >
        <h2>三週期圖表比較</h2>
        <p>需要並排核對時再展開；手機會改成月、週、日依序堆疊。</p>
        <button
          type="button"
          data-multitimeframe-comparison-toggle
          :aria-expanded="showMultiTimeframeComparison"
          @click="showMultiTimeframeComparison = !showMultiTimeframeComparison"
        >
          {{ showMultiTimeframeComparison ? '收合三週期圖表' : '展開三週期圖表' }}
        </button>
      </section>
      <MultiTimeframeComparison
        v-if="showMultiTimeframeComparison"
        :analysis="multiTimeframeResult"
      />
    </template>

    <AnalysisResultPanel
      v-if="result"
      :result="result"
      :snapshot="snapshot"
      :market-snapshot-metadata="marketSnapshotMetadata"
      :structure-result="structureResult"
      :selected-structure-candidate-id="selectedStructureCandidateId"
      @select-structure-candidate="selectDetailedCandidate"
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

.stock-analyzer__comparison-control {
  width: min(100% - 2rem, 76rem);
  margin: 2rem auto;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
}

.stock-analyzer__comparison-control h2 {
  margin-top: 0;
}

.stock-analyzer__selection h3 {
  margin-top: 0;
}

.stock-analyzer__timeframes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 1rem 0;
  padding: 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.5rem;
}

.stock-analyzer__timeframes legend {
  padding: 0 0.25rem;
  font-weight: 700;
}

.stock-analyzer__timeframes label {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
  min-height: 2.25rem;
  cursor: pointer;
}

.stock-analyzer__timeframes label:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.65;
}

.stock-analyzer__mode-warning {
  padding: 0.75rem;
  border-left: 4px solid #855b00;
  background: #fff6dc;
  color: #4d3b1c;
}

.stock-analyzer__selection button,
.stock-analyzer__comparison-control button,
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
