/** GitHub Pages 部署時使用的網站根路徑。 */
export const SITE_BASE = '/taiwan-stock-candlestick-guide/' as const;

/** 頂層導覽項目的最小結構，供 VitePress 與元件共用。 */
export interface NavItem {
  text: string;
  link: string;
}

/** 產品核准的六個主要學習目的地。 */
export const MAIN_NAV: readonly NavItem[] = [
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
];
