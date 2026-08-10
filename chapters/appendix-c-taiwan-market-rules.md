# 附錄 C：台股規則、成本與官方查核

本附錄集中容易變動的交易制度、單位、稅費與公司行動查核方式。它是閱讀 K 線時的資料核對表，不是下單指示；實際交易以前，應再開啟相應市場的官方頁面與自己的券商契約確認。

## 讀法與適用範圍

表中的「交易所規則」適用範圍依來源頁所列市場而定；上市與上櫃的細節不可互相套用。稅務、費率、商品資格與優惠都可能修正，因此每一列都保留直接官方連結和查核日期。

本教材的圖表則另外在 metadata 中標出 `market`、`symbol`、`timeframe`、`price_mode`、`source_url`、`checked_on` 與 `corporate_actions`。先核對這些欄位，再使用本附錄的規則。

## 交易時段與委託單位

| 項目 | 現行摘要 | 類別 | 官方來源與查核 |
| --- | --- | --- | --- |
| TWSE 上市普通股一般交易 | 一般委託時段為 08:30–13:30；開盤撮合自 09:00 起，盤中撮合至 13:30。 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| TWSE 上市普通股整股 | 一般交易單位為 1,000 股。 | 交易所規則 | [TWSE 投資人指南](https://www.twse.com.tw/zh/about/company/guide.html)；查核日期：2026-08-10 |
| TWSE 盤中零股 | 委託時段為 09:00–13:30；首筆撮合為 09:10，後續每 5 秒撮合；交易單位為 1–999 股。 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| TWSE 盤後零股 | 委託時段為 13:40–14:30，於 14:30 集合競價；交易單位為 1–999 股。 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| TPEx 上櫃普通股一般交易 | 委託時段為 08:30–13:30；撮合自 09:00 至 13:30。開盤與 13:25–13:30 收盤採集合交易，盤中原則採逐筆交易；一般交易單位為 1,000 股。初次上櫃普通股前 5 個交易日沒有漲跌幅限制，且市場另有暫緩開收盤等例外機制。 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |
| TPEx 上櫃盤中零股 | 委託時段為 09:00–13:30；09:10 首次撮合，其後每 5 秒集合交易撮合。上櫃普通股可申報 1–999 股，限價且當日有效；新上櫃普通股前 5 個交易日的無漲跌幅限制也適用於零股。 | 交易所規則 | [TPEx 盤中零股交易](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/odd-lot.html)；查核日期：2026-08-10 |
| TPEx 上櫃盤後零股 | 委託時段為 13:40–14:30，14:30 以集合交易一次撮合；上櫃普通股可申報 1–999 股，限價且當日有效。 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |

盤中零股的成交價格不會設定上市普通股日 K 線的 OHLC，故零股成交經驗與整股日線的對照必須保留這個市場微結構差異。這是 TWSE 規則的機制說明，來源與查核日同上表。

## 價格升降單位

### TWSE 上市普通股

| 價格區間 | 升降單位 | 類別 | 官方來源與查核 |
| --- | --- | --- | --- |
| 0.01 元至未滿 10 元 | 0.01 元 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| 10 元至未滿 50 元 | 0.05 元 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| 50 元至未滿 100 元 | 0.10 元 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| 100 元至未滿 500 元 | 0.50 元 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| 500 元至未滿 1,000 元 | 1 元 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| 1,000 元以上 | 5 元 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |

上述普通股級距另可直接核對 [TWSE 營業細則第 62 條](https://twse-regulation.twse.com.tw/TW/law/DOC01_print.aspx?FLCODE=FL007304&FLNO=62)。同一張官方表另列權證、可轉換公司債與 ETF 等商品；不可把其他商品欄位的升降單位套到普通股。

### TPEx 上櫃普通股

| 價格區間 | 升降單位 | 類別 | 官方來源與查核 |
| --- | --- | --- | --- |
| 0.01 元至未滿 10 元 | 0.01 元 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |
| 10 元至未滿 50 元 | 0.05 元 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |
| 50 元至未滿 100 元 | 0.10 元 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |
| 100 元至未滿 500 元 | 0.50 元 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |
| 500 元至未滿 1,000 元 | 1 元 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |
| 1,000 元以上 | 5 元 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |

同一價格在不同市場可能適用不同升降單位；送單前以券商畫面和當日市場規則再次確認，不能只依本表四捨五入。

## 每日價格限制與例外

| 適用範圍 | 現行摘要 | 類別 | 官方來源與查核 |
| --- | --- | --- | --- |
| TWSE 上市普通股 | 一般股票每日漲跌幅限制為開盤競價基準價格上下 10%；新上市普通股前 5 個交易日不適用該限制。 | 交易所規則 | [TWSE 交易制度](https://www.twse.com.tw/zh/products/system/trading.html?hl=zh-TW)；查核日期：2026-08-10 |
| TPEx 上櫃普通股 | 上櫃普通股一般每日漲跌幅限制為 10%；適用例外與商品範圍依當日制度頁為準。 | 交易所規則 | [TPEx 交易制度](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)；查核日期：2026-08-10 |

漲跌幅限制不代表在該範圍內一定能成交，也不代表停損一定可以執行；流動性、排隊順位與委託條件仍會改變實際結果。

## 成本、費用與證券交易稅

| 項目 | 現行摘要 | 類別 | 官方來源與查核 |
| --- | --- | --- | --- |
| 證券商手續費 | 集中市場的經紀商報酬率由證券商依客戶每筆交易金額自行訂定；應以自己的券商契約與交易畫面為準，沒有本教材可替代的全市場固定費率。 | 券商慣例／法規架構 | [TWSE 營業細則第 94 條](https://twse-regulation.twse.com.tw/TW/law/DOC01.aspx?FLCODE=FL007304&FLNO=94)、[TWSE 投資人指南](https://www.twse.com.tw/zh/about/company/guide.html)；查核日期：2026-08-10 |
| 券商折讓、最低收費與電子下單優惠 | 屬券商合約或產品設定，可能因客戶、商品與期間不同；不視為交易所統一規則。 | 券商慣例 | [TWSE 投資人指南](https://www.twse.com.tw/zh/about/company/guide.html)；查核日期：2026-08-10 |
| 股票賣方證券交易稅 | 股票賣出人稅率為千分之 3，由證券商於交割日代徵。 | 法令／稅務 | [財政部稅務入口網說明](https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-knowledge/rwG2M1N)、[證券交易稅條例](https://law-out.mof.gov.tw/LawContent.aspx?id=FL006079&kw=%E6%9C%AA%E6%88%96&media=print)；查核日期：2026-08-10 |
| 現股當沖證券交易稅 | 符合上市或上櫃現股當日沖銷資格者，稅率為千分之 1.5，適用至民國 116 年 12 月 31 日。 | 法令／稅務 | [財政部稅務入口網說明](https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-knowledge/rwG2M1N)；查核日期：2026-08-10 |

成本試算應將成交價、股數、手續費條件、稅別、是否當沖與可能的滑價分開列示。不要把歷史回測中假設的成本，誤認為今日所有券商都適用的實收金額。

## 公司行動、原始價格與缺口查核

現金股利、股票股利、減資、股票分割等公司行動，可能在原始價格序列造成機械性的價格落差。其參考價與公式應先從公告與交易所資料查起，調整後價格則須再確認資料商採用的處理規則。

| 查核步驟 | 要回答的問題 | 類別 | 官方來源與查核 |
| --- | --- | --- | --- |
| 1. 查公司公告 | 是否有除權、除息、減資、分割或其他影響基準價格的事件？以公司代號、日期與公告類別查詢。 | 公司行動機制 | [MOPS 公開資訊觀測站入口](https://mops.twse.com.tw/mops/)；查核日期：2026-08-10 |
| 2. 查參考價 | 交易所公開的除權息參考價與計算欄位如何呈現？ | 公司行動機制 | [TWSE 除權息參考價](https://www.twse.com.tw/zh/announcement/ex-right/cal.html)、[TWSE 參考價資料](https://wwwc.twse.com.tw/zh/announcement/ex-right/twt49u.html)；查核日期：2026-08-10 |
| 3. 查原始成交資料 | 圖中的 OHLC 與成交量是否為指定交易日、指定市場的原始紀錄？ | 市場資料事實 | [TWSE 每日收盤行情](https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY)、[TPEx 個股日成交資訊](https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock)；查核日期：2026-08-10 |
| 4. 記錄資料模式 | 分析使用 raw 或 adjusted？若已調整，調整來源、事件與計算規則是什麼？ | 教材／資料慣例 | 本教材的圖表 metadata 與本附錄；查核日期：2026-08-10 |

只有完成前述查核，才討論缺口中可能由市場供需造成的部分。這個順序避免把公司行動的可驗證機制，誤寫成單一交易者或「主力」的心理敘事。

## 官方來源層級與更新流程

### 來源層級

1. **交易所規則與交易資料**：TWSE、TPEx 的制度頁與日成交資料，優先用於時段、單位、價格規則與 OHLC／量能。
2. **公司行動公告**：MOPS 與交易所的除權息參考價資料，優先用於事件日期、股利與基準價格。
3. **法令與稅務**：財政部稅務入口網、財政部法規與金管會法規，優先用於稅別與法律架構。
4. **券商契約**：只用於自己的手續費、折讓、最低收費和下單限制；不可推廣為市場通則。

### 更新清單

1. 開啟直接官方連結，確認市場、商品與適用期間。
2. 修改可能變動的數字、例外或文字時，同步更新該列的查核日期。
3. 若交易所與券商畫面不同，先記錄差異與商品別，不臆測哪一方錯誤。
4. 歷史圖出現缺口時，將公告、參考價、原始資料與價格模式一併記入圖表 metadata。
5. 重新執行教材驗證與圖表產生流程，避免規則文字和圖表資料脫節。

## 限制與投資風險

交易制度會變動，且不同商品、盤別、零股、信用交易與新上市期間可能有不同限制；本附錄不替代當日公告、券商風控或稅務專業意見。價格波動、流動性不足與資訊判讀都會造成損失風險，交易前宜閱讀 [TWSE 投資風險教育](https://investoredu.twse.com.tw/Pages/TWSE_InvestmentRisk8_2.aspx) 的說明；查核日期：2026-08-10。

## 變更紀錄

- 2026-08-10：首次建立，依 TWSE、TPEx、MOPS、財政部與金管會一手來源完成查核；未把券商折讓或個別下單條件視為交易所統一規則。
