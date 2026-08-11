import { defineConfig } from 'vitepress';
import { MAIN_NAV, SITE_BASE } from '../src/domain/site/navigation';

const chapterItems = [
  ['第 1 章：K 線能回答與不能回答的問題', '/chapters/01-what-candlesticks-can-and-cannot-answer'],
  ['第 2 章：OHLC、實體、影線與顏色', '/chapters/02-ohlc-body-wicks-colors'],
  ['第 3 章：週期、原始價格與調整後價格', '/chapters/03-timeframes-raw-adjusted-prices'],
  ['第 4 章：成交量、流動性與台股市場基礎', '/chapters/04-volume-liquidity-taiwan-market-basics'],
  ['第 5 章：波峰、波谷與趨勢結構', '/chapters/05-swing-highs-lows-trend-structure'],
  ['第 6 章：關鍵區域、支撐區與壓力區', '/chapters/06-key-zones-support-resistance'],
  ['第 7 章：缺口、突破、回測與假突破', '/chapters/07-gaps-breakouts-retests-false-breakouts'],
  ['第 8 章：多時間週期與市場狀態三面向', '/chapters/08-multiple-timeframes-market-state'],
  ['第 9 章：單根 K 線：強弱、拒絕與猶豫', '/chapters/09-single-candlestick-signals'],
  ['第 10 章：雙根與三根 K 線組合', '/chapters/10-two-three-candlestick-patterns'],
  ['第 11 章：整理、反轉與延續型態', '/chapters/11-consolidation-reversal-continuation-patterns'],
  ['第 12 章：量價關係、低流動性與失敗訊號', '/chapters/12-volume-price-liquidity-failed-signals'],
  ['第 13 章：移動平均、成交量均量與 ATR', '/chapters/13-moving-averages-volume-average-atr'],
  ['第 14 章：RSI、KD、MACD 與布林通道', '/chapters/14-rsi-kd-macd-bollinger-bands'],
  ['第 15 章：情境、觸發、失效與放棄交易', '/chapters/15-scenarios-triggers-invalidation-no-trade'],
  ['第 16 章：停損、部位、R 倍數、期望值與成本', '/chapters/16-stops-position-sizing-r-multiple-expectancy-costs'],
  ['第 17 章：K 線看不到的財報、消息與制度事件', '/chapters/17-what-candlesticks-cannot-see'],
  ['第 18 章：心理偏誤、交易紀錄與紙上交易', '/chapters/18-psychology-journal-paper-trading'],
  ['第 19 章：漸進式遮圖案例實驗室', '/chapters/19-progressive-chart-replay-lab'],
  ['第 20 章：十組綜合案例與能力驗收', '/chapters/20-capstone-ten-cases'],
];

const appendixItems = [
  ['附錄 A：型態速查', '/chapters/appendix-a-pattern-reference'],
  ['附錄 B：公式與工作表', '/chapters/appendix-b-formulas-and-worksheets'],
  ['附錄 C：台股規則、成本與官方查核', '/chapters/appendix-c-taiwan-market-rules'],
  ['附錄 D：詞彙表', '/chapters/appendix-d-glossary'],
];

export default defineConfig({
  lang: 'zh-Hant-TW',
  title: '台股 K 線筆記',
  description: '用可查核、可複習的方式學習台灣股市 K 線。',
  base: SITE_BASE,
  lastUpdated: true,
  cleanUrls: true,
  // 章節保留指向 Python 工具與詞彙來源的原始連結；它們不是 VitePress 頁面。
  ignoreDeadLinks: [
    (link: string) => /(?:^|\/)tools\//.test(link),
    (link: string) => /(?:^|\/)tests\//.test(link),
    (link: string) => /(?:^|\/)CONTEXT(?:\.md)?$/.test(link),
  ],
  srcExclude: [
    'README.md',
    'CONTEXT.md',
    'docs/**',
    'tests/**',
    '.superpowers/**',
    'tools/**/fixtures/**',
  ],
  head: [
    ['meta', { name: 'theme-color', content: '#fff8ef' }],
    ['meta', { name: 'color-scheme', content: 'light' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [...MAIN_NAV],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    lastUpdatedText: '最後更新',
    docFooter: {
      prev: '上一頁',
      next: '下一頁',
    },
    sidebar: [
      {
        text: '二十章學習路線',
        collapsed: false,
        items: chapterItems.map(([text, link]) => ({ text, link })),
      },
      {
        text: '附錄速查',
        collapsed: true,
        items: appendixItems.map(([text, link]) => ({ text, link })),
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/' },
    ],
  },
});
