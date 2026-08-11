import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { goToRoute } from './fixtures';

interface AccessibilityException {
  readonly ruleId: string;
  readonly route: string;
  readonly reason: string;
  readonly owner: string;
  readonly expiry: string;
}

const allowlistPath = resolve(process.cwd(), 'tests/a11y-allowlist.json');
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8')) as unknown;

function readAllowlist(): readonly AccessibilityException[] {
  expect(Array.isArray(allowlist)).toBe(true);
  if (!Array.isArray(allowlist)) {
    return [];
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const exception of allowlist) {
    expect(exception).toMatchObject({
      ruleId: expect.any(String),
      route: expect.any(String),
      reason: expect.any(String),
      owner: expect.any(String),
      expiry: expect.any(String),
    });
    const candidate = exception as AccessibilityException;
    expect(candidate.ruleId.trim()).not.toBe('');
    expect(candidate.route.trim()).toMatch(/^\//);
    expect(candidate.reason.trim()).not.toBe('');
    expect(candidate.owner.trim()).not.toBe('');
    expect(candidate.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(candidate.expiry > today).toBe(true);
  }
  return allowlist as readonly AccessibilityException[];
}

async function expectNoBlockingAxeFindings(page: Page, route: string): Promise<void> {
  const exceptions = readAllowlist();
  const results = await new AxeBuilder({ page }).analyze();
  const blockers = results.violations.filter((violation) => {
    if (violation.impact !== 'critical' && violation.impact !== 'serious') {
      return false;
    }
    return !exceptions.some((exception) => exception.ruleId === violation.id && exception.route === route);
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

  test('跳至主要內容連結、焦點提示與非僅色彩的 K 線說明可被使用', async ({ page }) => {
    await goToRoute(page);

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: '跳至主要內容' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveCSS('outline-style', 'solid');
    await expect(page.getByLabel('K 線圖例')).toContainText('實體填滿');
    await expect(page.getByLabel('K 線圖例')).toContainText('實體留白');
    await expect(page.getByLabel('K 線圖例')).toContainText('虛線提示猶豫');
  });
});
