import { mount } from '@vue/test-utils';
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
});
