import type {
  PatternCardInput,
  PatternCardId,
  PatternDirection,
  PatternPurpose,
  TalibPatternFunction,
} from './types';

type TalibBatch1CardId =
  | 'talib-two-crows'
  | 'talib-three-inside'
  | 'talib-three-line-strike'
  | 'talib-three-outside'
  | 'talib-three-stars-in-the-south'
  | 'talib-abandoned-baby'
  | 'talib-advance-block'
  | 'talib-belt-hold'
  | 'talib-breakaway'
  | 'talib-closing-marubozu'
  | 'talib-concealing-baby-swallow'
  | 'talib-counterattack';

interface TalibBatchCardSpec {
  id: TalibBatch1CardId;
  functionName: TalibPatternFunction;
  nameZhTw: string;
  nameEn: string;
  aliases: readonly string[];
  bars: number;
  direction: PatternDirection;
  purpose: PatternPurpose;
  meaning: string;
  definition: string;
  geometrySteps: readonly string[];
  confirmation: readonly string[];
  misreads: readonly string[];
  invalidation: readonly string[];
}

const LESSON_LINKS = ['/chapters/10-two-three-candlestick-patterns'] as const;
const COMMON_LIMITATIONS = [
  'TA-Lib 函式輸出是幾何辨識結果，不是報酬率、勝率、買賣建議或未來方向保證。',
  '實體長短、影線與近似相等都依 TA-Lib 的全域 CandleSettings 與近期平均計算，不能改用肉眼固定百分比替代。',
] as const;

const RELATED_PATTERN_IDS: Readonly<Record<TalibBatch1CardId, readonly PatternCardId[]>> = {
  'talib-two-crows': ['three-falling-candles', 'dark-cloud-cover'],
  'talib-three-inside': ['bullish-harami', 'bearish-harami'],
  'talib-three-line-strike': ['three-advancing-candles', 'three-falling-candles'],
  'talib-three-outside': ['bullish-engulfing', 'bearish-engulfing'],
  'talib-three-stars-in-the-south': ['morning-star', 'three-falling-candles'],
  'talib-abandoned-baby': ['morning-star', 'evening-star'],
  'talib-advance-block': ['three-advancing-candles', 'shooting-star'],
  'talib-belt-hold': ['near-marubozu', 'talib-closing-marubozu'],
  'talib-breakaway': ['morning-star', 'evening-star'],
  'talib-closing-marubozu': ['near-marubozu', 'talib-belt-hold'],
  'talib-concealing-baby-swallow': ['talib-three-stars-in-the-south', 'three-falling-candles'],
  'talib-counterattack': ['piercing-line', 'dark-cloud-cover'],
};

function createTalibCard(spec: TalibBatchCardSpec): PatternCardInput {
  return {
    id: spec.id,
    nameZhTw: spec.nameZhTw,
    nameEn: spec.nameEn,
    aliases: spec.aliases,
    category: spec.bars === 1 ? '單根與描述型' : '進階 K 棒組合',
    matchSupport: 'catalog-only',
    sourceRow: spec.functionName,
    sourceNotes: [],
    oneSentenceMeaning: spec.meaning,
    observableDefinition: spec.definition,
    minimumBars: spec.bars,
    maximumBars: spec.bars,
    patternDirection: spec.direction,
    patternPurpose: spec.purpose,
    geometrySteps: spec.geometrySteps,
    relatedPatternIds: RELATED_PATTERN_IDS[spec.id],
    dataRequirements: [
      `至少 ${spec.bars} 根同週期、已完成且價格模式一致的 OHLC K 線`,
      '足以計算 TA-Lib CandleSettings 近期平均的前置資料',
      '公司行動、停牌與缺值已完成資料品質核對',
    ],
    background: [
      '先確認前段結構與型態所在位置，再逐根核對實體、影線、跳空與包含關係。',
      '把函式回傳方向、型態確認與後續情境分開記錄，避免用名稱替代證據。',
    ],
    confirmationGuidance: spec.confirmation,
    commonMisreads: spec.misreads,
    invalidationGuidance: spec.invalidation,
    limitations: COMMON_LIMITATIONS,
    lessonLinks: LESSON_LINKS,
  };
}

/** T03 新增的 12 張正規卡；另 4 個函式重用既有卡片。 */
export const TALIB_BATCH_1_CARD_DEFINITIONS: readonly PatternCardInput[] = [
  createTalibCard({
    id: 'talib-two-crows',
    functionName: 'CDL2CROWS',
    nameZhTw: '兩隻烏鴉',
    nameEn: 'Two Crows',
    aliases: ['兩烏鴉', 'Two Crows'],
    bars: 3,
    direction: 'bearish',
    purpose: 'reversal',
    meaning: '長上漲實體之後，兩根下跌實體在上方逐步回落，構成需要背景確認的偏空反轉候選。',
    definition: '第一根為長上漲實體；第二根下跌實體向上形成實體跳空；第三根下跌實體開在第二根實體內，並收進第一根實體內。',
    geometrySteps: ['第一根：長上漲實體。', '第二根：下跌實體與第一根實體向上跳空。', '第三根：開在第二根實體內，收盤回到第一根實體內。'],
    confirmation: ['先核對型態是否位於上行背景或壓力候選附近。', '第三根收盤只確認幾何完成；後續是否延續仍須另列觸發與失效。'],
    misreads: ['把兩根任意黑 K 都稱為兩隻烏鴉。', '只看缺口，不核對第三根開收位置。'],
    invalidation: ['第二根未向上形成實體跳空，或第三根未收進第一根實體時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-three-inside',
    functionName: 'CDL3INSIDE',
    nameZhTw: '三內升降',
    nameEn: 'Three Inside Up/Down',
    aliases: ['三內部上升下降', 'Three Inside'],
    bars: 3,
    direction: 'both',
    purpose: 'reversal',
    meaning: '母子實體後接一根向相反方向延伸的 K 線，用來描述多空皆可能出現的三根反轉候選。',
    definition: '第一根為長實體；第二根是相反方向的短實體且被第一根實體包含；第三根與第二根同方向，收盤越過第一根開盤。',
    geometrySteps: ['第一根：長實體。', '第二根：相反方向短實體，完整位於第一根實體內。', '第三根：延續第二根方向，收盤越過第一根開盤。'],
    confirmation: ['第三根必須完成收盤越界，盤中穿越不能取代完成 K。', '多頭版與空頭版分別核對前段下行或上行背景。'],
    misreads: ['把影線包含誤當成實體包含。', '第二根出現後就略過第三根完成條件。'],
    invalidation: ['第二根實體未被包含，或第三根收盤未越過第一根開盤時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-three-line-strike',
    functionName: 'CDL3LINESTRIKE',
    nameZhTw: '三線反擊',
    nameEn: 'Three-Line Strike',
    aliases: ['三線打擊', 'Three-Line Strike'],
    bars: 4,
    direction: 'both',
    purpose: 'continuation',
    meaning: '三根同向推進後由第四根反向長實體一次包回；TA-Lib 仍以前三根方向回傳，歸為延續候選。',
    definition: '前三根為逐步推進的三白兵或三黑鴉；第四根方向相反，開在第三根收盤外側並收過第一根開盤。',
    geometrySteps: ['前三根：同向且收盤依序推進。', '第四根：方向相反，開盤延伸到第三根收盤外側。', '第四根：收盤跨越第一根開盤，實體包回前三根。'],
    confirmation: ['等待第四根完成，並核對前三根是否真的符合推進序列。', '後續情境需另外設定，不把四根形狀直接視為方向保證。'],
    misreads: ['把任意長反向 K 當成三線反擊。', '忽略前三根的同向推進與第四根兩端開收條件。'],
    invalidation: ['第四根未收過第一根開盤，或前三根不是有效推進序列時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-three-outside',
    functionName: 'CDL3OUTSIDE',
    nameZhTw: '三外升降',
    nameEn: 'Three Outside Up/Down',
    aliases: ['三外部上升下降', 'Three Outside'],
    bars: 3,
    direction: 'both',
    purpose: 'reversal',
    meaning: '外包實體後再由第三根向同一方向延伸收盤，描述多空皆可能出現的三根反轉候選。',
    definition: '前兩根先形成上漲或下跌外包線；第三根與第二根同方向，並把收盤再推到第二根收盤之外。',
    geometrySteps: ['第一、二根：第二根反向實體完整包住第一根實體。', '第三根：與第二根同方向。', '第三根：收盤超過第二根收盤，延伸外包方向。'],
    confirmation: ['先完整核對前兩根外包實體，再等待第三根收盤延伸。', '位置與前段結構只作背景，不可由三根形狀自行補齊。'],
    misreads: ['把影線外包當成實體外包。', '第三根方向相同但收盤未延伸仍算成立。'],
    invalidation: ['前兩根不構成外包，或第三根未延伸第二根收盤時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-three-stars-in-the-south',
    functionName: 'CDL3STARSINSOUTH',
    nameZhTw: '南方三星',
    nameEn: 'Three Stars in the South',
    aliases: ['南方三顆星', 'Three Stars in the South'],
    bars: 3,
    direction: 'bullish',
    purpose: 'reversal',
    meaning: '下行背景中三根下跌 K 的實體與波幅依序收斂，形成需要等待後續驗證的偏多反轉候選。',
    definition: '第一根為長下跌實體且下影較長；第二根較小，開盤位於第一根高低範圍內且高於第一根收盤，盤中低點跌破第一根收盤、但不破第一根低點並留下下影；第三根為更小的下跌光頭光腳，位於第二根高低範圍內。',
    geometrySteps: ['第一根：長下跌實體與明顯下影。', '第二根：較小下跌實體，開盤高於第一根收盤，低點跌破第一根收盤但不破第一根低點，並具有下影。', '第三根：小型下跌光頭光腳，完整位於第二根範圍內。'],
    confirmation: ['確認三根波幅與實體逐步收斂，且位於可辨識下行背景。', '型態完成後只列為候選，後續轉強需另以事前規則核對。'],
    misreads: ['只要三根下跌 K 越來越小就命名。', '忽略第三根需接近光頭光腳並位於第二根範圍內。'],
    invalidation: ['第二根開盤未高於第一根收盤、低點未跌破前收或跌破第一根低點、沒有下影，或第三根不是位於第二根範圍內的短下跌光頭光腳時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-abandoned-baby',
    functionName: 'CDLABANDONEDBABY',
    nameZhTw: '棄嬰',
    nameEn: 'Abandoned Baby',
    aliases: ['棄嬰線', 'Abandoned Baby'],
    bars: 3,
    direction: 'both',
    purpose: 'reversal',
    meaning: '中央十字線與前後兩根的影線完全分離，構成對缺口要求嚴格的三根反轉候選。',
    definition: '第一根為長實體；第二根為十字線且連影線都與第一根跳空；第三根方向相反、實體大於 BodyShort 平均、同樣與十字線影線跳空，並依 penetration 參數充分收進第一根實體。',
    geometrySteps: ['第一根：長實體。', '第二根：十字線，整根高低範圍與第一根分離。', '第三根：反向實體大於 BodyShort 平均，與十字線範圍分離，並依 penetration 門檻充分收進第一根實體。'],
    confirmation: ['以高低價核對兩側完整缺口，不能只看實體。', '第三根完成回收才算幾何完成，之後仍需另列失效。'],
    misreads: ['把只有實體跳空的晨星或暮星當成棄嬰。', '忽略市場撮合制度可能讓完整缺口極少見。'],
    invalidation: ['十字線影線與任一鄰近 K 重疊、第三根實體過短，或未達 penetration 回收門檻時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-advance-block',
    functionName: 'CDLADVANCEBLOCK',
    nameZhTw: '前進受阻',
    nameEn: 'Advance Block',
    aliases: ['前進障礙', 'Advance Block'],
    bars: 3,
    direction: 'bearish',
    purpose: 'weakening',
    meaning: '三根上漲 K 仍逐步收高，但後兩根出現實體縮短或上影加長，用來描述推進動能減弱。',
    definition: '三根皆為上漲實體且收盤依序提高、後兩根開在前根實體內；第一根較長且上影短，後兩根以實體縮短或上影拉長呈現受阻。',
    geometrySteps: ['三根：上漲實體、收盤依序提高。', '後兩根：開盤位於前一根實體內。', '第一根較強；第二、三根以實體縮短或上影加長顯示推進受阻。'],
    confirmation: ['這是一張弱化警示卡，不把第三根本身當成向下觸發。', '核對後兩根縮短或上影增加是否符合 CandleSettings，而非只靠肉眼。'],
    misreads: ['看到三根上漲 K 就稱為前進受阻。', '把弱化描述直接改寫成已確認反轉。'],
    invalidation: ['後兩根未顯示實體縮短或上影加長，或收盤未依序提高時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-belt-hold',
    functionName: 'CDLBELTHOLD',
    nameZhTw: '捉腰帶線',
    nameEn: 'Belt-hold',
    aliases: ['腰帶線', 'Belt Hold'],
    bars: 1,
    direction: 'both',
    purpose: 'reversal',
    meaning: '長實體從一端近似無影線地展開，描述單根 K 的方向性幾何，仍需所在位置與背景。',
    definition: '多頭版為長上漲實體且下影很短；空頭版為長下跌實體且上影很短，影線門檻依 CandleSettings。',
    geometrySteps: ['多頭版：長上漲實體，下影近似為零。', '空頭版：長下跌實體，上影近似為零。', '兩版都先核對相對長實體與對應影線門檻。'],
    confirmation: ['先固定前段趨勢與關鍵區，再將單根幾何列為候選。', '下一根資料只能作後續情境驗證，不能倒灌到當根結果。'],
    misreads: ['把任何長 K 都稱為捉腰帶線。', '忽略方向不同時要檢查的影線端點不同。'],
    invalidation: ['實體不夠長，或應該接近零的影線超過設定門檻時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-breakaway',
    functionName: 'CDLBREAKAWAY',
    nameZhTw: '脫離型態',
    nameEn: 'Breakaway',
    aliases: ['脫離線', 'Breakaway Pattern'],
    bars: 5,
    direction: 'both',
    purpose: 'reversal',
    meaning: '趨勢方向的缺口與三根延伸後，由第五根反向收回部分缺口，形成五根 K 的反轉候選。',
    definition: '第一根為長實體；第二根同方向並形成實體缺口；第三根高低點都比第二根沿原方向推進；第四根與前兩根同色且高低點再同向推進；第五根反向並收進第一、二根缺口，但未越過第一根收盤。',
    geometrySteps: ['第一根長實體；第二根同向並形成實體缺口。', '第三根高低點沿原方向超過第二根；第四根與原方向同色，且高低點再超過第三根。', '第五根反向長實體，收回部分缺口但不完全越過第一根收盤。'],
    confirmation: ['五根皆完成後才核對缺口、延伸與第五根回收位置。', '多空版本鏡像處理，後續方向仍另以觸發和失效情境呈現。'],
    misreads: ['少於五根就套用名稱。', '第五根只要反向就算，不檢查收盤落點。'],
    invalidation: ['第二根沒有同向實體缺口、第三或第四根高低點未依序推進、第四根不同色，或第五根收盤不在指定回收區間時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-closing-marubozu',
    functionName: 'CDLCLOSINGMARUBOZU',
    nameZhTw: '收盤光頭光腳',
    nameEn: 'Closing Marubozu',
    aliases: ['收盤禿線', 'Closing Marubozu'],
    bars: 1,
    direction: 'both',
    purpose: 'continuation',
    meaning: '收盤貼近當日極值且實體相對長，描述價格一路推到收盤端點的單根幾何。',
    definition: '上漲版為長上漲實體且上影很短；下跌版為長下跌實體且下影很短，門檻依 CandleSettings。',
    geometrySteps: ['上漲版：長上漲實體，收盤靠近最高價。', '下跌版：長下跌實體，收盤靠近最低價。', '以對應影線是否短於設定平均核對收盤端點。'],
    confirmation: ['只描述完成 K 的收盤位置與相對實體，不單獨宣告趨勢延續。', '搭配前段結構、成交量與事前失效條件閱讀。'],
    misreads: ['把上下影都很短當成必要條件。', '只要收在高低點就忽略實體是否相對長。'],
    invalidation: ['實體不夠長，或收盤端影線超過設定門檻時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-concealing-baby-swallow',
    functionName: 'CDLCONCEALBABYSWALL',
    nameZhTw: '藏嬰吞沒',
    nameEn: 'Concealing Baby Swallow',
    aliases: ['藏嬰吞沒線', 'Concealing Baby Swallow'],
    bars: 4,
    direction: 'bullish',
    purpose: 'reversal',
    meaning: '兩根下跌光頭光腳後，第三根向下跳空而第四根的整段高低範圍吞沒第三根，形成偏多反轉候選。',
    definition: '前兩根是下跌光頭光腳；第三根仍下跌並向下跳空，上影伸入第二根實體；第四根下跌 K 的整段高低範圍吞沒第三根。',
    geometrySteps: ['第一、二根：連續下跌光頭光腳。', '第三根：向下跳空，上影伸入第二根實體。', '第四根：下跌 K 的高低範圍完整吞沒第三根。'],
    confirmation: ['逐項核對第三根跳空與上影、第四根全範圍吞沒，不能只看實體。', '四根完成只代表型態候選，後續轉強仍須獨立驗證。'],
    misreads: ['把第四根實體包住第三根實體就算成立。', '忽略前兩根需要接近光頭光腳。'],
    invalidation: ['第三根沒有向下跳空／上影伸入，或第四根未吞沒第三根完整範圍時，不符合幾何。'],
  }),
  createTalibCard({
    id: 'talib-counterattack',
    functionName: 'CDLCOUNTERATTACK',
    nameZhTw: '反擊線',
    nameEn: 'Counterattack',
    aliases: ['反攻線', 'Counterattack Lines'],
    bars: 2,
    direction: 'both',
    purpose: 'reversal',
    meaning: '兩根相反方向的長實體收在近似相同價位，形成多空皆可能出現的雙根反擊候選。',
    definition: '第一根為長實體；第二根為相反方向長實體，兩根收盤在 CandleSettings 所定義的近似相等範圍內。',
    geometrySteps: ['第一根：長實體。', '第二根：方向相反且同樣為長實體。', '兩根收盤：落在近似相等的容許範圍。'],
    confirmation: ['先確認兩根皆為相對長實體，並使用資料精度與近似相等門檻核對收盤。', '多頭或空頭版的背景分開閱讀，不用第二根顏色直接取代情境。'],
    misreads: ['把收盤大致靠近但實體不長的兩根 K 命名為反擊線。', '把反擊線與需要實體重疊的刺透／烏雲混為一談。'],
    invalidation: ['任一實體不夠長、方向未相反或收盤差超過容許範圍時，不符合幾何。'],
  }),
] as const;
