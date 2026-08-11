import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => ({
  loadManifest: vi.fn(),
  loadStockSnapshot: vi.fn(),
}));
const matcherMocks = vi.hoisted(() => ({ analyzePatterns: vi.fn() }));
const freshnessMocks = vi.hoisted(() => ({
  computeFreshness: vi.fn(),
  mostConservativeFreshness: vi.fn((_manifestFreshness: string, computedFreshness: string) => computedFreshness),
}));

vi.mock('../domain/market-data/client', () => ({
  loadManifest: clientMocks.loadManifest,
  loadStockSnapshot: clientMocks.loadStockSnapshot,
  normalizeStockCode: (value: unknown) => (typeof value === 'string' ? value.trim() : null),
}));
vi.mock('../domain/market-data/freshness', () => ({
  computeFreshness: freshnessMocks.computeFreshness,
  mostConservativeFreshness: freshnessMocks.mostConservativeFreshness,
}));
vi.mock('../domain/patterns/matcher', () => ({ analyzePatterns: matcherMocks.analyzePatterns }));

import StockAnalyzer from './StockAnalyzer.vue';

describe('StockAnalyzer data dates', () => {
  it('uses the stock file last date for analysis while showing market cutoff separately', async () => {
    const manifest = {
      schemaVersion: 1,
      snapshotVersion: 3,
      sourceCommit: 'a'.repeat(40),
      snapshotHash: 'b'.repeat(64),
      generatedAt: '2026-08-11T18:00:00+08:00',
      markets: {
        TWSE: {
          cutoffDate: '2026-08-11', expectedCutoffDate: '2026-08-11', freshness: 'fresh',
          calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
          calendarValidThrough: '2026-12-31', tradingSessions: ['2026-08-10', '2026-08-11'],
        },
        TPEx: {
          cutoffDate: '2026-08-11', expectedCutoffDate: '2026-08-11', freshness: 'fresh',
          calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
          calendarValidThrough: '2026-12-31', tradingSessions: ['2026-08-10', '2026-08-11'],
        },
      },
      symbols: [{
        code: '2330', name: '台積電', market: 'TWSE', securityType: 'common-stock',
        dataPath: 'data/stocks/2330.fixture.json', digest: 'c'.repeat(64), size: 100,
        firstDate: '2026-08-10', lastDate: '2026-08-10', barCount: 1,
        noQuoteCount: 0,
        listingDate: '1994-09-05', availableSessions: 1, shortHistoryReason: 'listing-history',
      }],
    };
    const loadedSnapshot = {
      schemaVersion: 1,
      code: '2330', name: '台積電', market: 'TWSE' as const, securityType: 'common-stock' as const,
      priceMode: 'raw' as const, currency: 'TWD' as const,
      comparisonUnitPolicy: {
        version: 1, effectiveFrom: '2026-08-11', sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
      },
      bars: [{
        date: '2026-08-10', open: 100, high: 105, low: 95, close: 102,
        volumeShares: 1000, sourcePrecision: 0.01, comparisonUnit: 0.5,
      }],
      noQuoteEvidence: [],
      corporateActions: [],
      sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
    };
    clientMocks.loadManifest.mockResolvedValue(manifest);
    clientMocks.loadStockSnapshot.mockResolvedValue(loadedSnapshot);
    freshnessMocks.computeFreshness.mockReturnValue('one-session-behind');
    matcherMocks.analyzePatterns.mockImplementation((snapshot, options) => ({
      status: 'no-clear-pattern',
      matches: [],
      context: {
        snapshotVersion: 1,
        snapshotHash: 'b'.repeat(64),
        market: 'TWSE',
        cutoffDate: snapshot.cutoffDate,
        freshness: options.freshness,
        timeframe: '1d',
        analyzedFrom: '2026-08-10',
        analyzedTo: '2026-08-10',
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
    search.vm.$emit('selected', manifest.symbols[0]);
    await flushPromises();

    expect(freshnessMocks.computeFreshness).toHaveBeenCalledWith(expect.anything(), '2026-08-10');
    expect(matcherMocks.analyzePatterns).toHaveBeenCalledWith(
      expect.objectContaining({ cutoffDate: '2026-08-10', freshness: 'one-session-behind' }),
      expect.objectContaining({ freshness: 'one-session-behind' }),
    );
    const selection = wrapper.get('[aria-label="已選擇的股票"]').text();
    expect(selection).toContain('股票日 K 最後交易日 2026-08-10');
    expect(selection).toContain('市場快照截止日 2026-08-11');
    expect(selection).toContain('官方預期截止日 2026-08-11');
    expect(wrapper.text()).toContain('2026-08-10 的型態相似度分析');
    expect(wrapper.findComponent({ name: 'AnalysisResultPanel' }).props('marketSnapshotMetadata')).toEqual({
      marketSnapshotCutoffDate: '2026-08-11',
      officialExpectedCutoffDate: '2026-08-11',
    });
  });

  it('uses later official suspension evidence as the stock cutoff without relabelling it as a K candle', async () => {
    vi.clearAllMocks();
    const manifest = {
      schemaVersion: 1,
      snapshotVersion: 3,
      sourceCommit: 'a'.repeat(40),
      snapshotHash: 'b'.repeat(64),
      generatedAt: '2026-08-11T18:00:00+08:00',
      markets: {
        TWSE: {
          cutoffDate: '2026-08-11', expectedCutoffDate: '2026-08-11', freshness: 'fresh',
          calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
          calendarValidThrough: '2026-12-31', tradingSessions: ['2026-08-10', '2026-08-11'],
        },
        TPEx: {
          cutoffDate: '2026-08-11', expectedCutoffDate: '2026-08-11', freshness: 'fresh',
          calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
          calendarValidThrough: '2026-12-31', tradingSessions: ['2026-08-10', '2026-08-11'],
        },
      },
      symbols: [{
        code: '2330', name: '台積電', market: 'TWSE', securityType: 'common-stock',
        dataPath: 'data/stocks/2330.fixture.json', digest: 'c'.repeat(64), size: 100,
        firstDate: '2026-08-10', lastDate: '2026-08-10', barCount: 1, noQuoteCount: 1,
        listingDate: '1994-09-05', availableSessions: 2, shortHistoryReason: 'listing-history',
      }],
    };
    const loadedSnapshot = {
      schemaVersion: 1,
      code: '2330', name: '台積電', market: 'TWSE' as const, securityType: 'common-stock' as const,
      priceMode: 'raw' as const, currency: 'TWD' as const,
      comparisonUnitPolicy: {
        version: 1, effectiveFrom: '2026-08-11', sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
      },
      bars: [{
        date: '2026-08-10', open: 100, high: 105, low: 95, close: 102,
        volumeShares: 1000, sourcePrecision: 0.01, comparisonUnit: 0.5,
      }],
      noQuoteEvidence: [{
        market: 'TWSE' as const, code: '2330', date: '2026-08-11', reason: 'official-suspension' as const,
        sourceUrl: 'https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB',
      }],
      corporateActions: [],
      sourceUrls: [
        'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
        'https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB',
      ],
    };
    clientMocks.loadManifest.mockResolvedValue(manifest);
    clientMocks.loadStockSnapshot.mockResolvedValue(loadedSnapshot);
    freshnessMocks.computeFreshness.mockReturnValue('fresh');
    matcherMocks.analyzePatterns.mockImplementation((snapshot, options) => ({
      status: 'no-clear-pattern',
      matches: [],
      context: {
        snapshotVersion: 1,
        snapshotHash: 'b'.repeat(64),
        market: 'TWSE',
        cutoffDate: snapshot.cutoffDate,
        freshness: options.freshness,
        timeframe: '1d',
        analyzedFrom: '2026-08-10',
        analyzedTo: '2026-08-10',
        analyzedBarCount: 1,
        dataCompleteness: 50,
        reasonCodes: ['official-suspension'],
        evaluatedCardCount: 17,
        unavailableCardIds: [],
        affectedRuleIds: [],
        suppressedRules: [],
        corporateActions: [],
        warnings: ['交易所公告停止買賣；型態比對不跨越停牌區間。'],
      },
    }));
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    wrapper.findComponent({ name: 'StockCodeSearch' }).vm.$emit('selected', manifest.symbols[0]);
    await flushPromises();

    expect(freshnessMocks.computeFreshness).toHaveBeenCalledWith(expect.anything(), '2026-08-11');
    expect(matcherMocks.analyzePatterns).toHaveBeenCalledWith(
      expect.objectContaining({ cutoffDate: '2026-08-11', freshness: 'fresh' }),
      expect.objectContaining({ freshness: 'fresh' }),
    );
    expect(wrapper.get('[aria-label="已選擇的股票"]').text()).toContain('股票日 K 最後交易日 2026-08-10');
  });
});
