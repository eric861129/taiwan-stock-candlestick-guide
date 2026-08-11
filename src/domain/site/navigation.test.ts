import { describe, expect, it } from 'vitest';
import { MAIN_NAV, SITE_BASE } from './navigation';

describe('site navigation', () => {
  it('keeps the GitHub Pages base and six approved destinations', () => {
    expect(SITE_BASE).toBe('/taiwan-stock-candlestick-guide/');
    expect(MAIN_NAV.map((item) => item.text)).toEqual([
      '開始學習',
      '學習地圖',
      '完整章節',
      '型態卡',
      '股票型態比對',
      '附錄速查',
    ]);
  });
});
