import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { validateAccessibilityAllowlist } from '../../src/domain/site/a11y-allowlist';
import { goToRoute } from './fixtures';

const allowlistPath = resolve(process.cwd(), 'tests/a11y-allowlist.json');
const allowlist = validateAccessibilityAllowlist(JSON.parse(readFileSync(allowlistPath, 'utf8')) as unknown);

async function expectNoBlockingAxeFindings(page: Page, route: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blockers = results.violations.filter((violation) => {
    if (violation.impact !== 'critical' && violation.impact !== 'serious') {
      return false;
    }
    return !allowlist.some((exception) => exception.ruleId === violation.id && exception.route === route);
  });

  expect(
    blockers.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target),
    })),
  ).toEqual([]);
}

test.describe('自動化可近用性 release gate', () => {
  test('首頁、學習、型態卡與分析器不存在 serious 或 critical axe 問題', async ({ page }) => {
    const routes = [
      { route: '/', heading: '台股 K 線筆記' },
      { route: '/learning-path', heading: '五階段學習地圖' },
      { route: '/pattern-cards', heading: '型態卡' },
      { route: '/analyzer', heading: '股票型態比對' },
    ];

    for (const target of routes) {
      await goToRoute(page, target.route);
      await expect(page.locator('#VPContent')).toContainText(target.heading);
      await expectNoBlockingAxeFindings(page, target.route);
    }
  });

  test('跳至主要內容連結會以鍵盤啟用、定位並將焦點交給 main', async ({ page }) => {
    await goToRoute(page);

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: '跳至主要內容' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter');

    const mainContent = page.locator('#VPContent');
    await expect(page).toHaveURL(/#VPContent$/);
    await expect(mainContent).toBeFocused();
    await expect.poll(async () => mainContent.evaluate((element) => Math.abs(element.getBoundingClientRect().top))).toBeLessThanOrEqual(8);
    await expect(page.getByLabel('K 線圖例')).toContainText('實體填滿');
    await expect(page.getByLabel('K 線圖例')).toContainText('實體留白');
    await expect(page.getByLabel('K 線圖例')).toContainText('虛線提示猶豫');
  });
});
