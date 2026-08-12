import { describe, expect, it } from 'vitest';
import { MAIN_NAV, PATTERN_GALLERY_NAV, SITE_BASE } from './navigation';

describe('site navigation', () => {
  it('keeps the GitHub Pages base and six approved destinations', () => {
    expect(SITE_BASE).toBe('/taiwan-stock-candlestick-guide/');
    expect(MAIN_NAV).toEqual([
      { text: '開始學習', link: '/' },
      { text: '學習地圖', link: '/learning-path' },
      {
        text: '完整章節',
        link: '/chapters/01-what-candlesticks-can-and-cannot-answer',
      },
      { text: '型態卡', link: '/pattern-cards' },
      { text: '股票型態比對', link: '/analyzer' },
      {
        text: '附錄速查',
        link: '/chapters/appendix-a-pattern-reference',
      },
    ]);
  });

  it('provides three stable pattern gallery entry points', () => {
    expect(PATTERN_GALLERY_NAV).toEqual([
      { text: 'K 棒型態速查館', link: '/pattern-cards/candlestick' },
      { text: '價格結構型態主館', link: '/pattern-cards/price-structures' },
      { text: 'TA-Lib 進階 K 棒圖鑑', link: '/pattern-cards/talib' },
    ]);
  });
});
