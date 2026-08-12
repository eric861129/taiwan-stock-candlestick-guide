import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { AdjustmentFactor, CorporateAction, NoQuoteEvidence, OhlcvBar } from '../../src/domain/market-data/types';
export { prepareFixtureSnapshot } from './fixture-lifecycle';

export const SITE_BASE = '/taiwan-stock-candlestick-guide/';
export const PROGRESS_STORAGE_KEY = 'tw-candlestick-guide:progress:v1';

const fixtureSourceCommit = 'fixture';
const twseOfficialFixtureSource = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const tpexOfficialFixtureSource = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

type BrowserOhlcvBar = OhlcvBar & { readonly priceUnit: 'TWD' };

/**
 * 提供給瀏覽器 E2E 的單一週期資料。週、月 K 必須已按官方交易日曆聚合，
 * 讓前端仍會經過與正式快照相同的 v4 驗證流程。
 */
export interface BrowserTimeframeFixture {
  readonly completedBars: readonly OhlcvBar[];
  readonly formingBar?: OhlcvBar | null;
}

/** 一次注入日、週、月三套預先聚合 K 線的 E2E 接縫。 */
export interface BrowserMultiTimeframeFixture {
  readonly '1d': BrowserTimeframeFixture;
  readonly '1w': BrowserTimeframeFixture;
  readonly '1m': BrowserTimeframeFixture;
}

interface BrowserTimeframeSeries {
  readonly completedBars: readonly BrowserOhlcvBar[];
  readonly formingBar: BrowserOhlcvBar | null;
}

interface BrowserTimeframeSeriesSet {
  readonly '1d': BrowserTimeframeSeries;
  readonly '1w': BrowserTimeframeSeries;
  readonly '1m': BrowserTimeframeSeries;
}

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
      readonly timeframes: BrowserTimeframeSeriesSet;
    };
    readonly adjusted: {
      readonly status: 'unavailable';
      readonly reasonCodes: readonly ['missing-adjustment-evidence'];
      readonly warnings: readonly string[];
    } | {
      readonly status: 'available';
      readonly reasonCodes: readonly [];
      readonly warnings: readonly [];
      readonly timeframes: BrowserTimeframeSeriesSet;
    };
  };
  readonly adjustmentFactors: readonly AdjustmentFactor[];
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

export interface BrowserStockFixtureOptions {
  readonly code?: string;
  readonly name?: string;
  readonly market?: 'TWSE' | 'TPEx';
  readonly securityType?: 'common-stock' | 'etf';
  readonly corporateActions?: readonly CorporateAction[];
  readonly adjustmentFactors?: readonly AdjustmentFactor[];
  readonly noQuoteEvidence?: readonly NoQuoteEvidence[];
  readonly listingDate?: string;
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

function serializeBrowserBar(bar: OhlcvBar, defaultCompleted: boolean): BrowserOhlcvBar {
  return {
    ...bar,
    periodStart: bar.periodStart ?? bar.date,
    periodEnd: bar.periodEnd ?? bar.date,
    completed: bar.completed ?? defaultCompleted,
    evidenceStatus: bar.evidenceStatus ?? 'complete',
    missingSessionDates: bar.missingSessionDates ?? [],
    priceUnit: 'TWD',
  };
}

function serializeTimeframeSeries(series: BrowserTimeframeFixture): BrowserTimeframeSeries {
  return {
    completedBars: series.completedBars.map((bar) => serializeBrowserBar(bar, true)),
    formingBar: series.formingBar === undefined || series.formingBar === null
      ? null
      : serializeBrowserBar(series.formingBar, false),
  };
}

function serializeTimeframes(timeframes: BrowserMultiTimeframeFixture): BrowserTimeframeSeriesSet {
  return {
    '1d': serializeTimeframeSeries(timeframes['1d']),
    '1w': serializeTimeframeSeries(timeframes['1w']),
    '1m': serializeTimeframeSeries(timeframes['1m']),
  };
}

export function makeBrowserStockFixture(
  bars: readonly OhlcvBar[],
  options: BrowserStockFixtureOptions = {},
): BrowserStockFixture {
  return makeBrowserMultiTimeframeStockFixture({
    '1d': { completedBars: bars },
    '1w': { completedBars: [] },
    '1m': { completedBars: [] },
  }, options);
}

/**
 * 建立含預先聚合日、週、月 K 的單一股票快照；不在測試端重建前端資料流。
 * 呼叫端須提供與日 K、manifest 交易日曆一致的週／月聚合棒，正式載入時會再次驗證。
 */
export function makeBrowserMultiTimeframeStockFixture(
  timeframes: BrowserMultiTimeframeFixture,
  options: BrowserStockFixtureOptions = {},
): BrowserStockFixture {
  const serializedTimeframes = serializeTimeframes(timeframes);
  const dailyBars = serializedTimeframes['1d'].completedBars;
  const market = options.market ?? 'TWSE';
  const noQuoteEvidence = options.noQuoteEvidence ?? [];
  const observedDates = [...dailyBars, ...noQuoteEvidence]
    .map((observation) => observation.date)
    .sort();
  if (observedDates.length === 0) {
    throw new Error('瀏覽器測試股票必須至少包含一筆 K 線或官方無報價證據。');
  }
  const listingDate = options.listingDate ?? observedDates[0]!;
  const availableSessions = dailyBars.length + noQuoteEvidence.length;
  const shortHistoryReason = availableSessions < 120 ? 'listing-history' : null;
  const marketSource = market === 'TWSE' ? twseOfficialFixtureSource : tpexOfficialFixtureSource;
  const corporateActions = options.corporateActions ?? [];
  const adjustmentFactors = options.adjustmentFactors ?? [];
  const hasMissingAdjustmentEvidence = corporateActions.some((action) => (
    action.affectsPriceContinuity
    && !adjustmentFactors.some((factor) => (
      factor.effectiveDate === action.date && factor.actionTypes.includes(action.type)
    ))
  ));
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
        timeframes: serializedTimeframes,
      },
      adjusted: hasMissingAdjustmentEvidence ? {
        status: 'unavailable',
        reasonCodes: ['missing-adjustment-evidence'],
        warnings: ['公司行動缺少可重算的官方調整證據，已保留原始價格。'],
      } : {
        status: 'available',
        reasonCodes: [],
        warnings: [],
        timeframes: serializedTimeframes,
      },
    },
    adjustmentFactors,
    noQuoteEvidence,
    corporateActions,
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
  const publishedBars = Object.values(stock.priceModes.raw.timeframes).flatMap((series) => [
    ...series.completedBars,
    ...(series.formingBar ? [series.formingBar] : []),
  ]);
  const calendarYears = new Set([
    ...effectiveSessions,
    ...publishedBars.flatMap((bar) => [bar.periodStart, bar.periodEnd]),
  ].map((date) => date.slice(0, 4)));
  const manifestWithoutHash = {
    schemaVersion: 1,
    snapshotVersion: 4,
    sourceCommit: fixtureSourceCommit,
    generatedAt: '2026-08-11T18:00:00+08:00',
    calendar: {
      sourceUrl: twseOfficialFixtureSource,
      validThrough: calendarValidThrough,
      // 補齊預先聚合舊週／月 K 的年度覆蓋，讓前端可在載入時驗證其自然週與曆月範圍。
      holidayDates: [...calendarYears].sort().map((year) => `${year}-01-01`),
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
