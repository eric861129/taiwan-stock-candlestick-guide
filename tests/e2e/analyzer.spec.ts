import { expect, test } from '@playwright/test';
import { MVP_CASES } from '../../src/domain/patterns/test-cases';
import {
  createBrowserMarketFixture,
  goToRoute,
  makeBar,
  makeBrowserStockFixture,
  routeBrowserMarketFixture,
  searchStock,
  trackLiveMarketRequests,
  waitForAnalyzerReady,
} from './fixtures';

function neutralBars(targetDate = '2026-08-10') {
  const prior = Array.from({ length: 20 }, (_, index) => {
    const body = index + 1;
    return makeBar(`2026-07-${String(index + 1).padStart(2, '0')}`, 100, 100 + body + 1, 100, 100 + body);
  });
  return [...prior, makeBar(targetDate, 95, 115, 95, 105)];
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
  });

  test('未完成日 K 會顯示證據不足，而不假裝有候選', async ({ page }) => {
    const stock = makeBrowserStockFixture([
      makeBar('2026-08-10', 100, 101, 99, 100, false),
    ]);
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: /證據不足/ })).toBeVisible();
    await expect(page.getByText(/沒有可用的已完成日 K/)).toBeVisible();
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
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: /截至 2026-08-07 的型態相似度分析/ })).toBeVisible();
    await expect(page.getByText('資料截止日符合目前預期交易日')).not.toBeVisible();
  });

  test('公司行動會標示並抑制價格連續性型態規則', async ({ page }) => {
    const piercing = MVP_CASES.find((candidate) => candidate.cardId === 'piercing-line' && candidate.kind === 'positive');
    if (!piercing) {
      throw new Error('E2E fixture 缺少穿透形正向案例。');
    }
    const targetDate = piercing.snapshot.bars.at(-1)?.date;
    if (!targetDate) {
      throw new Error('穿透形案例缺少目標日 K。');
    }
    const stock = makeBrowserStockFixture(piercing.snapshot.bars, {
      corporateActions: [{
        date: targetDate,
        type: 'cash-dividend',
        affectsPriceContinuity: true,
        sourceUrl: 'https://example.test/corporate-actions',
        verifiedAt: '2026-08-11',
      }],
    });
    await routeBrowserMarketFixture(page, createBrowserMarketFixture(stock));
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);

    await searchStock(page, '2330');
    await expect(page.getByRole('heading', { name: '公司行動' })).toBeVisible();
    await expect(page.getByText(/影響候選窗的價格連續性/)).toBeVisible();
    await expect(page.getByRole('heading', { name: '無法完整評估的型態卡' })).toBeVisible();
    await expect(page.locator('.analysis-result-panel__candidate').filter({ hasText: '穿透形' })).toHaveCount(0);
  });
});
