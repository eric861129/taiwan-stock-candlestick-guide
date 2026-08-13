import { expect, test, type Page } from '@playwright/test';
import type { OhlcvBar } from '../../src/domain/market-data/types';
import {
  createBrowserMarketFixture,
  goToRoute,
  makeBar,
  makeBrowserMultiTimeframeStockFixture,
  routeBrowserMarketFixture,
  searchStock,
  waitForAnalyzerReady,
} from './fixtures';

type Timeframe = '1m' | '1w' | '1d';

interface Period {
  readonly start: string;
  readonly end: string;
  readonly date: string;
}

const timeframeSteps: readonly {
  readonly timeframe: Timeframe;
  readonly label: string;
}[] = [
  { timeframe: '1m', label: '月 K' },
  { timeframe: '1w', label: '週 K' },
  { timeframe: '1d', label: '日 K' },
];

/** 已確認向上離開的區間；三個週期各自使用，避免摘要只能測到無候選的空畫面。 */
const confirmedRangeShape: readonly (readonly [high: number, low: number, close?: number])[] = [
  [108, 102], [109, 101], [112, 102], [108, 101],
  [109, 99], [108, 102], [112, 102], [108, 101],
  [109, 99], [108, 102], [112, 102], [108, 101],
  [109, 99], [108, 102], [109, 101], [116, 104, 115],
];

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function weekdayDates(startDate: string, count: number): readonly string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  while (dates.length < count) {
    const value = toIsoDate(cursor);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6 && !value.endsWith('-01-01')) {
      dates.push(value);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function monthPeriod(year: number, monthIndex: number): Period {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  let start = toIsoDate(first);
  let end = toIsoDate(last);
  while (new Date(`${start}T00:00:00.000Z`).getUTCDay() === 0
    || new Date(`${start}T00:00:00.000Z`).getUTCDay() === 6
    || start.endsWith('-01-01')) {
    start = addUtcDays(start, 1);
  }
  while (new Date(`${end}T00:00:00.000Z`).getUTCDay() === 0
    || new Date(`${end}T00:00:00.000Z`).getUTCDay() === 6
    || end.endsWith('-01-01')) {
    end = addUtcDays(end, -1);
  }
  return { start, end, date: end };
}

function monthlyPeriods(year: number, monthIndex: number, count: number): readonly Period[] {
  return Array.from({ length: count }, (_value, index) => {
    const totalMonths = monthIndex + index;
    return monthPeriod(year + Math.floor(totalMonths / 12), totalMonths % 12);
  });
}

function weekPeriod(monday: string): Period {
  return {
    start: monday,
    end: addUtcDays(monday, 4),
    date: addUtcDays(monday, 4),
  };
}

function weeklyPeriods(firstMonday: string, count: number): readonly Period[] {
  return Array.from({ length: count }, (_value, index) => weekPeriod(addUtcDays(firstMonday, index * 7)));
}

function shapeBars(periods: readonly Period[]): readonly OhlcvBar[] {
  return periods.map((period, index) => {
    const [high, low, close = (high + low) / 2] = confirmedRangeShape[index]!;
    return {
      ...makeBar(period.date, close, high, low, close),
      periodStart: period.start,
      periodEnd: period.end,
    };
  });
}

function dailyBars(): readonly OhlcvBar[] {
  const dates = weekdayDates('2026-04-01', 120);
  const bars = dates.map((date) => makeBar(date, 100, 102, 98, 100));
  const firstStructureIndex = bars.length - confirmedRangeShape.length;
  confirmedRangeShape.forEach(([high, low, close = (high + low) / 2], index) => {
    bars[firstStructureIndex + index] = makeBar(dates[firstStructureIndex + index]!, close, high, low, close);
  });
  return bars;
}

function aggregateDailyBars(
  daily: readonly OhlcvBar[],
  periodStart: string,
  periodEnd: string,
): OhlcvBar {
  const constituents = daily.filter((bar) => bar.date >= periodStart && bar.date <= periodEnd);
  if (constituents.length === 0) {
    throw new Error(`E2E fixture 缺少 ${periodStart} 至 ${periodEnd} 的日 K 組成資料。`);
  }
  const first = constituents[0]!;
  const last = constituents.at(-1)!;
  return {
    ...makeBar(
      last.date,
      first.open,
      Math.max(...constituents.map((bar) => bar.high)),
      Math.min(...constituents.map((bar) => bar.low)),
      last.close,
      false,
    ),
    periodStart,
    periodEnd,
    volumeShares: constituents.reduce((sum, bar) => sum + bar.volumeShares, 0),
  };
}

/**
 * 月、週各保留一組歷史已確認候選，並加入目前形成中的聚合 K；
 * 日 K 為同一股票最近 120 根完成資料。舊聚合棒早於日 K 保留窗，
 * 仍會被正式 v4 驗證其期間與完成狀態，但不偽造不存在的日 K 組成資料。
 */
function multiTimeframeStock() {
  const daily = dailyBars();
  const currentWeek = weekPeriod('2026-09-14');
  const currentMonth = { start: '2026-09-01', end: '2026-09-30' };
  return makeBrowserMultiTimeframeStockFixture({
    '1d': { completedBars: daily },
    '1w': {
      completedBars: shapeBars(weeklyPeriods('2025-12-08', confirmedRangeShape.length)),
      formingBar: aggregateDailyBars(daily, currentWeek.start, currentWeek.end),
    },
    '1m': {
      completedBars: shapeBars(monthlyPeriods(2024, 11, confirmedRangeShape.length)),
      formingBar: aggregateDailyBars(daily, currentMonth.start, currentMonth.end),
    },
  }, {
    code: '2330',
    name: '多週期測試股',
    // 月 K 的歷史區間早於保留的 120 根日 K；上市日必須早於所有已發布週期資料。
    listingDate: '2020-01-02',
  });
}

async function openMultiTimeframeExercise(page: Page): Promise<void> {
  const fixture = createBrowserMarketFixture(multiTimeframeStock(), undefined, {
    calendarValidThrough: '2026-09-30',
  });
  await routeBrowserMarketFixture(page, fixture);
  await goToRoute(page, 'analyzer');
  await waitForAnalyzerReady(page);
  await searchStock(page, '2330');
  await expect(page.getByRole('heading', { name: /已選擇：2330 多週期測試股/ })).toBeVisible();
}

async function expectPrimaryTimeframe(
  page: Page,
  timeframe: Timeframe,
  label: string,
): Promise<void> {
  await expect(page.locator(`input[data-timeframe="${timeframe}"]`)).toBeChecked();
  const primaryChart = page.locator('[data-analyzer-workspace-grid] > .candlestick-chart').first();
  await expect(primaryChart.getByRole('heading')).toContainText(label);
}

/** 練習只記錄表單觀察；此階段不依賴詳細面板候選，也不觸碰完成後才出現的三圖 selector。 */
async function completeMonthWeekDayExercise(page: Page): Promise<void> {
  const practice = page.locator('[data-multitimeframe-practice]');
  const announcement = practice.locator('[aria-live="polite"]');
  await expect(practice).toBeVisible();
  await expect(practice).toContainText('月 K');
  await expect(announcement).toHaveAttribute('aria-atomic', 'true');
  await expect(practice.locator('[data-exercise-step-button="1m"]')).toHaveAttribute('aria-pressed', 'false');
  await expectPrimaryTimeframe(page, '1d', '日 K');
  await expect(practice.locator('input[name="monthly-direction"]')).toHaveCount(0);
  await practice.locator('[data-exercise-sync-timeframe]').click();
  await expectPrimaryTimeframe(page, '1m', '月 K');

  await practice.locator('input[name="monthly-direction"][value="up"]').check();
  await practice.locator('textarea[name="monthly-key-area"]').fill('月 K 的長期區間與關鍵壓力支撐已記錄。');
  await expect(announcement).toContainText('第二步');

  // 月 K 步驟列以鍵盤解鎖並切換週 K；主圖仍是唯一應在練習階段驗證的圖表。
  await practice.locator('[data-exercise-step-button="1m"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(practice.locator('[data-exercise-step-button="1w"]')).toHaveAttribute('aria-pressed', 'true');
  await expectPrimaryTimeframe(page, '1w', '週 K');

  await practice.locator('input[name="weekly-relationship"][value="aligned"]').check();
  await expect(announcement).toContainText('第三步');
  await practice.locator('[data-exercise-step-button="1d"]').click();
  await expect(practice.locator('[data-exercise-step-button="1d"]')).toHaveAttribute('aria-pressed', 'true');
  await expectPrimaryTimeframe(page, '1d', '日 K');

  await practice.locator('input[name="daily-check"][value="confirmed"]').check();
  await expect(announcement).toContainText('可以揭露');
  await expect(practice.locator('[data-exercise-summary-locked]')).toBeVisible();
  await expect(page.locator('[data-timeframe-chart]')).toHaveCount(0);
  await practice.locator('[data-exercise-reveal]').click();
  await expect(practice.locator('[data-exercise-summary-revealed]')).toBeVisible();
  await expect(page.getByRole('heading', { name: '多時間週期摘要' })).toBeVisible();
}

interface CandidateSelection {
  readonly candidateId: string;
  readonly score: string;
}

/** 摘要卡保留原始分數；候選按鈕本身不帶分數，必須從同一張 article 讀取。 */
async function selectSummaryCandidatesByKeyboard(page: Page): Promise<Record<Timeframe, CandidateSelection>> {
  const selections = {} as Record<Timeframe, CandidateSelection>;
  const liveRegion = page.locator('[data-summary-selection-live]');

  for (const { timeframe, label } of timeframeSteps) {
    const summary = page.locator(`[data-timeframe-summary="${timeframe}"]`);
    const candidate = summary.locator('[data-summary-candidate]').first();
    await expect(summary).toContainText(label);
    await expect(candidate).toBeVisible();
    const candidateId = await candidate.getAttribute('data-summary-candidate');
    const summaryText = await summary.textContent();
    const score = /規則符合度\s+(\d+(?:\.\d+)?)/.exec(summaryText ?? '')?.[1];
    if (!candidateId || !score) {
      throw new Error(`多時間週期 E2E fixture 的 ${label} 摘要缺少候選或規則符合度。`);
    }

    await candidate.focus();
    await page.keyboard.press('Enter');
    await expect(candidate).toHaveAttribute('aria-pressed', 'true');
    await expect(liveRegion).toContainText(`已選擇 ${label}`);
    await expect(summary).toContainText(`規則符合度 ${score}`);
    selections[timeframe] = { candidateId, score };
  }

  // 切回每個詳細週期後，已選候選仍保留；這裡使用摘要本身的按鈕，而非練習表單當作候選選擇器。
  for (const { timeframe } of timeframeSteps) {
    await page.locator(`[data-timeframe-tab="${timeframe}"]`).click();
    await expect(page.locator(`input[data-timeframe="${timeframe}"]`)).toBeChecked();
    await expect(
      page.locator(`[data-timeframe-summary="${timeframe}"] [data-summary-candidate="${selections[timeframe].candidateId}"]`),
    ).toHaveAttribute('aria-pressed', 'true');
  }

  return selections;
}

async function revealThreeChartComparison(
  page: Page,
  selections: Record<Timeframe, CandidateSelection>,
): Promise<void> {
  const comparisonToggle = page.locator('[data-multitimeframe-comparison-toggle]');
  await expect(comparisonToggle).toBeVisible();
  await expect(comparisonToggle).toHaveAttribute('aria-expanded', 'false');
  await comparisonToggle.click();
  await expect(comparisonToggle).toHaveAttribute('aria-expanded', 'true');
  for (const { timeframe } of timeframeSteps) {
    const chart = page.locator(`[data-timeframe-chart="${timeframe}"]`);
    await expect(chart).toBeVisible();
    await expect(chart.locator(`[data-structure-overlay="${selections[timeframe].candidateId}"]`)).toHaveCount(1);
  }
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe('多時間週期股票分析', () => {
  test('搜尋後預設日 K，主控制可直接切換週 K 與月 K，並立即更新完整型態', async ({ page }) => {
    await openMultiTimeframeExercise(page);

    const resultPanel = page.locator('.analysis-result-panel');
    const practice = page.locator('[data-multitimeframe-practice]');
    await expectPrimaryTimeframe(page, '1d', '日 K');
    await expect(page.locator('input[data-timeframe="1d"]')).toBeEnabled();
    await expect(page.locator('input[data-timeframe="1w"]')).toBeEnabled();
    await expect(page.locator('input[data-timeframe="1m"]')).toBeEnabled();
    const structureComparison = page.locator('.structure-comparison-panel');
    await expect(structureComparison.getByRole('heading', { name: '最接近的完整價格結構' })).toBeVisible();
    await expect(structureComparison.locator('[data-structure-comparison-candidate]')).toHaveCount(3);
    await expect(page.locator('[data-structure-overlay]')).toHaveCount(1);

    const positions = await Promise.all([resultPanel, practice].map((element) => element.boundingBox()));
    if (positions.some((position) => position === null)) {
      throw new Error('Analyzer 主要結果或互動練習沒有可量測的位置。');
    }
    expect(positions[0]!.y).toBeLessThan(positions[1]!.y);

    await page.locator('input[data-timeframe="1w"]').check();
    await expectPrimaryTimeframe(page, '1w', '週 K');
    await expect(resultPanel).toContainText('本檔週 K 資料截止日');
    await expect(resultPanel).toContainText('分析區間');

    await page.locator('input[data-timeframe="1m"]').check();
    await expectPrimaryTimeframe(page, '1m', '月 K');
    await expect(resultPanel).toContainText('本檔月 K 資料截止日');
    await expect(structureComparison.locator('[data-structure-comparison-candidate]')).toHaveCount(3);
    await expect(page.locator('[data-structure-overlay]')).toHaveCount(1);
  });

  test('桌機依月→週→日完成練習後揭露摘要，保留各週期候選並可鍵盤開啟三圖比較', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', '桌機比較配置只在 desktop Chromium 驗證。');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openMultiTimeframeExercise(page);

    await completeMonthWeekDayExercise(page);
    await expect(page.locator('[data-multitimeframe-overall-status]')).toHaveText('週期一致');
    const selections = await selectSummaryCandidatesByKeyboard(page);
    for (const { timeframe, label } of timeframeSteps) {
      const summary = page.locator(`[data-timeframe-summary="${timeframe}"]`);
      await expect(summary).toContainText(label);
      await expect(summary).toContainText(`規則符合度 ${selections[timeframe].score}`);
      await expect(summary).toContainText('狀態');
    }

    await revealThreeChartComparison(page, selections);
    const bounds = await Promise.all(timeframeSteps.map(async ({ timeframe }) => (
      page.locator(`[data-timeframe-chart="${timeframe}"]`).boundingBox()
    )));
    if (bounds.some((bound) => bound === null)) {
      throw new Error('三圖比較中的週期圖表沒有可量測的桌機位置。');
    }
    expect(new Set(bounds.map((bound) => Math.round(bound!.x))).size).toBeGreaterThan(1);
  });

  test('手機三圖比較垂直閱讀且不產生文件層級橫向捲軸', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', '手機垂直閱讀只在 mobile Chromium 驗證。');
    await page.setViewportSize({ width: 390, height: 844 });
    await openMultiTimeframeExercise(page);
    await completeMonthWeekDayExercise(page);
    const selections = await selectSummaryCandidatesByKeyboard(page);
    await revealThreeChartComparison(page, selections);

    const bounds = await Promise.all(timeframeSteps.map(async ({ timeframe }) => (
      page.locator(`[data-timeframe-chart="${timeframe}"]`).boundingBox()
    )));
    if (bounds.some((bound) => bound === null)) {
      throw new Error('三圖比較中的週期圖表沒有可量測的手機位置。');
    }
    const [monthly, weekly, daily] = bounds as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    expect(Math.abs(monthly.x - weekly.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(weekly.x - daily.x)).toBeLessThanOrEqual(1);
    expect(monthly.y).toBeLessThan(weekly.y);
    expect(weekly.y).toBeLessThan(daily.y);
    await expectNoDocumentHorizontalOverflow(page);
  });
});
