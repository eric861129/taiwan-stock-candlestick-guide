import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => ({
  loadManifest: vi.fn(),
  loadStockSnapshot: vi.fn(),
}));
const matcherMocks = vi.hoisted(() => ({ analyzePatterns: vi.fn() }));

vi.mock('../domain/market-data/client', () => ({
  loadManifest: clientMocks.loadManifest,
  loadStockSnapshot: clientMocks.loadStockSnapshot,
  normalizeStockCode: (value: unknown) => (typeof value === 'string' ? value.trim() : null),
}));
vi.mock('../domain/patterns/matcher', () => ({ analyzePatterns: matcherMocks.analyzePatterns }));

import StockAnalyzer from './StockAnalyzer.vue';

const manifest = {
  schemaVersion: 1,
  snapshotVersion: 3,
  sourceCommit: 'a'.repeat(40),
  snapshotHash: 'b'.repeat(64),
  generatedAt: '2026-08-11T18:00:00+08:00',
  markets: {
    TWSE: {
      cutoffDate: '2026-08-11',
      expectedCutoffDate: '2026-08-11',
      freshness: 'fresh',
      calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
      calendarValidThrough: '2026-12-31',
      tradingSessions: ['2026-08-10', '2026-08-11'],
    },
    TPEx: {
      cutoffDate: '2026-08-11',
      expectedCutoffDate: '2026-08-11',
      freshness: 'fresh',
      calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
      calendarValidThrough: '2026-12-31',
      tradingSessions: ['2026-08-10', '2026-08-11'],
    },
  },
  symbols: [
    {
      code: '2330', name: '台積電', market: 'TWSE', securityType: 'common-stock',
      dataPath: 'data/stocks/2330.fixture.json', digest: 'c'.repeat(64), size: 100,
      firstDate: '2026-08-11', lastDate: '2026-08-11', barCount: 1,
      noQuoteCount: 0,
      listingDate: '1994-09-05', availableSessions: 1, shortHistoryReason: 'listing-history',
    },
    {
      code: '0050', name: '測試基金', market: 'TWSE', securityType: 'common-stock',
      dataPath: 'data/stocks/0050.fixture.json', digest: 'd'.repeat(64), size: 100,
      firstDate: '2026-08-11', lastDate: '2026-08-11', barCount: 1,
      noQuoteCount: 0,
      listingDate: '2003-06-25', availableSessions: 1, shortHistoryReason: 'listing-history',
    },
  ],
};

function snapshot(code: string, name: string) {
  return {
    schemaVersion: 1,
    code,
    name,
    market: 'TWSE' as const,
    securityType: 'common-stock' as const,
    priceMode: 'raw' as const,
    currency: 'TWD' as const,
    comparisonUnitPolicy: {
      version: 1,
      effectiveFrom: '2026-08-11',
      sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
    },
    bars: [{
      date: '2026-08-11', open: 100, high: 105, low: 95, close: 102,
      volumeShares: 1000, sourcePrecision: 0.01, comparisonUnit: 0.5,
    }],
    noQuoteEvidence: [],
    corporateActions: [],
    sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('StockAnalyzer request ordering', () => {
  it('does not let an earlier stock request overwrite the later selection', async () => {
    const firstRequest = deferred<ReturnType<typeof snapshot>>();
    const secondRequest = deferred<ReturnType<typeof snapshot>>();
    clientMocks.loadManifest.mockResolvedValue(manifest);
    clientMocks.loadStockSnapshot.mockImplementation((_manifest, code: string) => (
      code === '2330' ? firstRequest.promise : secondRequest.promise
    ));
    matcherMocks.analyzePatterns.mockImplementation((loaded) => ({
      status: 'no-clear-pattern',
      matches: [],
      context: {
        snapshotVersion: 1,
        snapshotHash: 'b'.repeat(64),
        market: 'TWSE',
        cutoffDate: '2026-08-11',
        freshness: 'fresh',
        timeframe: '1d',
        analyzedFrom: loaded.bars[0].date,
        analyzedTo: loaded.bars[0].date,
        analyzedBarCount: 1,
        dataCompleteness: 100,
        reasonCodes: [],
        evaluatedCardCount: 17,
        unavailableCardIds: [],
        affectedRuleIds: [],
        suppressedRules: [],
        corporateActions: [],
        warnings: [],
      },
    }));
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    const search = wrapper.findComponent({ name: 'StockCodeSearch' });
    expect(search.exists()).toBe(true);
    search.vm.$emit('selected', manifest.symbols[0]);
    await wrapper.vm.$nextTick();
    search.vm.$emit('selected', manifest.symbols[1]);
    await wrapper.vm.$nextTick();

    secondRequest.resolve(snapshot('0050', '測試基金'));
    await flushPromises();
    expect(wrapper.get('[aria-label="已選擇的股票"]').text()).toContain('0050');

    firstRequest.resolve(snapshot('2330', '台積電'));
    await flushPromises();
    expect(wrapper.get('[aria-label="已選擇的股票"]').text()).toContain('0050');
  });
});
