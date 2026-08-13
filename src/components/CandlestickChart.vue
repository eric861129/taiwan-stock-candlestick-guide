<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import type { CorporateAction, OhlcvBar, PriceMode, StockSnapshot, Timeframe } from '../domain/market-data/types';
import type { StructureOverlay } from '../domain/structures/types';

const props = withDefaults(defineProps<{
  snapshot: StockSnapshot;
  maxBars?: number;
  /** 目前選中的單一結構候選；圖表只接收資料座標，不重新判斷型態。 */
  structureOverlay?: StructureOverlay | null;
}>(), {
  maxBars: 60,
  structureOverlay: null,
});

const selectedIndex = ref(0);
const showDataTable = ref(false);
const showFullStructure = ref(false);
const chartInstanceId = useId();
const candleElements = ref<(SVGGElement | null)[]>([]);
const chartWidth = 1000;
const chartHeight = 560;
const priceTop = 40;
const priceBottom = 355;
const volumeTop = 405;
const volumeBottom = 510;

const timeframe = computed<Timeframe>(() => props.snapshot.timeframe ?? '1d');
const completedBars = computed(() => props.snapshot.bars.filter((bar) => bar.completed !== false));
const formingBar = computed(() => props.snapshot.bars.filter((bar) => bar.completed === false).at(-1) ?? null);
const defaultVisibleStart = computed(() => Math.max(0, completedBars.value.length - props.maxBars));
const hasHiddenStructureStart = computed(() => (
  props.structureOverlay !== null
  && props.structureOverlay.window.startBarIndex < defaultVisibleStart.value
));
const visibleCompletedStart = computed(() => (
  showFullStructure.value && props.structureOverlay !== null
    ? Math.max(0, props.structureOverlay.window.startBarIndex)
    : defaultVisibleStart.value
));
const visibleCompletedBars = computed(() => completedBars.value.slice(visibleCompletedStart.value));
const bars = computed(() => [
  ...visibleCompletedBars.value,
  ...(formingBar.value ? [formingBar.value] : []),
]);
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
const chartHeadingId = `${chartInstanceId}-heading`;
const chartTitleId = `${chartInstanceId}-title`;
const chartDescriptionId = `${chartInstanceId}-description`;
const chartClipId = `${chartInstanceId}-plot`;
const chartTableId = `${chartInstanceId}-data-table`;

function candleId(index: number): string {
  return `${chartInstanceId}-candle-${index}`;
}

function setCandleElement(index: number, element: Element | ComponentPublicInstance | null): void {
  candleElements.value[index] = element instanceof Element ? element as SVGGElement : null;
}
const visibleSourceEnd = computed(() => completedBars.value.length - 1);
const displayedStructureOverlay = computed(() => {
  const overlay = props.structureOverlay;
  if (!overlay) return null;
  return overlay.window.endBarIndex >= visibleCompletedStart.value
    && overlay.window.startBarIndex <= visibleSourceEnd.value
    ? overlay
    : null;
});
const overlayDescription = computed(() => {
  const overlay = displayedStructureOverlay.value;
  if (!overlay) return '未選擇價格結構疊線。';
  const anchors = overlay.anchors.map((anchor) => anchor.label).join('；');
  const scenario = overlay.scenario
    ? `；${overlay.scenario.label}${overlay.scenario.conditions?.length
      ? `：${overlay.scenario.conditions.map((condition) => `${condition.label} ${condition.condition}`).join('；')}`
      : ''}`
    : '';
  return `目前疊線為 ${overlay.candidateId}，形成區間 ${overlay.window.startDate} 至 ${overlay.window.endDate}；${anchors}${scenario}。`;
});

const timeframeLabels: Readonly<Record<Timeframe, string>> = {
  '1d': '日 K',
  '1w': '週 K',
  '1m': '月 K',
};

function timeframeLabel(value: Timeframe): string {
  return timeframeLabels[value];
}

function priceModeLabel(value: PriceMode): string {
  return value === 'adjusted' ? '向後還原價格' : '官方原始價格';
}

watch(bars, (nextBars) => {
  selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, nextBars.length - 1));
}, { immediate: true });

function candleX(index: number): number {
  return 45 + ((index + 0.5) * 910) / Math.max(1, bars.value.length);
}

function sourceBarIndex(index: number): number {
  if (index >= visibleCompletedBars.value.length) {
    return completedBars.value.length;
  }
  return visibleCompletedStart.value + index;
}

function sourceBarX(index: number): number {
  return candleX(index - visibleCompletedStart.value);
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

function numericTicks(minimum: number, maximum: number, count = 4): readonly number[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || count < 2) return [];
  const step = (maximum - minimum) / (count - 1);
  return Array.from({ length: count }, (_value, index) => minimum + step * index);
}

const priceTicks = computed(() => numericTicks(priceBounds.value.low, priceBounds.value.high));
const volumeTicks = computed(() => numericTicks(0, maximumVolume.value));
const dateTicks = computed(() => {
  const visibleCount = bars.value.length;
  if (visibleCount === 0) return [];
  const positions = [...new Set([0, Math.floor((visibleCount - 1) / 2), visibleCount - 1])];
  return positions.map((index) => ({
    index,
    label: periodLabel(bars.value[index]!),
  }));
});

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
  return `${periodLabel(bar)}，開 ${formatPrice(bar.open)}，高 ${formatPrice(bar.high)}，低 ${formatPrice(bar.low)}，收 ${formatPrice(bar.close)}，成交量 ${formatNumber(bar.volumeShares)} 股，${barStatusLabel(bar)}，${directionLabel(bar)}。`;
}

function periodLabel(bar: OhlcvBar): string {
  if (bar.periodStart && bar.periodEnd && bar.periodStart !== bar.periodEnd) {
    return `${bar.periodStart} 至 ${bar.periodEnd}`;
  }
  return bar.date;
}

function barStatusLabel(bar: OhlcvBar): string {
  if (bar.completed === false) {
    return '形成中，不納入型態比對';
  }
  if (bar.evidenceStatus === 'incomplete') {
    return '已完成但官方交易日證據不完整，不納入型態比對';
  }
  return '已完成';
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: props.snapshot.priceMode === 'adjusted' ? 4 : 0,
  }).format(value);
}

function formatVolumeTick(value: number): string {
  return `${formatNumber(value)} 股`;
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

function actionsFor(bar: OhlcvBar): readonly CorporateAction[] {
  const periodStart = bar.periodStart ?? bar.date;
  const periodEnd = bar.periodEnd ?? bar.date;
  return props.snapshot.corporateActions.filter((action) => (
    action.date >= periodStart && action.date <= periodEnd
  ));
}

async function selectCandle(index: number, moveFocus = false): Promise<void> {
  const nextIndex = Math.max(0, Math.min(index, bars.value.length - 1));
  selectedIndex.value = nextIndex;
  if (moveFocus && typeof document !== 'undefined') {
    await nextTick();
    candleElements.value[nextIndex]?.focus();
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
    :aria-labelledby="chartHeadingId"
  >
    <div class="candlestick-chart__heading-row">
      <div>
        <h3 :id="chartHeadingId">
          {{ snapshot.name }}（{{ snapshot.code }}）{{ priceModeLabel(snapshot.priceMode) }}{{ showFullStructure ? '完整型態範圍' : '最近' }} {{ visibleCompletedBars.length }} 根{{ timeframeLabel(timeframe) }}
          <span v-if="formingBar">，另有 1 根形成中{{ timeframeLabel(timeframe) }}</span>
        </h3>
        <p>價格單位為 TWD；成交量在原始模式是實際股數，在還原模式是依官方因子換算的等值股數。紅綠之外，圖上也使用實心上箭頭、空心下箭頭與菱形記號；可用左右方向鍵逐根查看。</p>
      </div>
      <button
        type="button"
        data-chart-table-toggle
        :aria-expanded="showDataTable"
        :aria-controls="chartTableId"
        @click="showDataTable = !showDataTable"
      >
        {{ showDataTable ? '收合 OHLCV 資料表' : '展開 OHLCV 資料表' }}
      </button>
      <button
        v-if="hasHiddenStructureStart"
        type="button"
        data-full-structure-toggle
        @click="showFullStructure = !showFullStructure"
      >
        {{ showFullStructure ? '顯示最近 60 根 K 棒' : '展開完整型態範圍' }}
      </button>
    </div>

    <div class="candlestick-chart__plot-wrap">
      <svg
        class="candlestick-chart__svg"
        :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
        role="img"
        :aria-labelledby="`${chartTitleId} ${chartDescriptionId}`"
      >
        <title :id="chartTitleId">{{ snapshot.name }}最近 {{ bars.length }} 根{{ priceModeLabel(snapshot.priceMode) }}{{ timeframeLabel(timeframe) }} 與成交量</title>
        <desc :id="chartDescriptionId">顯示 {{ bars.length }} 根{{ priceModeLabel(snapshot.priceMode) }}{{ timeframeLabel(timeframe) }}、成交量與公司行動標記。形成中或證據不完整的 K 棒不納入型態比對。{{ overlayDescription }}使用左右方向鍵可逐根取得繁體中文 OHLCV 摘要。</desc>
        <defs>
          <clipPath :id="chartClipId">
            <rect
              x="40"
              :y="priceTop"
              width="925"
              :height="priceBottom - priceTop"
            />
          </clipPath>
        </defs>
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
          v-for="tick in priceTicks"
          :key="`price-${tick}`"
          data-price-tick
        >
          <line
            x1="40"
            x2="965"
            :y1="priceY(tick)"
            :y2="priceY(tick)"
            class="candlestick-chart__grid"
          />
          <text
            x="960"
            :y="priceY(tick) - 4"
            text-anchor="end"
            class="candlestick-chart__tick-label"
          >{{ formatPrice(tick) }} TWD</text>
        </g>
        <g
          v-for="tick in volumeTicks"
          :key="`volume-${tick}`"
          data-volume-tick
        >
          <line
            x1="40"
            x2="965"
            :y1="volumeY(tick)"
            :y2="volumeY(tick)"
            class="candlestick-chart__grid"
          />
          <text
            x="960"
            :y="volumeY(tick) - 4"
            text-anchor="end"
            class="candlestick-chart__tick-label"
          >{{ formatVolumeTick(tick) }}</text>
        </g>
        <g
          v-for="tick in dateTicks"
          :key="`date-${tick.index}`"
          data-date-tick
        >
          <line
            :x1="candleX(tick.index)"
            :x2="candleX(tick.index)"
            :y1="volumeBottom"
            y2="520"
            class="candlestick-chart__axis"
          />
          <text
            :x="candleX(tick.index)"
            y="540"
            text-anchor="middle"
            class="candlestick-chart__tick-label"
          >{{ tick.label }}</text>
        </g>

        <g
          v-for="(bar, index) in bars"
          :id="candleId(index)"
          :ref="(element) => setCandleElement(index, element)"
          :key="bar.date"
          :data-candle-index="index"
          :data-source-bar-index="sourceBarIndex(index)"
          :class="['candlestick-chart__candle', `candlestick-chart__candle--${direction(bar)}`, { 'is-selected': selectedIndex === index, 'is-forming': bar.completed === false, 'is-incomplete': bar.evidenceStatus === 'incomplete' }]"
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
            v-for="action in actionsFor(bar)"
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

        <g
          v-if="displayedStructureOverlay"
          :data-structure-overlay="displayedStructureOverlay.candidateId"
          class="candlestick-chart__structure-overlay"
          :clip-path="`url(#${chartClipId})`"
        >
          <g
            v-for="segment in displayedStructureOverlay.segments"
            :key="segment.id"
            :data-structure-segment="segment.kind"
          >
            <line
              :x1="sourceBarX(segment.startBarIndex)"
              :x2="sourceBarX(segment.endBarIndex)"
              :y1="priceY(segment.startPrice)"
              :y2="priceY(segment.endPrice)"
              :class="['candlestick-chart__structure-line', `candlestick-chart__structure-line--${segment.kind}`, { 'is-dashed': segment.lineStyle === 'dashed' }]"
            />
            <title>{{ segment.label }}</title>
          </g>
          <g
            v-for="anchor in displayedStructureOverlay.anchors"
            :key="anchor.id"
            data-structure-anchor
          >
            <circle
              :cx="sourceBarX(anchor.barIndex)"
              :cy="priceY(anchor.price)"
              r="5"
              class="candlestick-chart__structure-anchor"
            />
            <title>{{ anchor.label }}</title>
          </g>
          <text
            v-if="displayedStructureOverlay.scenario"
            x="52"
            :y="priceTop + 24"
            class="candlestick-chart__structure-scenario"
          >{{ displayedStructureOverlay.scenario.label }}</text>
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
      <span v-if="actionsFor(selectedBar).length > 0">公司行動：{{ actionsFor(selectedBar).map(actionLabel).join('、') }}。</span>
    </output>

    <div
      v-if="showDataTable"
      :id="chartTableId"
      class="candlestick-chart__table-wrap"
      tabindex="-1"
    >
      <table>
        <caption>最近 {{ bars.length }} 根{{ priceModeLabel(snapshot.priceMode) }}{{ timeframeLabel(timeframe) }} OHLCV 資料</caption>
        <thead>
          <tr>
            <th scope="col">
              日期
            </th>
            <th scope="col">
              狀態
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
              {{ periodLabel(bar) }}
            </th>
            <td>{{ barStatusLabel(bar) }}</td>
            <td>{{ formatPrice(bar.open) }}</td>
            <td>{{ formatPrice(bar.high) }}</td>
            <td>{{ formatPrice(bar.low) }}</td>
            <td>{{ formatPrice(bar.close) }}</td>
            <td>{{ formatNumber(bar.volumeShares) }}</td>
            <td>{{ actionsFor(bar).map(actionLabel).join('、') || '—' }}</td>
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

.candlestick-chart__grid {
  stroke: #d8c9bd;
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.candlestick-chart__tick-label {
  fill: #65564e;
  font-size: 12px;
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

.candlestick-chart__structure-line {
  fill: none;
  stroke: #1b4e8a;
  stroke-width: 3;
}

.candlestick-chart__structure-line--confirmation {
  stroke: #1f633f;
}

.candlestick-chart__structure-line--invalidation {
  stroke: #8b3f35;
}

.candlestick-chart__structure-line--outline {
  stroke: #785f9d;
  stroke-width: 2;
}

.candlestick-chart__structure-line.is-dashed {
  stroke-dasharray: 7 4;
}

.candlestick-chart__structure-anchor {
  fill: #fffdf9;
  stroke: #1b4e8a;
  stroke-width: 3;
}

.candlestick-chart__structure-scenario {
  fill: #1e3655;
  font-size: 13px;
  font-weight: 700;
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

.candlestick-chart__candle.is-forming {
  opacity: 0.58;
}

.candlestick-chart__candle.is-forming .candlestick-chart__body,
.candlestick-chart__candle.is-incomplete .candlestick-chart__body {
  stroke-dasharray: 4 3;
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
