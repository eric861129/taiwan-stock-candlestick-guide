import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';
import CandlestickChart from './CandlestickChart.vue';

function chartDate(index: number): string {
  return new Date(Date.UTC(2026, 5, index + 1)).toISOString().slice(0, 10);
}

const chartSnapshot = {
  schemaVersion: 1,
  code: '2330',
  name: '台積電',
  market: 'TWSE' as const,
  securityType: 'common-stock' as const,
  priceMode: 'raw' as const,
  currency: 'TWD' as const,
  comparisonUnitPolicy: {
    version: 1,
    effectiveFrom: '2026-08-11',
    sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
  },
  bars: Array.from({ length: 61 }, (_value, index) => ({
    date: chartDate(index),
    open: 100 + index,
    high: 105 + index,
    low: 98 + index,
    close: index % 2 === 0 ? 103 + index : 99 + index,
    volumeShares: 1_000_000 + index,
    sourcePrecision: 0.01,
    comparisonUnit: 0.5,
  })),
  noQuoteEvidence: [],
  corporateActions: [{
    date: chartDate(60),
    type: 'cash-dividend' as const,
    affectsPriceContinuity: true,
    sourceUrl: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
    verifiedAt: '2026-06-30',
  }],
  sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
};

describe('CandlestickChart', () => {
  it('keeps SVG, table, candle IDs, and keyboard focus local when the same stock chart is mounted twice', async () => {
    const Host = defineComponent({
      components: { CandlestickChart },
      setup: () => ({ chartSnapshot }),
      template: '<div><CandlestickChart :snapshot="chartSnapshot" /><CandlestickChart :snapshot="chartSnapshot" /></div>',
    });
    const wrapper = mount(Host, { attachTo: document.body });
    const charts = wrapper.findAllComponents(CandlestickChart);
    const ids = wrapper.findAll('[id]').map((element) => element.attributes('id'));

    expect(new Set(ids).size).toBe(ids.length);
    await charts[0]!.get('[data-candle-index="0"]').trigger('keydown', { key: 'ArrowRight' });
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(charts[0]!.get('[data-candle-index="1"]').element);
    expect(charts[1]!.get('[data-candle-index="0"]').classes()).toContain('is-selected');
    wrapper.unmount();
  });

  it('renders TWD, share-volume, and date ticks with exactly one selected structure overlay', () => {
    const wrapper = mount(CandlestickChart, {
      props: {
        snapshot: chartSnapshot,
        structureOverlay: {
          candidateId: 'range:1d:raw:2026-06-04:2026-06-30',
          window: {
            version: 'structure-window-v1',
            startBarIndex: 3,
            endBarIndex: 29,
            startDate: chartDate(3),
            endDate: chartDate(29),
            barCount: 27,
          },
          segments: [{
            id: 'boundary-upper',
            kind: 'boundary',
            label: '上方邊界／確認線',
            startBarIndex: 3,
            startPrice: 112,
            endBarIndex: 29,
            endPrice: 138,
            lineStyle: 'solid',
          }],
          anchors: [{
            id: 'high-3',
            barIndex: 3,
            date: chartDate(3),
            price: 112,
            label: '波峰',
          }],
        },
      },
    });

    expect(wrapper.findAll('[data-price-tick]').length).toBeGreaterThanOrEqual(2);
    expect(wrapper.findAll('[data-volume-tick]').length).toBeGreaterThanOrEqual(2);
    expect(wrapper.findAll('[data-date-tick]').length).toBeGreaterThanOrEqual(2);
    expect(wrapper.findAll('[data-structure-overlay]')).toHaveLength(1);
    expect(wrapper.get('[data-structure-overlay]').attributes('data-structure-overlay')).toBe('range:1d:raw:2026-06-04:2026-06-30');
    expect(wrapper.findAll('[data-structure-anchor]')).toHaveLength(1);
  });

  it('clips an older structure to the visible sixty-bar viewport instead of hiding the whole overlay', () => {
    const wrapper = mount(CandlestickChart, {
      props: {
        snapshot: chartSnapshot,
        structureOverlay: {
          candidateId: 'range:older-than-viewport',
          window: {
            version: 'structure-window-v1',
            startBarIndex: 0,
            endBarIndex: 30,
            startDate: chartDate(0),
            endDate: chartDate(30),
            barCount: 31,
          },
          segments: [{
            id: 'boundary-upper',
            kind: 'boundary',
            label: '上方邊界',
            startBarIndex: 0,
            startPrice: 105,
            endBarIndex: 30,
            endPrice: 135,
            lineStyle: 'solid',
          }],
          anchors: [],
        },
      },
    });

    expect(wrapper.findAll('[data-candle-index]')).toHaveLength(60);
    expect(wrapper.get('[data-structure-overlay]').attributes('data-structure-overlay'))
      .toBe('range:older-than-viewport');
  });

  it('renders the latest sixty candles in an accessible SVG with a semantic table alternative', async () => {
    const wrapper = mount(CandlestickChart, {
      attachTo: document.body,
      props: { snapshot: chartSnapshot },
    });

    expect(wrapper.find('canvas').exists()).toBe(false);
    expect(wrapper.get('svg').attributes('role')).toBe('img');
    expect(wrapper.find('title').text()).toContain('台積電');
    expect(wrapper.find('desc').text()).toContain('60');
    expect(wrapper.findAll('[data-candle-index]')).toHaveLength(60);
    expect(wrapper.get('[data-candle-index="0"]').attributes('aria-label')).toContain('開');
    expect(wrapper.find('[data-corporate-action]').exists()).toBe(true);

    const tableToggle = wrapper.get('button[data-chart-table-toggle]');
    expect(tableToggle.attributes('aria-expanded')).toBe('false');
    await tableToggle.trigger('click');
    expect(tableToggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('table').exists()).toBe(true);

    wrapper.unmount();
  });

  it('moves the selected candle with arrow keys and announces OHLCV details', async () => {
    const wrapper = mount(CandlestickChart, {
      attachTo: document.body,
      props: { snapshot: chartSnapshot },
    });
    const firstCandle = wrapper.get('[data-candle-index="0"]');

    await firstCandle.trigger('keydown', { key: 'ArrowRight' });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-candle-index="1"]').classes()).toContain('is-selected');
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('成交量');

    wrapper.unmount();
  });

  it('keeps sixty completed weekly bars plus one visible forming bar and labels their status', () => {
    const completedBars = chartSnapshot.bars.map((bar) => ({
      ...bar,
      periodStart: bar.date,
      periodEnd: bar.date,
      completed: true,
      evidenceStatus: 'complete' as const,
      missingSessionDates: [],
    }));
    const formingBar = {
      ...completedBars.at(-1)!,
      date: chartDate(61),
      periodStart: chartDate(61),
      periodEnd: chartDate(61),
      completed: false,
    };
    const wrapper = mount(CandlestickChart, {
      props: {
        snapshot: {
          ...chartSnapshot,
          snapshotVersion: 4,
          timeframe: '1w' as const,
          bars: [...completedBars, formingBar],
        },
      },
    });

    expect(wrapper.findAll('[data-candle-index]')).toHaveLength(61);
    expect(wrapper.get('h3').text()).toContain('週 K');
    expect(wrapper.get('[data-candle-index="60"]').attributes('aria-label')).toContain('形成中');
  });

  it('shows a company action that happened inside a weekly bar period', async () => {
    const weeklyBar = {
      ...chartSnapshot.bars.at(-1)!,
      date: chartDate(60),
      periodStart: chartDate(58),
      periodEnd: chartDate(62),
      completed: true,
      evidenceStatus: 'complete' as const,
      missingSessionDates: [],
    };
    const wrapper = mount(CandlestickChart, {
      props: {
        snapshot: {
          ...chartSnapshot,
          snapshotVersion: 4,
          timeframe: '1w' as const,
          bars: [weeklyBar],
        },
      },
    });

    expect(wrapper.find('[data-corporate-action]').exists()).toBe(true);
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('現金股利');
    await wrapper.get('button[data-chart-table-toggle]').trigger('click');
    expect(wrapper.get('tbody').text()).toContain('現金股利');
  });
});
