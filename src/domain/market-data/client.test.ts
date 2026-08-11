import { describe, expect, it, vi } from 'vitest';
import {
  loadManifest,
  loadStockSnapshot,
  normalizeStockCode,
} from './client';
import { marketManifestSchema, type MarketDataManifest } from './schema';

interface StockPayload {
  code: string;
  name: string;
  market: string;
  securityType: string;
  listingDate: string;
  availableSessions: number;
  shortHistoryReason: string | null;
  bars: Array<{ date: string; [key: string]: unknown }>;
  noQuoteEvidence: Array<{ date: string; [key: string]: unknown }>;
  sourceUrls: string[];
  [key: string]: unknown;
}

const stockSnapshotFixture: StockPayload = {
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
  corporateActions: [],
  sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
};

const encoder = new TextEncoder();

function utf8Bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function withUtf8Bom(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 3);
  result.set([0xef, 0xbb, 0xbf]);
  result.set(bytes, 3);
  return result;
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(value));
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

function bytesResponse(bytes: Uint8Array): { ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  const body = Uint8Array.from(bytes);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      const result = new ArrayBuffer(body.byteLength);
      new Uint8Array(result).set(body);
      return result;
    },
  };
}

async function manifestFixture(
  stockPayload: StockPayload = stockSnapshotFixture,
  stockBytes: Uint8Array = utf8Bytes(JSON.stringify(stockPayload)),
  indexOverrides: Record<string, unknown> = {},
): Promise<MarketDataManifest> {
  const firstBar = stockPayload.bars[0];
  const lastBar = stockPayload.bars.at(-1);
  if (!firstBar || !lastBar) {
    throw new Error('測試股票快照必須至少有一根日 K。');
  }

  const manifestWithoutHash = {
    schemaVersion: 1,
    snapshotVersion: 3,
    sourceCommit: 'a'.repeat(40),
    generatedAt: '2026-08-11T18:00:00+08:00',
    calendar: {
      sourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
      validThrough: '2026-12-31',
      emergencyClosureEvidence: {
        schemaVersion: 1,
        closures: [],
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
      code: stockPayload.code,
      name: stockPayload.name,
      market: stockPayload.market,
      securityType: stockPayload.securityType,
      dataPath: `data/stocks/${stockPayload.code}.fixture.json`,
      digest: await sha256Hex(stockBytes),
      size: stockBytes.byteLength,
      firstDate: firstBar.date,
      lastDate: lastBar.date,
      barCount: stockPayload.bars.length,
      noQuoteCount: stockPayload.noQuoteEvidence.length,
      listingDate: stockPayload.listingDate,
      availableSessions: stockPayload.availableSessions,
      shortHistoryReason: stockPayload.shortHistoryReason,
      ...indexOverrides,
    }],
  };

  return marketManifestSchema.parse({
    ...manifestWithoutHash,
    snapshotHash: await sha256Hex(utf8Bytes(`${canonicalJson(manifestWithoutHash)}\n`)),
  });
}

function fullHistoryStockFixture(): StockPayload {
  return {
    ...stockSnapshotFixture,
    availableSessions: 120,
    shortHistoryReason: null,
    bars: Array.from({ length: 120 }, (_value, index) => ({
      ...stockSnapshotFixture.bars[0],
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    })),
  };
}

describe('browser snapshot client', () => {
  it('normalizes full-width digits and verifies the exact raw bytes including a trailing newline', async () => {
    const stockBytes = utf8Bytes(`${JSON.stringify(stockSnapshotFixture)}\n`);
    const manifest = await manifestFixture(stockSnapshotFixture, stockBytes);
    const fetchFixture = vi.fn(async () => bytesResponse(stockBytes));

    expect(normalizeStockCode(' ２３３０　')).toBe('2330');
    const snapshot = await loadStockSnapshot(manifest, '2330', fetchFixture);

    expect(snapshot.code).toBe('2330');
    expect(fetchFixture).toHaveBeenCalledWith('/taiwan-stock-candlestick-guide/data/stocks/2330.fixture.json');
  });

  it('accepts only stock suspension evidence that exactly matches the manifest interval', async () => {
    const announcementUrl = 'https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB';
    const stock = {
      ...stockSnapshotFixture,
      availableSessions: 2,
      bars: [{ ...stockSnapshotFixture.bars[0], date: '2026-08-11' }],
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-suspension',
        sourceUrl: announcementUrl,
      }],
      sourceUrls: [...stockSnapshotFixture.sourceUrls, announcementUrl],
    };
    const stockBytes = utf8Bytes(JSON.stringify(stock));
    const baseManifest = await manifestFixture(stock, stockBytes);
    const validManifest = marketManifestSchema.parse({
      ...baseManifest,
      suspensionEvidence: {
        schemaVersion: 1,
        intervals: [{
          market: 'TWSE',
          code: '2330',
          startDate: '2026-08-10',
          endDateExclusive: '2026-08-11',
          reason: '測試用官方停止買賣公告。',
          sourceUrls: [announcementUrl],
        }],
      },
    });

    await expect(loadStockSnapshot(validManifest, '2330', async () => bytesResponse(stockBytes))).resolves.toMatchObject({
      noQuoteEvidence: [{ reason: 'official-suspension' }],
    });

    const mismatchedManifest = marketManifestSchema.parse({
      ...validManifest,
      suspensionEvidence: {
        ...validManifest.suspensionEvidence,
        intervals: [{
          ...validManifest.suspensionEvidence.intervals[0],
          startDate: '2026-08-11',
          endDateExclusive: '2026-08-12',
        }],
      },
    });
    await expect(loadStockSnapshot(mismatchedManifest, '2330', async () => bytesResponse(stockBytes))).rejects.toMatchObject({
      reason: 'schema-error',
    });
  });

  it('loads the manifest from the configured same-origin base and validates its canonical hash', async () => {
    const manifest = await manifestFixture();
    const fetchFixture = vi.fn(async () => bytesResponse(utf8Bytes(JSON.stringify(manifest))));

    const loaded = await loadManifest('/taiwan-stock-candlestick-guide/', fetchFixture);

    expect(loaded.snapshotVersion).toBe(3);
    expect(fetchFixture).toHaveBeenCalledWith('/taiwan-stock-candlestick-guide/data/manifest.json');
  });

  it('accepts BOM-prefixed manifest and stock documents while hashing and sizing their original bytes', async () => {
    const stockBytes = withUtf8Bom(utf8Bytes(JSON.stringify(stockSnapshotFixture)));
    const manifest = await manifestFixture(stockSnapshotFixture, stockBytes);
    const manifestBytes = withUtf8Bom(utf8Bytes(JSON.stringify(manifest)));
    const fetchFixture = vi.fn(async (path: string) => (
      path.endsWith('manifest.json') ? bytesResponse(manifestBytes) : bytesResponse(stockBytes)
    ));

    const loadedManifest = await loadManifest('/snapshot/', fetchFixture);
    const snapshot = await loadStockSnapshot(loadedManifest, '2330', fetchFixture, '/snapshot/');

    expect(snapshot.name).toBe('台積電');
    expect(fetchFixture).toHaveBeenCalledWith('/snapshot/data/stocks/2330.fixture.json');
  });

  it('rejects invalid UTF-8 after raw digest and byte-size validation', async () => {
    const validBytes = utf8Bytes(JSON.stringify(stockSnapshotFixture));
    const invalidUtf8Bytes = new Uint8Array(validBytes.byteLength + 1);
    invalidUtf8Bytes.set(validBytes);
    invalidUtf8Bytes[invalidUtf8Bytes.byteLength - 1] = 0xff;
    const manifest = await manifestFixture(stockSnapshotFixture, invalidUtf8Bytes);

    await expect(loadStockSnapshot(manifest, '2330', async () => bytesResponse(invalidUtf8Bytes))).rejects.toMatchObject({
      reason: 'schema-error',
    });
  });

  it('rejects traversal paths and a stock payload whose digest no longer matches', async () => {
    const manifest = await manifestFixture();
    const tamperedBytes = utf8Bytes(JSON.stringify({ ...stockSnapshotFixture, name: '遭竄改資料' }));
    const fetchFixture = vi.fn(async () => bytesResponse(tamperedBytes));
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

  it('rejects a stock file when manifest dates, counts, or availability metadata disagree with it', async () => {
    const stockBytes = utf8Bytes(JSON.stringify(stockSnapshotFixture));
    const datesManifest = await manifestFixture(stockSnapshotFixture, stockBytes, {
      firstDate: '2026-08-10',
      lastDate: '2026-08-10',
    });
    const availabilityManifest = await manifestFixture(stockSnapshotFixture, stockBytes, {
      barCount: 2,
      availableSessions: 2,
    });
    const fullHistory = fullHistoryStockFixture();
    const fullHistoryBytes = utf8Bytes(JSON.stringify(fullHistory));
    const historyManifest = await manifestFixture(fullHistory, fullHistoryBytes, {
      barCount: 119,
      availableSessions: 119,
      shortHistoryReason: 'listing-history',
    });

    for (const [manifest, bytes] of [
      [datesManifest, stockBytes],
      [availabilityManifest, stockBytes],
      [historyManifest, fullHistoryBytes],
    ] as const) {
      await expect(loadStockSnapshot(manifest, '2330', async () => bytesResponse(bytes))).rejects.toMatchObject({
        reason: 'schema-error',
      });
    }
  });

  it('keeps an interrupted binary response body in the network-error branch', async () => {
    const manifest = await manifestFixture();
    const fetchFixture = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Promise.reject(new Error('connection closed')),
    }));

    await expect(loadStockSnapshot(manifest, '2330', fetchFixture)).rejects.toMatchObject({
      reason: 'load-error',
    });
  });
});
