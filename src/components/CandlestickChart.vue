<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { CorporateAction, OhlcvBar, StockSnapshot } from '../domain/market-data/types';

const props = withDefaults(defineProps<{
  snapshot: StockSnapshot;
  maxBars?: number;
}>(), {
  maxBars: 60,
});

const selectedIndex = ref(0);
const showDataTable = ref(false);
const chartWidth = 1000;
const chartHeight = 560;
const priceTop = 40;
const priceBottom = 355;
const volumeTop = 405;
const volumeBottom = 510;

const bars = computed(() => props.snapshot.bars.slice(-props.maxBars));
const priceBounds = computed(() => {
  const lows = bars.value.map((bar) => bar.low);
  const highs = bars.value.map((bar) => bar.high);
  const low = Math.min(...lows);
  const high = Math.max(...highs);
  const padding = high === low ? Math.max(1, high * 0.01) : (high - low) * 0.05;
  return { low: low - padding, high: high + padding };
});
const maximumVolume = computed(() => Math.max(1, ...bars.value.map((bar) => bar.volumeShares)));
const selectedBar = computed(() => bars.value[selectedIndex.value] ?? bars.value[0]);
const chartTitleId = computed(() => `candlestick-chart-title-${props.snapshot.code}`);
const chartDescriptionId = computed(() => `candlestick-chart-description-${props.snapshot.code}`);

watch(bars, (nextBars) => {
  selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, nextBars.length - 1));
}, { immediate: true });

function candleX(index: number): number {
  return 45 + ((index + 0.5) * 910) / Math.max(1, bars.value.length);
}

function candleWidth(): number {
  return Math.max(3, Math.min(12, 560 / Math.max(1, bars.value.length)));
}

function priceY(price: number): number {
  const range = priceBounds.value.high - priceBounds.value.low;
  return priceBottom - ((price - priceBounds.value.low) / range) * (priceBottom - priceTop);
}

function volumeY(volume: number): number {
  return volumeBottom - (volume / maximumVolume.value) * (volumeBottom - volumeTop);
}

function direction(bar: OhlcvBar): 'up' | 'down' | 'flat' {
  if (bar.close > bar.open) return 'up';
  if (bar.close < bar.open) return 'down';
  return 'flat';
}

function directionLabel(bar: OhlcvBar): string {
  switch (direction(bar)) {
    case 'up': return '收高於開，實心上箭頭';
    case 'down': return '收低於開，空心下箭頭';
    default: return '開收相同，菱形記號';
  }
}

function candleAriaLabel(bar: OhlcvBar): string {
  return `${bar.date}，開 ${formatPrice(bar.open)}，高 ${formatPrice(bar.high)}，低 ${formatPrice(bar.low)}，收 ${formatPrice(bar.close)}，成交量 ${formatNumber(bar.volumeShares)} 股，${directionLabel(bar)}。`;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(value);
}

function actionLabel(action: CorporateAction): string {
  const labels: Record<CorporateAction['type'], string> = {
    'cash-dividend': '現金股利',
    'stock-dividend': '股票股利',
    'capital-reduction': '減資',
    split: '分割',
    other: '其他公司行動',
  };
  return labels[action.type];
}

function actionsFor(date: string): readonly CorporateAction[] {
  return props.snapshot.corporateActions.filter((action) => action.date === date);
}

async function selectCandle(index: number, moveFocus = false): Promise<void> {
  const nextIndex = Math.max(0, Math.min(index, bars.value.length - 1));
  selectedIndex.value = nextIndex;
  if (moveFocus && typeof document !== 'undefined') {
    await nextTick();
    document.getElementById(`candle-${props.snapshot.code}-${nextIndex}`)?.focus();
  }
}

function handleCandleKeydown(event: KeyboardEvent, index: number): void {
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    void selectCandle(index + 1, true);
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    void selectCandle(index - 1, true);
  }
  if (event.key === 'Home') {
    event.preventDefault();
    void selectCandle(0, true);
  }
  if (event.key === 'End') {
    event.preventDefault();
    void selectCandle(bars.value.length - 1, true);
  }
}
</script>

<template>
  <section
    class="candlestick-chart"
    aria-labelledby="candlestick-chart-heading"
  >
    <div class="candlestick-chart__heading-row">
      <div>
        <h3 id="candlestick-chart-heading">
          {{ snapshot.name }}（{{ snapshot.code }}）最近 {{ bars.length }} 根日 K
        </h3>
        <p>紅綠之外，圖上也使用實心上箭頭、空心下箭頭與菱形記號；可用左右方向鍵逐根查看。</p>
      </div>
      <button
        type="button"
        data-chart-table-toggle
        :aria-expanded="showDataTable"
        aria-controls="candlestick-data-table"
        @click="showDataTable = !showDataTable"
      >
        {{ showDataTable ? '收合 OHLCV 資料表' : '展開 OHLCV 資料表' }}
      </button>
    </div>

    <div class="candlestick-chart__plot-wrap">
      <svg
        class="candlestick-chart__svg"
        :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
        role="img"
        :aria-labelledby="`${chartTitleId} ${chartDescriptionId}`"
      >
        <title :id="chartTitleId">{{ snapshot.name }}最近 {{ bars.length }} 根原始盤後日 K 與成交量</title>
        <desc :id="chartDescriptionId">顯示 {{ bars.length }} 根日 K、成交量與公司行動標記。使用左右方向鍵可逐根取得繁體中文 OHLCV 摘要。</desc>
        <line
          x1="40"
          :y1="priceBottom"
          x2="965"
          :y2="priceBottom"
          class="candlestick-chart__axis"
        />
        <line
          x1="40"
          :y1="volumeBottom"
          x2="965"
          :y2="volumeBottom"
          class="candlestick-chart__axis"
        />
        <text
          x="45"
          y="25"
          class="candlestick-chart__axis-label"
        >價格（TWD）</text>
        <text
          x="45"
          y="390"
          class="candlestick-chart__axis-label"
        >成交量（股）</text>

        <g
          v-for="(bar, index) in bars"
          :id="`candle-${snapshot.code}-${index}`"
          :key="bar.date"
          :data-candle-index="index"
          :class="['candlestick-chart__candle', `candlestick-chart__candle--${direction(bar)}`, { 'is-selected': selectedIndex === index }]"
          role="button"
          :tabindex="selectedIndex === index ? 0 : -1"
          :aria-label="candleAriaLabel(bar)"
          @focus="selectedIndex = index"
          @keydown="handleCandleKeydown($event, index)"
          @click="selectCandle(index)"
        >
          <title>{{ candleAriaLabel(bar) }}</title>
          <line
            :x1="candleX(index)"
            :x2="candleX(index)"
            :y1="priceY(bar.high)"
            :y2="priceY(bar.low)"
            class="candlestick-chart__wick"
          />
          <rect
            :x="candleX(index) - candleWidth() / 2"
            :y="Math.min(priceY(bar.open), priceY(bar.close))"
            :width="candleWidth()"
            :height="Math.max(2, Math.abs(priceY(bar.open) - priceY(bar.close)))"
            class="candlestick-chart__body"
          />
          <text
            :x="candleX(index)"
            :y="priceY(bar.high) - 8"
            text-anchor="middle"
            class="candlestick-chart__direction"
            aria-hidden="true"
          >{{ direction(bar) === 'up' ? '▲' : direction(bar) === 'down' ? '▽' : '◆' }}</text>
          <rect
            :x="candleX(index) - candleWidth() / 2"
            :y="volumeY(bar.volumeShares)"
            :width="candleWidth()"
            :height="Math.max(1, volumeBottom - volumeY(bar.volumeShares))"
            class="candlestick-chart__volume"
          />
          <g
            v-for="action in actionsFor(bar.date)"
            :key="`${action.type}-${action.date}`"
            data-corporate-action
            :aria-label="`${bar.date} 公司行動：${actionLabel(action)}`"
          >
            <path
              :d="`M ${candleX(index) - 6} ${priceTop + 8} L ${candleX(index) + 6} ${priceTop + 8} L ${candleX(index)} ${priceTop + 19} Z`"
              class="candlestick-chart__action-marker"
            />
            <title>{{ actionLabel(action) }}；資料來源：{{ action.sourceUrl }}</title>
          </g>
        </g>
      </svg>
    </div>

    <output
      v-if="selectedBar"
      class="candlestick-chart__summary"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ candleAriaLabel(selectedBar) }}
      <span v-if="actionsFor(selectedBar.date).length > 0">公司行動：{{ actionsFor(selectedBar.date).map(actionLabel).join('、') }}。</span>
    </output>

    <div
      v-if="showDataTable"
      id="candlestick-data-table"
      class="candlestick-chart__table-wrap"
      tabindex="-1"
    >
      <table>
        <caption>最近 {{ bars.length }} 根原始盤後日 K OHLCV 資料</caption>
        <thead>
          <tr>
            <th scope="col">
              日期
            </th>
            <th scope="col">
              開
            </th>
            <th scope="col">
              高
            </th>
            <th scope="col">
              低
            </th>
            <th scope="col">
              收
            </th>
            <th scope="col">
              成交量（股）
            </th>
            <th scope="col">
              公司行動
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="bar in bars"
            :key="bar.date"
          >
            <th scope="row">
              {{ bar.date }}
            </th>
            <td>{{ formatPrice(bar.open) }}</td>
            <td>{{ formatPrice(bar.high) }}</td>
            <td>{{ formatPrice(bar.low) }}</td>
            <td>{{ formatPrice(bar.close) }}</td>
            <td>{{ formatNumber(bar.volumeShares) }}</td>
            <td>{{ actionsFor(bar.date).map(actionLabel).join('、') || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.candlestick-chart {
  margin: 1.5rem 0;
  padding: 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg-soft);
}

.candlestick-chart__heading-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: start;
  justify-content: space-between;
}

.candlestick-chart h3,
.candlestick-chart p {
  margin-top: 0;
}

.candlestick-chart__heading-row button {
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.45rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}

.candlestick-chart__plot-wrap {
  overflow-x: auto;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.candlestick-chart__svg {
  display: block;
  min-width: 38rem;
  width: 100%;
  height: auto;
}

.candlestick-chart__axis {
  stroke: #8c786d;
  stroke-width: 1;
}

.candlestick-chart__axis-label {
  fill: #594842;
  font-size: 18px;
}

.candlestick-chart__wick {
  stroke: #594842;
  stroke-width: 2;
}

.candlestick-chart__body {
  stroke: currentColor;
  stroke-width: 2;
}

.candlestick-chart__candle--up {
  color: #9d352a;
}

.candlestick-chart__candle--up .candlestick-chart__body,
.candlestick-chart__candle--up .candlestick-chart__volume {
  fill: #b54a3c;
}

.candlestick-chart__candle--down {
  color: #246b4a;
}

.candlestick-chart__candle--down .candlestick-chart__body {
  fill: #fffdf9;
}

.candlestick-chart__candle--down .candlestick-chart__volume {
  fill: #2d7f56;
}

.candlestick-chart__candle--flat {
  color: #6f625a;
}

.candlestick-chart__candle--flat .candlestick-chart__body,
.candlestick-chart__candle--flat .candlestick-chart__volume {
  fill: #d8c9bd;
}

.candlestick-chart__direction {
  fill: currentColor;
  font-size: 13px;
}

.candlestick-chart__action-marker {
  fill: #d28a21;
  stroke: #594842;
  stroke-width: 1;
}

.candlestick-chart__candle {
  cursor: pointer;
  outline: none;
}

.candlestick-chart__candle.is-selected .candlestick-chart__body {
  stroke: #1b4e8a;
  stroke-width: 4;
}

.candlestick-chart__candle:focus .candlestick-chart__body {
  stroke: #1b4e8a;
  stroke-width: 5;
}

.candlestick-chart__summary {
  display: block;
  min-height: 2.5rem;
  margin-top: 0.75rem;
  padding: 0.75rem;
  border-left: 4px solid #1b4e8a;
  background: #eef5ff;
  color: #1e3655;
}

.candlestick-chart__table-wrap {
  overflow-x: auto;
  margin-top: 1rem;
}

.candlestick-chart table {
  width: 100%;
  min-width: 42rem;
  border-collapse: collapse;
}

.candlestick-chart th,
.candlestick-chart td {
  padding: 0.5rem;
  border: 1px solid var(--vp-c-divider);
  text-align: right;
}

.candlestick-chart th:first-child,
.candlestick-chart td:first-child {
  text-align: left;
}

@media (max-width: 600px) {
  .candlestick-chart {
    padding: 0.75rem;
  }

  .candlestick-chart__svg {
    min-width: 34rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .candlestick-chart * {
    transition: none !important;
    animation: none !important;
  }
}
</style>
