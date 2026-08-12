import type {
  AnnotationIllustrationPrimitive,
  CandleIllustrationPrimitive,
  PatternCardId,
  PatternIllustration,
  TrendLineIllustrationPrimitive,
  VolumeBarIllustrationPrimitive,
  ZoneIllustrationPrimitive,
} from './types';

const candle = (
  x: number,
  open: number,
  close: number,
  high: number,
  low: number,
  direction: CandleIllustrationPrimitive['direction'],
  label: string,
): CandleIllustrationPrimitive => ({ kind: 'candle', x, open, close, high, low, direction, label });

const trend = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
): TrendLineIllustrationPrimitive => ({ kind: 'trend-line', x1, y1, x2, y2, label });

const zone = (x: number, y: number, width: number, height: number, label: string): ZoneIllustrationPrimitive => ({
  kind: 'zone',
  x,
  y,
  width,
  height,
  label,
});

const volume = (x: number, height: number, label: string): VolumeBarIllustrationPrimitive => ({
  kind: 'volume-bar',
  x,
  height,
  label,
});

const note = (x: number, y: number, text: string): AnnotationIllustrationPrimitive => ({
  kind: 'annotation',
  x,
  y,
  text,
});

function illustration(
  title: string,
  altTextZhTw: string,
  primitives: PatternIllustration['primitives'],
): PatternIllustration {
  return { title, altTextZhTw, primitives };
}

/**
 * 每張卡的輕量 SVG 資料。實心／空心實體、虛線區域與文字註記共同傳達意義，
 * 任何圖例都不要求讀者只靠顏色辨識。
 */
export const PATTERN_ILLUSTRATIONS: Readonly<Record<PatternCardId, PatternIllustration>> = {
  'relative-long-body': illustration(
    '相對長實體示意',
    '一根較高的實心 K 線，旁有「前 20 根上四分位」文字，表示實體相對長而非固定百分比。',
    [candle(80, 66, 28, 18, 76, 'up', '相對長實體'), note(97, 24, '前 20 根上四分位')],
  ),
  'relative-small-body': illustration(
    '相對小實體示意',
    '一根影線較長、實體很小的空心 K 線，旁有「前 20 根下四分位」文字。',
    [candle(80, 49, 53, 22, 78, 'down', '相對小實體'), note(97, 24, '前 20 根下四分位')],
  ),
  doji: illustration(
    '十字線示意',
    '一根中央短橫線與上下影線的中性 K 線，文字指出開收差不超過一個比較單位。',
    [candle(80, 50, 50, 20, 79, 'neutral', '開收近似'), note(97, 30, '開收差 ≤ 1 個比較單位')],
  ),
  hammer: illustration(
    '錘子形示意',
    '實體靠近高位、下影線至少較長的實心 K 線，下方以文字標示長下影。',
    [candle(80, 35, 44, 26, 84, 'up', '錘子形'), note(98, 73, '長下影 ≥ 2 倍有效實體'), trend(28, 24, 55, 43, '下行背景')],
  ),
  'shooting-star': illustration(
    '射擊之星形示意',
    '實體靠近低位、上影線至少較長的空心 K 線，上方以文字標示長上影。',
    [candle(80, 62, 71, 19, 80, 'down', '射擊之星形'), note(98, 28, '長上影 ≥ 2 倍有效實體'), trend(28, 78, 55, 58, '上行背景')],
  ),
  'near-marubozu': illustration(
    '近似光頭光腳示意',
    '一根上下影線極短的實心 K 線，文字標示上下影各不超過一個比較單位。',
    [candle(80, 70, 25, 23, 72, 'up', '近似光頭光腳'), note(97, 42, '上下影各 ≤ 1 個比較單位')],
  ),
  'close-rejection-indecision': illustration(
    '收盤位置與長影示意',
    '一根下影較長且收盤靠近高位的 K 線，旁有收盤位置公式文字，說明是描述而非因果。',
    [candle(72, 43, 34, 27, 82, 'up', '長下影與收盤靠高'), note(94, 32, '收盤位置 = (C−L)/(H−L)'), note(94, 48, '描述，不推論意圖')],
  ),
  'bullish-engulfing': illustration(
    '多頭外包線示意',
    '左側較小空心下跌實體被右側較大實心上漲實體完整包含；虛線框只框住實體，不含影線。',
    [candle(55, 42, 62, 30, 72, 'down', '前根下跌實體'), candle(95, 70, 30, 22, 80, 'up', '當前上漲實體'), zone(45, 37, 20, 30, '前根實體'), note(120, 28, '只比較實體')],
  ),
  'bearish-engulfing': illustration(
    '空頭外包線示意',
    '左側較小實心上漲實體被右側較大空心下跌實體完整包含；虛線框只框住實體，不含影線。',
    [candle(55, 63, 43, 31, 74, 'up', '前根上漲實體'), candle(95, 29, 72, 20, 82, 'down', '當前下跌實體'), zone(45, 38, 20, 30, '前根實體'), note(120, 28, '只比較實體')],
  ),
  'bullish-harami': illustration(
    '多頭母子線示意',
    '左側相對長的空心下跌母實體內，放入右側較小實心子實體；虛線框表示母實體範圍。',
    [candle(52, 25, 74, 18, 82, 'down', '相對長母實體'), candle(96, 59, 49, 43, 65, 'up', '子實體'), zone(41, 23, 22, 53, '母實體內'), note(120, 28, '前 20 根比較窗')],
  ),
  'bearish-harami': illustration(
    '空頭母子線示意',
    '左側相對長的實心上漲母實體內，放入右側較小空心子實體；虛線框表示母實體範圍。',
    [candle(52, 75, 26, 18, 82, 'up', '相對長母實體'), candle(96, 45, 55, 40, 62, 'down', '子實體'), zone(41, 23, 22, 53, '母實體內'), note(120, 28, '前 20 根比較窗')],
  ),
  'piercing-line': illustration(
    '穿透形示意',
    '左側空心下跌 K 線，右側實心 K 線開低後收過前實體中點；虛線標示中點。',
    [candle(53, 26, 72, 20, 80, 'down', '前根下跌'), candle(97, 83, 43, 38, 89, 'up', '當前開低收回'), trend(35, 49, 70, 49, '前根實體中點'), note(116, 26, '收盤穿越中點')],
  ),
  'dark-cloud-cover': illustration(
    '烏雲形示意',
    '左側實心上漲 K 線，右側空心 K 線開高後收破前實體中點；虛線標示中點。',
    [candle(53, 73, 26, 19, 80, 'up', '前根上漲'), candle(97, 17, 57, 11, 64, 'down', '當前開高收回'), trend(35, 49, 70, 49, '前根實體中點'), note(116, 70, '收盤穿越中點')],
  ),
  'morning-star': illustration(
    '晨星形示意',
    '相對長空心下跌第一根、中間小中性 K 線、及實心上漲第三根；虛線標示第一根中點。',
    [candle(42, 22, 73, 17, 80, 'down', '相對長下跌'), candle(78, 68, 70, 54, 84, 'neutral', '小實體或十字'), candle(114, 76, 32, 26, 81, 'up', '收過中點'), trend(29, 48, 57, 48, '第一根中點')],
  ),
  'evening-star': illustration(
    '暮星形示意',
    '相對長實心上漲第一根、中間小中性 K 線、及空心下跌第三根；虛線標示第一根中點。',
    [candle(42, 76, 24, 18, 82, 'up', '相對長上漲'), candle(78, 29, 31, 16, 48, 'neutral', '小實體或十字'), candle(114, 23, 69, 17, 76, 'down', '收過中點'), trend(29, 50, 57, 50, '第一根中點')],
  ),
  'three-advancing-candles': illustration(
    '連續三根推進示意',
    '三根實心 K 線依序墊高，箭頭與文字標示收盤依序提高，非僅以顏色表示。',
    [candle(43, 75, 58, 51, 82, 'up', '第一根'), candle(78, 62, 42, 36, 70, 'up', '第二根'), candle(113, 46, 24, 18, 54, 'up', '第三根'), trend(30, 77, 126, 22, '收盤依序墊高'), note(116, 88, '開盤在前根實體內或 ±1 單位')],
  ),
  'three-falling-candles': illustration(
    '連續三根下跌示意',
    '三根空心 K 線依序降低，箭頭與文字標示收盤依序降低，非僅以顏色表示。',
    [candle(43, 27, 46, 18, 57, 'down', '第一根'), candle(78, 43, 65, 34, 73, 'down', '第二根'), candle(113, 62, 80, 52, 88, 'down', '第三根'), trend(30, 26, 126, 80, '收盤依序降低'), note(110, 15, '開盤在前根實體內或 ±1 單位')],
  ),
  range: illustration(
    '區間示意',
    '兩條有斜線填充的水平區域包住多根 K 線，上下各以文字標示至少兩次反應。',
    [zone(22, 22, 118, 11, '上反應區'), zone(22, 73, 118, 11, '下反應區'), candle(43, 61, 43, 34, 75, 'up', '反應一'), candle(75, 40, 66, 31, 76, 'down', '反應二'), candle(107, 65, 35, 25, 78, 'up', '反應三'), note(24, 16, '上下各至少兩次反應')],
  ),
  'triangle-consolidation': illustration(
    '三角形整理示意',
    '兩條實線由寬到窄收斂，多根小 K 線位於其間；文字指出兩側各至少兩個錨點。',
    [trend(23, 23, 133, 52, '上邊界收斂'), trend(23, 82, 133, 53, '下邊界收斂'), candle(48, 62, 43, 34, 76, 'up', '錨點'), candle(78, 46, 62, 35, 73, 'down', '錨點'), candle(108, 57, 49, 42, 64, 'up', '錨點'), note(26, 15, '兩側各至少兩個錨點')],
  ),
  'flag-consolidation': illustration(
    '旗形整理示意',
    '左側以箭頭標示方向性移動，右側兩條平行虛線包住較小振幅的短整理。',
    [trend(25, 82, 65, 23, '方向性移動'), trend(68, 36, 137, 53, '短整理上緣'), trend(68, 61, 137, 78, '短整理下緣'), candle(84, 51, 42, 34, 58, 'up', '整理 K'), candle(112, 50, 68, 43, 76, 'down', '整理 K'), note(73, 19, '重疊較多、振幅較小')],
  ),
  'double-top': illustration(
    '雙重頂示意',
    '兩個高點都落在斜線填充的同一上方區域，中間以波谷文字標示。',
    [zone(25, 20, 112, 13, '同一關鍵區'), trend(30, 30, 56, 26, '第一高點'), trend(56, 26, 84, 68, '中間波谷'), trend(84, 68, 116, 27, '第二高點'), note(26, 83, '收盤離開波谷區才另行確認')],
  ),
  'double-bottom': illustration(
    '雙重底示意',
    '兩個低點都落在斜線填充的同一下方區域，中間以波峰文字標示。',
    [zone(25, 76, 112, 13, '同一關鍵區'), trend(30, 79, 56, 82, '第一低點'), trend(56, 82, 84, 42, '中間波峰'), trend(84, 42, 116, 81, '第二低點'), note(26, 16, '收盤離開波峰區才另行確認')],
  ),
  'head-and-shoulders-top': illustration(
    '頭肩頂示意',
    '三個局部高點中間最高，兩條斜線標出頸線區域，文字提醒需固定錨點。',
    [trend(25, 70, 53, 48, '左肩'), trend(53, 48, 80, 20, '頭部較高'), trend(80, 20, 108, 48, '右肩'), trend(108, 48, 137, 70, '回落'), zone(28, 72, 106, 10, '頸線區'), note(28, 15, '肩、頭、頸線皆需固定錨點')],
  ),
  'head-and-shoulders-bottom': illustration(
    '頭肩底示意',
    '三個局部低點中間最低，兩條斜線標出頸線區域，文字提醒需固定錨點。',
    [trend(25, 31, 53, 53, '左肩'), trend(53, 53, 80, 82, '頭部較低'), trend(80, 82, 108, 53, '右肩'), trend(108, 53, 137, 31, '回升'), zone(28, 20, 106, 10, '頸線區'), note(28, 96, '肩、頭、頸線皆需固定錨點')],
  ),
  'false-breakout': illustration(
    '假突破示意',
    '有斜線填充的上方區域、短暫越出的一根 K 線，以及回到原區域的箭頭和收盤文字。',
    [zone(25, 25, 110, 12, '事前上邊界區'), candle(76, 43, 18, 12, 54, 'up', '短暫離開'), candle(110, 35, 57, 27, 68, 'down', '收盤回區間'), trend(93, 19, 112, 55, '回到原區域'), note(25, 85, '先有邊界與收盤口徑')],
  ),
  'rounding-top': illustration(
    '圓弧頂示意',
    '多段折線由上升、趨平到下降，支撐區以斜線區域標示，文字提醒不是完美拋物線。',
    [trend(20, 78, 48, 43, '斜率為正'), trend(48, 43, 78, 25, '逐步趨平'), trend(78, 25, 108, 40, '斜率轉負'), trend(108, 40, 140, 74, '逐步下降'), zone(24, 78, 112, 9, '確認支撐區'), note(25, 15, '不要求完美拋物線')],
  ),
  'rounding-bottom': illustration(
    '圓弧底示意',
    '多段折線由下降、趨平到上升，壓力區以斜線區域標示，文字提醒不是 V 型急彈。',
    [trend(20, 26, 48, 61, '斜率為負'), trend(48, 61, 78, 79, '逐步趨平'), trend(78, 79, 108, 64, '斜率轉正'), trend(108, 64, 140, 30, '逐步上升'), zone(24, 16, 112, 9, '確認壓力區'), note(25, 97, '不是 V 型急跌反彈')],
  ),
  'triple-top': illustration(
    '三重頂示意',
    '三個高點落在同一上方區域，中間有兩個波谷，頸線區標示收盤跌破才確認。',
    [zone(20, 18, 120, 12, '同一壓力區'), trend(24, 68, 43, 25, '第一頂'), trend(43, 25, 65, 66, '波谷一'), trend(65, 66, 82, 24, '第二頂'), trend(82, 24, 105, 66, '波谷二'), trend(105, 66, 125, 25, '第三頂'), zone(52, 65, 67, 9, '頸線區')],
  ),
  'triple-bottom': illustration(
    '三重底示意',
    '三個低點落在同一下方區域，中間有兩個波峰，頸線區標示收盤突破才確認。',
    [zone(20, 75, 120, 12, '同一支撐區'), trend(24, 36, 43, 81, '第一底'), trend(43, 81, 65, 39, '波峰一'), trend(65, 39, 82, 82, '第二底'), trend(82, 82, 105, 39, '波峰二'), trend(105, 39, 125, 81, '第三底'), zone(52, 31, 67, 9, '頸線區')],
  ),
  'symmetrical-triangle': illustration(
    '對稱三角形示意',
    '下降上緣與上升下緣收斂，多根 K 線位於兩線之間，文字標示突破前方向未決。',
    [trend(20, 20, 138, 53, '下降上緣'), trend(20, 85, 138, 53, '上升下緣'), candle(50, 45, 58, 34, 70, 'down', '區內 K'), candle(85, 58, 48, 41, 66, 'up', '區內 K'), note(25, 97, '突破前方向未決')],
  ),
  'ascending-triangle': illustration(
    '上升三角形示意',
    '上方是近水平壓力區，下方邊界逐步升高收斂，文字提醒名稱不保證向上。',
    [zone(20, 20, 120, 10, '近水平上緣'), trend(20, 84, 138, 29, '上升下緣'), candle(55, 50, 42, 31, 67, 'up', '區內 K'), candle(94, 40, 51, 29, 58, 'down', '區內 K'), note(25, 97, '依實際離開方向確認')],
  ),
  'descending-triangle': illustration(
    '下降三角形示意',
    '下方是近水平支撐區，上方邊界逐步降低收斂，文字提醒名稱不保證向下。',
    [zone(20, 75, 120, 10, '近水平下緣'), trend(20, 20, 138, 76, '下降上緣'), candle(55, 56, 68, 40, 74, 'down', '區內 K'), candle(94, 66, 54, 48, 73, 'up', '區內 K'), note(25, 97, '依實際離開方向確認')],
  ),
  'bullish-rectangle': illustration(
    '多頭矩形示意',
    '左側方向線向上，右側兩個水平區域包住整理 K 線，向上確認與向下失效分別標示。',
    [trend(18, 82, 50, 28, '前段上升'), zone(55, 25, 82, 9, '矩形上緣'), zone(55, 70, 82, 9, '矩形下緣'), candle(76, 60, 43, 34, 69, 'up', '整理 K'), candle(108, 42, 61, 33, 69, 'down', '整理 K'), note(58, 95, '上破確認；下破失效')],
  ),
  'bearish-rectangle': illustration(
    '空頭矩形示意',
    '左側方向線向下，右側兩個水平區域包住整理 K 線，向下確認與向上失效分別標示。',
    [trend(18, 22, 50, 76, '前段下降'), zone(55, 25, 82, 9, '矩形上緣'), zone(55, 70, 82, 9, '矩形下緣'), candle(76, 60, 43, 34, 69, 'up', '整理 K'), candle(108, 42, 61, 33, 69, 'down', '整理 K'), note(58, 95, '下破確認；上破失效')],
  ),
  pennant: illustration(
    '三角旗形示意',
    '左側是明確旗桿，右側是較短小的收斂整理，文字標出必須同時具有旗桿與小三角。',
    [trend(18, 83, 56, 20, '旗桿'), trend(60, 30, 137, 52, '整理上緣'), trend(60, 75, 137, 52, '整理下緣'), candle(82, 50, 59, 42, 68, 'down', '整理 K'), candle(112, 57, 48, 43, 63, 'up', '整理 K'), note(25, 97, '旗桿＋短小收斂')],
  ),
  'rising-wedge': illustration(
    '上升楔形示意',
    '上下兩條邊界都向上且逐步收斂，下緣較陡，文字標示等待實際離開。',
    [trend(20, 68, 138, 24, '上升上緣'), trend(20, 91, 138, 27, '較陡下緣'), candle(55, 61, 48, 39, 72, 'up', '區內 K'), candle(95, 42, 53, 31, 62, 'down', '區內 K'), note(25, 15, '離開邊界後才確認')],
  ),
  'falling-wedge': illustration(
    '下降楔形示意',
    '上下兩條邊界都向下且逐步收斂，上緣較陡，文字標示等待實際離開。',
    [trend(20, 14, 138, 77, '較陡上緣'), trend(20, 38, 138, 80, '下降下緣'), candle(55, 46, 58, 32, 67, 'down', '區內 K'), candle(95, 63, 52, 43, 72, 'up', '區內 K'), note(25, 97, '離開邊界後才確認')],
  ),
  'broadening-top': illustration(
    '擴散頂示意',
    '上下邊界由左向右擴張，折線交替形成更高高點與更低低點，文字標示高檔背景。',
    [trend(25, 46, 138, 14, '向上擴張'), trend(25, 59, 138, 91, '向下擴張'), trend(30, 52, 58, 30, '高點一'), trend(58, 30, 82, 70, '低點一'), trend(82, 70, 108, 20, '高點二'), trend(108, 20, 133, 84, '低點二'), note(25, 99, '高檔背景需另核對')],
  ),
  'broadening-bottom': illustration(
    '擴散底示意',
    '上下邊界由左向右擴張，折線交替形成更高高點與更低低點，文字標示低檔背景。',
    [trend(25, 46, 138, 14, '向上擴張'), trend(25, 59, 138, 91, '向下擴張'), trend(30, 52, 58, 72, '低點一'), trend(58, 72, 82, 31, '高點一'), trend(82, 31, 108, 84, '低點二'), trend(108, 84, 133, 20, '高點二'), note(25, 99, '低檔背景需另核對')],
  ),
  'volume-expansion': illustration(
    '量能擴張示意',
    '數根低量實心柱與一根較高條紋成交量柱，虛線標示事前固定比較窗統計量。',
    [volume(35, 20, '比較窗量柱'), volume(62, 28, '比較窗量柱'), volume(89, 66, '目標日高量'), trend(25, 65, 138, 65, '事前固定統計量'), note(25, 15, '目標日不放入比較窗')],
  ),
  'volume-contraction': illustration(
    '量能收縮示意',
    '數根較高條紋成交量柱與一根明顯較低實心成交量柱，虛線標示事前固定比較窗統計量。',
    [volume(35, 61, '比較窗量柱'), volume(62, 49, '比較窗量柱'), volume(89, 15, '目標日低量'), trend(25, 45, 138, 45, '事前固定統計量'), note(25, 15, '目標日不放入比較窗')],
  ),
  'effort-vs-result': illustration(
    '努力與結果示意',
    '同時呈現一根 K 線與一根成交量柱，文字列出範圍、實體、收盤位置及區域穿越的並列觀察。',
    [candle(52, 70, 35, 22, 79, 'up', '價格結果'), volume(108, 62, '成交量'), note(20, 16, '並列記錄：量、實體、範圍、收盤位置'), note(20, 91, '不把配對擴寫為意圖')],
  ),
  'volume-climax-risk': illustration(
    '量能高潮風險示意',
    '一根範圍很大的 K 線搭配一根明顯較高的條紋成交量柱，文字標示需要額外驗證。',
    [candle(54, 76, 24, 13, 89, 'up', '相對大範圍'), volume(108, 74, '相對高量'), note(20, 15, '需要額外驗證'), note(20, 96, '不是最高或最低點的保證')],
  ),
  'low-liquidity-distortion': illustration(
    '低流動性扭曲示意',
    '稀疏分布的小成交量柱、跳躍的折線與文字「價差、深度、成交頻率」共同表示日 K 資料不足。',
    [volume(37, 10, '零星成交'), volume(65, 16, '零星成交'), volume(94, 8, '零星成交'), trend(28, 72, 58, 39, '跳價'), trend(58, 39, 91, 69, '跳價'), trend(91, 69, 126, 30, '跳價'), note(22, 16, '還需價差、深度、成交頻率')],
  ),
  'failed-signal': illustration(
    '失敗訊號守門示意',
    '一張有勾選框的「事前觸發」與一張有叉號的「事前失效」文字卡，箭頭指向停止判讀。',
    [zone(20, 20, 48, 24, '事前觸發'), zone(88, 20, 48, 24, '事前失效'), trend(44, 55, 112, 75, '核對原先計畫'), note(23, 34, '觸發'), note(91, 34, '失效'), note(44, 90, '不可事後改寫規則')],
  ),
  'insufficient-evidence': illustration(
    '證據不足守門示意',
    '三個有斜線填充的缺失欄位框，分別標示比較窗、公司行動與流動性資料，箭頭指向停止判讀。',
    [zone(20, 24, 34, 22, '比較窗缺失'), zone(64, 24, 34, 22, '公司行動缺失'), zone(108, 24, 34, 22, '流動性缺失'), trend(80, 53, 80, 75, '停止判讀'), note(47, 92, '缺失本身就是答案')],
  ),
};
