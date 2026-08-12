import { expect, test } from '@playwright/test';
import { goToRoute } from './fixtures';

test.describe('型態卡目錄', () => {
  test('顯示 96 張卡、篩選結果會公告，且鍵盤可翻面', async ({ page }) => {
    await goToRoute(page, 'pattern-cards');

    const cards = page.locator('[data-pattern-id]');
    await expect(cards).toHaveCount(96);
    const resultCount = page.locator('.pattern-catalog__result-count');
    await expect(resultCount).toHaveText('目前顯示 96 張型態卡。');
    await expect(resultCount).toHaveAttribute('aria-live', 'polite');

    const firstCard = cards.first();
    const flipButton = firstCard.locator('.pattern-card__toggle');
    await flipButton.focus();
    await page.keyboard.press('Enter');
    await expect(flipButton).toHaveAttribute('aria-expanded', 'true');
    await expect(firstCard.locator('[data-card-side="back"]')).toBeVisible();
    await expect(flipButton).toBeFocused();

    await page.getByLabel('自動比對支援範圍').selectOption('short-window');
    await expect(resultCount).toHaveText('目前顯示 17 張型態卡。');
    await expect(cards).toHaveCount(17);

    await page.getByLabel('自動比對支援範圍').selectOption('structure');
    await expect(resultCount).toHaveText('目前顯示 9 張型態卡。');
    await expect(cards).toHaveCount(9);
  });
});
