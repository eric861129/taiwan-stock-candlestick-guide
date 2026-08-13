import { expect, test } from '@playwright/test';
import type { OhlcvBar } from '../../src/domain/market-data/types';
import { MVP_CASES } from '../../src/domain/patterns/test-cases';
import {
  createBrowserMarketFixture,
  goToRoute,
  makeBar,
  makeBrowserStockFixture,
  rawDailyBars,
  routeBrowserMarketFixture,
  searchStock,
  trackLiveMarketRequests,
  waitForAnalyzerReady,
} from './fixtures';

function neutralBars(targetDate = '2026-08-10') {
  const prior = weekdayDates('2026-07-01', 20).map((tradingDate, index) => {
    const body = index + 1;
    return makeBar(tradingDate, 100, 100 + body + 1, 100, 100 + body);
  });
  return [...prior, makeBar(targetDate, 95, 115, 95, 105)];
}

function weekdayDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function withWeekdayDates(bars: readonly OhlcvBar[]): OhlcvBar[] {
  const dates = weekdayDates('2026-06-01', bars.length);
  return bars.map((bar, index) => ({
    ...bar,
    date: dates[index]!,
  }));
}

function freezeTaipeiClock(page: import('@playwright/test').Page): Promise<void> {
  return page.addInitScript(() => {
    const RealDate = Date;
    const fixedTime = new RealDate('2026-08-11T20:00:00+08:00').valueOf();
    class FixedDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length === 0 ? [fixedTime] : args));
      }

      static now(): number {
        return fixedTime;
      }
    }
    Object.defineProperty(globalThis, 'Date', { value: FixedDate });
  });
}

function piercingPositiveCase() {
  const piercing = MVP_CASES.find((candidate) => candidate.cardId === 'piercing-line' && candidate.kind === 'positive');
  if (!piercing) {
    throw new Error('E2E fixture 缺少穿透形正向案例。');
  }
  return piercing;
}

test.describe('股票型態比對', () => {
  test('離線 fixture 支援 2330、全形代碼與圖表鍵盤導覽，且候選不超過三張', async ({ page }) => {
    const liveMarketRequests = trackLiveMarketRequests(page);
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);
    await expect(page.getByRole('button', { name: '查詢盤後資料' })).toBeEnabled();

    await searchStock(page, '２３３０');
    await expect(page.getByRole('heading', { name: /已選擇：2330 台積電/ })).toBeVisible();
    await expect(page.getByLabel('股票代碼')).toHaveValue('2330');

    const candles = page.locator('[data-candle-index]');
    await expect(candles).toHaveCount(60);
    await candles.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(candles.nth(1)).toBeFocused();
    await expect(page.locator('.candlestick-chart__summary')).toContainText('成交量');

    await page.getByRole('button', { name: '展開 OHLCV 資料表' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('table')).toContainText('日期');

    const candidateCount = await page.locator('.analysis-result-panel__candidate').count();
    expect(candidateCount).toBeLessThanOrEqual(3);
    expect(liveMarketRequests).toEqual([]);
  });

  test('正常但無候選時顯示無明顯型態，而非證據不足', async ({ page }) => {
    const stock = makeBrowserStockFixture(neutralBars());
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: /無明顯型態/ })).toBeVisible();
    await expect(page.getByText(/本次沒有候選同時達到必要條件與規則門檻/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /證據不足/ })).toHaveCount(0);
    await expect(page.locator('.analysis-result-panel__candidate')).toHaveCount(0);
  });

  test('預設使用可稽核還原價格，切換原始價格後圖表與分析結果同步更新', async ({ page }) => {
    const stock = makeBrowserStockFixture(neutralBars());
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.locator('[data-price-mode="adjusted"]')).toBeChecked();
    await expect(page.getByText('向後還原價格', { exact: true }).last()).toBeVisible();

    await page.locator('[data-price-mode="raw"]').check();
    await expect(page.locator('[data-price-mode="raw"]')).toBeChecked();
    await expect(page.getByText(/已切換為官方原始價格；圖表與型態比對已使用同一價格口徑重算/)).toBeVisible();
    await expect(page.getByText('官方原始價格', { exact: true }).last()).toBeVisible();
  });

  test('不合法的未完成日 K 會 fail closed，而不假裝有候選', async ({ page }) => {
    const stock = makeBrowserStockFixture([
      makeBar('2026-08-10', 100, 101, 99, 100, false),
    ]);
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: '暫時無法分析' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /無明顯型態/ })).toHaveCount(0);
    await expect(page.locator('.analysis-result-panel__candidate')).toHaveCount(0);
  });

  test('只有官方無報價證據的股票保留交易日完整性，並顯示證據不足', async ({ page }) => {
    const noQuoteSource = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
    const stock = makeBrowserStockFixture([], {
      noQuoteEvidence: [{
        market: 'TWSE',
        code: '2330',
        date: '2026-08-10',
        reason: 'official-no-quote',
        sourceUrl: noQuoteSource,
      }],
    });
    const fixture = createBrowserMarketFixture(stock);
    const entry = (fixture.manifest.symbols as Array<Record<string, unknown>>)[0]!;
    expect(stock.availableSessions).toBe(1);
    expect(entry).toMatchObject({
      barCount: 0,
      firstDate: null,
      lastDate: null,
      noQuoteCount: 1,
      availableSessions: 1,
    });
    await routeBrowserMarketFixture(page, fixture);
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: /證據不足/ })).toBeVisible();
    await expect(page.getByText(/沒有可用的已完成 K 棒/)).toBeVisible();
    await expect(page.getByText(/官方曾明示交易日未報價/)).toBeVisible();
    await expect(page.getByRole('heading', { name: '暫時無法分析' })).toHaveCount(0);
  });

  test('未受公司行動抑制的穿透形正向 fixture 會指定候選且 Top 3 至少一張', async ({ page }) => {
    const piercing = piercingPositiveCase();
    const stock = makeBrowserStockFixture(withWeekdayDates(piercing.snapshot.bars));
    const sessions = [...new Set(rawDailyBars(stock).map((bar) => bar.date))].sort();
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock, sessions));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.locator('#analysis-candidate-title')).toBeVisible();
    const candidates = page.locator('.analysis-result-panel__candidate');
    const candidateCount = await candidates.count();
    expect(candidateCount).toBeGreaterThanOrEqual(1);
    expect(candidateCount).toBeLessThanOrEqual(3);
    await expect(candidates.filter({ hasText: '穿透形' })).toHaveCount(1);
  });

  test('股票資料 HTTP 500 顯示 unavailable 結果，而非 ETF 輸入警示', async ({ page }) => {
    const stock = makeBrowserStockFixture(neutralBars());
    const fixture = createBrowserMarketFixture(stock);
    await page.route('**/data/manifest.json', async (route) => {
      await route.fulfill({ contentType: 'application/json; charset=utf-8', body: fixture.manifestBody });
    });
    await page.route(`**/${fixture.stockPath}`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json; charset=utf-8',
        body: '{"error":"fixture failure"}',
      });
    });
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: '暫時無法分析' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('盤後資料暫時無法載入');
    await expect(page.locator('.stock-code-search__error')).toHaveCount(0);
    await expect(page.locator('.stock-analyzer__error')).toHaveCount(0);
  });

  test('ETF 清冊項目會明確拒絕為非支援普通股', async ({ page }) => {
    const etf = makeBrowserStockFixture(
      [makeBar('2026-08-10', 40, 41, 39, 40)],
      { code: '006201', name: '元大富櫃50', securityType: 'etf' },
    );
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(etf));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '006201');
    await expect(page.getByRole('alert')).toContainText('此證券不是第一版支援的普通股');
  });

  test('兩個以上交易日落後時以截止日表述，不稱為目前型態', async ({ page }) => {
    await freezeTaipeiClock(page);
    const stock = makeBrowserStockFixture(neutralBars('2026-08-07'));
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock, undefined, {
      expectedCutoffDate: '2026-08-11',
      freshness: 'stale',
      calendarValidThrough: '2026-08-11',
    }));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: /截至 2026-08-07 的型態相似度分析/ })).toBeVisible();
    await expect(page.getByText('落後兩個以上交易日，請以截止日為準解讀')).toBeVisible();
    await expect(page.getByText('資料截止日符合目前預期交易日')).not.toBeVisible();
  });

  test('公司行動會標示並抑制價格連續性型態規則', async ({ page }) => {
    const piercing = piercingPositiveCase();
    const bars = withWeekdayDates(piercing.snapshot.bars);
    const targetDate = bars.at(-1)?.date;
    if (!targetDate) {
      throw new Error('穿透形案例缺少目標日 K。');
    }
    const stock = makeBrowserStockFixture(bars, {
      corporateActions: [{
        date: targetDate,
        type: 'cash-dividend',
        affectsPriceContinuity: true,
        sourceUrl: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
        verifiedAt: '2026-08-11',
      }],
    });
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.locator('[data-price-mode="adjusted"]')).toBeDisabled();
    await expect(page.getByText(/公司行動缺少可重算的官方調整證據/)).toBeVisible();
    await expect(page.getByRole('heading', { name: '公司行動' })).toBeVisible();
    await expect(page.getByText(/影響候選窗的價格連續性/)).toBeVisible();
    await expect(page.getByRole('heading', { name: '無法完整評估的型態卡' })).toBeVisible();
    await expect(page.locator('.analysis-result-panel__candidate').filter({ hasText: '穿透形' })).toHaveCount(0);
  });
});
