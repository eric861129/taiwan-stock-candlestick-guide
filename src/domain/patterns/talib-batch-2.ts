import type {
  PatternCardId,
  PatternCardInput,
  PatternDirection,
  PatternPurpose,
  TalibPatternFunction,
} from './types';

type TalibBatch2CardId =
  | 'talib-doji-star'
  | 'talib-dragonfly-doji'
  | 'talib-evening-doji-star'
  | 'talib-gap-side-by-side-white-lines'
  | 'talib-gravestone-doji'
  | 'talib-hanging-man'
  | 'talib-harami-cross'
  | 'talib-high-wave'
  | 'talib-hikkake'
  | 'talib-modified-hikkake'
  | 'talib-homing-pigeon';

interface Batch2Spec {
  id: TalibBatch2CardId;
  functionName: TalibPatternFunction;
  nameZhTw: string;
  nameEn: string;
  aliases: readonly string[];
  minimumBars: number;
  maximumBars?: number;
  direction: PatternDirection;
  purpose: PatternPurpose;
  meaning: string;
  definition: string;
  geometry: readonly string[];
  settings: string;
  confirmation: readonly string[];
  invalidation: readonly string[];
  related: readonly PatternCardId[];
}

const LESSON_LINKS = ['/chapters/10-two-three-candlestick-patterns'] as const;

function createCard(spec: Batch2Spec): PatternCardInput {
  return {
    id: spec.id,
    nameZhTw: spec.nameZhTw,
    nameEn: spec.nameEn,
    aliases: spec.aliases,
    category: spec.minimumBars === 1 ? '單根與描述型' : '進階 K 棒組合',
    matchSupport: 'catalog-only',
    sourceRow: spec.functionName,
    sourceNotes: [],
    oneSentenceMeaning: spec.meaning,
    observableDefinition: spec.definition,
    minimumBars: spec.minimumBars,
    maximumBars: spec.maximumBars ?? spec.minimumBars,
    patternDirection: spec.direction,
    patternPurpose: spec.purpose,
    geometrySteps: spec.geometry,
    relatedPatternIds: spec.related,
    dataRequirements: [
      `至少 ${spec.minimumBars} 根同週期、已完成且價格模式一致的目標 K 線`,
      spec.settings,
      '公司行動、停牌與缺值已完成資料品質核對',
    ],
    background: [
      'TA-Lib 函式只核對程式化幾何；趨勢背景即使出現在型態名稱或慣例中，也必須由讀者另外確認。',
      '先固定價格模式、時間週期與完成 K，再核對實體、影線、跳空、包含或確認狀態。',
    ],
    confirmationGuidance: spec.confirmation,
    commonMisreads: [
      '只看縮圖相似就省略 CandleSettings、lookback 或近似相等門檻。',
      '把 TA-Lib 的正負回傳值解讀成未來報酬、勝率或買賣建議。',
    ],
    invalidationGuidance: spec.invalidation,
    limitations: [
      '函式輸出只代表官方幾何條件，不是未來方向保證；本站第一版只提供教學查閱，不執行 TA-Lib 原生函式。',
      'CandleSettings 可由呼叫端全域調整；卡片以官方預設設定說明，實際門檻必須與執行環境一致。',
    ],
    lessonLinks: LESSON_LINKS,
  };
}

/** T04 新增的 11 張正規卡；另 4 個函式投影到既有正規卡。 */
export const TALIB_BATCH_2_CARD_DEFINITIONS: readonly PatternCardInput[] = [
  createCard({
    id: 'talib-doji-star', functionName: 'CDLDOJISTAR', nameZhTw: '十字星', nameEn: 'Doji Star', aliases: ['Doji Star', '跳空十字星'],
    minimumBars: 2, direction: 'both', purpose: 'reversal',
    meaning: '長實體後出現向該方向跳空的十字線，形成多空皆可能出現的雙根反轉候選。',
    definition: '第一根為長實體；第二根為十字線。第一根上漲時，十字實體向上跳空；第一根下跌時，十字實體向下跳空。',
    geometry: ['第一根：BodyLong 長實體。', '第二根：BodyDoji 十字線。', '第二根實體依第一根方向完整跳空。'],
    settings: 'BodyLong 與 BodyDoji 的近期平均；官方預設 lookback 為 11 根',
    confirmation: ['等待第二根完成並用實體端點核對跳空。', '依第一根顏色分辨官方回傳方向，後續走勢另行驗證。'],
    invalidation: ['第一根不長、第二根不符合 Doji，或兩根實體未依方向分離時，不符合官方幾何。'],
    related: ['doji', 'morning-star', 'evening-star'],
  }),
  createCard({
    id: 'talib-dragonfly-doji', functionName: 'CDLDRAGONFLYDOJI', nameZhTw: '蜻蜓十字', nameEn: 'Dragonfly Doji', aliases: ['蜻蜓十字線', 'Dragonfly Doji'],
    minimumBars: 1, direction: 'neutral', purpose: 'indecision',
    meaning: '開收近似、上影極短而下影明顯的十字形狀；官方固定回傳正值只代表辨識到形狀。',
    definition: '目標 K 為 Doji；上影短於 ShadowVeryShort 門檻，下影長於同一門檻。',
    geometry: ['開盤與收盤符合 BodyDoji。', '上影小於 ShadowVeryShort。', '下影大於 ShadowVeryShort。'],
    settings: 'BodyDoji 與 ShadowVeryShort 的近期平均；官方預設 lookback 為 10 根',
    confirmation: ['先核對開收近似，再分別量測上下影。', '把所在位置與後續失效另行記錄。'],
    invalidation: ['不是 Doji、上影不夠短或下影不夠長時，不符合官方幾何。'],
    related: ['doji', 'talib-gravestone-doji', 'hammer'],
  }),
  createCard({
    id: 'talib-evening-doji-star', functionName: 'CDLEVENINGDOJISTAR', nameZhTw: '暮星十字', nameEn: 'Evening Doji Star', aliases: ['十字暮星', 'Evening Doji Star'],
    minimumBars: 3, direction: 'bearish', purpose: 'reversal',
    meaning: '長上漲實體、向上跳空的十字線與深入第一根實體的下跌 K，構成偏空三根候選。',
    definition: '第一根為長上漲實體；第二根為向上實體跳空的 Doji；第三根為大於 BodyShort 的下跌實體，收盤依 penetration 門檻深入第一根實體。',
    geometry: ['第一根：BodyLong 長上漲實體。', '第二根：BodyDoji，實體向上跳空。', '第三根：下跌且大於 BodyShort，收盤達 penetration 深度。'],
    settings: 'BodyLong、BodyDoji、BodyShort 近期平均與 penetration 參數（官方預設 0.3）；預設 lookback 12 根',
    confirmation: ['等待第三根完成，核對其實體長度與 penetration 深度。', '函式不自行判斷上行趨勢，背景需另核對。'],
    invalidation: ['第二根不是 Doji／未跳空，或第三根過短、未達 penetration 門檻時，不符合官方幾何。'],
    related: ['evening-star', 'talib-doji-star', 'doji'],
  }),
  createCard({
    id: 'talib-gap-side-by-side-white-lines', functionName: 'CDLGAPSIDESIDEWHITE', nameZhTw: '跳空並列白線', nameEn: 'Gap Side-by-Side White Lines', aliases: ['並列白線', 'Gap Side-by-Side White Lines'],
    minimumBars: 3, direction: 'both', purpose: 'continuation',
    meaning: '第一根後出現同向缺口，第二、三根皆為大小相近、開盤近似的 TA-Lib white K，形成延續候選。',
    definition: '第二、三根皆符合 TA-Lib white（收盤不低於開盤，包含開收相等），兩者相對第一根形成同方向且未被收盤回填的缺口；兩根實體大小 Near、開盤 Equal。',
    geometry: ['第一根提供缺口參考。', '第二、三根收盤不低於開盤，並位於同方向缺口一側。', '第二、三根實體大小相近且開盤近似，收盤不回填缺口。'],
    settings: 'Near 與 Equal 的近期平均；官方預設 lookback 為 7 根',
    confirmation: ['依缺口在第一根上方或下方區分官方回傳方向。', '核對兩根白線的實體大小、開盤與缺口是否仍存在。'],
    invalidation: ['任一並列 K 收盤低於開盤、缺口被回填、實體大小不近或開盤不近似時，不符合官方幾何。'],
    related: ['flag-consolidation', 'talib-breakaway', 'talib-closing-marubozu'],
  }),
  createCard({
    id: 'talib-gravestone-doji', functionName: 'CDLGRAVESTONEDOJI', nameZhTw: '墓碑十字', nameEn: 'Gravestone Doji', aliases: ['墓碑十字線', 'Gravestone Doji'],
    minimumBars: 1, direction: 'neutral', purpose: 'indecision',
    meaning: '開收近似、下影極短而上影明顯的十字形狀；官方固定回傳正值只代表辨識到形狀。',
    definition: '目標 K 為 Doji；下影短於 ShadowVeryShort 門檻，上影長於同一門檻。',
    geometry: ['開盤與收盤符合 BodyDoji。', '下影小於 ShadowVeryShort。', '上影大於 ShadowVeryShort。'],
    settings: 'BodyDoji 與 ShadowVeryShort 的近期平均；官方預設 lookback 為 10 根',
    confirmation: ['先核對開收近似，再分別量測上下影。', '把所在位置與後續失效另行記錄。'],
    invalidation: ['不是 Doji、下影不夠短或上影不夠長時，不符合官方幾何。'],
    related: ['doji', 'talib-dragonfly-doji', 'shooting-star'],
  }),
  createCard({
    id: 'talib-hanging-man', functionName: 'CDLHANGINGMAN', nameZhTw: '吊人線', nameEn: 'Hanging Man', aliases: ['吊頸線', 'Hanging Man'],
    minimumBars: 1, direction: 'bearish', purpose: 'reversal',
    meaning: '小實體、長下影與極短上影出現在前高附近；官方幾何與錘子相似，但位置條件相反。',
    definition: '目標 K 為 BodyShort 小實體、下影長於 ShadowLong、上影短於 ShadowVeryShort；實體低端不低於前一根高點減 Near 門檻。',
    geometry: ['目標 K：小實體、長下影、極短上影。', '實體低端靠近或高於前一根最高價。', '官方函式不自行判斷上行趨勢。'],
    settings: 'BodyShort、ShadowLong、ShadowVeryShort、Near 與前一根高點；官方預設 lookback 為 11 根',
    confirmation: ['核對影線比例與相對前一根高點的位置。', '上行背景是教學必要脈絡，但不是函式內建條件。'],
    invalidation: ['實體不小、下影不長、上影不短，或實體位置低於 Near 容許範圍時，不符合官方幾何。'],
    related: ['hammer', 'shooting-star', 'talib-belt-hold'],
  }),
  createCard({
    id: 'talib-harami-cross', functionName: 'CDLHARAMICROSS', nameZhTw: '十字母子', nameEn: 'Harami Cross', aliases: ['十字孕線', 'Harami Cross'],
    minimumBars: 2, direction: 'both', purpose: 'reversal',
    meaning: '第一根長實體內包含第二根十字實體，形成多空皆可能出現的母子反轉候選。',
    definition: '第一根為 BodyLong 長實體；第二根為 BodyDoji，實體完整落在第一根實體內；兩端嚴格包含回傳完整訊號，一端相等則回傳較弱值。',
    geometry: ['第一根：BodyLong 長實體。', '第二根：BodyDoji 十字線。', '第二根實體被第一根實體包含，並區分嚴格包含或一端相等。'],
    settings: 'BodyLong 與 BodyDoji 的近期平均；官方預設 lookback 為 11 根',
    confirmation: ['依第一根顏色辨識官方多空方向。', '用實體端點核對包含，不把影線包含混進來。'],
    invalidation: ['第一根不長、第二根不是 Doji，或十字實體未被包含時，不符合官方幾何。'],
    related: ['bullish-harami', 'bearish-harami', 'doji'],
  }),
  createCard({
    id: 'talib-high-wave', functionName: 'CDLHIGHWAVE', nameZhTw: '高浪線', nameEn: 'High-Wave Candle', aliases: ['高浪 K', 'High Wave'],
    minimumBars: 1, direction: 'neutral', purpose: 'indecision',
    meaning: '短實體同時帶有很長的上、下影線，用來描述高幅拉扯，不把 K 棒顏色當成未來方向。',
    definition: '目標 K 實體短於 BodyShort；上影與下影都長於 ShadowVeryLong。官方正負值只跟 K 棒顏色相同。',
    geometry: ['實體小於 BodyShort。', '上影大於 ShadowVeryLong。', '下影大於 ShadowVeryLong。'],
    settings: 'BodyShort 與 ShadowVeryLong 的近期平均；官方預設 lookback 為 10 根',
    confirmation: ['先核對短實體，再確認兩側影線都足夠長。', '將位置、成交量與後續失效獨立記錄。'],
    invalidation: ['實體不短，或任一側影線未達 ShadowVeryLong 時，不符合官方幾何。'],
    related: ['doji', 'close-rejection-indecision', 'relative-small-body'],
  }),
  createCard({
    id: 'talib-hikkake', functionName: 'CDLHIKKAKE', nameZhTw: '陷阱型態', nameEn: 'Hikkake Pattern', aliases: ['Hikkake', '內包陷阱'],
    minimumBars: 3, maximumBars: 6, direction: 'both', purpose: 'reversal-or-continuation',
    meaning: '內包 K 後向單側擴張形成初始陷阱，接下來最多三根內以反向收盤突破確認。',
    definition: '第二根是第一根 inside bar；第三根高低點同向越出第二根，先回傳 ±100；其後最多三根內，收盤反向突破第二根高點或低點時回傳同方向 ±200 確認。同一根若也形成新的初始型態，官方先輸出新 ±100，不輸出舊型態確認。',
    geometry: ['第一、二根：第二根高低都在第一根內。', '第三根：高低同向越出第二根，形成初始 ±100。', '後續最多三根：收盤反向突破第二根邊界，形成確認 ±200；同日新初始型態優先。'],
    settings: '不使用 CandleSettings；函式固定 lookback 5 根，並保存最多三根確認狀態',
    confirmation: ['區分初始 ±100 與確認 ±200，不把兩者合併。', '確認只能使用初始型態後最多三根完成 K；同一根同時形成新初始型態時，以新 ±100 優先。'],
    invalidation: ['第二根不是 inside bar、第三根高低未同向越界，或三根確認窗內未收盤突破指定邊界時，不可標成已確認。'],
    related: ['false-breakout', 'bullish-harami', 'bearish-harami'],
  }),
  createCard({
    id: 'talib-modified-hikkake', functionName: 'CDLHIKKAKEMOD', nameZhTw: '修正版陷阱型態', nameEn: 'Modified Hikkake Pattern', aliases: ['修正 Hikkake', 'Modified Hikkake'],
    minimumBars: 4, maximumBars: 7, direction: 'both', purpose: 'reversal',
    meaning: '連續兩層內包與收盤靠邊條件後出現單側擴張，再以最多三根內的反向收盤突破確認。',
    definition: '第二根內包第一根且收盤靠近對應端點；第三根再內包第二根；第四根高低同向越出第三根，先回傳 ±100；後續最多三根內反向收盤突破第三根邊界時回傳 ±200。同一根若也形成新的初始型態，官方先輸出新 ±100。',
    geometry: ['第二根：內包第一根，且收盤依方向靠近低端或高端。', '第三根：再內包第二根；第四根高低同向越出第三根。', '後續最多三根：收盤反向突破第三根邊界，形成確認；同日新初始型態優先。'],
    settings: 'Near 近期平均；官方預設 lookback 為 10 根，並保存最多三根確認狀態',
    confirmation: ['逐層核對兩次 inside bar、第二根收盤位置及第四根越界。', '確認窗與初始訊號分開呈現；同一根同時形成新初始型態時，以新 ±100 優先。'],
    invalidation: ['任一內包、Near 收盤位置或第四根越界條件缺失，或確認窗逾期時，不符合對應狀態。'],
    related: ['talib-hikkake', 'false-breakout', 'talib-harami-cross'],
  }),
  createCard({
    id: 'talib-homing-pigeon', functionName: 'CDLHOMINGPIGEON', nameZhTw: '歸巢鴿', nameEn: 'Homing Pigeon', aliases: ['家鴿線', 'Homing Pigeon'],
    minimumBars: 2, direction: 'bullish', purpose: 'reversal',
    meaning: '長下跌實體內包含第二根較短的下跌實體，形成下行背景中的偏多反轉候選。',
    definition: '第一根為 BodyLong 長下跌實體；第二根為 BodyShort 短下跌實體，第二根開盤低於第一根開盤、收盤高於第一根收盤，完整位於第一根實體內。',
    geometry: ['第一根：BodyLong 長下跌實體。', '第二根：BodyShort 短下跌實體。', '第二根下跌實體完整位於第一根下跌實體內。'],
    settings: 'BodyLong 與 BodyShort 的近期平均；官方預設 lookback 為 11 根',
    confirmation: ['核對兩根皆為下跌實體與嚴格包含。', '下行背景需另外確認，函式本身不判斷趨勢。'],
    invalidation: ['任一 K 不是下跌、長短實體不符，或第二根未被第一根實體包含時，不符合官方幾何。'],
    related: ['bullish-harami', 'talib-harami-cross', 'talib-three-stars-in-the-south'],
  }),
] as const;
