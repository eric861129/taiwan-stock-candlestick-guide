# 市場快照驗證收據與 GitHub Pages 快速部署規格

- 狀態：完整設計已核准，等待規格檔案複核
- 核准日期：2026-08-13
- Repository：`https://github.com/eric861129/taiwan-stock-candlestick-guide`
- 部署目標：GitHub Pages
- 前置規格：[進階價格結構與多時間週期分析規格](2026-08-12-advanced-patterns-multi-timeframe-analysis-design.md)
- 架構決策：[純 GitHub Pages 架構](../../adr/0001-use-static-github-pages-architecture.md)、[預先產生可稽核的多時間週期序列](../../adr/0002-precompute-auditable-multi-timeframe-series.md)
- 官方依據：[GitHub Artifact Attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)、[GitHub CLI attestation verify](https://cli.github.com/manual/gh_attestation_verify)、[actions/upload-artifact](https://github.com/actions/upload-artifact)

## Problem Statement

網站程式版本與市場資料版本已能分流，但純前端部署仍會在多個 GitHub Actions job 重複解壓及逐檔執行完整市場快照驗證。2026-08-13 實測的兩次部署分別花費約 14 分 43 秒與 14 分 23 秒，其中約 82% 時間都耗在重複的市場快照語意驗證；實際前端建置與 Pages 部署只需約 18 秒。

目前流程在還原前一版快照、產生或重用候選快照、Pages 建置及保留 rollback artifact 時，會多次重跑相同的完整驗證。完整驗證仍是市場資料建立與更新時不可省略的安全門檻，但同一份不可變內容在每次純文件或 Vue 修改時重複驗證，沒有增加等比例的信任價值，也讓日常發布無法達到數分鐘完成。

直接刪除驗證會破壞 fail-closed、安全解壓縮、資料來源稽核及 rollback 配對。單純把 job 合併只能部分縮短時間；只優化 Python validator 或增加平行處理，仍會保留重複驗證與不必要的運算。因此需要把「完整驗證市場資料」與「驗證這份資料已由可信流程完整驗證」拆成兩種明確責任。

## Solution

市場快照在建立或更新時只執行一次完整語意驗證，驗證成功後產生版本化 `validation-receipt.json`，並以受信任的 GitHub Actions workflow 對 `snapshot.tar.gz` 建立 Artifact Attestation。不可變市場快照 Artifact 只保存市場資料、內容雜湊與驗證收據，不綁定特定網站程式 commit。

純前端部署改走快速路徑：依明確 Artifact ID 下載最近一份受信任快照，驗證 Artifact provenance、GitHub Attestation、收據契約、內容雜湊及資料檔案集合後直接建置 Pages。快速路徑不呼叫行情來源、不重建快照，也不逐股票重跑完整 validator。每次網站部署另外產生 `deployment.json`，把目前網站 commit 與已驗證市場快照配成一次可回復的站台版本。

市場資料程式、schema、聚合規則、validator、收據契約、行情更新或十年基準資料變更時，必須走完整路徑並簽出新的快照。快速驗證任一條件不成立時直接停止部署，不得偷偷降級成完整重建。整體仍維持純 GitHub Pages 架構，不新增常駐後端、資料庫或執行期行情 API。

## Goals

1. 純前端提交的 time-to-public 目標為 3 分鐘內，硬性 Gate 為 5 分鐘內。
2. 純前端 Workflow 從啟動到全部完成必須在 5 分鐘內。
3. 同一份不可變市場快照在建立或更新時只執行一次完整語意驗證。
4. 純前端路徑不得抓取行情、重建市場資料或呼叫完整逐股票 validator。
5. 市場快照的來源、內容、驗證規則、截止日與簽署 workflow 必須可稽核。
6. Pages 輸出的市場資料必須與已驗證快照位元一致。
7. Rollback 必須能重建指定的網站版本與市場資料版本配對。
8. 信任資訊缺少、模糊或不一致時一律 fail closed。

## Non-goals

1. 不拆分前後端，不新增常駐 API、資料庫或伺服器。
2. 不修改 Analyzer、價格結構 matcher、日週月 K 或型態教學內容。
3. 不改變市場資料的來源、聚合、還原價格或完成 K 棒語意。
4. 不移除完整市場 validator；只改變它的執行時機。
5. 不要求市場資料完整重建在 5 分鐘內完成。
6. 不以 Artifact 名稱或「最近一次成功」作為唯一信任依據。
7. 不在快速路徑失敗後自動建立新的市場快照。

## User Stories

1. As a 維護者, I want 純文件或前端修改直接重用已驗證快照, so that GitHub Pages 能在數分鐘內更新。
2. As a 維護者, I want 市場資料變更時只執行一次完整驗證, so that 安全門檻不會被重複成本掩蓋。
3. As a 維護者, I want 快速部署驗證 GitHub Attestation 與收據, so that 我能確認快照來自正式 Repository、主分支與受信任 workflow。
4. As a 維護者, I want 每次部署記錄網站與市場資料兩個版本, so that 我能解釋公開站台正在使用哪一組內容。
5. As a 維護者, I want rollback 使用同一組版本配對, so that 回復結果可重現而不是重新挑選行情快照。
6. As a 維護者, I want 任一 digest、收據或來源不一致就停止, so that 被更換或錯配的 Artifact 不會公開。
7. As a 維護者, I want Actions Summary 顯示部署模式與各階段耗時, so that 我能判斷快速路徑是否真正生效。
8. As a 讀者, I want 純前端更新不改變 snapshot hash 與 cutoff date, so that 教學介面更新不會悄悄替換行情資料。

## Architecture

### 1. 兩條正式部署路徑

部署分類器先判斷變更是否影響市場資料契約。

`snapshot-reuse` 適用於 Vue、CSS、一般 Markdown 教材、非資料測試及不影響市場資料的網站設定。它下載既有市場 Artifact，執行快速信任驗證，再建置及部署 Pages。

`snapshot-rebuild` 適用於定期行情更新、十年基準重建、`tools/market_*.py`、市場 schema、公司行動還原、聚合邏輯、validator、收據契約、資料工作 workflow 或資料生成參數變更。它建立快照、完整驗證一次、產生收據及 Attestation，再建置及部署 Pages。

分類結果必須明確記錄在 Actions Summary。新增檔案若無法安全判定，預設進入 `snapshot-rebuild`，不得假設可重用。

### 2. Artifact 與部署 metadata 分離

可重用的市場 Artifact 不得綁定網站程式 commit：

```text
market-snapshot-<snapshotHash>
├─ snapshot.tar.gz
├─ snapshot.tar.gz.sha256
└─ validation-receipt.json
```

`snapshot.tar.gz` 保存既有市場資料成品，包括 manifest、provenance、`SHA256SUMS`、股票索引及逐檔資料。實作時須以目前正式快照檔案集合為準，並由測試鎖住固定集合；不允許未列入契約的額外檔案。

每次網站部署另行產生 `deployment.json`：

```json
{
  "deploymentVersion": 2,
  "websiteSourceCommit": "<current website commit>",
  "marketDataSourceCommit": "<receipt market source commit>",
  "snapshotHash": "<receipt snapshot hash>",
  "cutoffDate": "<receipt cutoff date>",
  "marketArtifactId": "<immutable artifact id>",
  "marketArtifactDigest": "<artifact digest>",
  "strategy": "snapshot-reuse | snapshot-rebuild"
}
```

`deployment.json` 是站台版本配對紀錄，不是市場快照驗證證明。Pages 建置會把它與已驗證市場資料組合，並驗證其中的市場欄位與收據一致。

### 3. 完整驗證責任

只有市場快照建立或更新工作可以簽出新的驗證收據。正式順序固定為：

1. 取得官方行情與既有歷史 cache。
2. 建立完整市場 Snapshot。
3. 執行現有完整語意 validator 一次。
4. 計算 archive 及內部契約檔案 digest。
5. 產生版本化驗證收據。
6. 對 `snapshot.tar.gz` 建立 GitHub Artifact Attestation。
7. 上傳不可變 Artifact 並記錄 Artifact ID 與 digest。
8. 由同一份已驗證內容進行 Pages 建置，不再完整驗證第二次。

若完整 validator 失敗，不得產生 `result: passed` 收據，不得簽署 Artifact，也不得覆蓋上一份成功快照。

### 4. 快速驗證責任

快速驗證只證明「目前下載的不可變內容，就是受信任 workflow 已完整驗證的內容」。它必須完成：

1. 由 GitHub API 取得候選 Artifact 的 ID、digest、來源 run、repository、branch、workflow path 與 conclusion。
2. 限制來源為正式 Repository、`main`、成功 run 及允許清單中的資料 workflow。
3. 依 Artifact ID 下載，不以名稱重新解析另一個候選。
4. 驗證下載 Artifact digest 及 `snapshot.tar.gz.sha256`。
5. 使用 `gh attestation verify` 驗證 repository、signer workflow、source ref、subject digest 與 predicate type。
6. 驗證收據 schema 及支援版本。
7. 驗證收據、manifest、provenance、`SHA256SUMS` 的配對欄位及 digest。
8. 安全解壓縮並驗證固定檔案集合、路徑及檔案型態。
9. 驗證 `deployment.json` 的市場欄位與收據一致。

快速路徑不得呼叫完整 `validate_snapshot()` 或等效逐股票驗證。測試與 workflow log 必須能證明這項限制。

## Validation Receipt Contract

### 1. Receipt 結構

`validation-receipt.json` 使用 canonical JSON 與版本化 schema。第一版最低欄位如下：

```json
{
  "receiptVersion": 1,
  "predicateType": "https://eric861129.github.io/attestations/market-snapshot-validation/v1",
  "snapshot": {
    "archiveSha256": "<sha256>",
    "snapshotHash": "<logical snapshot hash>",
    "snapshotVersion": 4,
    "cutoffDate": "2026-08-13",
    "manifestSha256": "<sha256>",
    "provenanceSha256": "<sha256>",
    "checksumsSha256": "<sha256>",
    "stockCount": 0
  },
  "marketData": {
    "sourceCommit": "<full git sha>",
    "generatorContractDigest": "<sha256>",
    "validatorContractDigest": "<sha256>"
  },
  "validation": {
    "validatorSourceCommit": "<full git sha>",
    "result": "passed"
  }
}
```

正式 predicate type URI 在實作時固定為 Repository 擁有者可控制且不會變動的 URI。測試不得依賴該 URI 必須能公開回傳內容；它是全域唯一的契約識別碼。

### 2. Digest 語意

- `archiveSha256`：實際被 Attestation 簽署的 `snapshot.tar.gz` digest。
- `snapshotHash`：現有市場資料邏輯內容雜湊，不得用 archive 壓縮 metadata 代替。
- `manifestSha256`：快照內 manifest 原始 bytes 的 SHA-256。
- `provenanceSha256`：快照內 provenance 原始 bytes 的 SHA-256。
- `checksumsSha256`：快照內 `SHA256SUMS` 原始 bytes 的 SHA-256。
- `generatorContractDigest`：會改變市場資料內容的生成程式與資料工作設定契約 digest。
- `validatorContractDigest`：完整 validator、schema 及驗證規則契約 digest。

契約 digest 的輸入檔案必須由一份明確且受測試保護的 allowlist 產生。它不能依賴未排序的檔案列舉、目前時間或 runner 路徑。

### 3. 非循環簽署

收據不得放進 `snapshot.tar.gz` 後再計算同一個 archive digest，避免循環相依。Attestation 的 subject 是 `snapshot.tar.gz`，自訂 predicate 是 `validation-receipt.json` 的內容；Actions Artifact 再把 archive、digest 檔及收據一起保存。

GitHub Attestation 已包含簽署時間、workflow identity、repository、commit 與 run provenance，收據不重複加入會造成非決定性內容的目前時間或 run ID。Artifact ID 與 Actions Artifact digest 由部署 metadata 記錄，不納入可跨 run 重現的市場收據。

## Trust Boundary

### 1. 受信任簽署者

只有 allowlist 中的正式市場資料 workflow 可以簽署 `market-snapshot-validation/v1`。簽署 job 必須具有最小權限：

```yaml
permissions:
  contents: read
  id-token: write
  attestations: write
```

快速驗證至少限制：

- Repository 完整名稱。
- `refs/heads/main`。
- Signer workflow path。
- Predicate type。
- Subject SHA-256。
- Workflow conclusion 為 success。
- Artifact repository、branch、workflow path 與 run identity 和 Attestation provenance 一致。

若 GitHub CLI 與目前方案支援穩定的 signer digest 驗證，正式流程再限制 signer digest；否則以受保護 `main`、固定 workflow path、契約 digest 與 code review 共同守住簽署者。不可只驗證「GitHub 有簽章」。

### 2. Artifact finder

Artifact finder 必須處理 pagination，並對每個候選檢查：

- 同一正式 Repository。
- 允許的 workflow path。
- `main` branch。
- 成功 run。
- Artifact 未過期且可下載。
- 名稱、ID、digest 與來源 run 都有值。

符合條件的最新候選可以被選取，但選取後整條流程只傳遞 Artifact ID 與預期 digest。下載、驗證、建置及 rollback 不得再次用名稱搜尋，以免發生 time-of-check/time-of-use 錯配。

### 3. 市場來源 commit

收據中的 `marketData.sourceCommit` 與 `validatorSourceCommit` 必須是正式 Repository 可解析的完整 commit。正常部署要求來源 commit 位於正式 `main` 歷史，手動 rollback 則只能使用當時已被允許 workflow 簽署、且 Attestation provenance 可驗證的歷史 commit。

## Failure Modes

以下任一狀況必須停止部署：

1. 找不到符合來源條件的市場 Artifact。
2. 候選 Artifact 缺少 ID、digest、來源 run 或 workflow identity。
3. 下載結果與 GitHub Artifact digest 不符。
4. `snapshot.tar.gz.sha256` 與實際 archive 不符。
5. Attestation 不存在、驗證失敗或 subject digest 不符。
6. Repository、source ref、signer workflow 或 predicate type 不符。
7. 收據缺欄位、使用未知版本、包含未知安全關鍵 enum 或 `result` 不是 `passed`。
8. manifest、provenance、`SHA256SUMS` 與收據 digest 不符。
9. snapshot hash、cutoff date、snapshot version 或 source commit 配對失敗。
10. Generator 或 Validator 契約 digest 已改變，但流程嘗試重用舊收據。
11. 壓縮檔包含絕對路徑、`..`、符號連結、hard link、裝置檔、額外頂層路徑或未知檔案。
12. `deployment.json` 與收據的市場欄位不一致。
13. Pages 輸出的市場資料與來源快照不一致。
14. Artifact provenance 與 Attestation provenance 無法唯一配對。
15. GitHub API、Artifact 下載或 Attestation 驗證工具無法可靠完成。

快速路徑失敗後只輸出可行動的錯誤摘要並停止。它不得自行抓行情或建立新 Snapshot，因為這會把部署錯誤轉成未經明確授權的昂貴資料操作。

## Rollback

Rollback 的輸入是明確的部署版本紀錄，而不是一個模糊的 Snapshot 名稱。紀錄至少包含網站 commit、市場來源 commit、snapshot hash、cutoff date、Artifact ID、Artifact digest 與原始部署策略。

Rollback 固定執行：

1. 驗證目標部署紀錄來自允許的正式 workflow 與成功 run。
2. 依紀錄中的 Artifact ID 下載原市場快照。
3. 驗證 Artifact provenance、Attestation、收據及 digest。
4. Checkout 紀錄中的網站 commit。
5. 產生新的 `deployment.json`，保留 rollback 來源資訊。
6. 建置 Pages 並執行市場資料位元比對。
7. 部署並保存新的站台部署紀錄。

Rollback 不重跑完整市場 validator，因為使用的是已由可信 workflow 完整驗證且以 digest 綁定的不可變內容。若原 Artifact 已過期或無法驗證，Rollback 失敗；不得用相同名稱的其他 Artifact 代替。

## Workflow Design

### 1. Source verification job

保留前端 typecheck、lint、unit test、build 及必要契約測試。資料影響分類器從目前 workflow helper 路徑執行，不能依賴被 checkout 的舊網站 commit 剛好包含新版分類器。

### 2. Market snapshot job

`snapshot-rebuild` 執行完整資料流程與一次完整 validator；`snapshot-reuse` 執行 Artifact finder 與快速驗證。兩條分支輸出相同介面：Artifact ID、digest、snapshot hash、cutoff date、market source commit、receipt version 與策略。

### 3. Pages build job

Pages build job 依上游輸出的 Artifact ID 下載快照，只做快速驗證與安全解壓縮。它產生當次 `deployment.json`、複製市場資料、執行網站 build，並以檔案清單與 SHA-256 比較來源和輸出市場資料。

位元比對範圍排除每次部署才產生的 `deployment.json`，但必須單獨驗證該檔與收據配對。不能為了通過比較而排除其他市場資料檔案。

### 4. Deploy job

Deploy job 只部署已通過 build job 的 Pages Artifact。公開後驗證版本 metadata、首頁、Analyzer 頁面及至少一檔股票資料 HTTP 200；不在 deploy job 重新完整驗證市場資料。

### 5. Rollback retention job

保留 rollback 所需的部署紀錄與市場 Artifact 參照。若必須複製 Artifact，仍只做快速信任驗證。市場 Artifact retention 必須涵蓋正式 rollback 期間；若 GitHub Artifact retention 無法滿足，應先調整保留策略，不能假設過期 Artifact 仍可回復。

## Observability

每次 workflow 必須在 Actions Summary 顯示：

- 部署策略：`snapshot-rebuild` 或 `snapshot-reuse`。
- 網站程式 commit。
- 市場資料來源 commit。
- Snapshot hash 與 cutoff date。
- Artifact ID 與 digest。
- Receipt version 與 validator contract digest。
- 完整 validator 執行次數。
- Artifact 查找、下載、快速驗證、完整驗證、網站 build、deploy 各階段耗時。
- Time-to-public。
- Workflow 完整耗時。
- 公開站台驗證結果。

不得把 token、OIDC claim 全文或可能包含憑證的 command output 寫入 Summary。

## Work Breakdown

### Ticket 1：驗證收據契約與快速驗證器

- 建立 receipt schema、canonical JSON 與契約 digest allowlist。
- 建立產生收據及快速驗證的 Python seam。
- 驗證固定檔案集合、安全解壓縮及內容配對。
- 補正常、篡改、未知版本、路徑穿越及契約變更測試。

### Ticket 2：完整驗證與 Attestation 產生流程

- 調整市場快照 workflow，使完整 validator 恰好執行一次。
- 產生 archive digest 與驗證收據。
- 建立 custom predicate Attestation。
- 設定最小 workflow 權限並保存 Artifact ID、digest。
- 補無完整驗證不得簽署的測試或 workflow contract assertion。

### Ticket 3：純前端快速部署路徑

- 讓部署分類器輸出明確策略及原因。
- 以 Artifact ID 下載並執行快速驗證。
- 移除 reuse、Pages build 與 retention 中的重複完整 validator。
- 保留前端 gates、資料位元比對與正式站台 smoke test。

### Ticket 4：Rollback 與 Artifact provenance

- 強化 finder 的 repository、workflow、branch、run 與 pagination 驗證。
- 讓選取後的流程只傳遞 Artifact ID 與 digest。
- 建立部署版本配對與 rollback 快速驗證。
- 補其他 workflow 同名前綴、錯誤 repository、錯誤分支與錯配版本測試。

### Ticket 5：部署時間與可觀測性

- 產生一致的 Actions Summary。
- 記錄 time-to-public 與 workflow-complete。
- 增加正式快速路徑驗收腳本或可重現 runbook。
- 以一次完整資料部署及一次純文件部署記錄實際耗時。

Ticket 1 是所有工作的前置。Ticket 2 與 Ticket 4 在契約穩定後可以平行進行；Ticket 3 需整合兩者，Ticket 5 最後收斂。實作可以使用多個 SubAgent，但每個代理必須有明確檔案所有權，完成後立即關閉；共享 workflow 由主整合者負責。

## Test Matrix

| 範圍 | 必要案例 |
|---|---|
| 資料影響分類 | Vue、CSS、一般 Markdown 走 reuse；市場工具、schema、validator、收據或資料 workflow 走 rebuild；未知資料相關路徑 fail safe |
| Receipt schema | 合法、缺欄位、錯誤型別、未知版本、未知安全關鍵 enum、非 passed 結果 |
| Digest | archive、manifest、provenance、`SHA256SUMS` 任一 byte 變更都失敗 |
| Contract digest | allowlist 穩定排序；生成或驗證契約改變後舊收據不可 reuse |
| Attestation | 正確 subject 成功；錯誤 repository、workflow、ref、predicate type、digest 均失敗 |
| Artifact provenance | 其他 repo、非 main、失敗 run、非允許 workflow、同名前綴與 pagination 邊界均拒絕 |
| 安全解壓縮 | 絕對路徑、`..`、symlink、hard link、裝置檔、重複路徑與未知檔案均拒絕 |
| 快速部署 | 不抓行情、不重建 snapshot、不呼叫完整 validator、資料位元一致 |
| 完整部署 | 完整 validator 恰好一次；失敗時不產生 passed receipt 或 Attestation |
| Pages metadata | 網站 commit 更新；snapshot hash、cutoff date、market source commit 與收據一致 |
| Rollback | 正確版本配對成功；錯誤網站／市場配對、過期或不同 ID Artifact 失敗 |
| 現有產品 | Analyzer、日週月 K、型態候選、桌機與手機 E2E 不回歸 |
| 效能 | 純前端 time-to-public 目標 3 分鐘，硬性 Gate 5 分鐘；workflow-complete 5 分鐘內 |

## Implementation Boundaries

預期主要修改範圍：

- `.github/workflows/deploy-pages.yml`
- 市場基準、定期更新及 rollback 相關 workflow
- `tools/deployment_snapshot_mode.py`
- `tools/deployment_versions.py`
- `tools/github_actions_artifacts.py`
- 新增或擴充 receipt、attestation、archive 驗證工具
- 對應 Python、workflow contract、Vitest 與 Playwright 測試
- 必要的部署 runbook 或 ADR 更新

不應為本 Phase 修改 `src/domain/structures/**`、型態 catalog、matcher 分數或市場資料演算法。若測試發現現有產品問題，另開 Issue，不把功能修正混入部署效能 Phase。

## Git and Integration Strategy

1. 使用單一 Phase 分支 `codex/snapshot-attestation-fast-deploy`。
2. 每個 Ticket 形成可審查的獨立 commit，但整個 Phase 通過前不合併 `main`。
3. 共享 workflow 只由主整合者修改，避免多代理同時編輯。
4. 完成後執行規格審查與標準審查，直接修復 findings 並重驗。
5. 全部 Gate 通過後合併 `main`、push，再執行正式部署。
6. 不需要的 Worktree 與 SubAgent 在確認已交付後關閉；禁止遺留處理中代理。

## Production Rollout

### Gate 1：完整市場資料部署

1. 由正式 `main` 觸發一次 `snapshot-rebuild`。
2. 確認完整 validator 恰好執行一次。
3. 確認收據與 Attestation 已產生且可由 `gh attestation verify` 驗證。
4. 確認 Artifact ID、digest、snapshot hash、cutoff date 與 market source commit 已記錄。
5. 確認 Pages 部署、版本 metadata、Analyzer 頁面及股票資料載入正常。
6. 記錄完整資料路徑各階段實際耗時。

### Gate 2：純前端快速部署

1. 在正式流程送出一筆只修改文件或非資料內容的提交。
2. 確認分類為 `snapshot-reuse`。
3. 確認沒有行情請求、Snapshot 重建或完整 validator。
4. 確認沿用相同 snapshot hash、cutoff date 與 market source commit。
5. 確認網站 commit、部署紀錄與公開頁面已更新。
6. 確認 time-to-public 不超過 5 分鐘，並記錄實際時間。

若 Gate 2 超過 5 分鐘，Phase 不算完成。依 Actions Summary 的階段耗時繼續定位，直到達標或有經使用者核准的新限制；不能只以部署成功結案。

## Final Acceptance Gates

必須全部通過：

1. Python 測試與 compile check。
2. TypeScript typecheck。
3. ESLint。
4. 單元測試。
5. Production build。
6. 桌機與手機 Playwright。
7. Workflow 契約測試。
8. Receipt、digest、Attestation 正向與篡改測試。
9. 安全解壓縮與 Artifact provenance 測試。
10. Git diff、工作樹與 scope 檢查。
11. 規格審查與標準審查無 blocker、P1 或 P2。
12. 正式完整資料部署驗收。
13. 正式純前端快速部署驗收。
14. 公開站台 metadata、股票資料、日週月 K 與頁面載入正常。
15. 純前端 time-to-public 不超過 5 分鐘。

## Phase Stop Condition

完成以下事項後立即暫停，不接續 Analyzer 或其他產品 Phase：

1. Phase 分支完成並通過所有 Gate。
2. 合併 `main`、commit、push。
3. GitHub Pages 正式部署成功。
4. 完整資料路徑與純前端快速路徑都完成驗收。
5. 回報兩條路徑的實際耗時。
6. 回報網站 commit、市場來源 commit、Snapshot hash、cutoff date、Artifact ID 與部署策略。
7. 工作樹乾淨。
8. 所有已完成或不再使用的 SubAgent 都已關閉。

下一個 Phase 只能在使用者閱讀本 Phase 結果並明確要求後開始。

## Rejected Alternatives

### 1. 只把完整驗證集中到單一 job

比目前快，但每次純前端部署仍需完整掃描市場資料，預估難以穩定達到 5 分鐘 Gate；job 隔離與 rollback 也會變得更複雜。

### 2. 只平行化或優化 Python validator

可以縮短單次完整驗證，但保留了多次重複驗證。資料量增加後仍會再次惡化，也無法建立可跨部署重用的信任證明。

### 3. 只信任 Artifact 名稱、成功 run 或 checksum 檔

Checksum 只能證明內容自洽，不能證明由哪個 Repository、branch 或 workflow 驗證。其他成功 workflow 可以建立同名前綴 Artifact，因此不足以作為正式發布信任邊界。

### 4. 快速驗證失敗後自動重建

會把信任或供應鏈錯誤隱藏成昂貴資料操作，也可能在沒有明確意圖時抓取行情及簽出新 Snapshot。正式設計選擇停止並要求明確啟動資料工作。
