import { describe, expect, it, vi } from 'vitest';
import {
  loadManifest,
  loadStockSnapshot,
  normalizeStockCode,
  selectStockPriceMode,
  selectStockTimeframe,
} from './client';
import { marketManifestSchema, type MarketDataManifest } from './schema';
import type { StockSnapshot } from './types';

interface StockPayload {
  code: string;
  name: string;
  market: string;
  securityType: string;
  listingDate: string;
  availableSessions: number;
  shortHistoryReason: string | null;
  priceModes: {
    raw: {
      status: 'available';
      reasonCodes: string[];
      warnings: string[];
      timeframes: Record<string, {
        completedBars: Array<{ date: string; [key: string]: unknown }>;
        formingBar: { date: string; [key: string]: unknown } | null;
      }>;
    };
    adjusted: {
      status: 'unavailable';
      reasonCodes: string[];
      warnings: string[];
    } | {
      status: 'available';
      reasonCodes: string[];
      warnings: string[];
      timeframes: Record<string, {
        completedBars: Array<{ date: string; [key: string]: unknown }>;
        formingBar: { date: string; [key: string]: unknown } | null;
      }>;
    };
  };
  noQuoteEvidence: Array<{ date: string; [key: string]: unknown }>;
  sourceUrls: string[];
  [key: string]: unknown;
}

const stockSnapshotFixture: StockPayload = {
  schemaVersion: 1,
  snapshotVersion: 4,
  code: '2330',
  name: '台積電',
  market: 'TWSE',
  securityType: 'common-stock',
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
  priceModes: {
    raw: {
      status: 'available',
      reasonCodes: [],
      warnings: [],
      timeframes: {
        '1d': {
          completedBars: [{
    date: '2026-08-11',
    periodStart: '2026-08-11',
    periodEnd: '2026-08-11',
    completed: true,
    evidenceStatus: 'complete',
    missingSessionDates: [],
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
          formingBar: null,
        },
        '1w': { completedBars: [], formingBar: null },
        '1m': { completedBars: [], formingBar: null },
      },
    },
    adjusted: {
      status: 'available',
      reasonCodes: [],
      warnings: [],
      timeframes: {
        '1d': {
          completedBars: [{
            date: '2026-08-11', periodStart: '2026-08-11', periodEnd: '2026-08-11',
            completed: true, evidenceStatus: 'complete', missingSessionDates: [],
            open: 1000, high: 1015, low: 995, close: 1010,
            volumeShares: 21_345_678, transactionCount: 12_345,
            sourcePrecision: 0.01, comparisonUnit: 5, priceUnit: 'TWD',
          }],
          formingBar: null,
        },
        '1w': { completedBars: [], formingBar: null },
        '1m': { completedBars: [], formingBar: null },
      },
    },
  },
  adjustmentFactors: [],
  noQuoteEvidence: [],
  corporateActions: [],
  sourceUrls: ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
};

function rawDailyBars(stock: StockPayload): Array<{ date: string; [key: string]: unknown }> {
  return stock.priceModes.raw.timeframes['1d']!.completedBars;
}

function withRawDailyBars(
  stock: StockPayload,
  completedBars: Array<{ date: string; [key: string]: unknown }>,
): StockPayload {
  const timeframes = {
    ...stock.priceModes.raw.timeframes,
    '1d': { completedBars, formingBar: null },
  };
  return {
    ...stock,
    priceModes: {
      ...stock.priceModes,
      raw: {
        ...stock.priceModes.raw,
        timeframes,
      },
      adjusted: stock.priceModes.adjusted.status === 'available'
        ? { ...stock.priceModes.adjusted, timeframes }
        : stock.priceModes.adjusted,
    },
  };
}

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
  const dailyBars = rawDailyBars(stockPayload);
  const firstBar = dailyBars[0];
  const lastBar = dailyBars.at(-1);
  const observedSessions = [...dailyBars, ...stockPayload.noQuoteEvidence]
    .map((observation) => observation.date)
    .sort();
  if (observedSessions.length === 0) {
    throw new Error('測試股票快照必須至少有一筆 K 線或無報價證據。');
  }
  const tradingSessions = [...new Set(observedSessions)];
  const cutoffDate = tradingSessions.at(-1)!;

  const manifestWithoutHash = {
    schemaVersion: 1,
    snapshotVersion: 4,
    sourceCommit: 'a'.repeat(40),
    generatedAt: '2026-08-11T18:00:00+08:00',
    calendar: {
      sourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
      validThrough: '2026-12-31',
      holidayDates: ['2026-01-01'],
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
        cutoffDate,
        expectedCutoffDate: cutoffDate,
        freshness: 'fresh',
        calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
        calendarValidThrough: '2026-12-31',
        tradingSessions,
      },
      TPEx: {
        cutoffDate,
        expectedCutoffDate: cutoffDate,
        freshness: 'fresh',
        calendarSourceUrl: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
        calendarValidThrough: '2026-12-31',
        tradingSessions,
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
      firstDate: firstBar?.date ?? null,
      lastDate: lastBar?.date ?? null,
      barCount: dailyBars.length,
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
  const tradingDates: string[] = [];
  for (let day = 1; tradingDates.length < 120; day += 1) {
    const date = new Date(Date.UTC(2026, 0, day));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      tradingDates.push(date.toISOString().slice(0, 10));
    }
  }

  return {
    ...stockSnapshotFixture,
    availableSessions: 120,
    shortHistoryReason: null,
    priceModes: {
      ...stockSnapshotFixture.priceModes,
      raw: {
        ...stockSnapshotFixture.priceModes.raw,
        timeframes: {
          ...stockSnapshotFixture.priceModes.raw.timeframes,
          '1d': {
            completedBars: tradingDates.map((date) => ({
      ...rawDailyBars(stockSnapshotFixture)[0],
      date,
      periodStart: date,
      periodEnd: date,
    })),
            formingBar: null,
          },
        },
      },
    },
  };
}

describe('browser snapshot client', () => {
  it('keeps all v4 timeframes and derives the selected chart bars without mutating the source snapshot', () => {
    const daily = { ...rawDailyBars(stockSnapshotFixture)[0], completed: true, evidenceStatus: 'complete', missingSessionDates: [] };
    const completedWeek = { ...daily, date: '2026-08-08', periodStart: '2026-08-04', periodEnd: '2026-08-08' };
    const formingWeek = { ...daily, date: '2026-08-12', periodStart: '2026-08-11', periodEnd: '2026-08-12', completed: false };
    const snapshot = {
      ...stockSnapshotFixture,
      snapshotVersion: 4,
      timeframe: '1d' as const,
      priceModes: {
        raw: {
          status: 'available' as const,
          reasonCodes: [],
          warnings: [],
          timeframes: {
            '1d': { completedBars: [daily], formingBar: null },
            '1w': { completedBars: [completedWeek], formingBar: formingWeek },
            '1m': { completedBars: [completedWeek], formingBar: null },
          },
        },
        adjusted: {
          status: 'unavailable' as const,
          reasonCodes: ['missing-adjustment-evidence'],
          warnings: ['公司行動缺少可重算的官方調整證據，已保留原始價格。'],
        },
      },
      priceMode: 'raw' as const,
      bars: [daily],
    };

    const selected = selectStockTimeframe(snapshot as unknown as StockSnapshot, '1w');

    expect(selected.timeframe).toBe('1w');
    expect(selected.bars).toEqual([completedWeek, formingWeek]);
    expect(snapshot.bars).toEqual([daily]);
  });

  it('switches the selected bars between audited adjusted and raw prices without changing the timeframe', () => {
    const rawBar = { ...rawDailyBars(stockSnapshotFixture)[0], close: 1010 };
    const adjustedBar = { ...rawBar, close: 1005 };
    const snapshot = {
      ...stockSnapshotFixture,
      timeframe: '1d' as const,
      priceMode: 'raw' as const,
      priceModes: {
        raw: {
          status: 'available' as const,
          reasonCodes: [],
          warnings: [],
          timeframes: {
            '1d': { completedBars: [rawBar], formingBar: null },
            '1w': { completedBars: [], formingBar: null },
            '1m': { completedBars: [], formingBar: null },
          },
        },
        adjusted: {
          status: 'available' as const,
          reasonCodes: [],
          warnings: [],
          timeframes: {
            '1d': { completedBars: [adjustedBar], formingBar: null },
            '1w': { completedBars: [], formingBar: null },
            '1m': { completedBars: [], formingBar: null },
          },
        },
      },
      bars: [rawBar],
    };

    const selected = selectStockPriceMode(snapshot as unknown as StockSnapshot, 'adjusted');

    expect(selected.priceMode).toBe('adjusted');
    expect(selected.timeframe).toBe('1d');
    expect(selected.bars).toEqual([adjustedBar]);
    expect(snapshot.bars).toEqual([rawBar]);
  });

  it('rejects a shortened natural week even when the payload keeps valid OHLCV relationships', async () => {
    const template = rawDailyBars(stockSnapshotFixture)[0]!;
    const dailyBars = [
      {
        ...template,
        date: '2026-08-10',
        periodStart: '2026-08-10',
        periodEnd: '2026-08-10',
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volumeShares: 1_000,
        transactionCount: 10,
      },
      {
        ...template,
        date: '2026-08-11',
        periodStart: '2026-08-11',
        periodEnd: '2026-08-11',
        open: 105,
        high: 115,
        low: 100,
        close: 112,
        volumeShares: 2_000,
        transactionCount: 20,
      },
    ];
    const formingWeek = {
      ...template,
      date: '2026-08-11',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-14',
      completed: false,
      open: 100,
      high: 115,
      low: 95,
      close: 112,
      volumeShares: 3_000,
      transactionCount: 30,
    };
    const timeframes = {
      '1d': { completedBars: dailyBars, formingBar: null },
      '1w': { completedBars: [], formingBar: formingWeek },
      '1m': { completedBars: [], formingBar: null },
    };
    const stock = {
      ...stockSnapshotFixture,
      listingDate: '2026-08-10',
      availableSessions: 2,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        raw: {
          ...stockSnapshotFixture.priceModes.raw,
          timeframes,
        },
        adjusted: {
          status: 'available' as const,
          reasonCodes: [],
          warnings: [],
          timeframes,
        },
      },
    };
    const stockBytes = utf8Bytes(JSON.stringify(stock));
    const manifest = await manifestFixture(stock, stockBytes);

    await expect(loadStockSnapshot(manifest, '2330', async () => bytesResponse(stockBytes))).resolves.toMatchObject({
      code: '2330',
    });

    const shortened = {
      ...stock,
      priceModes: {
        ...stock.priceModes,
        raw: {
          ...stock.priceModes.raw,
          timeframes: {
            ...stock.priceModes.raw.timeframes,
            '1w': {
              completedBars: [],
              formingBar: { ...formingWeek, periodStart: '2026-08-11' },
            },
          },
        },
      },
    };
    const shortenedBytes = utf8Bytes(JSON.stringify(shortened));
    const shortenedManifest = await manifestFixture(shortened, shortenedBytes);

    await expect(loadStockSnapshot(
      shortenedManifest,
      '2330',
      async () => bytesResponse(shortenedBytes),
    )).rejects.toMatchObject({ reason: 'schema-error' });
  });

  it('normalizes full-width digits and verifies the exact raw bytes including a trailing newline', async () => {
    const stockBytes = utf8Bytes(`${JSON.stringify(stockSnapshotFixture)}\n`);
    const manifest = await manifestFixture(stockSnapshotFixture, stockBytes);
    const fetchFixture = vi.fn(async () => bytesResponse(stockBytes));

    expect(normalizeStockCode(' ２３３０　')).toBe('2330');
    const snapshot = await loadStockSnapshot(manifest, '2330', fetchFixture);

    expect(snapshot.code).toBe('2330');
    expect(fetchFixture).toHaveBeenCalledWith('/taiwan-stock-candlestick-guide/data/stocks/2330.fixture.json');
  });

  it('loads raw prices when historical adjustment coverage is explicitly unavailable without listed actions', async () => {
    const stock = {
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        adjusted: {
          status: 'unavailable' as const,
          reasonCodes: ['missing-adjustment-evidence'],
          warnings: ['公司行動歷史覆蓋尚未完整證明，請使用官方原始價格。'],
        },
      },
      corporateActions: [],
    };
    const stockBytes = utf8Bytes(JSON.stringify(stock));
    const manifest = await manifestFixture(stock, stockBytes);

    await expect(loadStockSnapshot(
      manifest,
      '2330',
      async () => bytesResponse(stockBytes),
    )).resolves.toMatchObject({
      code: '2330',
      priceMode: 'raw',
      bars: [{ date: '2026-08-11' }],
    });
  });

  it('rejects adjusted daily prices that cannot be recomputed even when manifest digest and size are updated', async () => {
    const adjusted = stockSnapshotFixture.priceModes.adjusted;
    if (adjusted.status !== 'available') {
      throw new Error('測試快照必須提供向後還原價格。');
    }
    const tampered = {
      ...stockSnapshotFixture,
      priceModes: {
        ...stockSnapshotFixture.priceModes,
        adjusted: {
          ...adjusted,
          timeframes: {
            ...adjusted.timeframes,
            '1d': {
              completedBars: [{ ...adjusted.timeframes['1d']!.completedBars[0], close: 1009 }],
              formingBar: null,
            },
          },
        },
      },
    };
    const bytes = utf8Bytes(JSON.stringify(tampered));
    const manifest = await manifestFixture(tampered, bytes);

    await expect(loadStockSnapshot(manifest, '2330', async () => bytesResponse(bytes))).rejects.toMatchObject({
      reason: 'schema-error',
    });
  });

  it('rejects historical adjustment evidence dated on an official market holiday', async () => {
    const actionDate = '2018-08-06';
    const actionSource = 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL';
    const calculationSource = 'https://www.twse.com.tw/rwd/zh/exRight/TWT49U';
    const historicalMonth = {
      ...rawDailyBars(stockSnapshotFixture)[0],
      date: '2018-08-31',
      periodStart: '2018-08-01',
      periodEnd: '2018-08-31',
    };
    const rawTimeframes = stockSnapshotFixture.priceModes.raw.timeframes;
    const timeframes = {
      ...rawTimeframes,
      '1m': { completedBars: [historicalMonth], formingBar: null },
    };
    const stock = {
      ...stockSnapshotFixture,
      priceModes: {
        raw: { ...stockSnapshotFixture.priceModes.raw, timeframes },
        adjusted: {
          status: 'available' as const,
          reasonCodes: [],
          warnings: [],
          timeframes,
        },
      },
      corporateActions: [{
        date: actionDate,
        type: 'cash-dividend',
        affectsPriceContinuity: true,
        sourceUrl: actionSource,
        verifiedAt: '2026-08-11',
      }],
      adjustmentFactors: [{
        effectiveDate: actionDate,
        actionTypes: ['cash-dividend'],
        priceFactor: 0.95,
        volumeFactor: 1,
        stockDividendRatio: null,
        basis: 'official-reference-price',
        previousClose: 100,
        referencePrice: 95,
        sourceUrls: [actionSource, calculationSource],
        verifiedAt: '2026-08-11',
      }],
      sourceUrls: [...stockSnapshotFixture.sourceUrls, actionSource, calculationSource],
    };
    const bytes = utf8Bytes(JSON.stringify(stock));
    const baseManifest = await manifestFixture(stock, bytes);
    const manifest = marketManifestSchema.parse({
      ...baseManifest,
      calendar: {
        ...baseManifest.calendar,
        holidayDates: ['2018-01-01', actionDate, '2026-01-01'],
      },
    });

    await expect(loadStockSnapshot(manifest, '2330', async () => bytesResponse(bytes))).rejects.toMatchObject({
      reason: 'schema-error',
    });
  });

  it('accepts only stock suspension evidence that exactly matches the manifest interval', async () => {
    const announcementUrl = 'https://www.twse.com.tw/zh/announcement/announcement/detail.html?3B707CC9422511F199A2F6A8670AFEDB';
    const stock = {
      ...withRawDailyBars(stockSnapshotFixture, [{
        ...rawDailyBars(stockSnapshotFixture)[0],
        date: '2026-08-11',
        periodStart: '2026-08-11',
        periodEnd: '2026-08-11',
      }]),
      availableSessions: 2,
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

  it('allows pre-listing market sessions and a newer official no-quote cutoff when each covered session is evidenced', async () => {
    const newlyListedStock = {
      ...stockSnapshotFixture,
      listingDate: '2026-08-11',
    };
    const newlyListedBytes = utf8Bytes(JSON.stringify(newlyListedStock));
    const newlyListedManifest = await manifestFixture(newlyListedStock, newlyListedBytes);
    const manifestWithPreListingSession = marketManifestSchema.parse({
      ...newlyListedManifest,
      markets: {
        ...newlyListedManifest.markets,
        TWSE: {
          ...newlyListedManifest.markets.TWSE,
          tradingSessions: ['2026-08-10', '2026-08-11'],
        },
      },
    });
    await expect(loadStockSnapshot(manifestWithPreListingSession, '2330', async () => bytesResponse(newlyListedBytes))).resolves.toMatchObject({
      bars: [{ date: '2026-08-11' }],
    });

    const noQuoteOnlyStock = {
      ...withRawDailyBars(stockSnapshotFixture, []),
      availableSessions: 1,
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-no-quote',
        sourceUrl: stockSnapshotFixture.sourceUrls[0],
      }],
    };
    const noQuoteBytes = utf8Bytes(JSON.stringify(noQuoteOnlyStock));
    const noQuoteManifest = await manifestFixture(noQuoteOnlyStock, noQuoteBytes);
    await expect(loadStockSnapshot(noQuoteManifest, '2330', async () => bytesResponse(noQuoteBytes))).resolves.toMatchObject({
      noQuoteEvidence: [{ date: '2026-08-10', reason: 'official-no-quote' }],
    });
  });

  it('rejects a missing session, a non-session bar, and official no-quote evidence outside the manifest calendar', async () => {
    const stockBytes = utf8Bytes(JSON.stringify(stockSnapshotFixture));
    const baseManifest = await manifestFixture(stockSnapshotFixture, stockBytes);
    const missingSessionManifest = marketManifestSchema.parse({
      ...baseManifest,
      markets: {
        ...baseManifest.markets,
        TWSE: {
          ...baseManifest.markets.TWSE,
          tradingSessions: ['2026-08-10', '2026-08-11'],
        },
      },
    });
    await expect(loadStockSnapshot(missingSessionManifest, '2330', async () => bytesResponse(stockBytes))).rejects.toMatchObject({
      reason: 'schema-error',
    });

    const weekendStock = withRawDailyBars(stockSnapshotFixture, [{
      ...rawDailyBars(stockSnapshotFixture)[0],
      date: '2026-08-09',
      periodStart: '2026-08-09',
      periodEnd: '2026-08-09',
    }]);
    const weekendBytes = utf8Bytes(JSON.stringify(weekendStock));
    const weekendManifest = await manifestFixture(stockSnapshotFixture, weekendBytes, {
      firstDate: '2026-08-09',
      lastDate: '2026-08-09',
    });
    await expect(loadStockSnapshot(weekendManifest, '2330', async () => bytesResponse(weekendBytes))).rejects.toMatchObject({
      reason: 'schema-error',
    });

    const noQuoteOnlyStock = {
      ...withRawDailyBars(stockSnapshotFixture, []),
      availableSessions: 1,
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-no-quote',
        sourceUrl: stockSnapshotFixture.sourceUrls[0],
      }],
    };
    const noQuoteBytes = utf8Bytes(JSON.stringify(noQuoteOnlyStock));
    const noQuoteManifest = await manifestFixture(noQuoteOnlyStock, noQuoteBytes);
    const noQuoteOutsideCalendar = marketManifestSchema.parse({
      ...noQuoteManifest,
      markets: {
        ...noQuoteManifest.markets,
        TWSE: {
          ...noQuoteManifest.markets.TWSE,
          cutoffDate: '2026-08-11',
          expectedCutoffDate: '2026-08-11',
          tradingSessions: ['2026-08-11'],
        },
      },
    });
    await expect(loadStockSnapshot(noQuoteOutsideCalendar, '2330', async () => bytesResponse(noQuoteBytes))).rejects.toMatchObject({
      reason: 'schema-error',
    });
  });

  it('loads the manifest from the configured same-origin base and validates its canonical hash', async () => {
    const manifest = await manifestFixture();
    const fetchFixture = vi.fn(async () => bytesResponse(utf8Bytes(JSON.stringify(manifest))));

    const loaded = await loadManifest('/taiwan-stock-candlestick-guide/', fetchFixture);

    expect(loaded.snapshotVersion).toBe(4);
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
