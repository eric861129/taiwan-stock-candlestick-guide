import type { PatternCardId, PatternCardInput, PatternDirection, PatternPurpose, TalibPatternFunction } from './types';

type Batch3Id =
  | 'talib-identical-three-crows' | 'talib-in-neck' | 'talib-inverted-hammer'
  | 'talib-kicking' | 'talib-kicking-by-length' | 'talib-ladder-bottom'
  | 'talib-long-legged-doji' | 'talib-long-line' | 'talib-marubozu'
  | 'talib-matching-low' | 'talib-mat-hold' | 'talib-morning-doji-star'
  | 'talib-on-neck';

interface Spec {
  id: Batch3Id;
  fn: TalibPatternFunction;
  zh: string;
  en: string;
  aliases: readonly string[];
  bars: number;
  direction: PatternDirection;
  purpose: PatternPurpose;
  meaning: string;
  definition: string;
  geometry: readonly string[];
  settings: string;
  confirmation: readonly string[];
  invalidation: string;
  related: readonly PatternCardId[];
}

const LESSONS = ['/chapters/10-two-three-candlestick-patterns'] as const;

function createCard(spec: Spec): PatternCardInput {
  return {
    id: spec.id,
    nameZhTw: spec.zh,
    nameEn: spec.en,
    aliases: spec.aliases,
    category: spec.bars === 1 ? '單根與描述型' : '進階 K 棒組合',
    matchSupport: 'catalog-only',
    sourceRow: spec.fn,
    sourceNotes: [],
    oneSentenceMeaning: spec.meaning,
    observableDefinition: spec.definition,
    minimumBars: spec.bars,
    maximumBars: spec.bars,
    patternDirection: spec.direction,
    patternPurpose: spec.purpose,
    geometrySteps: spec.geometry,
    relatedPatternIds: spec.related,
    dataRequirements: [`${spec.bars} 根目標完成 K`, spec.settings, '一致價格模式與公司行動資料品質核對'],
    background: ['官方函式只核對幾何，型態慣用的前段趨勢仍須另行確認。', '長短、影線與近似相等採可調 CandleSettings，不用固定肉眼比例替代。'],
    confirmationGuidance: spec.confirmation,
    commonMisreads: ['省略 CandleSettings、lookback 或 penetration，只憑縮圖命名。', '把正負回傳值改寫成未來報酬或買賣訊號。'],
    invalidationGuidance: [spec.invalidation],
    limitations: ['本站第一版只提供官方函式教學，不執行 TA-Lib 原生辨識。', '函式輸出是幾何旗標，不含趨勢背景、勝率或未來方向保證。'],
    lessonLinks: LESSONS,
  };
}

export const TALIB_BATCH_3_CARD_DEFINITIONS: readonly PatternCardInput[] = [
  createCard({
    id: 'talib-identical-three-crows', fn: 'CDLIDENTICAL3CROWS', zh: '同開三黑鴉', en: 'Identical Three Crows', aliases: ['三隻同開烏鴉', 'Identical Three Crows'], bars: 3, direction: 'bearish', purpose: 'reversal',
    meaning: '三根收盤依序降低的下跌 K，後兩根開盤近似前一根收盤，且三根下影都極短。',
    definition: '三根皆為下跌 K 且收盤嚴格遞減；三根下影都短於 ShadowVeryShort；第二、三根開盤分別在前一根收盤的 Equal 範圍內。',
    geometry: ['三根皆為下跌 K，收盤嚴格遞減。', '每根下影小於 ShadowVeryShort。', '後兩根開盤近似前一根收盤。'],
    settings: 'ShadowVeryShort、Equal；官方預設 lookback 12 根', confirmation: ['核對開盤近似與三根短下影。', '上行背景另行確認。'], invalidation: '任一 K 非下跌、收盤未遞減、下影過長或開盤不近似時不符合。', related: ['three-falling-candles', 'talib-counterattack'],
  }),
  createCard({
    id: 'talib-in-neck', fn: 'CDLINNECK', zh: '頸內線', en: 'In-Neck Pattern', aliases: ['In Neck', '頸內型態'], bars: 2, direction: 'bearish', purpose: 'continuation',
    meaning: '長下跌 K 後的上漲 K 開低，收盤只稍微進入前一根實體、靠近前收。',
    definition: '第一根為 BodyLong 長下跌；第二根為上漲 K，開盤低於前低，收盤介於前收與前收加 Equal 之間。',
    geometry: ['第一根：長下跌實體。', '第二根：開盤低於前低的上漲 K。', '第二根收盤近似前收，僅稍微刺入前實體。'],
    settings: 'BodyLong、Equal；官方預設 lookback 11 根', confirmation: ['以第一根收盤為 Equal 比較中心。', '和頸上線的前低中心分開核對。'], invalidation: '第二根未開低，或收盤不是位於前收至前收加 Equal 時不符合。', related: ['talib-on-neck', 'piercing-line', 'talib-counterattack'],
  }),
  createCard({
    id: 'talib-inverted-hammer', fn: 'CDLINVERTEDHAMMER', zh: '倒錘子線', en: 'Inverted Hammer', aliases: ['反錘子', 'Inverted Hammer'], bars: 2, direction: 'bullish', purpose: 'reversal',
    meaning: '小實體、長上影與極短下影的目標 K，其整個實體向下跳離前一根實體。',
    definition: '目標 K 實體小於 BodyShort、上影長於 ShadowLong、下影短於 ShadowVeryShort；目標實體最高端低於前一根實體最低端。',
    geometry: ['目標 K：小實體、長上影、極短下影。', '目標整個實體低於前一根實體。', '下行背景由讀者另核對。'],
    settings: 'BodyShort、ShadowLong、ShadowVeryShort 與前一根；官方預設 lookback 11 根', confirmation: ['以兩根實體端點核對向下 gap。', '不能只因外觀像倒錘就略過前根位置。'], invalidation: '影線或小實體條件不符，或目標實體未完全低於前根實體時不符合。', related: ['hammer', 'shooting-star', 'talib-hanging-man'],
  }),
  createCard({
    id: 'talib-kicking', fn: 'CDLKICKING', zh: '踢腿型態', en: 'Kicking', aliases: ['Kicking', '踢腳線'], bars: 2, direction: 'both', purpose: 'reversal',
    meaning: '兩根相反顏色的長光頭光腳 K 以完整高低價缺口分離，方向依第二根顏色。',
    definition: '兩根皆為 BodyLong 且上下影都短於 ShadowVeryShort；顏色相反。黑轉白須第二根最低高於前高；白轉黑須第二根最高低於前低。',
    geometry: ['兩根：長實體、雙側極短影。', '兩根顏色相反。', '兩根完整高低範圍依第二根方向跳空。'],
    settings: 'BodyLong、ShadowVeryShort；官方預設 lookback 11 根', confirmation: ['以 high/low 核對完整 gap。', '官方方向取第二根顏色。'], invalidation: '任一根不長／影線過長、顏色相同或完整 gap 不存在時不符合。', related: ['talib-kicking-by-length', 'talib-marubozu', 'talib-breakaway'],
  }),
  createCard({
    id: 'talib-kicking-by-length', fn: 'CDLKICKINGBYLENGTH', zh: '實體長度踢腿型態', en: 'Kicking by Length', aliases: ['Kicking By Length', '長度踢腿'], bars: 2, direction: 'both', purpose: 'reversal',
    meaning: '幾何與踢腿型態相同，但方向取實體較長那根的顏色；相等時取第一根。',
    definition: '兩根長光頭光腳 K 顏色相反且以完整高低價缺口分離；官方以嚴格第二實體大於第一實體決定取第二根，否則取第一根顏色。',
    geometry: ['先完成 Kicking 的相反色、長實體、短影與完整 gap。', '比較兩根實體長度。', '較長者決定回傳方向；相等時第一根優先。'],
    settings: 'BodyLong、ShadowVeryShort；官方預設 lookback 11 根', confirmation: ['精確比較兩根實體長度。', '不要誤用第二根顏色作方向。'], invalidation: 'Kicking 基礎幾何不符時不成立；實體相等時不可誤選第二根。', related: ['talib-kicking', 'talib-marubozu'],
  }),
  createCard({
    id: 'talib-ladder-bottom', fn: 'CDLLADDERBOTTOM', zh: '梯底', en: 'Ladder Bottom', aliases: ['梯形底', 'Ladder Bottom'], bars: 5, direction: 'bullish', purpose: 'reversal',
    meaning: '前三根下跌 K 持續下移，第四根仍跌但留下較長上影，第五根上漲並越過第四根高點。',
    definition: '前三根下跌且開、收各自嚴格遞減；第四根下跌且上影長於 ShadowVeryShort；第五根上漲，開盤高於第四根實體高端、收盤高於第四根最高價。',
    geometry: ['前三根：下跌 K，開盤與收盤各自遞減。', '第四根：下跌 K，上影超過門檻。', '第五根：上漲，開過第四根實體且收過第四根高點。'],
    settings: 'ShadowVeryShort；官方預設 lookback 14 根', confirmation: ['等待第五根完成雙重越界。', '第四根不另要求實體長短或下影。'], invalidation: '前三根序列、第四根上影或第五根開收越界任一缺失時不符合。', related: ['talib-three-stars-in-the-south', 'morning-star', 'talib-breakaway'],
  }),
  createCard({
    id: 'talib-long-legged-doji', fn: 'CDLLONGLEGGEDDOJI', zh: '長腳十字', en: 'Long-Legged Doji', aliases: ['長腿十字', 'Long-Legged Doji'], bars: 1, direction: 'neutral', purpose: 'indecision',
    meaning: 'Doji 實體搭配至少一側長影線；官方不要求上下影都長。',
    definition: '實體小於或等於 BodyDoji；上影或下影至少一側長於 ShadowLong。',
    geometry: ['開收符合 BodyDoji。', '量測上、下影。', '任一側影線超過 ShadowLong 即符合。'],
    settings: 'BodyDoji、ShadowLong；官方預設 lookback 10 根', confirmation: ['至少一側長影即可，不自行加上雙長影限制。', '位置與後續另行記錄。'], invalidation: '不是 Doji，或上下影都未超過 ShadowLong 時不符合。', related: ['doji', 'talib-high-wave', 'close-rejection-indecision'],
  }),
  createCard({
    id: 'talib-long-line', fn: 'CDLLONGLINE', zh: '長線 K', en: 'Long Line Candle', aliases: ['長實體短影', 'Long Line'], bars: 1, direction: 'both', purpose: 'continuation',
    meaning: '實體相對長且上下影都短的單根形狀，方向只描述 K 棒顏色。',
    definition: '目標實體長於 BodyLong；上影、下影都短於 ShadowShort；官方依 K 棒顏色回傳正負值。',
    geometry: ['實體大於 BodyLong。', '上影小於 ShadowShort。', '下影小於 ShadowShort。'],
    settings: 'BodyLong、ShadowShort；官方預設 lookback 10 根', confirmation: ['核對兩側短影，不等同完全無影。', '把單根方向和後續趨勢分開。'], invalidation: '實體不長或任一影線不短時不符合。', related: ['relative-long-body', 'talib-marubozu', 'near-marubozu'],
  }),
  createCard({
    id: 'talib-marubozu', fn: 'CDLMARUBOZU', zh: '光頭光腳', en: 'Marubozu', aliases: ['丸坊主', 'Marubozu'], bars: 1, direction: 'both', purpose: 'continuation',
    meaning: '實體相對長且上下影都極短的單根形狀，門檻採 TA-Lib CandleSettings。',
    definition: '目標實體長於 BodyLong；上影、下影都短於 ShadowVeryShort；官方依顏色回傳正負值。',
    geometry: ['實體大於 BodyLong。', '上影小於 ShadowVeryShort。', '下影小於 ShadowVeryShort。'],
    settings: 'BodyLong、ShadowVeryShort；官方預設 lookback 10 根', confirmation: ['使用官方平均門檻，不與本站固定單位的近似光頭光腳混用。', '只描述形狀與顏色。'], invalidation: '實體不長或任一影線超過 ShadowVeryShort 時不符合。', related: ['near-marubozu', 'talib-long-line', 'talib-closing-marubozu'],
  }),
  createCard({
    id: 'talib-matching-low', fn: 'CDLMATCHINGLOW', zh: '相同低收', en: 'Matching Low', aliases: ['相同低價', 'Matching Low'], bars: 2, direction: 'bullish', purpose: 'reversal',
    meaning: '兩根下跌 K 的收盤位於 Equal 近似範圍，形成偏多反轉候選。',
    definition: '兩根皆為下跌 K；第二根收盤介於第一根收盤減 Equal 與加 Equal 的含端點範圍。',
    geometry: ['第一、二根皆為下跌 K。', '以第一根收盤為中心。', '第二根收盤落在 ±Equal 範圍。'],
    settings: 'Equal；官方預設 lookback 6 根', confirmation: ['用收盤而非最低價比較。', '下行背景由讀者另行確認。'], invalidation: '任一根非下跌，或兩個收盤差超過 Equal 時不符合。', related: ['talib-counterattack', 'double-bottom', 'talib-in-neck'],
  }),
  createCard({
    id: 'talib-mat-hold', fn: 'CDLMATHOLD', zh: '鋪墊型態', en: 'Mat Hold', aliases: ['墊子型態', 'Mat Hold'], bars: 5, direction: 'bullish', purpose: 'continuation',
    meaning: '長上漲 K 後向上跳空，三根回檔實體守住 penetration 區，最後以第五根上漲收過中段高點。',
    definition: '第一根 BodyLong 上漲；第二根下跌且實體向上跳空；第二、三、四根皆為 BodyShort，其中第三、四根顏色不限、實體部分進入第一根但下界守住 penetration，實體高端逐步下移；第五根上漲，開盤高於第四根收盤，收盤高於第二、三、四根最高價。',
    geometry: ['第一根長上漲；第二根 BodyShort 下跌實體向上跳空。', '第二、三、四根都短；第三、四根顏色不限，逐步回檔但守住 penetration。', '第五根上漲，開過第四根收盤並收過第二、三、四根最高價。'],
    settings: 'BodyLong、BodyShort、penetration（官方預設 0.5）；官方預設 lookback 14 根', confirmation: ['第三、四根不可強制解讀為下跌 K，但第二至第四根都必須符合 BodyShort。', '等待第五根完成開過第四根收盤、收過第二至第四根最高價。'], invalidation: '任一反應 K 不短、缺口、penetration 守位、回檔高端遞減或第五根越界任一缺失時不符合。', related: ['talib-breakaway', 'flag-consolidation', 'talib-gap-side-by-side-white-lines'],
  }),
  createCard({
    id: 'talib-morning-doji-star', fn: 'CDLMORNINGDOJISTAR', zh: '晨星十字', en: 'Morning Doji Star', aliases: ['十字晨星', 'Morning Doji Star'], bars: 3, direction: 'bullish', purpose: 'reversal',
    meaning: '長下跌實體、向下實體跳空的 Doji，以及深入第一根實體的上漲第三根。',
    definition: '第一根 BodyLong 下跌；第二根 BodyDoji 且整個實體低於第一根實體；第三根上漲且實體大於 BodyShort，收盤高於第一根收盤加實體乘 penetration。',
    geometry: ['第一根：BodyLong 長下跌。', '第二根：BodyDoji，實體向下跳空。', '第三根：上漲且大於 BodyShort，收盤達 penetration。'],
    settings: 'BodyLong、BodyDoji、BodyShort、penetration（預設 0.3）；官方預設 lookback 12 根', confirmation: ['核對第二根實體 gap 與第三根 penetration。', '第三根收盤沒有必須低於第一根開盤的上限。'], invalidation: '第一根不長、第二根非 Doji／未跳空，或第三根過短／未達 penetration 時不符合。', related: ['morning-star', 'talib-evening-doji-star', 'talib-doji-star'],
  }),
  createCard({
    id: 'talib-on-neck', fn: 'CDLONNECK', zh: '頸上線', en: 'On-Neck Pattern', aliases: ['On Neck', '頸線型態'], bars: 2, direction: 'bearish', purpose: 'continuation',
    meaning: '長下跌 K 後的上漲 K 開低，收盤只回到前一根最低價附近。',
    definition: '第一根為 BodyLong 長下跌；第二根上漲且開盤低於前低；第二根收盤位於前低 ± Equal。',
    geometry: ['第一根：長下跌實體。', '第二根：開盤低於前低的上漲 K。', '第二根收盤近似前一根最低價。'],
    settings: 'BodyLong、Equal；官方預設 lookback 11 根', confirmation: ['以第一根 low 為 Equal 比較中心。', '和頸內線以第一根 close 為中心明確區分。'], invalidation: '第二根未開低，或收盤不在前低 ±Equal 時不符合。', related: ['talib-in-neck', 'piercing-line', 'talib-matching-low'],
  }),
] as const;
