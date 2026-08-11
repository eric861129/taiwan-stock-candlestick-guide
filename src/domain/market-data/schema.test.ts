import { describe, expect, it } from 'vitest';
import { marketManifestSchema, stockSnapshotSchema } from './schema';

const manifestFixture = {
  schemaVersion: 1,
  snapshotVersion: 3,
  sourceCommit: 'a'.repeat(40),
  snapshotHash: 'b'.repeat(64),
  generatedAt: '2026-08-11T18:00:00+08:00',
  calendar: {
    sourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
    validThrough: '2026-12-31',
    emergencyClosureEvidence: {
      schemaVersion: 1,
      closures: [{
        date: '2026-07-10',
        markets: ['TWSE', 'TPEx'],
        reason: '臺灣證券交易所集中交易市場 115 年 7 月 10 日因天然災害全日休市。',
        sourceUrls: [
          'https://eoc.gov.taipei/News/Detail/909',
          'https://www.tpex.org.tw/storage/eb_data/11205/11200591671.html',
          'https://www.twse.com.tw/en/clearing/suspended.html',
        ],
      }],
    },
  },
  suspensionEvidence: {
    schemaVersion: 1,
    intervals: [],
  },
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
  }],
};

const snapshotFixture = {
  schemaVersion: 1,
  snapshotVersion: 3,
  code: '2330',
  name: '台積電',
  market: 'TWSE',
  securityType: 'common-stock',
  priceMode: 'raw',
  currency: 'TWD',
  priceUnit: 'TWD',
  listingDate: '1994-09-05',
  availableSessions: 1,
  shortHistoryReason: 'listing-history',
  comparisonUnitPolicy: {
    version: 1,
    effectiveFrom: '2026-08-11',
    sourceUrl: 'https://www.twse.com.tw/zh/trading/trading-rule.html',
  },
  bars: [{
    date: '2026-08-11',
    open: 1000,
    high: 1015,
    low: 995,
    close: 1010,
    volumeShares: 21_345_678,
    transactionCount: 12_345,
    sourcePrecision: 0.01,
    comparisonUnit: 5,
    priceUnit: 'TWD',
  }],
  noQuoteEvidence: [],
  corporateActions: [{
    date: '2026-08-11',
    type: 'cash-dividend',
    affectsPriceContinuity: true,
    sourceUrl: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
    verifiedAt: '2026-08-11',
  }],
  sourceUrls: [
    'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
  ],
};

describe('market snapshot v3 schemas', () => {
  it('accepts the versioned manifest and raw stock snapshot fields used by the pipeline', () => {
    expect(marketManifestSchema.safeParse(manifestFixture).success).toBe(true);
    expect(stockSnapshotSchema.safeParse(snapshotFixture).success).toBe(true);
  });

  it('accepts a versioned official suspension interval and its auditable stock evidence', () => {
    const suspensionEvidence = {
      schemaVersion: 1,
      intervals: [{
        market: 'TWSE',
        code: '2330',
        startDate: '2026-08-10',
        endDateExclusive: '2026-08-11',
        reason: '測試用交易所停止買賣公告。',
        sourceUrls: ['https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB'],
      }],
    };
    const stock = {
      ...snapshotFixture,
      bars: [],
      availableSessions: 1,
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-suspension',
        sourceUrl: suspensionEvidence.intervals[0].sourceUrls[0],
      }],
      sourceUrls: [
        ...snapshotFixture.sourceUrls,
        suspensionEvidence.intervals[0].sourceUrls[0],
      ],
    };

    expect(marketManifestSchema.safeParse({ ...manifestFixture, suspensionEvidence }).success).toBe(true);
    expect(stockSnapshotSchema.safeParse(stock).success).toBe(true);
  });

  it('rejects an unsafe manifest path, malformed digest, a non-v3 snapshot, and an unexplained gap', () => {
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      symbols: [{ ...manifestFixture.symbols[0], dataPath: 'data/stocks/../secret.json' }],
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      symbols: [{ ...manifestFixture.symbols[0], digest: 'not-a-sha256' }],
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({ ...snapshotFixture, snapshotVersion: 2 }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({ ...snapshotFixture, noQuoteEvidence: undefined }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...snapshotFixture,
      availableSessions: 2,
      noQuoteEvidence: [],
    }).success).toBe(false);
  });

  it('fails closed for hostile official URLs, weekend sessions, and duplicate observations', () => {
    const hostileCalendarUrl = 'https://www.twse.com.tw@evil.example/holiday';
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      calendar: { ...manifestFixture.calendar, sourceUrl: hostileCalendarUrl },
      markets: {
        TWSE: { ...manifestFixture.markets.TWSE, calendarSourceUrl: hostileCalendarUrl },
        TPEx: { ...manifestFixture.markets.TPEx, calendarSourceUrl: hostileCalendarUrl },
      },
    }).success).toBe(false);
    const nonStandardPortUrl = 'https://openapi.twse.com.tw:444/v1/holidaySchedule/holidaySchedule';
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      calendar: { ...manifestFixture.calendar, sourceUrl: nonStandardPortUrl },
      markets: {
        TWSE: { ...manifestFixture.markets.TWSE, calendarSourceUrl: nonStandardPortUrl },
        TPEx: { ...manifestFixture.markets.TPEx, calendarSourceUrl: nonStandardPortUrl },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      markets: {
        TWSE: { ...manifestFixture.markets.TWSE, tradingSessions: ['2026-08-08', '2026-08-11'] },
        TPEx: { ...manifestFixture.markets.TPEx, tradingSessions: ['2026-08-10', '2026-08-11'] },
      },
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...snapshotFixture,
      availableSessions: 2,
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-08',
        reason: 'official-no-quote',
        sourceUrl: snapshotFixture.sourceUrls[0],
      }],
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...snapshotFixture,
      market: 'TPEx',
      corporateActions: [],
      sourceUrls: ['https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'],
      availableSessions: 2,
      noQuoteEvidence: [{
        market: 'TPEx',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-no-quote',
        sourceUrl: snapshotFixture.sourceUrls[0],
      }],
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({
      ...snapshotFixture,
      availableSessions: 2,
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: snapshotFixture.bars[0].date,
        reason: 'official-no-quote',
        sourceUrl: snapshotFixture.sourceUrls[0],
      }],
    }).success).toBe(false);
  });

  it('matches the v3 calendar contract for unknown expected cutoffs and retained trading sessions', () => {
    const unknownMarket = {
      ...manifestFixture.markets.TWSE,
      expectedCutoffDate: null,
      freshness: 'unknown',
    };
    const unknownManifest = {
      ...manifestFixture,
      markets: {
        TWSE: unknownMarket,
        TPEx: { ...unknownMarket },
      },
    };

    expect(marketManifestSchema.safeParse(unknownManifest).success).toBe(true);
    expect(marketManifestSchema.safeParse({
      ...unknownManifest,
      markets: {
        ...unknownManifest.markets,
        TWSE: { ...unknownMarket, freshness: 'fresh' },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      markets: {
        ...manifestFixture.markets,
        TWSE: { ...manifestFixture.markets.TWSE, cutoffDate: '2026-08-10' },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      markets: {
        ...manifestFixture.markets,
        TWSE: { ...manifestFixture.markets.TWSE, freshness: 'one-session-behind' },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      markets: {
        ...manifestFixture.markets,
        TWSE: {
          ...unknownMarket,
          calendarValidThrough: '2026-08-10',
        },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      markets: {
        ...manifestFixture.markets,
        TWSE: { ...manifestFixture.markets.TWSE, tradingSessions: [] },
      },
    }).success).toBe(false);
  });

  it('rejects an emergency closure that is unsourced, duplicated, or retained as a trading session', () => {
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      calendar: {
        ...manifestFixture.calendar,
        emergencyClosureEvidence: {
          schemaVersion: 1,
          closures: [{
            ...manifestFixture.calendar.emergencyClosureEvidence.closures[0],
            sourceUrls: [],
          }],
        },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      calendar: {
        ...manifestFixture.calendar,
        emergencyClosureEvidence: {
          schemaVersion: 1,
          closures: [{
            ...manifestFixture.calendar.emergencyClosureEvidence.closures[0],
            sourceUrls: ['https://www.twse.com.tw/en/clearing/suspended.html'],
          }],
        },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      calendar: {
        ...manifestFixture.calendar,
        emergencyClosureEvidence: {
          schemaVersion: 1,
          closures: [
            manifestFixture.calendar.emergencyClosureEvidence.closures[0],
            manifestFixture.calendar.emergencyClosureEvidence.closures[0],
          ],
        },
      },
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      markets: {
        TWSE: { ...manifestFixture.markets.TWSE, tradingSessions: ['2026-07-10', '2026-08-11'] },
        TPEx: { ...manifestFixture.markets.TPEx, tradingSessions: ['2026-07-10', '2026-08-11'] },
      },
    }).success).toBe(false);
  });
});
