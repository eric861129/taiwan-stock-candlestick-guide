---
status: accepted
date: 2026-08-11
---

# 使用純 GitHub Pages 架構提供互動教材與盤後型態比對

網站必須保留既有 Markdown 教材、支援輸入上市與上櫃普通股代碼，並在不使用外部後端或私密 API 金鑰的前提下提供型態相似度分析。因此採用 VitePress、Vue 3 與 TypeScript 建置靜態網站，由 GitHub Actions 於盤後呼叫 TWSE 與 TPEx OpenAPI，取得、累積及驗證最近 120 個交易日資料，產生每檔股票的靜態 JSON，再由瀏覽器端規則引擎完成比對。

TWSE OpenAPI 的 `STOCK_DAY_ALL` 是單一交易日的上市市場資料，不能依股票代碼取得完整歷史 K 線，且未提供 GitHub Pages 跨來源存取所需的回應標頭。因此瀏覽器不直接呼叫官方 API；初始歷史資料由官方歷史介面建立，後續再由盤後 OpenAPI 資料增量更新。

## 曾考慮的方案

- GitHub Pages 搭配 Serverless API：查詢彈性較高，但增加額外服務、監控、安全與部署成本。
- 第三方行情 API：開發較快，但會依賴供應商金鑰、費率、授權與服務穩定性。

## 影響

- 網站不提供盤中或即時行情；日 K 來自官方盤後資料，週 K 與月 K 由已完成日 K 聚合。多時間週期與還原序列的後續決策見 [ADR-0002](0002-precompute-auditable-multi-timeframe-series.md)。
- 股票代碼只用來選取同站台的個股靜態資料，不會由瀏覽器轉送至官方資料服務。
- 排程或資料驗證失敗時不得發布不完整資料，應保留上一個成功版本。
- 網站程式版本與市場資料版本分開追蹤；純前端或教材修改重用上一個已驗證 snapshot，只有官方行情刷新、資料證據或市場資料產生程式改變時才更新／重建。部署 metadata 必須同時綁定兩個版本，rollback 不得重新把兩者混成同一個 source commit。
- 股票資料必須控制在 GitHub Pages 容量與建置時間限制內；若未來需要盤中資料、登入同步或即時查詢，再以新 ADR 評估外部後端。
