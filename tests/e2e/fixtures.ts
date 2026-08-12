import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { CorporateAction, NoQuoteEvidence, OhlcvBar } from '../../src/domain/market-data/types';
export { prepareFixtureSnapshot } from './fixture-lifecycle';

export const SITE_BASE = '/taiwan-stock-candlestick-guide/';
export const PROGRESS_STORAGE_KEY = 'tw-candlestick-guide:progress:v1';

const fixtureSourceCommit = 'fixture';
const twseOfficialFixtureSource = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const tpexOfficialFixtureSource = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

type BrowserOhlcvBar = OhlcvBar & { readonly priceUnit: 'TWD' };

export interface BrowserStockFixture {
  readonly schemaVersion: 1;
  readonly snapshotVersion: 4;
  readonly code: string;
  readonly name: string;
  readonly market: 'TWSE' | 'TPEx';
  readonly securityType: 'common-stock' | 'etf';
  readonly currency: 'TWD';
  readonly priceUnit: 'TWD';
  readonly listingDate: string;
  readonly availableSessions: number;
  readonly shortHistoryReason: 'listing-history' | null;
  readonly comparisonUnitPolicy: {
    readonly version: 1;
    readonly effectiveFrom: string;
    readonly sourceUrl: string;
  };
  readonly priceModes: {
    readonly raw: {
      readonly status: 'available';
      readonly reasonCodes: readonly string[];
      readonly warnings: readonly string[];
      readonly timeframes: {
        readonly '1d': { readonly completedBars: readonly BrowserOhlcvBar[]; readonly formingBar: null };
        readonly '1w': { readonly completedBars: readonly BrowserOhlcvBar[]; readonly formingBar: BrowserOhlcvBar | null };
        readonly '1m': { readonly completedBars: readonly BrowserOhlcvBar[]; readonly formingBar: BrowserOhlcvBar | null };
      };
    };
    readonly adjusted: {
      readonly status: 'unavailable';
      readonly reasonCodes: readonly ['adjustment-series-not-built'];
      readonly warnings: readonly string[];
    };
  };
  readonly noQuoteEvidence: readonly NoQuoteEvidence[];
  readonly corporateActions: readonly CorporateAction[];
  readonly sourceUrls: readonly string[];
}

export interface BrowserMarketFixture {
  readonly manifest: Record<string, unknown>;
  readonly manifestBody: string;
  readonly stockBody: string;
  readonly stockPath: string;
}

export interface BrowserMarketFixtureOptions {
  readonly expectedCutoffDate?: string | null;
  readonly freshness?: 'fresh' | 'one-session-behind' | 'stale' | 'unknown';
  readonly calendarValidThrough?: string;
}

export async function goToRoute(page: Page, route = ''): Promise<void> {
  await page.goto(`${SITE_BASE}${route.replace(/^\//, '')}`);
}

export async function waitForAnalyzerReady(page: Page): Promise<void> {
  await expect(page.getByLabel('股票代碼')).toBeEnabled();
  await expect(page.getByRole('button', { name: '查詢盤後資料' })).toBeEnabled();
}

export async function searchStock(page: Page, code: string): Promise<void> {
  const input = page.getByLabel('股票代碼');
  await input.fill(code);
  await page.getByRole('button', { name: '查詢盤後資料' }).click();
}

export function trackLiveMarketRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host === 'openapi.twse.com.tw' || host === 'www.twse.com.tw' || host === 'www.tpex.org.tw') {
      requests.push(request.url());
    }
  });
  return requests;
}

export function makeBar(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  completed = true,
): BrowserOhlcvBar {
  return {
    date,
    periodStart: date,
    periodEnd: date,
    open,
    high,
    low,
    close,
    volumeShares: 1_000,
    sourcePrecision: 0.01,
    comparisonUnit: 0.1,
    priceUnit: 'TWD',
    completed,
    evidenceStatus: 'complete',
    missingSessionDates: [],
  };
}

export function rawDailyBars(stock: BrowserStockFixture): readonly BrowserOhlcvBar[] {
  return stock.priceModes.raw.timeframes['1d'].completedBars;
}

export function makeBrowserStockFixture(
  bars: readonly OhlcvBar[],
  options: {
    code?: string;
    name?: string;
    market?: 'TWSE' | 'TPEx';
    securityType?: 'common-stock' | 'etf';
    corporateActions?: readonly CorporateAction[];
    noQuoteEvidence?: readonly NoQuoteEvidence[];
    listingDate?: string;
  } = {},
): BrowserStockFixture {
  const serializedBars: readonly BrowserOhlcvBar[] = bars.map((bar) => ({
    ...bar,
    periodStart: bar.periodStart ?? bar.date,
    periodEnd: bar.periodEnd ?? bar.date,
    completed: bar.completed ?? true,
    evidenceStatus: bar.evidenceStatus ?? 'complete',
    missingSessionDates: bar.missingSessionDates ?? [],
    priceUnit: 'TWD',
  }));
  const market = options.market ?? 'TWSE';
  const noQuoteEvidence = options.noQuoteEvidence ?? [];
  const observedDates = [...serializedBars, ...noQuoteEvidence]
    .map((observation) => observation.date)
    .sort();
  if (observedDates.length === 0) {
    throw new Error('瀏覽器測試股票必須至少包含一筆 K 線或官方無報價證據。');
  }
  const listingDate = options.listingDate ?? observedDates[0]!;
  const availableSessions = serializedBars.length + noQuoteEvidence.length;
  const shortHistoryReason = availableSessions < 120 ? 'listing-history' : null;
  const marketSource = market === 'TWSE' ? twseOfficialFixtureSource : tpexOfficialFixtureSource;
  return {
    schemaVersion: 1,
    snapshotVersion: 4,
    code: options.code ?? '2330',
    name: options.name ?? '測試普通股',
    market,
    securityType: options.securityType ?? 'common-stock',
    currency: 'TWD',
    priceUnit: 'TWD',
    listingDate,
    availableSessions,
    shortHistoryReason,
    comparisonUnitPolicy: {
      version: 1,
      effectiveFrom: listingDate,
      sourceUrl: twseOfficialFixtureSource,
    },
    priceModes: {
      raw: {
        status: 'available',
        reasonCodes: [],
        warnings: [],
        timeframes: {
          '1d': { completedBars: serializedBars, formingBar: null },
          '1w': { completedBars: [], formingBar: null },
          '1m': { completedBars: [], formingBar: null },
        },
      },
      adjusted: {
        status: 'unavailable',
        reasonCodes: ['adjustment-series-not-built'],
        warnings: ['尚未建立可稽核的向後還原價格序列。'],
      },
    },
    noQuoteEvidence,
    corporateActions: options.corporateActions ?? [],
    sourceUrls: [...new Set([marketSource, ...noQuoteEvidence.map((evidence) => evidence.sourceUrl)])],
  };
}

export function createBrowserMarketFixture(
  stock: BrowserStockFixture,
  sessions?: readonly string[],
  options: BrowserMarketFixtureOptions = {},
): BrowserMarketFixture {
  const stockPath = `data/stocks/${stock.code}.e2e.json`;
  const stockBody = canonicalJson(stock);
  const dailyBars = rawDailyBars(stock);
  const effectiveSessions = sessions ?? [...new Set([
    ...dailyBars.map((bar) => bar.date),
    ...stock.noQuoteEvidence.map((evidence) => evidence.date),
  ])].sort();
  if (effectiveSessions.length === 0) {
    throw new Error('瀏覽器測試 manifest 必須至少包含一個交易日。');
  }
  const marketCutoffDate = effectiveSessions.at(-1)!;
  const calendarValidThrough = options.calendarValidThrough ?? marketCutoffDate;
  const stockEntry = {
    code: stock.code,
    name: stock.name,
    market: stock.market,
    securityType: stock.securityType,
    dataPath: stockPath,
    digest: sha256(stockBody),
    size: Buffer.byteLength(stockBody, 'utf8'),
    firstDate: dailyBars[0]?.date ?? null,
    lastDate: dailyBars.at(-1)?.date ?? null,
    barCount: dailyBars.length,
    noQuoteCount: stock.noQuoteEvidence.length,
    listingDate: stock.listingDate,
    availableSessions: stock.availableSessions,
    shortHistoryReason: stock.shortHistoryReason,
  };
  const market = {
    cutoffDate: marketCutoffDate,
    expectedCutoffDate: options.expectedCutoffDate ?? marketCutoffDate,
    freshness: options.freshness ?? 'fresh',
    calendarSourceUrl: twseOfficialFixtureSource,
    calendarValidThrough,
    tradingSessions: [...effectiveSessions],
  };
  const manifestWithoutHash = {
    schemaVersion: 1,
    snapshotVersion: 4,
    sourceCommit: fixtureSourceCommit,
    generatedAt: '2026-08-11T18:00:00+08:00',
    calendar: {
      sourceUrl: twseOfficialFixtureSource,
      validThrough: calendarValidThrough,
      holidayDates: [...new Set(effectiveSessions.map((session) => `${session.slice(0, 4)}-01-01`))].sort(),
      emergencyClosureEvidence: {
        schemaVersion: 1,
        closures: [],
      },
    },
    suspensionEvidence: {
      schemaVersion: 1,
      intervals: [],
    },
    markets: { TWSE: market, TPEx: market },
    symbols: [stockEntry],
  };
  const manifest = {
    ...manifestWithoutHash,
    snapshotHash: sha256(canonicalJson(manifestWithoutHash)),
  };

  return {
    manifest,
    manifestBody: canonicalJson(manifest),
    stockBody,
    stockPath,
  };
}

export async function routeBrowserMarketFixture(page: Page, fixture: BrowserMarketFixture): Promise<void> {
  await page.route('**/data/manifest.json', async (route) => {
    await route.fulfill({ contentType: 'application/json; charset=utf-8', body: fixture.manifestBody });
  });
  await page.route(`**/${fixture.stockPath}`, async (route) => {
    await route.fulfill({ contentType: 'application/json; charset=utf-8', body: fixture.stockBody });
  });
}

function canonicalJson(value: unknown): string {
  const serialize = (item: unknown): string => {
    if (Array.isArray(item)) {
      return `[${item.map(serialize).join(',')}]`;
    }
    if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(item);
  };
  return `${serialize(value)}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function readExportedProgress(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}
