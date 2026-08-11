import { expect, test, type Page } from '@playwright/test';
import {
  goToRoute,
  PROGRESS_STORAGE_KEY,
  readExportedProgress,
} from './fixtures';

async function submitPassingStageOne(page: Page): Promise<void> {
  const answers = [
    ['stage-1-question-1', 'b'],
    ['stage-1-question-2', 'a'],
    ['stage-1-question-3', 'c'],
    ['stage-1-question-4', 'd'],
    ['stage-1-question-5', 'a'],
  ] as const;

  for (const [name, value] of answers) {
    await page.locator(`input[name="${name}"][value="${value}"]`).check();
  }
  await page.getByRole('button', { name: '送出答案' }).first().click();
}

test.describe('五階段學習旅程', () => {
  test('所有章節連結保持開放且可直接進入', async ({ page }) => {
    await goToRoute(page, 'learning-path');

    const chapterLinks = page.locator('.learning-map a');
    await expect(chapterLinks).toHaveCount(20);
    expect(await chapterLinks.evaluateAll((links) => (
      links.every((link) => link.getAttribute('aria-disabled') !== 'true')
    ))).toBe(true);

    const firstChapter = chapterLinks.first();
    await expect(firstChapter).toHaveAttribute('href', /chapters\/01-what-candlesticks-can-and-cannot-answer/);
    await firstChapter.click();
    await expect(page).toHaveURL(/01-what-candlesticks-can-and-cannot-answer/);
    await expect(page.locator('#VPContent')).toContainText('K 線能回答與不能回答的問題');
  });

  test('答對四題即可通過，可重試且重新整理後保留進度', async ({ page }) => {
    await goToRoute(page, 'learning-path');

    await submitPassingStageOne(page);
    await expect(page.getByText('恭喜通過！').first()).toBeVisible();
    await expect(page.getByText('得分 4/5 分').first()).toBeVisible();
    await expect(page.locator('[data-stage-status="stage-1"]')).toHaveText('已通過');

    await page.getByRole('button', { name: '再試一次' }).first().click();
    await submitPassingStageOne(page);
    await expect(page.getByText('恭喜通過！').first()).toBeVisible();

    await page.reload();
    await expect(page.locator('[data-stage-status="stage-1"]')).toHaveText('已通過');
    await expect(page.getByText('目前已通過 1/5 個階段。')).toBeVisible();
    const storedProgress = await page.evaluate((storageKey) => localStorage.getItem(storageKey), PROGRESS_STORAGE_KEY);
    expect(JSON.parse(storedProgress ?? '{}').passedStageIds).toContain('stage-1');
  });

  test('匯出、清除與匯入會還原已完成章節', async ({ page }) => {
    await goToRoute(page, 'learning-path');

    const firstChapterButton = page
      .locator('.learning-map__stages > li')
      .first()
      .locator('ul > li')
      .first()
      .getByRole('button');
    await firstChapterButton.click();
    await expect(firstChapterButton).toHaveText('已完成');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出進度' }).click();
    const download = await downloadPromise;
    const exportPath = await download.path();
    if (!exportPath) {
      throw new Error('瀏覽器未提供匯出的學習進度檔案。');
    }
    expect(readExportedProgress(exportPath).completedChapterIds).toContain('chapter-01');

    await page.getByRole('button', { name: '清除進度' }).click();
    await expect(firstChapterButton).toHaveText('標記完成');

    await page.getByLabel('匯入進度').setInputFiles(exportPath);
    await expect(page.getByText('學習進度已匯入。')).toBeVisible();
    await expect(firstChapterButton).toHaveText('已完成');
  });
});
