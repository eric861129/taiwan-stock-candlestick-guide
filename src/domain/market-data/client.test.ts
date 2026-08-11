import { describe, expect, it, vi } from 'vitest';
import {
  loadManifest,
  loadStockSnapshot,
  normalizeStockCode,
} from './client';
import { marketManifestSchema, type MarketDataManifest } from './schema';

const stockSnapshotFixture = {
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
  corporateActions: [],
  sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonResponse(text: string): { ok: boolean; status: number; text: () => Promise<string> } {
  return { ok: true, status: 200, text: async () => text };
}

async function manifestFixture(): Promise<MarketDataManifest> {
  const snapshotText = JSON.stringify(stockSnapshotFixture);
  const manifestWithoutHash = {
    schemaVersion: 1,
    snapshotVersion: 2,
    sourceCommit: 'a'.repeat(40),
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
      digest: await sha256Hex(snapshotText),
      size: new TextEncoder().encode(snapshotText).byteLength,
      firstDate: '2026-02-25',
      lastDate: '2026-08-11',
      barCount: 1,
      listingDate: '1994-09-05',
      availableSessions: 1,
      shortHistoryReason: 'listing-history',
    }],
  };

  return marketManifestSchema.parse({
    ...manifestWithoutHash,
    snapshotHash: await sha256Hex(`${canonicalJson(manifestWithoutHash)}\n`),
  });
}

describe('browser snapshot client', () => {
  it('normalizes full-width digits and only uses the exact manifest data path', async () => {
    const manifest = await manifestFixture();
    const fetchFixture = vi.fn(async () => jsonResponse(JSON.stringify(stockSnapshotFixture)));

    expect(normalizeStockCode(' ２３３０ ')).toBe('2330');
    const snapshot = await loadStockSnapshot(manifest, '2330', fetchFixture);

    expect(snapshot.code).toBe('2330');
    expect(fetchFixture).toHaveBeenCalledWith('/taiwan-stock-candlestick-guide/data/stocks/2330.fixture.json');
  });

  it('loads the manifest from the configured same-origin base and validates its hash', async () => {
    const manifest = await manifestFixture();
    const fetchFixture = vi.fn(async () => jsonResponse(JSON.stringify(manifest)));

    const loaded = await loadManifest('/taiwan-stock-candlestick-guide/', fetchFixture);

    expect(loaded.snapshotVersion).toBe(2);
    expect(fetchFixture).toHaveBeenCalledWith('/taiwan-stock-candlestick-guide/data/manifest.json');
  });

  it('rejects traversal paths and a stock payload whose digest no longer matches', async () => {
    const manifest = await manifestFixture();
    const fetchFixture = vi.fn(async () => jsonResponse(JSON.stringify({ ...stockSnapshotFixture, close: 1 })));
    const traversalManifest = {
      ...manifest,
      symbols: [{ ...manifest.symbols[0], dataPath: 'data/stocks/../secret.json' }],
    };

    await expect(loadStockSnapshot(traversalManifest, '2330', fetchFixture)).rejects.toMatchObject({
      reason: 'schema-error',
    });
    expect(fetchFixture).not.toHaveBeenCalled();

    await expect(loadStockSnapshot(manifest, '2330', fetchFixture)).rejects.toMatchObject({
      reason: 'schema-error',
    });
  });

  it('keeps an interrupted response body in the network-error branch', async () => {
    const manifest = await manifestFixture();
    const fetchFixture = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => Promise.reject(new Error('connection closed')),
    }));

    await expect(loadStockSnapshot(manifest, '2330', fetchFixture)).rejects.toMatchObject({
      reason: 'load-error',
    });
  });
});
