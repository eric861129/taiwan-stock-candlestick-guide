import { expect, test } from '@playwright/test';
import {
  goToRoute,
  searchStock,
  waitForAnalyzerReady,
} from './fixtures';

async function expectNoDocumentHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe('響應式與減少動態效果', () => {
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`首頁在 ${viewport.width}×${viewport.height} 沒有文件層級橫向捲軸`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await goToRoute(page);

      await expect(page.getByRole('link', { name: '開始學習' })).toBeVisible();
      await expect(page.getByRole('link', { name: '試用股票型態比對' })).toBeVisible();
      await expectNoDocumentHorizontalOverflow(page);
    });
  }

  test('窄螢幕股票圖表保留可見控制項與可展開的資料表替代內容', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await goToRoute(page, 'analyzer');
    await waitForAnalyzerReady(page);
    await searchStock(page, '2330');

    const tableToggle = page.getByRole('button', { name: '展開 OHLCV 資料表' });
    await expect(tableToggle).toBeVisible();
    await tableToggle.click();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
  });

  test('減少動態效果偏好會關閉卡片轉場，鍵盤操作仍可用', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goToRoute(page, 'pattern-cards');

    const card = page.locator('[data-pattern-id]').first();
    const cardContent = card.locator('.pattern-card__content');
    const transitionDuration = await cardContent.evaluate((element) => getComputedStyle(element).transitionDuration);
    const transitionMilliseconds = Math.max(...transitionDuration.split(',').map((value) => {
      const normalized = value.trim();
      return normalized.endsWith('ms') ? Number.parseFloat(normalized) : Number.parseFloat(normalized) * 1_000;
    }));
    expect(transitionMilliseconds).toBeLessThanOrEqual(1);
    const button = card.locator('.pattern-card__toggle');
    await button.focus();
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  test('以 640 CSS px 檢查 200% 瀏覽器縮放等效主流程仍可操作', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await goToRoute(page);

    const analyzerLink = page.getByRole('link', { name: '試用股票型態比對' });
    await expect(analyzerLink).toBeVisible();
    await analyzerLink.click();
    await expect(page.locator('#stock-analyzer-title')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
  });
});
