# 台股 K 線互動學習網站設計規格

- 狀態：五節設計已核准，等待規格檔案複核
- 核准日期：2026-08-11
- Repository：`https://github.com/eric861129/taiwan-stock-candlestick-guide`
- 預設分支：`main`
- 部署目標：GitHub Pages
- 既有教材設計：[台股 K 線新手完整筆記設計規格](2026-08-10-taiwan-stock-candlestick-guide-design.md)
- 架構決策：[ADR-0001：使用純 GitHub Pages 架構提供互動教材與盤後型態比對](../../adr/0001-use-static-github-pages-architecture.md)

## 1. 目的

把現有 20 章 Markdown 教材改造成適合初學者循序學習的互動式靜態網站，並加入「輸入台股代碼，將最近盤後日 K 與教學型態卡逐項比對」功能。

網站協助讀者辨識可觀察條件、背景限制與失效方式，不預測未來價格。分析結果稱為「型態相似度分析」，不得包裝成上漲機率、買賣訊號或 AI 預測。

## 2. 產品原則

1. 先教判讀流程，再提供型態名稱。
2. 先檢查資料可靠性，再執行型態比對。
3. 可以同時有多個候選，也可以沒有明顯型態。
4. 所有自動判讀都必須能說明成立、未成立與失效條件。
5. 教學卡數量不等於第一版可自動比對數量。
6. 只使用盤後完成日 K，不宣稱即時行情。
7. 不為了提高互動感加入排名、連續登入或交易刺激設計。

## 3. 主要讀者與成功結果

主要讀者是剛開始接觸 K 線，或認得型態名稱但尚未建立固定判讀流程的台股投資者。

完成五階段學習後，讀者應能：

1. 正確描述開、高、低、收、成交量與時間週期。
2. 區分圖表事實、可能解釋與尚未獲得的證據。
3. 先檢查結構、位置與量價背景，再討論型態。
4. 理解型態名稱不是未來方向保證。
5. 寫出觸發、失效、風險與放棄交易條件。
6. 使用分析工具核對規則，而不是照著分數直接下單。

## 4. 範圍

### 4.1 第一版納入

- VitePress、Vue 3 與 TypeScript 靜態網站。
- 既有 20 章與附錄的完整內容。
- 五階段教練式學習地圖。
- 章節完成狀態、階段測驗與本機學習進度。
- 所有核准教學型態卡的互動瀏覽頁。
- 上市與上櫃普通股代碼搜尋。
- 最近 120 個交易日原始 OHLCV 靜態資料。
- 預設以最近 60 個交易日執行短窗 K 線型態比對。
- 0 至 3 個型態候選、規則符合度、缺少證據及失效說明。
- TWSE OpenAPI、TPEx 官方介面與公司行動資料的盤後更新流程。
- GitHub Actions 驗證、資料更新及 GitHub Pages 部署。

### 4.2 第一版排除

- 未來價格線、漲跌預測、目標價與買賣建議。
- AI、機器學習或黑箱圖形辨識。
- 盤中、即時、分 K 或逐筆行情。
- ETF、ETN、權證、興櫃、期貨、選擇權與加密貨幣。
- 登入、雲端同步、社群排名、連續登入與推播。
- 使用者上傳截圖後進行影像辨識。
- 在第一版自動比對結構型態、流動性扭曲與失敗訊號。
- 由瀏覽器直接呼叫 TWSE 或 TPEx 官方 API。
- 任意歷史截止日選擇器；資料格式先保留未來擴充能力。

## 5. 資訊架構

### 5.1 主要導覽

1. **開始學習**：首頁與目前建議下一步。
2. **學習地圖**：五階段、章節能力與階段測驗。
3. **完整章節**：既有 20 章與附錄。
4. **型態卡**：完整教學卡目錄與篩選。
5. **股票型態比對**：輸入股票代碼、查看 K 線與候選結果。
6. **附錄速查**：保留既有快速查找用途。

所有章節從一開始即可開啟。學習地圖提供推薦順序，但不鎖住內容。

### 5.2 五階段成長旅程

| 階段 | 章節 | 能力焦點 |
| --- | --- | --- |
| 1. 看懂一根 K 線 | 第 1～4 章 | OHLC、影線、週期、成交量與台股基礎 |
| 2. 看懂市場背景 | 第 5～8 章 | 結構、位置、突破、缺口與多時間週期 |
| 3. 核對型態證據 | 第 9～12 章 | 單根、多根、結構型態與量價限制 |
| 4. 把判讀變成計畫 | 第 13～18 章 | 指標、情境、失效、風險與心理紀錄 |
| 5. 獨立完成判讀 | 第 19～20 章 | 遮圖練習與十組綜合驗收 |

每一階段顯示：已完成章節、目前能力、下一步與階段測驗入口。

### 5.3 章節互動模板

既有教材內容不重寫成碎片化短文，而是在章節外層加入一致的學習輔助：

1. 本章會解決的問題。
2. 完成後能做到什麼。
3. 白話觀念與精確定義。
4. 人工圖例與歷史案例。
5. 固定判讀流程提醒。
6. 可操作練習與延後揭露答案。
7. 本章常見誤判。
8. 完成章節與下一步。

章節完成由讀者主動確認，必要練習完成後才顯示建議完成狀態，但不阻止讀者繼續閱讀。

### 5.4 階段測驗與進度

- 每階段 5 題，答對 4 題通過。
- 可以不限次數重試。
- 重試後顯示觀念解析，不顯示排名。
- 不使用每日任務、連續登入或懲罰性歸零。
- 進度只儲存在瀏覽器 `localStorage`。
- 支援 JSON 匯出與匯入；匯入前驗證 Schema 版本與欄位。
- 未來資料格式改版時，以版本化 migration 保留相容性。

## 6. 視覺與互動語言

### 6.1 整體風格

採「溫暖教練」風格：大量留白、柔和中性色、清楚層級與有限的強調色。介面不模仿交易軟體的高壓資訊牆。

首頁使用教練式成長路徑；學習地圖使用五階段旅程；型態卡使用雙層翻面教學卡；比對結果使用引導式分析結果。

### 6.2 型態卡互動

- 正面：名稱、簡化圖、辨識重點與適用背景。
- 背面：必要條件、常見誤判、失效方式與對應章節。
- 使用明確按鈕翻面，不能只靠滑鼠移入。
- 翻面狀態支援鍵盤、觸控與螢幕閱讀器。
- 使用者選擇減少動態效果時，以無旋轉的內容切換取代動畫。

### 6.3 K 線圖

第一版採自有 Vue SVG 圖表元件，不引入大型看盤圖表套件。圖表提供：

- 最近 60 根日 K 與成交量。
- 日期、OHLCV 的滑鼠與鍵盤焦點提示。
- 型態候選實際使用區間的視覺標記。
- 公司行動警告標記。
- 等價文字摘要與可展開 OHLCV 表格。

圖表右側不繪製任何未來預測線。

## 7. 型態卡目錄

### 7.1 目錄正規化

現有附錄 A 有 28 個表格列。將方向不同且教學圖與條件不同的五組合併列拆成獨立卡片後，共有 33 個候選項目；其中「量度幅度」是風險情境工具，不是可觀察型態，因此保留在教材與速查內容，不列入型態卡。最終目錄為 32 張教學卡。

目錄分類為：

- 單根與描述型卡：7 張。
- 雙根與三根組合卡：10 張。
- 結構型態卡：8 張。
- 量價、流動性與守門卡：7 張。

### 7.2 第一版可比對範圍

第一版自動比對下列 17 張短窗卡：

1. 相對長實體
2. 相對小實體
3. 十字線
4. 錘子形
5. 射擊之星形
6. 近似光頭光腳
7. 收盤位置／拒絕／猶豫
8. 多頭外包線
9. 空頭外包線
10. 多頭母子線
11. 空頭母子線
12. 穿透形
13. 烏雲形
14. 晨星形
15. 暮星形
16. 連續三根推進
17. 連續三根下跌

其餘卡片仍可閱讀，但清楚標為「教學卡，第一版不參與自動比對」。低流動性扭曲需要價差、深度、成交頻率與成交衝擊等資料，不能只靠日 OHLCV 可靠辨識。

### 7.3 唯一規則來源

型態卡目錄是 UI 與比對引擎共用的結構化來源。附錄 A 保留原路徑與導覽責任，但改由同一份目錄資料呈現，不再另存一份可能漂移的型態定義表。

方向不同但幾何關係相同的卡片共用型態規則族，例如多頭與空頭外包線共用外包幾何，再套用方向條件。

### 7.4 版本化卡片清冊

32 張卡使用下列 canonical ID，ID 發布後不得因文案調整而改變：

```text
relative-long-body, relative-small-body, doji, hammer, shooting-star,
near-marubozu, close-rejection-indecision,
bullish-engulfing, bearish-engulfing, bullish-harami, bearish-harami,
piercing-line, dark-cloud-cover, morning-star, evening-star,
three-advancing-candles, three-falling-candles,
range, triangle-consolidation, flag-consolidation, double-top, double-bottom,
head-and-shoulders-top, head-and-shoulders-bottom, false-breakout,
volume-expansion, volume-contraction, effort-vs-result, volume-climax-risk,
low-liquidity-distortion, failed-signal, insufficient-evidence
```

第一版可比對卡必須使用以下規則族與最小資料量：

| 卡片 | 規則族 | 最少 K 數 | 固定參數或資料依賴 |
| --- | --- | ---: | --- |
| relative-long-body／relative-small-body | `relative-body-size` | 21 | 目標 K 不放入前 20 根非零實體比較窗；上／下四分位 |
| doji | `doji` | 1 | 開收差不超過比較單位 |
| hammer／shooting-star | `single-candle-wick-geometry` | 1 | 附錄 A 的實體位置、兩倍影線與比較單位公式 |
| near-marubozu | `near-marubozu` | 1 | 上下影線各不超過比較單位 |
| close-rejection-indecision | `candle-descriptors` | 1 | 收盤位置、影線比例及小實體條件 |
| bullish-engulfing／bearish-engulfing | `engulfing-body` | 2 | 相反方向非零實體、只比較實體包含關係 |
| bullish-harami／bearish-harami | `harami-body` | 22 | 前根使用前 20 根比較窗判定相對長實體 |
| piercing-line／dark-cloud-cover | `midpoint-penetration` | 2 | 採「越過前根極值或前收」缺口慣例；公司行動敏感 |
| morning-star／evening-star | `three-candle-star` | 23 | 第一根使用前 20 根比較窗；第三根穿越第一根中點 |
| three-advancing-candles／three-falling-candles | `three-candle-sequence` | 3 | 依序收盤、實體方向與開盤在前根實體內或一個比較單位內 |

清冊 Schema 必須驗證恰有 32 個不重複 ID、恰有 17 個 `mvp` 卡，且每張卡都能追溯到附錄 A 的來源列。`mvp` 卡的規則族、最小 K 數、最低門檻與規則綁定均為必填。

## 8. 型態卡與比對資料模型

以下介面描述資料契約，實作計畫可以調整檔案切分，但不能改變欄位語意：

```ts
type MatchSupport = 'mvp' | 'catalog-only' | 'guardrail';
type RuleGroup = 'required' | 'context' | 'supporting' | 'invalidating';
type RuleState = 'met' | 'not-met' | 'unavailable';

interface PatternRuleBinding {
  ruleId: string;
  group: RuleGroup;
  weight: number;
  parameters: Record<string, number | string | boolean>;
  teachingLabel: string;
}

interface PatternMatcherDefinition {
  ruleFamilyId: string;
  minimumBars: number;
  minimumScore: number;
  rules: PatternRuleBinding[];
}

interface CandleFeatures {
  bodyLow: number;
  bodyHigh: number;
  bodySize: number;
  effectiveBodySize: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  closeLocation: number | null;
  comparisonUnit: number;
}

interface CandlestickFeatures {
  candles: CandleFeatures[];
  relativeBodyPercentile: number | null;
  relativeVolumeToMedian20: number | null;
  priorStructure: 'rising' | 'falling' | 'range-or-transition' | 'unavailable';
  distanceToPrior20HighInAtr: number | null;
  distanceToPrior20LowInAtr: number | null;
  intersectingCorporateActions: CorporateAction[];
}

interface RuleFamilyDefinition {
  id: string;
  version: number;
  evaluate(
    features: Readonly<CandlestickFeatures>,
    binding: Readonly<PatternRuleBinding>,
  ): RuleEvaluation;
}

interface PatternCardDefinition {
  id: string;
  slug: string;
  nameZhTw: string;
  nameEn: string;
  aliases: string[];
  category: string;
  matchSupport: MatchSupport;
  matcher?: PatternMatcherDefinition;
  dataRequirements: string[];
  oneSentenceMeaning: string;
  background: string[];
  commonMisreads: string[];
  invalidationGuidance: string[];
  lessonLinks: string[];
  sourceNotes: string[];
}

interface RuleEvaluation {
  ruleId: string;
  label: string;
  group: RuleGroup;
  state: RuleState;
  weight: number;
  explanation: string;
}

interface PatternMatchResult {
  cardId: string;
  score: number;
  label: '高度符合' | '部分符合';
  dataCompleteness: number;
  analyzedFrom: string;
  analyzedTo: string;
  evaluations: RuleEvaluation[];
  warnings: string[];
}

interface AnalysisContext {
  snapshotVersion: number;
  snapshotHash: string;
  market: 'TWSE' | 'TPEx';
  cutoffDate: string;
  freshness: 'fresh' | 'one-session-behind' | 'stale' | 'unknown';
  timeframe: '1d';
  analyzedFrom: string;
  analyzedTo: string;
  evaluatedCardCount: number;
  unavailableCardIds: string[];
  affectedRuleIds: string[];
  warnings: string[];
}

type AnalysisResult =
  | { status: 'matched'; context: AnalysisContext; matches: PatternMatchResult[] }
  | { status: 'no-clear-pattern'; context: AnalysisContext; matches: [] }
  | { status: 'insufficient-evidence'; context: AnalysisContext; reasonCodes: string[] }
  | {
      status: 'unavailable';
      reason: 'not-found' | 'unsupported-security' | 'load-error' | 'schema-error';
      message: string;
    };
```

「高度符合」與「部分符合」只描述規則符合度，不對應未來報酬機率。

`mvp` 卡的 required 規則群總權重固定為 50 分 gate；context 規則權重合計必須為 30，supporting 規則權重合計必須為 20，invalidating 規則只作排除且權重為 0。清冊驗證器會阻擋權重不合計、重複規則 ID、缺少規則族或缺少最低門檻的卡片。

## 9. 比對規則

### 9.1 共用特徵定義

- `bodyLow = min(open, close)`；`bodyHigh = max(open, close)`。
- `bodySize = abs(close - open)`；`effectiveBodySize = max(bodySize, comparisonUnit)`。
- `range = high - low`；range 為零時，收盤位置與影線比例標為 unavailable。
- `upperWick = high - bodyHigh`；`lowerWick = bodyLow - low`。
- `closeLocation = (close - low) / range`。
- 相對實體大小只比較目標 K 之前 20 根完成且非零的實體，目標 K 不加入比較窗。
- 相對成交量以目標 K 之前 20 根完成 K 的成交量中位數為分母，目標 K 不加入比較窗。
- 背景結構沿用第 5 章的 `k=1` 確認規則；最近兩組已確認波峰與波谷皆墊高為 rising，皆降低為 falling，其餘為 range-or-transition。沒有足夠確認點時為 unavailable。
- 位置輔助以型態開始前 20 根最高／最低區域計算，距離用前 14 根 ATR 正規化；比較窗或 ATR 不足時為 unavailable。
- 所有特徵只使用分析截止日及以前資料，不得讀取右側未發生 K 線。

規則族只讀取這組版本化特徵與卡片 bindings。教材顯示的公式、引擎判斷與測試 fixture 必須引用相同常數及參數，不能在 Vue 元件中再定義一份。

### 9.2 分析流程

1. 依股票索引驗證代碼、市場與證券類型。
2. 驗證資料日期、完整性、OHLCV 關係與公司行動。
3. 從最近 60 根完成日 K 計算實體、範圍、影線、收盤位置、相對量能與背景方向。
4. 只執行資料需求已滿足的第一版型態規則族。
5. 任一必要條件未成立，該卡不得成為候選。
6. 任一失效條件成立，該卡不得成為候選。
7. 所有必要條件成立時得到 50 分基礎分；背景條件最多 30 分，輔助條件最多 20 分。
8. 不可取得的選擇性條件得到 0 分且不重新正規化，避免缺資料反而提高分數。
9. 分數四捨五入至最接近的 5 分，再套用各卡經案例校準的最低門檻。
10. `dataCompleteness` 是可評估規則權重占 100 分的比例；依總分、背景分、資料完整度與卡片 ID 進行固定排序。
11. 顯示實際通過門檻的前 0 至 3 張卡，不足三張時不得補入低於門檻的結果。

### 9.3 結果語意

- **型態候選**：必要條件成立，且規則符合度通過該卡最低門檻。
- **無明顯型態**：資料正常，但沒有型態通過門檻。
- **證據不足**：資料缺漏或干擾使必要判讀無法完成。
- **系統無法分析**：載入、Schema 或程式錯誤。

每個候選必須顯示成立條件、尚未成立的背景／輔助條件、失效方式、分析區間與對應課程。

至少一張卡可完整評估但沒有候選通過門檻時，回傳「無明顯型態」，並明示實際可評估卡數。沒有任何 MVP 卡能完成必要判讀時，回傳「證據不足」。載入或 Schema 錯誤使用 `unavailable`，不得降級成前兩種教學結果。

各卡 `minimumScore` 必須經核准案例集校準並落在 60～75 分；分數達 80 分為「高度符合」，介於該卡最低門檻與 75 分為「部分符合」。低於最低門檻不列入候選。

### 9.4 公司行動

除權、除息、減資或分割事件落在候選使用區間時：

- 標記事件日期與資料來源。
- 停用跳空、報酬與價格連續性相關規則。
- 不影響純 K 棒幾何規則。
- 若該卡的必要條件依賴被停用規則，該卡回傳不可用，不以其他條件補分。

## 10. 市場資料架構

### 10.1 決策

官方 API 是資料來源，但瀏覽器不直接呼叫官方 API。GitHub Actions 於盤後取得並驗證資料，GitHub Pages 只提供同站台的版本化靜態資料。

原因：截至 2026-08-11，TWSE OpenAPI 的 `STOCK_DAY_ALL` 沒有股票代碼參數，只提供單一交易日的上市市場資料；加入 `Code` 查詢參數不會篩選結果，回應也未提供 GitHub Pages 跨來源讀取所需的 CORS 標頭。它仍適合由 GitHub Actions 每日批次取得資料。

官方入口：

- [TWSE OpenAPI](https://openapi.twse.com.tw/)
- [TWSE OpenAPI Swagger 規格](https://openapi.twse.com.tw/v1/swagger.json)
- [TWSE 上市個股日成交資訊](https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL)
- [TWSE 有價證券集中交易市場開休市日期](https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule)
- [TWSE 個股日成交歷史資料](https://www.twse.com.tw/zh/trading/historical/stock-day.html)
- [TPEx OpenAPI](https://www.tpex.org.tw/openapi/)
- [TPEx OpenAPI Swagger 規格](https://www.tpex.org.tw/openapi/swagger.json)
- [TPEx 上櫃股票行情](https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes)
- [TPEx 上櫃個股歷史行情](https://www.tpex.org.tw/zh-tw/mainboard/trading/info/stock-pricing.html)

### 10.2 支援市場

- TWSE 上市普通股。
- TPEx 上櫃普通股。
- 依官方證券基本資料判斷類型，不只用代碼格式猜測。
- ETF、ETN、權證、興櫃及其他非普通股不得進入支援索引。

### 10.3 初始資料與每日增量

1. 首次建置使用現有官方歷史介面建立最近 120 個交易日基準快照。
2. 平日台北時間 17:30 後由 GitHub Actions 嘗試更新；實際資料日期仍以官方回傳為準。
3. TWSE 使用 `STOCK_DAY_ALL` 取得單一交易日全市場資料。
4. TPEx 使用 `tpex_mainboard_daily_close_quotes` 取得單一交易日上櫃市場資料。
5. 更新公司行動與證券基本資料。
6. 追加新交易日，依股票裁切至最近 120 個交易日。
7. 沒有新交易日時正常結束，不產生重複資料或重新部署。
8. 任一市場的關鍵驗證失敗時，整次不部署，保留上一個成功站台。

### 10.4 靜態產物

```ts
interface MarketDataManifest {
  schemaVersion: number;
  sourceCommit: string;
  snapshotHash: string;
  generatedAt: string;
  markets: Record<'TWSE' | 'TPEx', {
    cutoffDate: string;
    expectedCutoffDate: string;
    calendarSourceUrl: string;
    calendarValidThrough: string;
    tradingSessions: string[];
  }>;
  symbols: StockIndexEntry[];
}

interface StockIndexEntry {
  code: string;
  name: string;
  market: 'TWSE' | 'TPEx';
  securityType: 'common-stock';
  dataPath: string;
  firstDate: string;
  lastDate: string;
  barCount: number;
}

interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeShares: number;
  transactionCount?: number;
  sourcePrecision: number;
  comparisonUnit: number;
}

interface CorporateAction {
  date: string;
  type: 'cash-dividend' | 'stock-dividend' | 'capital-reduction' | 'split' | 'other';
  affectsPriceContinuity: boolean;
  sourceUrl: string;
  verifiedAt: string;
}

interface StockSnapshot {
  schemaVersion: number;
  code: string;
  name: string;
  market: 'TWSE' | 'TPEx';
  securityType: 'common-stock';
  priceMode: 'raw';
  currency: 'TWD';
  comparisonUnitPolicy: {
    version: number;
    effectiveFrom: string;
    sourceUrl: string;
  };
  bars: OhlcvBar[];
  corporateActions: CorporateAction[];
  sourceUrls: string[];
}
```

`comparisonUnit` 取來源精度與各 OHLC 價格所適用官方升降單位中的最大值，避免跨價格級距時使用過小容忍值。`comparisonUnitPolicy` 固定規則版本、有效日期與官方來源；缺少來源精度、比較單位或公司行動來源時，依賴該欄位的卡片回傳 `unavailable`，不得猜測。

每檔股票使用內容雜湊檔名，例如 `data/stocks/2330.a81f32.json`。manifest 指向實際檔案，避免 GitHub Pages 或瀏覽器繼續使用舊快取。

同一部署另產生壓縮的完整成功快照，供下一次增量更新使用；若無法取得或驗證，才重新建立歷史資料。每日資料產物不提交進 `main`。

### 10.5 發布前資料驗證

- 股票代碼與市場組合不得重複。
- 日期必須遞增且不得重複。
- 最高價不得低於開盤、收盤與最低價。
- 最低價不得高於開盤、收盤與最高價。
- 價格不得為負值。
- 成交量不得為負值；停牌或無成交可為零。
- 最新日期不得比已發布版本更早。
- 任一先前有效普通股消失但沒有官方下市、停止交易或類型變更證據時，阻擋發布。
- 當日有資料或有官方停止交易原因的既有股票必須達前一版有效股票的 98%；低於 98% 時阻擋發布。
- 普通股總數比前一版減少超過 1% 時，即使都有個別事件資料仍需人工核准。
- JSON 必須符合版本化 Schema。
- TWSE、TPEx 截止日期不一致時不得假裝為同一資料日。

### 10.6 資料截止日與新鮮度

- TWSE 與 TPEx 共用 TWSE 公布的臺灣有價證券集中交易市場開休市日曆作為預期交易日基準，manifest 至少涵蓋過去 10 個與未來 90 個交易日；兩個市場的實際資料截止日仍分別驗證。若有市場個別停止交易公告，必須在 provenance 中留下官方例外來源。
- 台北時間交易日 17:30 前，expected cutoff 是前一個開市日；17:30 起是當日。
- 資料工作於平日 17:30 首次執行，20:30 再執行一次相同且可重入的更新；已有同日期快照時直接 no-op。
- 實際截止日等於 expected cutoff 為 `fresh`，落後一個交易日為 `one-session-behind`，落後兩個以上為 `stale`。
- 交易日曆不足以涵蓋目前日期時為 `unknown`，不得顯示資料最新。
- 一日落後可分析但顯示黃色提醒；兩日以上仍可對舊快照做規則比對，但使用紅色提醒，標題只能寫「截至 YYYY-MM-DD 的型態」，不得稱為目前型態。
- 兩個市場若官方開休市狀態不同，各自計算 expected cutoff；同為開市卻只有一個市場更新時，不發布混合版本。

### 10.7 資料來源與引用追溯

- manifest 記錄每個市場的官方端點、取得時間、資料截止日、Schema 版本與內容雜湊。
- 個股快照保留市場、原始價格模式與相關公司行動識別，不移除判讀所需來源資訊。
- 型態結果連回採用規則的型態卡與教材章節；市場資料來源和教學判讀來源分開呈現。
- 既有章節的證據等級、官方來源、查核日期與圖表 metadata 繼續有效，不由互動介面另寫一套說法。
- 官方契約變更時先更新 parser、固定樣本與 Schema 測試，通過後才能發布新版資料。

## 11. 前端與程式邊界

VitePress 以 repository 根目錄的 Markdown 為內容來源，保留既有章節路徑；內部規格、測試與不應公開的開發文件由 `srcExclude` 排除。

GitHub Pages 的 VitePress `base` 固定為 `/taiwan-stock-candlestick-guide/`；站內導覽、動態載入資料與資產網址都必須使用 base-aware 路徑，不能假設部署在網域根目錄。

預計邊界如下：

```text
.vitepress/                 VitePress 設定、主題與導覽
src/components/            首頁、學習地圖、型態卡、圖表與分析結果元件
src/domain/patterns/        型態卡目錄、規則族、特徵與比對結果
src/domain/market-data/     manifest、股票快照與資料驗證
src/domain/learning/        進度、測驗、匯出匯入與版本遷移
public/data/                CI 產生的部署資料，不納入每日 Git commit
chapters/                   既有教材 Markdown
tools/                      既有 Python 圖表、資料與內容驗證工具
```

重要隔離：

- 教學呈現不直接實作規則計算。
- 規則引擎不依賴 Vue 元件。
- 市場資料解析不依賴型態規則。
- `localStorage` 由學習進度模組集中管理。
- 結果元件只接收已完成的分析結果，不自行重算分數。

## 12. 錯誤狀態與新手保護

| 狀態 | 行為 |
| --- | --- |
| 最新資料正常 | 開放完整分析 |
| 落後一個交易日 | 黃色提醒，結果明示截止日 |
| 落後兩個交易日以上 | 紅色警告，不稱為「目前型態」 |
| K 線數量不足 | 只執行資料需求已滿足的卡片 |
| 公司行動干擾 | 停用受影響規則並說明 |
| JSON 或 Schema 錯誤 | 不執行分析 |
| 沒有候選通過門檻 | 顯示無明顯型態 |
| 必要證據缺漏 | 顯示證據不足 |

任何錯誤都不得偷偷改用示範資料、舊格式資料或猜測結果。

分析頁固定顯示：

> 本工具比較歷史價格資料與教學型態規則，不預測未來價格，也不構成投資建議。

禁止使用「建議買進」、「建議賣出」、「上漲機率」、「下跌機率」、「AI 信心度」、「必漲」或「必跌」。

## 13. 安全、隱私與無障礙

### 13.1 安全與隱私

- 股票輸入先透過支援索引解析，不直接拼接路徑。
- API 資料經 Schema 驗證後才能進入部署產物。
- 股票名稱與外部資料只以文字呈現，不使用未消毒的 HTML。
- 第一版不使用登入、Cookie、廣告追蹤或外部分析工具。
- 學習進度只存在本機，不包含身分資料。
- GitHub Actions 使用最低必要權限，第三方 Actions 固定版本或提交雜湊。
- Repository 與 GitHub Pages 不保存私密 API 金鑰。

### 13.2 無障礙

- 驗收基準為 WCAG 2.2 AA。
- 所有搜尋、卡片、測驗與分析流程可用鍵盤完成。
- 紅漲綠跌之外，同時提供文字、箭頭、空心／實心或其他非色彩線索。
- 型態卡切換狀態提供螢幕閱讀器文字。
- 圖表提供摘要與資料表。
- 尊重 `prefers-reduced-motion`。
- 行動版操作區具有足夠觸控尺寸，不造成水平捲動。
- 焦點順序與可見焦點不得因卡片翻面、路由切換、錯誤訊息或結果更新而遺失。

## 14. 測試策略

### 14.1 規則引擎

每張第一版可比對卡至少準備：

- 5 組明確符合案例。
- 5 組臨界或容易誤判案例。
- 5 組不符合案例。
- 至少三分之一保留為門檻調整時未看過的驗證案例。

必要條件、失效條件、資料不可用、公司行動與分數邊界都必須有測試。規則與失效分支完整覆蓋，整體程式碼覆蓋率至少 85%。案例只驗證規則一致性，不宣稱獲利能力。

另以清冊測試固定：32 個 canonical ID、17 張 MVP 卡、每張卡唯一對應附錄 A 來源列、MVP matcher 欄位完整、context／supporting 權重分別合計 30／20。

### 14.2 資料管線

- 固定官方樣本測試解析、日期、單位、缺值與特殊註記。
- Pull Request 不依賴線上 API。
- 排程更新執行線上資料契約與完整性驗證。
- 民國／西元日期、千分位、`--`、零成交、重複交易日、回退日期與市場缺漏都必須有測試。

### 14.3 網站與內容

保留現有 Python 測試與教材驗證，新增：

- TypeScript 型別檢查與 ESLint。
- Vitest 單元與元件測試。
- Playwright 桌面、手機與鍵盤主要流程。
- 自動化無障礙掃描。
- VitePress 正式建置。
- 章節連結、SVG、詞彙與 GitHub Pages 子路徑驗證。

正式發布前不得有嚴重或重大無障礙問題；Lighthouse Accessibility 至少 90。首頁不預載全部行情或分析引擎，每次搜尋只下載股票索引與該股票資料。

無障礙 gate 的具體做法：

- Playwright 搭配 axe-core，WCAG 2.2 A／AA 規則中的 `critical` 與 `serious` 必須為零。
- `moderate` findings 必須逐項處理；例外只能放在版本控制內的 allowlist，包含理由、影響範圍與到期日。
- Playwright 鍵盤案例覆蓋 skip link、主要導覽、股票搜尋、K 線逐根焦點、卡片翻面、測驗、匯出匯入及錯誤後焦點位置。
- 測試 `prefers-reduced-motion` 與 200% 縮放下的主要流程。
- 發布前人工執行 NVDA＋Firefox 與 Narrator＋Edge 矩陣，核對頁面地標、表單標籤、卡片狀態、圖表摘要、結果 live region 與錯誤訊息。
- Lighthouse 分數是補充門檻，不能取代 axe、鍵盤與螢幕閱讀器驗收。

## 15. GitHub Actions 與發布

規劃三條工作流程：

1. `verify.yml`
   - 支援 `pull_request` 與 `workflow_call`。
   - 執行內容、程式、測試與建置檢查，不連線取得正式行情。
2. `update-market-data.yml`
   - 台北時間平日 17:30、20:30 與手動觸發。
   - 先解析當下 `main` commit，再呼叫 reusable `deploy-pages.yml`；它本身不跨 workflow 傳遞未驗證檔案。
3. `deploy-pages.yml`
   - 支援 `push main`、`workflow_call` 與帶 rollback artifact ID 的 `workflow_dispatch`。
   - 固定 checkout 指定 `source_sha`，先呼叫 `verify.yml`，再取得上一個成功快照、同步官方資料、驗證、建置及部署。

每次成功產生的資料 artifact 名稱為 `market-snapshot-<cutoff>-<short-source-sha>`，內容固定包含：

```text
snapshot.tar.gz
manifest.json
provenance.json
SHA256SUMS
```

`manifest.json` 必須記錄完整 `sourceCommit`、市場截止日與 snapshot hash；`SHA256SUMS` 驗證所有部署資料。Pages artifact 只能由同一次編排中的已驗證 source commit 與 market snapshot 建立，避免程式與資料版本交錯。

任一步驟在 `deploy-pages` 前失敗時不呼叫 Pages deployment，線上站台保持上一版。最近 30 天成功 snapshot artifact 保留供人工 rollback；rollback 會驗證 digest、checkout artifact 記錄的 source commit，並以該組程式與資料原子重建後發布，不把舊資料任意配上新版 Schema。

部署使用 GitHub Pages Environment、最小權限與 concurrency 控制，同一時間只允許一個正式部署。每日行情不提交進 `main`。

## 16. 驗收情境

1. 輸入 `2330`，確認名稱、市場、資料截止日、K 線與 0～3 個可解釋候選。
2. 輸入不存在代碼，得到找不到股票而非載入錯誤。
3. 輸入 ETF 或其他排除類型，得到不支援原因。
4. 正常資料沒有候選時，顯示無明顯型態。
5. 必要欄位缺漏時，顯示證據不足而非低分候選。
6. 公司行動落在分析窗時，受影響規則被停用並可見。
7. 資料落後時，結果明示截止日與新鮮度警告。
8. 休市日、17:30 前後、單一市場延遲及交易日曆過期時，新鮮度結果符合定義。
9. 破損快照、digest 不符或 source commit 不符時，不會進入分析或正式部署。
10. 鍵盤與手機可以完成搜尋、看圖、翻卡與階段測驗。
11. 學習進度重新開啟後保留，並可成功匯出、清空後匯入。
12. GitHub Pages repository 子路徑下，首頁、章節、資產與重新整理均正常。
13. 指定一個保留 snapshot 執行 rollback，部署後的 source commit、snapshot hash 與內容一致。

## 17. 完成定義

- 20 章完成五階段學習路徑整合。
- 32 張教學型態卡都能瀏覽。
- 17 張第一版卡可自動比對，其餘卡片正確標示範圍。
- 股票代碼輸入、SVG K 線與 Top 3 候選流程完整運作。
- 結果包含資料截止日、分析區間、成立條件、缺少證據與失效方式。
- 無明顯型態、證據不足與系統錯誤正確分離。
- 所有既有與新增測試、正式建置及無障礙 gate 通過。
- GitHub Pages 公開網址完成 HTTP、標題、資產路徑與核心操作驗證。
- README 說明使用方式、資料來源、限制、驗證與部署狀態。
- Repository 不包含機密資料，也不每天提交市場資料。

## 18. 分階段交付

1. **網站骨架與內容遷移**：VitePress、導覽、五階段地圖與既有章節。
2. **互動學習**：章節完成、測驗、進度與匯出匯入。
3. **型態卡目錄**：32 張卡、篩選、翻面與附錄 A 共用來源。
4. **市場資料管線**：官方歷史種子、OpenAPI 增量、Schema 與部署快照。
5. **第一版規則引擎**：17 張短窗卡、分數、Top 3 與結果解釋。
6. **整合驗收與 Pages 發布**：跨裝置、無障礙、資料失敗與正式網址驗證。

每一階段都必須維持既有教材驗證通過，不能等到最後才一次整合。

## 19. 未採用方案

- **瀏覽器直接呼叫 TWSE OpenAPI**：缺少單股歷史查詢與所需 CORS 支援。
- **Serverless API**：對盤後日 K 沒有足夠效益，卻增加服務、監控與安全成本。
- **第三方行情 API**：引入金鑰、費率、授權與服務依賴。
- **AI／機器學習圖形辨識**：難以逐條解釋，也容易被誤解為預測模型。
- **一次自動辨識全部教學卡**：日 OHLCV 無法可靠支援部分結構、流動性與失敗訊號。

若未來需要盤中資料、登入同步、歷史日期選擇器或第二階段結構型態比對，必須另行設計並通過新的範圍核准，不在第一版中預先建立未使用的後端抽象。
