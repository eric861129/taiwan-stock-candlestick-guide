# 台股 K 線新手完整筆記 / Taiwan Stock Candlestick Guide

這是一套給第一次系統閱讀 K 線的台股讀者使用的教材。它把 K 線視為「某段時間內成交價格的摘要」，先學會描述與查核，再練習把不確定性寫成有條件的交易計畫。

> 教育用途，非投資建議。K 線、成交量與過去案例都不能保證報酬；任何下單前，仍應依自己的資金、風險承受度與當日官方規則判斷。

## 你會學到什麼

- 從一根 K 線正確讀出開、高、低、收，而不把圖形當成預言。
- 區分觀察事實、條件式解讀、可被推翻的情境與風險決策。
- 看懂日線、週線、原始價格、公司行動、成交量與流動性之間的關係。
- 依官方資料與來源層級，為一張圖留下可重現的查核線索。

## 怎麼閱讀本書

每章有兩張圖：人工圖例用來隔離一個概念；歷史案例以官方日資料重繪，並在圖表規格中留下市場、代號、日期、原始價格模式、來源與查核日。圖例的紅色空心、綠色實心之外，也會以實心／空心、圖例與文字說明方向，避免只靠色彩判讀。

「練習」後的答案收在可展開區塊。先自行寫下觀察、條件式解讀和風險決策，再開啟答案；評分看推理、證據與風險界線，不看後來價格是否剛好照預期走。

## 五個部分的閱讀路線

1. Part I：K 線與台股市場基礎
   - [第 1 章：K 線能回答與不能回答的問題](chapters/01-what-candlesticks-can-and-cannot-answer.md)
   - [第 2 章：OHLC、實體、影線與顏色](chapters/02-ohlc-body-wicks-colors.md)
   - [第 3 章：週期、原始價格與調整後價格](chapters/03-timeframes-raw-adjusted-prices.md)
   - [第 4 章：成交量、流動性與台股市場基礎](chapters/04-volume-liquidity-taiwan-market-basics.md)
   - [附錄 C：台股規則、成本與官方查核](chapters/appendix-c-taiwan-market-rules.md)
2. Part II：讀懂結構與位置
   - [第 5 章：波峰、波谷與趨勢結構](chapters/05-swing-highs-lows-trend-structure.md)
   - [第 6 章：關鍵區域、支撐與壓力](chapters/06-key-zones-support-resistance.md)
   - [第 7 章：缺口、突破、回測與假突破](chapters/07-gaps-breakouts-retests-false-breakouts.md)
   - [第 8 章：多時間週期與市場狀態三面向](chapters/08-multiple-timeframes-market-state.md)
3. Part III：看型態，也看背景
   - [第 9 章：單根 K 線：強弱、拒絕與猶豫](chapters/09-single-candlestick-signals.md)
   - [第 10 章：雙根與三根 K 線組合](chapters/10-two-three-candlestick-patterns.md)
   - [第 11 章：整理、反轉與延續型態](chapters/11-consolidation-reversal-continuation-patterns.md)
   - [第 12 章：量價關係、低流動性與失敗訊號](chapters/12-volume-price-liquidity-failed-signals.md)
   - [附錄 A：型態速查](chapters/appendix-a-pattern-reference.md)
4. Part IV：把判讀變成計畫
   - [第 13 章：移動平均、成交量均量與 ATR](chapters/13-moving-averages-volume-average-atr.md)
   - [第 14 章：RSI、KD、MACD 與布林通道](chapters/14-rsi-kd-macd-bollinger-bands.md)
   - [第 15 章：情境、觸發、失效與放棄交易](chapters/15-scenarios-triggers-invalidation-no-trade.md)
   - [第 16 章：停損、部位、R 倍數、期望值與成本](chapters/16-stops-position-sizing-r-multiple-expectancy-costs.md)
   - [附錄 B：公式與工作表](chapters/appendix-b-formulas-and-worksheets.md)
5. Part V：面對真實市場
   - [第 17 章：K 線看不到的財報、消息與制度事件](chapters/17-what-candlesticks-cannot-see.md)
   - [第 18 章：心理偏誤、交易紀錄與紙上交易](chapters/18-psychology-journal-paper-trading.md)
   - [第 19 章：漸進式遮圖案例實驗室](chapters/19-progressive-chart-replay-lab.md)
   - [第 20 章：十組綜合案例與能力驗收](chapters/20-capstone-ten-cases.md)
   - [附錄 D：詞彙表](chapters/appendix-d-glossary.md)

名詞以目前的 [CONTEXT.md](CONTEXT.md) 為準；[附錄 D：詞彙表](chapters/appendix-d-glossary.md)由 `CONTEXT.md` 產生，請勿手動修改。

## 資料與版本原則

教材的歷史圖預設採原始價格，遇到除權息、減資、分割等公司行動時，先查公告與參考價，再討論缺口。可能變動的市場規則、費率與稅率集中在附錄 C，並附官方連結與查核日期；其他章不重複抄寫易變數字。

## 互動網站、資料範圍與限制

公開網站入口是 <https://huangchiyu.com/taiwan-stock-candlestick-guide/>。GitHub Pages 預設網址 <https://eric861129.github.io/taiwan-stock-candlestick-guide/> 會依帳號設定重新導向這個自訂網域；發布健康狀態以最新的「原子化 GitHub Pages 部署」workflow 為準。

互動分析器只支援 TWSE／TPEx 的普通股；ETF、ETN、權證、興櫃與其他證券會被拒絕。v4 快照可保存官方原始與向後還原的日 K、週 K、月 K，各最多 120 根已完成 K 棒；預設使用具完整官方因子的向後還原價格，缺少證據時降級為原始價格並停用還原切換。型態比對最多使用所選週期與價格口徑最後 60 根「連續且合法」的已完成 K 棒；十年基準資料由獨立歷史工作建立。官方列出未報價，或交易所公告停止買賣時，系統會保留 `official-no-quote`／`official-suspension` 證據，不補造 OHLC，也不跨越該日或停牌區間建立型態視窗；全市場緊急休市則由版本化日曆佐證排除。

瀏覽器只從同源的 `data/manifest.json` 與內容雜湊股票 JSON 載入資料，不直接呼叫交易所。來源 adapter 只讀取 TWSE／TPEx 的官方盤後行情、上市櫃公司清冊、公司行動與 TWSE 年度交易日曆；個股停復牌與緊急休市必須有版本化官方公告佐證。這些資料只供教材式的歷史型態比對，不預測未來價格，也不構成投資建議。

## 本機預覽、快照與完整驗證

先安裝鎖定版本的前端相依套件，開發預覽使用 VitePress：

```powershell
npm ci
npm run dev
```

離線 fixture 可用於不連線官方來源的開發與測試：

```powershell
$sourceCommit = git rev-parse HEAD
python tools\market_snapshot.py fixture --fixtures tests\fixtures\market_snapshot --output .cache\fixture-site-data --source-commit $sourceCommit
python tools\market_snapshot.py validate --snapshot .cache\fixture-site-data
```

建立正式基準快照時，工具會使用 `.cache\` 暫存成功的官方日行情以安全續跑；快照不應提交到 Git：

```powershell
$sourceCommit = git rev-parse HEAD
python tools\market_snapshot.py bootstrap --output .cache\live-site-data --source-commit $sourceCommit --cache .cache\market-snapshot --suspensions data\suspension-intervals.json
python tools\market_snapshot.py validate --snapshot .cache\live-site-data
```

提交或部署前應在最終工作樹執行完整 gate：

```powershell
npm ci
npm run verify
npm run test:e2e
python -m unittest discover -s tests
python tools\validate_book.py
python tools\render_glossary.py --source CONTEXT.md --output chapters\appendix-d-glossary.md --check
git diff --check
git status --short --branch
```

`verify.yml` 會在 Pull Request 與 reusable workflow 呼叫時，以指定的完整 commit SHA 執行相同的 Python、詞彙、lint、型別、單元覆蓋率與 VitePress build 檢查；它不會取得正式市場行情。

推送 `main` 時，`deploy-pages.yml` 會先鎖定 source SHA 並重跑驗證，再驗證上一個成功市場快照或建立基準快照。只有 `manifest.json`、`provenance.json`、`SHA256SUMS` 與 `snapshot.tar.gz` 都通過驗證後，資料才會被複製進單一 GitHub Pages artifact。任一前置步驟失敗時，不會呼叫 Pages deployment；每日市場資料也不會提交回 `main`。

`update-market-data.yml` 在台北時間平日 17:30 與 20:30 執行。它只解析一次 `main` 的不可變 SHA，再交給相同部署流程；官方資料日期相同時會成功 no-op，不建立新的 Pages 部署。

每次成功 Pages 部署後，workflow 會保留 30 天的 `market-snapshot-<cutoff>-<short-source-sha>` artifact。若需 rollback，從 Actions 的「原子化 GitHub Pages 部署」手動執行，填入成功 artifact 的數字 `rollback_artifact_id`。流程會由該 artifact 的 `sourceCommit` 鎖定相對應程式碼，重新驗證 digest 與完整快照後才重建部署；不要將舊資料手動配到新版程式或 Schema。

## 貢獻方式

請把 `CONTEXT.md`、章節中的圖表 metadata、官方來源與已產生的 SVG 視為同一份可驗證教材的一部分：

- 先維持既有名詞與資料欄位的意義，再擴充內容。
- 歷史案例優先使用交易所、公開資訊觀測站、主管機關等一手來源；更新規則時同步更新附錄 C 的查核日期。
- 修改圖表規格後，使用既有工具重新產生 SVG，不手動改寫生成檔。
- 提交前執行教材驗證器與測試，避免破壞章節結構、圖片連結或資料血緣。
