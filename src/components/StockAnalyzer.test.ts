import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => ({
  loadManifest: vi.fn(),
  loadStockSnapshot: vi.fn(),
  selectStockPriceMode: vi.fn(),
  selectStockTimeframe: vi.fn(),
}));
const matcherMocks = vi.hoisted(() => ({ analyzePatterns: vi.fn() }));
const structureMocks = vi.hoisted(() => ({ analyzeStructures: vi.fn() }));

vi.mock('../domain/market-data/client', () => ({
  loadManifest: clientMocks.loadManifest,
  loadStockSnapshot: clientMocks.loadStockSnapshot,
  selectStockPriceMode: clientMocks.selectStockPriceMode,
  selectStockTimeframe: clientMocks.selectStockTimeframe,
  normalizeStockCode: (value: unknown) => (
    typeof value === 'string'
      ? value.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).trim()
      : null
  ),
}));
vi.mock('../domain/patterns/matcher', () => ({ analyzePatterns: matcherMocks.analyzePatterns }));
vi.mock('../domain/structures/analyzer', () => ({ analyzeStructures: structureMocks.analyzeStructures }));

import StockAnalyzer from './StockAnalyzer.vue';

const manifestFixture = {
  schemaVersion: 1,
  snapshotVersion: 4,
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
  symbols: [{
    code: '2330',
    name: '台積電',
    market: 'TWSE',
    securityType: 'common-stock',
    dataPath: 'data/stocks/2330.fixture.json',
    digest: 'c'.repeat(64),
    size: 512,
    firstDate: '2026-02-25',
    lastDate: '2026-08-11',
    barCount: 120,
    noQuoteCount: 0,
    listingDate: '1994-09-05',
    availableSessions: 120,
    shortHistoryReason: null,
  }, {
    code: '0050',
    name: '測試基金',
    market: 'TWSE',
    securityType: 'common-stock',
    dataPath: 'data/stocks/0050.fixture.json',
    digest: 'd'.repeat(64),
    size: 512,
    firstDate: '2026-02-25',
    lastDate: '2026-08-11',
    barCount: 120,
    noQuoteCount: 0,
    listingDate: '2003-06-25',
    availableSessions: 120,
    shortHistoryReason: null,
  }],
};

const snapshotFixture = {
  schemaVersion: 1,
  code: '2330',
  name: '台積電',
  market: 'TWSE',
  securityType: 'common-stock',
  priceMode: 'raw',
  currency: 'TWD',
  comparisonUnitPolicy: {
    version: 1,
    effectiveFrom: '2026-08-11',
    sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
  },
  bars: [{
    date: '2026-08-11', open: 1000, high: 1015, low: 995, close: 1010,
    volumeShares: 21_345_678, sourcePrecision: 0.01, comparisonUnit: 5,
  }],
  noQuoteEvidence: [],
  corporateActions: [],
  sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
};

const analysisContext = {
  snapshotVersion: 1,
  snapshotHash: 'b'.repeat(64),
  market: 'TWSE' as const,
  cutoffDate: '2026-08-11',
  freshness: 'fresh' as const,
  priceMode: 'raw' as const,
  timeframe: '1d' as const,
  analyzedFrom: '2026-08-11',
  analyzedTo: '2026-08-11',
  analyzedBarCount: 1,
  dataCompleteness: 100,
  reasonCodes: [],
  evaluatedCardCount: 17,
  unavailableCardIds: [],
  affectedRuleIds: [],
  suppressedRules: [],
  corporateActions: [],
  warnings: [],
};

const structureResultFixture = {
  status: 'matched' as const,
  matcherVersion: 'structure-v2' as const,
  timeframe: '1d' as const,
  priceMode: 'raw' as const,
  cutoffDate: '2026-08-11',
  features: {
    configVersion: 'structure-features-v2' as const,
    sourceBarCount: 1,
    analyzedBarCount: 1,
    smoothedClose: [],
    atr: { version: 'atr-v1' as const, period: 14, latest: 3, values: [] },
    pivots: [],
    warnings: [],
  },
  candidates: [{
    candidateId: 'range:1d:raw:2026-08-11:2026-08-11',
    structureId: 'range' as const,
    timeframe: '1d' as const,
    priceMode: 'raw' as const,
    ruleFit: 90,
    geometryCompleteness: 100,
    dataCompleteness: 100,
    status: 'forming' as const,
    direction: 'undetermined' as const,
    window: { version: 'structure-window-v1' as const, startBarIndex: 0, endBarIndex: 0, startDate: '2026-08-11', endDate: '2026-08-11', barCount: 1 },
    anchors: [],
    boundaries: [],
    evaluations: [],
    confirmationCondition: '收盤離開邊界後確認。',
    invalidationCondition: '返回區間即失效。',
    warnings: [],
    matcherVersion: 'structure-v2' as const,
    overlay: {
      candidateId: 'range:1d:raw:2026-08-11:2026-08-11',
      window: { version: 'structure-window-v1' as const, startBarIndex: 0, endBarIndex: 0, startDate: '2026-08-11', endDate: '2026-08-11', barCount: 1 },
      segments: [],
      anchors: [],
    },
  }],
  nearMisses: [],
  reasonCodes: [],
};

const weeklyBar = {
  ...snapshotFixture.bars[0],
  date: '2026-08-08',
  periodStart: '2026-08-04',
  periodEnd: '2026-08-08',
  completed: true,
  evidenceStatus: 'complete' as const,
  missingSessionDates: [],
};

describe('StockAnalyzer', () => {
  beforeEach(() => {
    clientMocks.loadManifest.mockReset();
    clientMocks.loadStockSnapshot.mockReset();
    clientMocks.selectStockPriceMode.mockReset();
    clientMocks.selectStockTimeframe.mockReset();
    matcherMocks.analyzePatterns.mockReset();
    structureMocks.analyzeStructures.mockReset();
    clientMocks.loadManifest.mockResolvedValue(manifestFixture);
    clientMocks.loadStockSnapshot.mockResolvedValue(snapshotFixture);
    clientMocks.selectStockTimeframe.mockImplementation((loaded, timeframe) => ({
      ...loaded,
      timeframe,
      bars: timeframe === '1w' ? [weeklyBar] : loaded.bars,
    }));
    clientMocks.selectStockPriceMode.mockImplementation((loaded, priceMode) => ({
      ...loaded,
      priceMode,
      bars: loaded.priceModes[priceMode].timeframes[loaded.timeframe ?? '1d'].completedBars,
    }));
    matcherMocks.analyzePatterns.mockReturnValue({
      status: 'no-clear-pattern',
      context: analysisContext,
      matches: [],
    });
    structureMocks.analyzeStructures.mockReturnValue(structureResultFixture);
  });

  it('loads no market data until this route mounts, then normalizes a supported code before loading one stock', async () => {
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    expect(wrapper.text()).toContain('本工具比較歷史價格資料與教學型態規則');
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true);
    await wrapper.get('input[name="stock-code"]').setValue('２３３０');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(clientMocks.loadStockSnapshot).toHaveBeenCalledWith(manifestFixture, '2330');
    expect(wrapper.text()).toContain('台積電');
    expect(wrapper.text()).toContain('無明顯型態');
  });

  it('runs the independent structure matcher with the same selected snapshot and applies only the selected overlay to the chart', async () => {
    const wrapper = mount(StockAnalyzer);
    await flushPromises();
    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(structureMocks.analyzeStructures).toHaveBeenCalledWith(expect.objectContaining({
      code: '2330', priceMode: 'raw', timeframe: '1d',
    }));
    expect(wrapper.findComponent({ name: 'CandlestickChart' }).props('structureOverlay')).toBeNull();

    await wrapper.get('[data-structure-candidate]').trigger('click');

    expect(wrapper.findComponent({ name: 'CandlestickChart' }).props('structureOverlay')).toMatchObject({
      candidateId: 'range:1d:raw:2026-08-11:2026-08-11',
    });
  });

  it('lets readers switch day/week/month with native keyboard-operable radios and immediately reruns matching', async () => {
    const wrapper = mount(StockAnalyzer);
    await flushPromises();
    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    const weeklyControl = wrapper.get('input[data-timeframe="1w"]');
    expect(weeklyControl.attributes('type')).toBe('radio');
    expect(weeklyControl.attributes('name')).toBe('analysis-timeframe');
    await weeklyControl.trigger('change');
    await flushPromises();

    expect(clientMocks.selectStockTimeframe).toHaveBeenCalledWith(
      expect.objectContaining({ code: '2330' }),
      '1w',
    );
    expect(matcherMocks.analyzePatterns).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeframe: '1w', bars: [weeklyBar] }),
      expect.any(Object),
    );
    expect(wrapper.get('.stock-analyzer__status').text()).toContain('週 K');
    expect(wrapper.text()).toContain('最近 60 根官方原始價格週 K');
    expect(wrapper.text()).not.toContain('最近 60 根官方原始價格日 K');
  });

  it('coordinates independent month, week, and day results and reveals three separate charts', async () => {
    const dailyBar = { ...snapshotFixture.bars[0], completed: true, evidenceStatus: 'complete' as const };
    const monthlyBar = {
      ...dailyBar,
      date: '2026-07-31',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    };
    const timeframes = {
      '1d': { completedBars: [dailyBar], formingBar: null },
      '1w': { completedBars: [weeklyBar], formingBar: null },
      '1m': { completedBars: [monthlyBar], formingBar: null },
    };
    clientMocks.loadStockSnapshot.mockResolvedValue({
      ...snapshotFixture,
      snapshotVersion: 4,
      timeframe: '1d',
      priceModes: {
        raw: { status: 'available', reasonCodes: [], warnings: [], timeframes },
        adjusted: { status: 'unavailable', reasonCodes: ['missing-adjustment-evidence'], warnings: ['證據不足'] },
      },
      bars: [dailyBar],
    });
    clientMocks.selectStockPriceMode.mockImplementation((loaded, priceMode) => ({
      ...loaded,
      priceMode,
      bars: loaded.priceModes[priceMode].timeframes[loaded.timeframe ?? '1d'].completedBars,
    }));
    clientMocks.selectStockTimeframe.mockImplementation((loaded, timeframe) => ({
      ...loaded,
      timeframe,
      bars: loaded.priceModes[loaded.priceMode].timeframes[timeframe].completedBars,
    }));
    structureMocks.analyzeStructures.mockImplementation((loaded) => ({
      ...structureResultFixture,
      timeframe: loaded.timeframe,
      candidates: structureResultFixture.candidates.map((candidate) => ({
        ...candidate,
        candidateId: `range:${loaded.timeframe}:raw:fixture`,
        timeframe: loaded.timeframe,
        overlay: { ...candidate.overlay, candidateId: `range:${loaded.timeframe}:raw:fixture` },
      })),
    }));
    matcherMocks.analyzePatterns.mockImplementation((loaded) => ({
      status: 'no-clear-pattern',
      context: { ...analysisContext, timeframe: loaded.timeframe },
      matches: [],
    }));

    const wrapper = mount(StockAnalyzer);
    await flushPromises();
    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('input[data-timeframe="1d"]').attributes('checked')).toBeDefined();
    expect(wrapper.get('input[data-timeframe="1d"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('input[data-timeframe="1w"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('input[data-timeframe="1m"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('input[data-timeframe="1w"]').trigger('change');
    await flushPromises();
    expect(wrapper.get('input[data-timeframe="1w"]').attributes('checked')).toBeDefined();
    expect(wrapper.text()).toContain('最近 60 根官方原始價格週 K');
    await wrapper.get('input[data-timeframe="1d"]').trigger('change');
    await flushPromises();

    expect(wrapper.html().indexOf('analysis-result-panel__structures'))
      .toBeLessThan(wrapper.html().indexOf('data-multitimeframe-practice'));
    expect(wrapper.findAll('[data-timeframe-summary]')).toHaveLength(0);
    await wrapper.get('[data-exercise-step-button="1m"]').trigger('click');
    await wrapper.get('input[name="monthly-direction"][value="up"]').setValue();
    await wrapper.get('textarea[name="monthly-key-area"]').setValue('月 K 長期壓力區');
    await flushPromises();
    await wrapper.get('[data-exercise-step-button="1w"]').trigger('click');
    await wrapper.get('input[name="weekly-relationship"][value="aligned"]').setValue();
    await flushPromises();
    await wrapper.get('[data-exercise-step-button="1d"]').trigger('click');
    await wrapper.get('input[name="daily-check"][value="confirmed"]').setValue();
    await flushPromises();
    await wrapper.get('[data-exercise-reveal]').trigger('click');

    expect(wrapper.findAll('[data-timeframe-summary]').map((item) => item.attributes('data-timeframe-summary')))
      .toEqual(['1m', '1w', '1d']);

    await wrapper.get('[data-multitimeframe-comparison-toggle]').trigger('click');
    expect(wrapper.findAll('[data-timeframe-chart]').map((item) => item.attributes('data-timeframe-chart')))
      .toEqual(['1m', '1w', '1d']);
  });

  it('switches from audited adjusted prices to raw prices and reruns chart matching with the same selected mode', async () => {
    const rawBar = { ...snapshotFixture.bars[0], close: 1010 };
    const adjustedBar = { ...snapshotFixture.bars[0], close: 1005 };
    const timeframes = (bar: typeof rawBar) => ({
      '1d': { completedBars: [bar], formingBar: null },
      '1w': { completedBars: [], formingBar: null },
      '1m': { completedBars: [], formingBar: null },
    });
    clientMocks.loadStockSnapshot.mockResolvedValue({
      ...snapshotFixture,
      snapshotVersion: 4,
      priceMode: 'adjusted',
      timeframe: '1d',
      priceModes: {
        raw: { status: 'available', reasonCodes: [], warnings: [], timeframes: timeframes(rawBar) },
        adjusted: { status: 'available', reasonCodes: [], warnings: [], timeframes: timeframes(adjustedBar) },
      },
      bars: [adjustedBar],
    });
    clientMocks.selectStockTimeframe.mockImplementation((loaded, timeframe) => ({
      ...loaded,
      timeframe,
      bars: loaded.priceModes[loaded.priceMode].timeframes[timeframe].completedBars,
    }));
    const wrapper = mount(StockAnalyzer);
    await flushPromises();
    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('input[data-price-mode="adjusted"]').attributes('checked')).toBeDefined();
    await wrapper.get('input[data-price-mode="raw"]').trigger('change');
    await flushPromises();

    expect(clientMocks.selectStockPriceMode).toHaveBeenCalledWith(
      expect.objectContaining({ priceMode: 'adjusted' }),
      'raw',
    );
    expect(matcherMocks.analyzePatterns).toHaveBeenCalledWith(
      expect.objectContaining({ priceMode: 'raw', bars: [rawBar] }),
      expect.any(Object),
    );
    expect(wrapper.text()).toContain('最近 60 根官方原始價格日 K');
  });

  it('disables adjusted analysis and explains the missing official evidence while keeping raw prices usable', async () => {
    const rawBar = snapshotFixture.bars[0];
    clientMocks.loadStockSnapshot.mockResolvedValue({
      ...snapshotFixture,
      snapshotVersion: 4,
      timeframe: '1d',
      priceMode: 'raw',
      priceModes: {
        raw: {
          status: 'available',
          reasonCodes: [],
          warnings: [],
          timeframes: {
            '1d': { completedBars: [rawBar], formingBar: null },
            '1w': { completedBars: [], formingBar: null },
            '1m': { completedBars: [], formingBar: null },
          },
        },
        adjusted: {
          status: 'unavailable',
          reasonCodes: ['missing-adjustment-evidence'],
          warnings: ['公司行動缺少可重算的官方調整證據，已保留原始價格。'],
        },
      },
      bars: [rawBar],
    });
    const wrapper = mount(StockAnalyzer);
    await flushPromises();
    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('input[data-price-mode="adjusted"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('公司行動缺少可重算的官方調整證據');
    expect(wrapper.text()).toContain('仍可查看官方原始價格');
  });

  it('uses the cutoff-date wording instead of calling a stale analysis current', async () => {
    matcherMocks.analyzePatterns.mockReturnValue({
      status: 'no-clear-pattern',
      context: { ...analysisContext, cutoffDate: '2026-08-06', freshness: 'stale' },
      matches: [],
    });
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('截至 2026-08-06 的型態');
    expect(wrapper.text()).not.toContain('目前型態');
  });

  it('keeps an unsupported-security loading failure distinct and actionable', async () => {
    clientMocks.loadStockSnapshot.mockRejectedValue({
      reason: 'unsupported-security',
      message: '此證券不是第一版支援的普通股。',
    });
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    await wrapper.get('input[name="stock-code"]').setValue('0050');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('此證券不是第一版支援的普通股。');
    expect(wrapper.text()).toContain('請輸入上市或上櫃普通股代碼');
  });

  it('keeps an official no-quote-only snapshot analyzable without inventing a chart candle', async () => {
    clientMocks.loadStockSnapshot.mockResolvedValue({
      ...snapshotFixture,
      bars: [],
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-11',
        reason: 'official-no-quote',
        sourceUrl: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
      }],
    });
    matcherMocks.analyzePatterns.mockReturnValue({
      status: 'insufficient-evidence',
      reasonCodes: ['official-no-quote', 'no-completed-bars'],
      context: { ...analysisContext, analyzedBarCount: 0 },
    });
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('股票日 K最後資料日 無合法日 K');
    expect(wrapper.text()).toContain('官方未報價證據 2026-08-11');
    expect(wrapper.findComponent({ name: 'CandlestickChart' }).exists()).toBe(false);
  });

  it('shows an auditable official suspension reason instead of presenting it as a price candle gap', async () => {
    const announcementUrl = 'https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB';
    clientMocks.loadStockSnapshot.mockResolvedValue({
      ...snapshotFixture,
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-suspension',
        sourceUrl: announcementUrl,
      }],
      sourceUrls: [...snapshotFixture.sourceUrls, announcementUrl],
    });
    matcherMocks.analyzePatterns.mockReturnValue({
      status: 'no-clear-pattern',
      matches: [],
      context: analysisContext,
    });
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('官方停牌證據 2026-08-10');
    expect(wrapper.text()).toContain('交易所公告停止買賣');
    expect(wrapper.get(`a[href="${announcementUrl}"]`).text()).toBe('查看官方來源');
  });

  it('將盤後資料載入失敗呈現為 unavailable 結果，而非股票輸入錯誤', async () => {
    clientMocks.loadStockSnapshot.mockRejectedValue({
      reason: 'load-error',
      message: '無法載入盤後資料（HTTP 500）。請稍後重新查詢。',
    });
    const wrapper = mount(StockAnalyzer);
    await flushPromises();

    await wrapper.get('input[name="stock-code"]').setValue('2330');
    await wrapper.get('form[data-stock-search]').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('暫時無法分析');
    expect(wrapper.text()).toContain('盤後資料暫時無法載入');
    expect(wrapper.find('.stock-analyzer__error').exists()).toBe(false);
  });
});
