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
  test('所有二十章連結保持開放，且每個 href 都能取得頁面', async ({ page }) => {
    await goToRoute(page, 'learning-path');

    const chapterLinks = page.locator('.learning-map a');
    await expect(chapterLinks).toHaveCount(20);
    expect(await chapterLinks.evaluateAll((links) => (
      links.every((link) => link.getAttribute('aria-disabled') !== 'true')
    ))).toBe(true);

    const chapterHrefs = await chapterLinks.evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(chapterHrefs).toHaveLength(20);
    for (const href of chapterHrefs) {
      expect(href).toMatch(/^\/taiwan-stock-candlestick-guide\/chapters\//);
      const response = await page.request.get(new URL(href!, page.url()).toString());
      expect(response.ok(), `章節連結應可取得：${href}`).toBe(true);
    }

    await page.goto(chapterHrefs[0]!);
    await expect(page).toHaveURL(/01-what-candlesticks-can-and-cannot-answer/);
    await expect(page.locator('#VPContent')).toContainText('K 線能回答與不能回答的問題');
  });

  test('答對四題即可通過，連續三次重試後仍可保留進度', async ({ page }) => {
    await goToRoute(page, 'learning-path');

    await submitPassingStageOne(page);
    await expect(page.getByText('恭喜通過！').first()).toBeVisible();
    await expect(page.getByText('得分 4/5 分').first()).toBeVisible();
    await expect(page.locator('[data-stage-status="stage-1"]')).toHaveText('已通過');

    for (let retryCount = 0; retryCount < 3; retryCount += 1) {
      await page.getByRole('button', { name: '再試一次' }).first().click();
      await submitPassingStageOne(page);
      await expect(page.getByText('恭喜通過！').first()).toBeVisible();
    }

    await page.reload();
    await expect(page.locator('[data-stage-status="stage-1"]')).toHaveText('已通過');
    await expect(page.getByText('目前已通過 1/5 個階段。')).toBeVisible();
    const storedProgress = await page.evaluate((storageKey) => localStorage.getItem(storageKey), PROGRESS_STORAGE_KEY);
    expect(JSON.parse(storedProgress ?? '{}').passedStageIds).toContain('stage-1');
  });

  test('匯出後清除再重新整理仍為空，匯入後重新整理會還原兩章與通過階段', async ({ page }) => {
    await goToRoute(page, 'learning-path');

    const stageOneChapterButtons = page
      .locator('.learning-map__stages > li')
      .first()
      .locator('ul > li')
      .getByRole('button');
    await stageOneChapterButtons.nth(0).click();
    await stageOneChapterButtons.nth(1).click();
    await expect(stageOneChapterButtons.nth(0)).toHaveText('已完成');
    await expect(stageOneChapterButtons.nth(1)).toHaveText('已完成');
    await submitPassingStageOne(page);
    await expect(page.locator('[data-stage-status="stage-1"]')).toHaveText('已通過');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出進度' }).click();
    const download = await downloadPromise;
    const exportPath = await download.path();
    if (!exportPath) {
      throw new Error('瀏覽器未提供匯出的學習進度檔案。');
    }
    const exportedProgress = readExportedProgress(exportPath);
    expect(exportedProgress.completedChapterIds).toEqual(expect.arrayContaining(['chapter-01', 'chapter-02']));
    expect(exportedProgress.passedStageIds).toEqual(expect.arrayContaining(['stage-1']));

    await page.getByRole('button', { name: '清除進度' }).click();
    await expect(stageOneChapterButtons.nth(0)).toHaveText('標記完成');
    await expect(stageOneChapterButtons.nth(1)).toHaveText('標記完成');
    await page.reload();
    await expect(stageOneChapterButtons.nth(0)).toHaveText('標記完成');
    await expect(stageOneChapterButtons.nth(1)).toHaveText('標記完成');
    await expect(page.locator('[data-stage-status="stage-1"]')).toHaveText('尚未通過');
    await expect(page.getByText('目前已通過 0/5 個階段。')).toBeVisible();

    await page.getByLabel('匯入進度').setInputFiles(exportPath);
    await expect(page.getByText('學習進度已匯入。')).toBeVisible();
    await page.reload();
    await expect(stageOneChapterButtons.nth(0)).toHaveText('已完成');
    await expect(stageOneChapterButtons.nth(1)).toHaveText('已完成');
    await expect(page.locator('[data-stage-status="stage-1"]')).toHaveText('已通過');
    await expect(page.getByText('目前已通過 1/5 個階段。')).toBeVisible();
  });
});
