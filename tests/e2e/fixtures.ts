import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { CorporateAction, OhlcvBar } from '../../src/domain/market-data/types';
export { prepareFixtureSnapshot } from './fixture-lifecycle';

export const SITE_BASE = '/taiwan-stock-candlestick-guide/';
export const PROGRESS_STORAGE_KEY = 'tw-candlestick-guide:progress:v1';

const fixtureSourceCommit = 'fixture';
const officialFixtureSource = 'https://example.test/official-market-source';

type BrowserOhlcvBar = OhlcvBar & { readonly priceUnit: 'TWD' };

export interface BrowserStockFixture {
  readonly schemaVersion: 1;
  readonly snapshotVersion: 2;
  readonly code: string;
  readonly name: string;
  readonly market: 'TWSE' | 'TPEx';
  readonly securityType: 'common-stock' | 'etf';
  readonly priceMode: 'raw';
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
  readonly bars: readonly BrowserOhlcvBar[];
  readonly corporateActions: readonly CorporateAction[];
  readonly sourceUrls: readonly string[];
}

export interface BrowserMarketFixture {
  readonly manifest: Record<string, unknown>;
  readonly manifestBody: string;
  readonly stockBody: string;
  readonly stockPath: string;
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
    open,
    high,
    low,
    close,
    volumeShares: 1_000,
    sourcePrecision: 0.01,
    comparisonUnit: 0.1,
    priceUnit: 'TWD',
    completed,
  };
}

export function makeBrowserStockFixture(
  bars: readonly OhlcvBar[],
  options: {
    code?: string;
    name?: string;
    market?: 'TWSE' | 'TPEx';
    securityType?: 'common-stock' | 'etf';
    corporateActions?: readonly CorporateAction[];
  } = {},
): BrowserStockFixture {
  const serializedBars: readonly BrowserOhlcvBar[] = bars.map((bar) => ({
    ...bar,
    priceUnit: 'TWD',
  }));
  const firstDate = serializedBars[0]?.date ?? '2026-08-10';
  const shortHistoryReason = serializedBars.length < 120 ? 'listing-history' : null;
  return {
    schemaVersion: 1,
    snapshotVersion: 2,
    code: options.code ?? '2330',
    name: options.name ?? '測試普通股',
    market: options.market ?? 'TWSE',
    securityType: options.securityType ?? 'common-stock',
    priceMode: 'raw',
    currency: 'TWD',
    priceUnit: 'TWD',
    listingDate: firstDate,
    availableSessions: serializedBars.length,
    shortHistoryReason,
    comparisonUnitPolicy: {
      version: 1,
      effectiveFrom: firstDate,
      sourceUrl: officialFixtureSource,
    },
    bars: serializedBars,
    corporateActions: options.corporateActions ?? [],
    sourceUrls: [officialFixtureSource],
  };
}

export function createBrowserMarketFixture(
  stock: BrowserStockFixture,
  sessions: readonly string[] = ['2026-08-07', '2026-08-10', '2026-08-11'],
): BrowserMarketFixture {
  const stockPath = `data/stocks/${stock.code}.e2e.json`;
  const stockBody = canonicalJson(stock);
  const marketCutoffDate = sessions.at(-1) ?? '2026-08-11';
  const stockEntry = {
    code: stock.code,
    name: stock.name,
    market: stock.market,
    securityType: stock.securityType,
    dataPath: stockPath,
    digest: sha256(stockBody),
    size: Buffer.byteLength(stockBody, 'utf8'),
    firstDate: stock.bars[0]?.date ?? stock.listingDate,
    lastDate: stock.bars.at(-1)?.date ?? stock.listingDate,
    barCount: stock.bars.length,
    listingDate: stock.listingDate,
    availableSessions: stock.availableSessions,
    shortHistoryReason: stock.shortHistoryReason,
  };
  const market = {
    cutoffDate: marketCutoffDate,
    expectedCutoffDate: marketCutoffDate,
    freshness: 'fresh',
    calendarSourceUrl: officialFixtureSource,
    calendarValidThrough: marketCutoffDate,
    tradingSessions: [...sessions],
  };
  const manifestWithoutHash = {
    schemaVersion: 1,
    snapshotVersion: 2,
    sourceCommit: fixtureSourceCommit,
    generatedAt: '2026-08-11T18:00:00+08:00',
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
