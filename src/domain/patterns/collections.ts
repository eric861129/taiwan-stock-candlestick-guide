import type { PatternCollectionId } from './types';

/** 圖鑑入口的單一註冊表，供內容投影、頁面標題與站台導覽共用。 */
export const PATTERN_COLLECTIONS = [
  {
    id: 'candlestick-reference',
    nameZhTw: 'K 棒型態速查館',
    description: '查找一至數根 K 棒的形狀、背景與失效條件。',
    link: '/pattern-cards/candlestick',
  },
  {
    id: 'price-structure',
    nameZhTw: '價格結構型態主館',
    description: '學習跨多根 K 棒的價格結構，以及量價與證據守門條件。',
    link: '/pattern-cards/price-structures',
  },
  {
    id: 'talib-advanced',
    nameZhTw: 'TA-Lib 進階 K 棒圖鑑',
    description: '依 TA-Lib 官方函式名稱查找進階 K 棒型態。',
    link: '/pattern-cards/talib',
  },
] as const satisfies readonly {
  id: PatternCollectionId;
  nameZhTw: string;
  description: string;
  link: string;
}[];
