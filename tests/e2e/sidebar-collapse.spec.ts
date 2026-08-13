import { expect, test } from '@playwright/test';
import { goToRoute } from './fixtures';

test.describe('桌機側欄與 Analyzer 頁面布局', () => {
  test('桌機可用鍵盤收合側欄並在重新載入後保留選擇', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await goToRoute(page, 'analyzer');
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    const toggle = page.getByRole('button', { name: '收合選單' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.VPSidebar')).toBeVisible();

    await toggle.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: '展開選單' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.VPSidebar')).toBeHidden();
    await expect(page.locator('#VPContent')).toHaveCSS('padding-left', '0px');

    await page.reload();

    await expect(page.getByRole('button', { name: '展開選單' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.VPSidebar')).toBeHidden();
  });

  test('Analyzer 移除頁面目錄，教材章節仍保留', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await goToRoute(page, 'analyzer');

    const outlineHeading = page.getByRole('heading', { name: 'On this page', exact: true });
    await expect(outlineHeading).toHaveCount(0);

    await goToRoute(page, 'chapters/01-what-candlesticks-can-and-cannot-answer');

    await expect(outlineHeading).toBeVisible();
  });

  test('手機仍使用 VitePress 原生側欄抽屜', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goToRoute(page, 'analyzer');

    await expect(page.locator('.sidebar-collapse-toggle')).toBeHidden();
    const nativeMenu = page.locator('.VPLocalNav .menu');
    await expect(nativeMenu).toBeVisible();

    await nativeMenu.click();

    await expect(page.locator('.VPSidebar.open')).toBeVisible();
  });
});
