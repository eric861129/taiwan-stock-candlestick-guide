import type { PatternCardId, PatternCardInput, PatternDirection, PatternPurpose, TalibPatternFunction } from './types';

type Batch4Id =
  | 'talib-rickshaw-man' | 'talib-rise-fall-three-methods' | 'talib-separating-lines'
  | 'talib-short-line' | 'talib-spinning-top' | 'talib-stalled-pattern'
  | 'talib-stick-sandwich' | 'talib-takuri' | 'talib-tasuki-gap'
  | 'talib-thrusting' | 'talib-tristar' | 'talib-unique-three-river'
  | 'talib-upside-gap-two-crows' | 'talib-x-side-gap-three-methods';

interface Spec {
  id: Batch4Id; fn: TalibPatternFunction; zh: string; en: string; aliases: readonly string[];
  bars: number; direction: PatternDirection; purpose: PatternPurpose; meaning: string;
  definition: string; geometry: readonly string[]; settings: string;
  confirmation: readonly string[]; invalidation: string; related: readonly PatternCardId[];
}

function createCard(spec: Spec): PatternCardInput {
  return {
    id: spec.id, nameZhTw: spec.zh, nameEn: spec.en, aliases: spec.aliases,
    category: spec.bars === 1 ? '單根與描述型' : '進階 K 棒組合', matchSupport: 'catalog-only',
    sourceRow: spec.fn, sourceNotes: [], oneSentenceMeaning: spec.meaning,
    observableDefinition: spec.definition, minimumBars: spec.bars, maximumBars: spec.bars,
    patternDirection: spec.direction, patternPurpose: spec.purpose, geometrySteps: spec.geometry,
    relatedPatternIds: spec.related,
    dataRequirements: [`${spec.bars} 根目標完成 K`, spec.settings, '一致價格模式與公司行動資料品質核對'],
    background: ['官方函式只核對程式化幾何；慣用趨勢背景仍須另外確認。', '所有長短、影線、Near 與 Equal 都依可調 CandleSettings。'],
    confirmationGuidance: spec.confirmation,
    commonMisreads: ['只憑縮圖相似，省略嚴格／含等號邊界與前置平均。', '把正負回傳值改寫成勝率、報酬或買賣建議。'],
    invalidationGuidance: [spec.invalidation],
    limitations: ['本站第一版只提供官方函式教學，不執行 TA-Lib 原生辨識。', '函式輸出是幾何旗標，不包含未來方向保證。'],
    lessonLinks: ['/chapters/10-two-three-candlestick-patterns'],
  };
}

export const TALIB_BATCH_4_CARD_DEFINITIONS: readonly PatternCardInput[] = [
  createCard({ id: 'talib-rickshaw-man', fn: 'CDLRICKSHAWMAN', zh: '黃包車夫', en: 'Rickshaw Man', aliases: ['人力車夫', 'Rickshaw Man'], bars: 1, direction: 'neutral', purpose: 'indecision',
    meaning: 'Doji 搭配雙長影，且小實體跨過全幅中點附近，描述劇烈拉扯。',
    definition: '實體不大於 BodyDoji；上下影都嚴格長於 ShadowLong；實體低端不高於全幅中點加 Near、實體高端不低於中點減 Near。',
    geometry: ['BodyDoji 小實體。', '上下影都大於 ShadowLong。', '實體與全幅中點 ±Near 區相交。'], settings: 'BodyDoji、ShadowLong、Near；官方預設 lookback 10 根', confirmation: ['同時核對雙長影與實體中點位置。', '官方 +100 只表示辨識到形狀。'], invalidation: '不是 Doji、任一影線不長，或實體未跨中點區時不符合。', related: ['doji', 'talib-long-legged-doji', 'talib-high-wave'] }),
  createCard({ id: 'talib-rise-fall-three-methods', fn: 'CDLRISEFALL3METHODS', zh: '升降三法', en: 'Rising/Falling Three Methods', aliases: ['上升下降三法', 'Rise/Fall Three Methods'], bars: 5, direction: 'both', purpose: 'continuation',
    meaning: '長方向 K、三根反向短 K 與同向長第五根組成官方固定 1＋3＋1 延續型態。',
    definition: '第一、五根同色且 BodyLong；第二至四根反色且 BodyShort，實體部分位於第一根全幅內、收盤沿反向嚴格遞進；第五根順勢開過第四根收盤並收過第一根收盤。',
    geometry: ['第一根 BodyLong。', '三根反色 BodyShort 在第一根全幅內反向遞進。', '第五根同色 BodyLong，開、收順勢越界。'], settings: 'BodyLong、BodyShort；官方預設 lookback 14 根', confirmation: ['本站說明官方實作固定三根中段 K。', '等待第五根完成兩個順勢越界。'], invalidation: '長短、顏色、中段包含與遞進，或第五根越界任一缺失時不符合。', related: ['three-advancing-candles', 'three-falling-candles', 'talib-mat-hold'] }),
  createCard({ id: 'talib-separating-lines', fn: 'CDLSEPARATINGLINES', zh: '分離線', en: 'Separating Lines', aliases: ['分隔線', 'Separating Lines'], bars: 2, direction: 'both', purpose: 'continuation',
    meaning: '兩根反色 K 開盤近似，第二根為長實體且起始端影線極短。',
    definition: '兩根顏色相反；第二根開盤位於第一根開盤 ±Equal；第二根大於 BodyLong。第二根上漲時下影短於 ShadowVeryShort，下跌時上影短於該門檻；第一根無長度要求。',
    geometry: ['兩根反色，開盤 Equal。', '第二根 BodyLong。', '第二根起始端影線極短。'], settings: 'ShadowVeryShort、BodyLong、Equal；官方預設 lookback 11 根', confirmation: ['方向依第二根顏色。', '不可自行替第一根加長實體條件。'], invalidation: '顏色未相反、開盤不近、第二根不長或起始端影線過長時不符合。', related: ['talib-belt-hold', 'talib-counterattack', 'three-advancing-candles'] }),
  createCard({ id: 'talib-short-line', fn: 'CDLSHORTLINE', zh: '短線 K', en: 'Short Line Candle', aliases: ['短實體短影', 'Short Line'], bars: 1, direction: 'neutral', purpose: 'indecision', meaning: '短實體搭配兩側短影的單根形狀，顏色不代表未來方向。', definition: '實體嚴格短於 BodyShort，且上影、下影都嚴格短於 ShadowShort；官方正負只依 K 棒顏色。', geometry: ['實體小於 BodyShort。', '上影小於 ShadowShort。', '下影小於 ShadowShort。'], settings: 'BodyShort、ShadowShort；官方預設 lookback 10 根', confirmation: ['核對實體與兩側影線皆短。', '把顏色與方向預期分開。'], invalidation: '實體或任一影線未低於門檻時不符合。', related: ['relative-small-body', 'talib-long-line', 'talib-spinning-top'] }),
  createCard({ id: 'talib-spinning-top', fn: 'CDLSPINNINGTOP', zh: '紡錘線', en: 'Spinning Top', aliases: ['陀螺線', 'Spinning Top'], bars: 1, direction: 'neutral', purpose: 'indecision', meaning: '短實體的上下影都長於實體本身，用來描述拉扯。', definition: '實體嚴格短於 BodyShort；上影、下影都嚴格長於實體絕對值；官方正負只依 K 棒顏色。', geometry: ['實體小於 BodyShort。', '上影大於實體。', '下影大於實體。'], settings: 'BodyShort；官方預設 lookback 10 根', confirmation: ['比較影線與當根實體，而非 ShadowLong。', '顏色不帶未來多空意義。'], invalidation: '實體不短，或任一影線不長於實體時不符合。', related: ['doji', 'talib-high-wave', 'talib-rickshaw-man'] }),
  createCard({ id: 'talib-stalled-pattern', fn: 'CDLSTALLEDPATTERN', zh: '停滯型態', en: 'Stalled Pattern', aliases: ['推進停滯', 'Stalled Pattern'], bars: 3, direction: 'bearish', purpose: 'weakening', meaning: '三根上漲 K 仍收高，但第三根變短並貼近第二根收盤，描述推進停滯。', definition: '三根皆上漲且收盤嚴格提高；第一、二根 BodyLong；第二根上影短且開盤高於第一根開盤、不超過第一根收盤加 Near；第三根 BodyShort，開盤至少位於第二根收盤減第三根實體減 Near。', geometry: ['三根上漲、收盤遞增。', '前兩根長，第二根短上影且開在第一根實體上部。', '第三根短，開盤貼近第二根收盤。'], settings: 'BodyLong、BodyShort、ShadowVeryShort、Near；預設 lookback 12 根', confirmation: ['這是弱化警示，不等於反轉完成。', '上行背景由讀者另核對。'], invalidation: '三根方向、長短、第二根位置或第三根貼近條件任一缺失時不符合。', related: ['three-advancing-candles', 'talib-advance-block', 'shooting-star'] }),
  createCard({ id: 'talib-stick-sandwich', fn: 'CDLSTICKSANDWICH', zh: '條形三明治', en: 'Stick Sandwich', aliases: ['棒狀三明治', 'Stick Sandwich'], bars: 3, direction: 'bullish', purpose: 'reversal', meaning: '黑、白、黑三根中，第三根收盤回到第一根收盤 Equal 區。', definition: '三根顏色依序下跌、上漲、下跌；第二根最低價嚴格高於第一根收盤；第三根收盤位於第一根收盤 ±Equal。', geometry: ['顏色：黑、白、黑。', '第二根 low 高於第一根 close。', '第三根 close 近似第一根 close。'], settings: 'Equal；官方預設 lookback 7 根', confirmation: ['比較第一、三根收盤而非最低價。', '下行背景另行核對。'], invalidation: '顏色順序、第二根低點或 Equal 收盤任一不符時不成立。', related: ['three-falling-candles', 'talib-counterattack', 'piercing-line'] }),
  createCard({ id: 'talib-takuri', fn: 'CDLTAKURI', zh: '探水竿', en: 'Takuri', aliases: ['探水竿線', 'Takuri Line'], bars: 1, direction: 'neutral', purpose: 'indecision', meaning: 'Doji、極短上影與極長下影組成比一般蜻蜓十字更嚴格的形狀。', definition: '實體不大於 BodyDoji；上影嚴格短於 ShadowVeryShort；下影嚴格長於 ShadowVeryLong。', geometry: ['BodyDoji。', '上影小於 ShadowVeryShort。', '下影大於 ShadowVeryLong。'], settings: 'BodyDoji、ShadowVeryShort、ShadowVeryLong；預設 lookback 10 根', confirmation: ['官方 +100 只表示形狀。', '和蜻蜓十字的下影門檻分開。'], invalidation: 'Doji、極短上影或極長下影任一不符時不成立。', related: ['hammer', 'doji', 'talib-dragonfly-doji'] }),
  createCard({ id: 'talib-tasuki-gap', fn: 'CDLTASUKIGAP', zh: '跳空並列缺口', en: 'Tasuki Gap', aliases: ['Tasuki 缺口', 'Tasuki Gap'], bars: 3, direction: 'both', purpose: 'continuation', meaning: '第二根順缺口方向、第三根反色回補部分缺口但仍保留缺口；第一根顏色不限。', definition: '第二根相對第一根形成嚴格實體 gap；向上缺口時第二根為上漲、第三根為下跌，向下缺口時第二根為下跌、第三根為上漲；第一根顏色不限。第三根開盤嚴格位於第二根實體內，收盤越過第二根開盤但仍停在第一根實體之外；第二、三根實體尺寸差小於 Near。', geometry: ['第一根顏色不限；第二根順缺口方向形成嚴格實體 gap。', '第三根與第二根反色，開在第二根實體內。', '第三根只回補部分 gap，且與第二根實體大小 Near。'], settings: 'Near；官方預設 lookback 7 根', confirmation: ['分別鏡像核對向上與向下缺口，不替第一根加顏色條件。', '第三根不可把缺口完全補滿。'], invalidation: '缺口、第二／三根顏色、第三根開收位置或尺寸 Near 任一不符時不成立。', related: ['talib-x-side-gap-three-methods', 'talib-gap-side-by-side-white-lines', 'talib-breakaway'] }),
  createCard({ id: 'talib-thrusting', fn: 'CDLTHRUSTING', zh: '插入線', en: 'Thrusting Pattern', aliases: ['推進線', 'Thrusting'], bars: 2, direction: 'bearish', purpose: 'continuation', meaning: '長下跌 K 後的上漲 K 開低，收過前收但不超過前一根實體中點。', definition: '第一根 BodyLong 下跌；第二根上漲且開盤嚴格低於前低；第二根收盤嚴格高於前收加 Equal，但不高於第一根下跌實體中點。', geometry: ['第一根長下跌。', '第二根上漲且開低。', '第二根收過前收 +Equal，但至多到實體中點。'], settings: 'Equal、BodyLong；官方預設 lookback 11 根', confirmation: ['函式固定回傳 -100。', '和頸內線、穿透形的收盤深度分開。'], invalidation: '第一根不長、第二根未開低，或收盤不在指定深度時不符合。', related: ['talib-in-neck', 'talib-on-neck', 'piercing-line', 'dark-cloud-cover'] }),
  createCard({ id: 'talib-tristar', fn: 'CDLTRISTAR', zh: '三星十字', en: 'Tristar Pattern', aliases: ['三十字星', 'Tristar'], bars: 3, direction: 'both', purpose: 'reversal', meaning: '三根 Doji 中，中央十字向上或向下實體跳空，第三根再朝中央回移才有方向輸出。', definition: '三根實體都不大於 BodyDoji；第二根實體嚴格向上 gap 且第三根實體高端低於第二根高端時回 -100；向下 gap 且第三根實體低端高於第二根低端時回 +100；其他三 Doji 回 0。', geometry: ['三根都符合 BodyDoji。', '第二根相對第一根嚴格實體 gap。', '第三根朝中央回移；否則三 Doji 仍為 0。'], settings: 'BodyDoji；官方預設 lookback 12 根', confirmation: ['三根 Doji 本身不保證有訊號。', '依 gap 方向與第三根回移判斷。'], invalidation: '任一根非 Doji，或缺少中央 gap／第三根回移時不產生方向值。', related: ['talib-doji-star', 'talib-abandoned-baby', 'talib-morning-doji-star'] }),
  createCard({ id: 'talib-unique-three-river', fn: 'CDLUNIQUE3RIVER', zh: '奇特三河', en: 'Unique Three River', aliases: ['獨特三河', 'Unique 3 River'], bars: 3, direction: 'bullish', purpose: 'reversal', meaning: '長下跌、創低但收高的內包下跌 K，再接一根短上漲 K。', definition: '第一根 BodyLong 下跌；第二根下跌，收盤嚴格高於第一根收盤、開盤不高於第一根開盤且低點創低；第三根 BodyShort 上漲，開盤嚴格高於第二根低點。官方未把第三根開收低於第二根收盤列為必要條件。', geometry: ['第一根長下跌。', '第二根下跌：實體內包、低點創低、收盤提高。', '第三根短上漲，開盤高於第二根 low。'], settings: 'BodyLong、BodyShort；官方預設 lookback 12 根', confirmation: ['只採 C 實作條件。', '不把原始碼註解中的「最好」寫成必要條件。'], invalidation: '長短、第二根內包創低或第三根方向／開盤任一不符時不成立。', related: ['talib-homing-pigeon', 'talib-ladder-bottom', 'talib-stick-sandwich'] }),
  createCard({ id: 'talib-upside-gap-two-crows', fn: 'CDLUPSIDEGAP2CROWS', zh: '向上跳空兩烏鴉', en: 'Upside Gap Two Crows', aliases: ['上升缺口兩烏鴉', 'Upside Gap 2 Crows'], bars: 3, direction: 'bearish', purpose: 'reversal', meaning: '長上漲 K 上方先出現短下跌 K，再由第三根下跌 K 包住第二根但仍收在第一根收盤之上。', definition: '第一根 BodyLong 上漲；第二根 BodyShort 下跌且實體嚴格 gap up；第三根下跌，開盤高於第二根開盤、收盤低於第二根收盤但仍嚴格高於第一根收盤。', geometry: ['第一根長上漲。', '第二根短下跌，實體 gap up。', '第三根下跌包住第二根實體，仍收在第一根收盤上方。'], settings: 'BodyLong、BodyShort；官方預設 lookback 12 根', confirmation: ['核對第三根只包住第二根且未收回第一根。', '上行背景另行確認。'], invalidation: '長短、gap、第三根包覆或最終收盤位置任一不符時不成立。', related: ['talib-two-crows', 'dark-cloud-cover', 'shooting-star'] }),
  createCard({ id: 'talib-x-side-gap-three-methods', fn: 'CDLXSIDEGAP3METHODS', zh: '跳空三法', en: 'Upside/Downside Gap Three Methods', aliases: ['上下跳空三法', 'X-Side Gap 3 Methods'], bars: 3, direction: 'both', purpose: 'continuation', meaning: '前兩根同色並嚴格實體跳空，第三根反色，開在第二根實體內、收在第一根實體內。', definition: '第一、二根同色，第二根相對第一根形成方向一致的嚴格實體 gap；第三根反色，開盤嚴格位於第二根實體內，收盤嚴格位於第一根實體內；方向依第一根顏色。', geometry: ['第一、二根同色並嚴格實體 gap。', '第三根反色。', '第三根開在第二根實體內、收在第一根實體內。'], settings: '不使用 CandleSettings；官方固定 lookback 2 根', confirmation: ['分別鏡像核對上、下缺口。', '實體端點皆採嚴格內部。'], invalidation: '顏色、gap 或第三根開收內含任一不符時不成立。', related: ['talib-tasuki-gap', 'talib-gap-side-by-side-white-lines', 'talib-rise-fall-three-methods'] }),
] as const;
