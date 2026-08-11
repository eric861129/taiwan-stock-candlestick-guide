import { describe, expect, it } from 'vitest';
import { marketManifestSchema, stockSnapshotSchema } from './schema';

const manifestFixture = {
  schemaVersion: 1,
  snapshotVersion: 2,
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
    listingDate: '1994-09-05',
    availableSessions: 120,
    shortHistoryReason: null,
  }],
};

const snapshotFixture = {
  schemaVersion: 1,
  snapshotVersion: 2,
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

describe('market snapshot v2 schemas', () => {
  it('accepts the versioned manifest and raw stock snapshot fields used by the pipeline', () => {
    expect(marketManifestSchema.safeParse(manifestFixture).success).toBe(true);
    expect(stockSnapshotSchema.safeParse(snapshotFixture).success).toBe(true);
  });

  it('rejects an unsafe manifest path, malformed digest, and non-v2 snapshot', () => {
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      symbols: [{ ...manifestFixture.symbols[0], dataPath: 'data/stocks/../secret.json' }],
    }).success).toBe(false);
    expect(marketManifestSchema.safeParse({
      ...manifestFixture,
      symbols: [{ ...manifestFixture.symbols[0], digest: 'not-a-sha256' }],
    }).success).toBe(false);
    expect(stockSnapshotSchema.safeParse({ ...snapshotFixture, snapshotVersion: 1 }).success).toBe(false);
  });

  it('matches the v2 calendar contract for unknown expected cutoffs and retained trading sessions', () => {
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
});
