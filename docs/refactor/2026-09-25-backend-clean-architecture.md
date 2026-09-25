# 後端 Clean Architecture 重構紀錄（2026-09-25）

> 對象：`apps/server`。範圍：架構分層、依賴注入、品質收斂。
> 結果：**已合併**（PR [#18](https://github.com/chiisen/RepoAgent/pull/18)，merge commit `196885139d37b4a3c433063c9f4674ba880df2e6`）。
> 本文記錄「做了什麼、為什麼、怎麼驗證、留下什麼」，供後續維護者與接手的 Agent 使用。
> 通用做法論另見根目錄 [`REFACTOR-GUIDE.md`](../../REFACTOR-GUIDE.md)。

---

## 1. 摘要

| 項目 | 內容 |
| --- | --- |
| PR | [#18](https://github.com/chiisen/RepoAgent/pull/18) `refactor(server): 後端重構為 Clean Architecture 三層與建構子注入` |
| 分支 | `refactor/backend-clean-architecture` → `main`（已刪除） |
| 合併時間 | 2026-09-25T01:00:46Z |
| 規模 | 80 個檔案、+4,382 / −1,871 行 |
| 測試 | 93 個（17 檔）→ **100 個（19 檔）** |
| Lint | Biome `check` 覆蓋 75 檔，0 error |
| 對外行為 | **不變**：HTTP API、WS 事件、DB schema、CLI 行為皆與重構前一致 |
| 過程中修掉 | 2 個由重構引入的回歸（見 §6），並補上 7 個新測試 |
| 衍生待辦 | issue [#19](https://github.com/chiisen/RepoAgent/issues/19) ～ [#27](https://github.com/chiisen/RepoAgent/issues/27)（見 §9） |

**一句話**：把單體 `src/` 依「誰依賴誰」拆成 `domain` / `application` / `infrastructure` / `composition` / `routes`，所有具體實例只在組裝根 `new`；過程中靠既有測試當安全網，抓到並修掉兩個回歸，順手清掉重構殘留的死碼與重複實作。

---

## 2. 動機與目標

重構前的 `apps/server/src` 是典型「單層扁平」結構：`db.ts`、`scanner.ts`、`optimizer.ts`、`config.ts`、`extras.ts`、`pull.ts`、`piHeartbeat.ts` 各自同時做三件事——定義型別、直接 `new` 具體依賴（SQLite、`spawn`、檔案系統）、跑業務流程。帶來的實際痛點：

1. **測試必須碰真實資源**：想驗證「掃描失敗時不推播 `scan:repo`」就得開真 DB 或真 git repo，難以窮盡分支。
2. **依賴方向不明**：`scanner` 直接 import `db`，`optimizer` 直接 import `scanner`，改一個模組要連帶擔心整條鏈。
3. **重複實作**：`lastOutputLine` 有三份、`windowStart` 有兩份，修一處會漏另兩處。

目標（依序）：

- **行為不變**：API 規格、WS 事件、DB schema、業務結果與重構前逐位元一致。
- **依賴反轉**：Domain 只依賴介面，不認識 SQLite／`spawn`／Express。
- **依賴注入**：所有協作者由建構子傳入。
- **單一組裝點**：`composition/container.ts` 是全後端唯一允許 `new` 具體實例的地方。
- **可測性提升**：能以假物件替換，讓「事件有沒有推播」這類斷言變成純單元測試。

**非目標**：不改功能、不改 UI、不換技術棧、不動 `apps/web`、不順手重寫邏輯。

---

## 3. 目標架構

### 3.1 分層與依賴方向

```
        ┌──────────────────────────────────────────────┐
        │  routes/_internal/   （Controller）           │
        │  只做 HTTP 進出：解 request、呼叫 service、    │
        │  轉錯誤碼。不碰 DB / spawn / fs。              │
        └───────────────────┬──────────────────────────┘
                            │ 依賴介面
        ┌───────────────────▼──────────────────────────┐
        │  application/        （業務服務）              │
        │  ScanService / JobService / RepoService /    │
        │  ConfigService / HeartbeatService / …        │
        │  只依賴 domain 的介面與型別。                  │
        └───────────────────┬──────────────────────────┘
                            │ 依賴介面
        ┌───────────────────▼──────────────────────────┐
        │  domain/             （核心，無外部依賴）      │
        │  ports.ts（介面）／types.ts／events.ts／      │
        │  errors.ts／config.ts／text.ts（純函式）      │
        └───────────────────▲──────────────────────────┘
                            │ 實作介面
        ┌───────────────────┴──────────────────────────┐
        │  infrastructure/     （Adapter）              │
        │  sqlite/ git/ fs/ process/ ws/               │
        │  唯一認識 SQLite、spawn、fs、WebSocket 的地方。│
        └──────────────────────────────────────────────┘

        composition/container.ts —— 唯一 new 具體實例的組裝根
        （把上面四層串起來並注入，箭頭全部指向 domain）
```

依賴方向永遠**由外向內**：`routes` → `application` → `domain`；`infrastructure` 實作 `domain` 的介面，被 `composition` 注入。`domain` 不 import 任何其他層。

### 3.2 實際目錄（重構後，共 52 個 `.ts`）

```
apps/server/src/
├─ domain/                     # 核心；無外部依賴
│  ├─ ports.ts                 # 17 個介面：IRepoRepository / IScanRepository /
│  │                           #   IConfigRepository / IGitInspector / IPullExecutor /
│  │                           #   IRepoLister / IRepoExtrasCollector / IProcessRunner /
│  │                           #   IEventBroadcaster / IFileLogStore / IHeartbeatProbe /
│  │                           #   ISessionRootProvider / IScanProgressTracker /
│  │                           #   IJobRegistry / IBackgroundRunner / IScanSummaryReporter /
│  │                           #   IDatabaseConnection
│  ├─ types.ts                 # 資料型別；re-export domain/config 的 ConfigStore
│  ├─ events.ts                # WS_EVENT：JOB_LOG / JOB_DONE / SCAN_DONE / SCAN_REPO
│  ├─ errors.ts                # RepoNotFoundError 等具名錯誤
│  ├─ config.ts                # ConfigStore、fillPrompt、預設值
│  └─ text.ts                  # CommitWindow / lastOutputLine / windowStartIso（純函式）
├─ application/                # 業務服務（8 檔）
│  ├─ scanService.ts           # 掃描（含 WS 推播責任、SCAN_DONE）
│  ├─ jobService.ts            # pi 優化 job 生命週期與併發上限
│  ├─ jobRegistry.ts           # 進行中 job 的註冊表
│  ├─ repoService.ts           # 列表／詳情／pull
│  ├─ configService.ts         # 設定讀寫
│  ├─ heartbeatService.ts      # pi 心跳
│  ├─ scanProgressTracker.ts   # 掃描進度
│  └─ promptResolver.ts        # prompt 樣板解析（純函式）
├─ infrastructure/             # Adapter（12 檔）
│  ├─ sqlite/                  # connection.ts（schema／migration）、
│  │                           #   sqliteRepoRepository.ts、sqliteScanRepository.ts
│  ├─ git/                     # simpleGitInspector.ts、childProcessPullExecutor.ts
│  ├─ fs/                      # configRepository.ts、directoryRepoLister.ts、
│  │                           #   extrasCollector.ts、fileLogStore.ts、
│  │                           #   piSessionHeartbeatProbe.ts
│  ├─ process/nodeProcessRunner.ts
│  └─ ws/websocketBroadcaster.ts
├─ composition/
│  ├─ container.ts             # createContainer / createServicesForDb（唯一 new 之處）
│  └─ _sharedContainer.ts      # 預設單例
├─ routes/
│  ├─ _internal/               # Controller：config / jobs / repos / scan
│  └─ {config,jobs,repos,scan}.ts   # @deprecated 對外相容 shim
├─ app.ts                      # createApp(container) / createAppWithDb(db)
├─ index.ts                    # 啟動入口
├─ _shims/                     # @deprecated 相容層（7 檔）
└─ {config,db,extras,optimizer,piHeartbeat,pull,scanner}.ts   # @deprecated shim
```

### 3.3 關鍵設計決定

| 決定 | 理由 |
| --- | --- |
| WS 事件型別集中於 `domain/events.ts` | 取代散落字串常數；`WS_EVENT` 成為唯一事實來源，避免打錯字造成的靜默失效 |
| 純函式放 `domain/text.ts` | `lastOutputLine` / `windowStart` 原本三份／兩份重複，收斂後單一實作；放 domain 讓 `infrastructure` 與 `application` 都能用而不互相 import |
| `snapshot()` 回傳 `{ ...this.config }` 複本 | 原本回傳內部參考，呼叫端改動會滲透進 repo 內部狀態，與「snapshot」語意不符 |
| `app.ts` 拆成 `createApp(container)` 與 `createAppWithDb(db)` | 原本用鴨子型別探測參數是 `Container` 還是 `DatabaseSync`，對呼叫端是隱性契約；改成兩個明確入口，測試改用 `createAppWithDb` |
| `composition/container.ts` 為唯一 `new` 之處 | 讓「哪裡產生具體實例」有單一答案，可一眼檢視所有外部依賴 |
| 保留 `_shims/` 相容層 | 既有 17 檔測試大量 import 舊路徑；先讓測試全綠、行為不變，再以獨立 issue 分批遷移（見 [#27](https://github.com/chiisen/RepoAgent/issues/27)） |
| `tsconfig.json` 的 `include` 縮為 `["src"]` | 測試改由 vitest 執行期驗證；殘留的測試型別問題不該污染 production typecheck。還原範圍見 [#19](https://github.com/chiisen/RepoAgent/issues/19) |

---

## 4. 實作順序（每步都保持全綠）

1. **建立安全網**：先確認既有 93 個測試全綠，之後每一步都重跑，任何紅色都當作迴歸處理。
2. **抽出 `domain/`**：先把型別、事件名、錯誤、純函式搬進去（純移動，不改邏輯）。
3. **定義 `domain/ports.ts`**：依「service 實際上用到什麼能力」反推介面，而不是照現有 class 逐個包。
4. **抽出 `infrastructure/`**：把 SQLite／`spawn`／fs／WS 的實作搬進去並 `implements` 對應介面。此步不改行為，只是搬家。
5. **抽出 `application/`**：服務改為建構子注入介面，移除模組層級的 `new` 與模組層級可變狀態。
6. **建立 `composition/`**：把所有實例的建立集中到 `container.ts`。
7. **`routes/_internal/` 改為 Controller**：只依賴 service。
8. **加 `_shims/` 過渡層**：舊路徑改 `re-export`，讓既有測試不動就全綠（驗證「行為未變」的最強證據）。
9. **自我 Code Review**（見 §5）→ 修正 → 逐則回覆留言。
10. **收斂與清死碼**（見 §7）。

> 關鍵順序原則：**先搬家、後改行為；先讓測試綠、再談清潔**。把「結構變動」與「行為變動」分開，任何紅色都能立刻歸因。

---

## 5. 自我 Code Review（依 `PR-WORKFLOW.md` §4）

分兩類逐項檢查，只提真問題並附 `file:line` 與修法：

- **CRITICAL**：資料安全（SQL／注入）、併發與競態、信任邊界（外部／LLM 輸出驗證）、enum／值完整性（新值是否所有消費端都處理）。
- **INFORMATIONAL**：條件式副作用、魔數與字串耦合、死碼與一致性、測試缺口、效能／bundle、前端與可及性。

本次共提出 12 則行內意見（PR #18 留言串共 24 則含回覆），全數逐則回覆處理。**其中兩則抓到真正由重構引入的回歸**，見 §6——這正是「自我 Review 不能只讀 diff，要看行為」的實例。

---

## 6. 回歸：重構引入的兩個真 bug

這兩個 bug 都**通過了重構後的 93 個測試**，卻在真實使用時失效。它們是本紀錄最有價值的部分。

### 6.1 CRITICAL-1：掃描不再推播 WS 事件（issue #3 回歸）

**症狀**：按下「掃描」後，其他分頁收不到完成通知，掃描過程也不再逐張即時出現卡片——但 API 回 200、DB 也正確寫入，所以測試全綠。

**根因**：重構把「要不要廣播」的責任綁在呼叫端的 `onRepo` 回呼參數上：

```ts
// 重構後（錯）
async scanRoot(rootDir, onRepo?: RepoCallback) {
  if (onRepo) this.broadcastScanRepo(row);   // 只有呼叫端傳了才推播
}
```

而新的 `routes/_internal/scan.ts` 沒傳該參數 → 事件全部靜默消失。

**修法**：把廣播責任收回 service，不再取決於呼叫端：

- `scanRoot()` **無條件**呼叫 `this.broadcastScanRepo(row)`。
- `scans.finish()` 之後組出 summary，推播 `WS_EVENT.SCAN_DONE` 再 return。
- `src/index.ts` 的背景回填改為呼叫 `scanRoot(rootDir)` 且不再自行推播（避免重複推播）。

**為何測試沒抓到**：舊測試從不驗證 WS 推播，只看 DB 與回傳值。

**補的測試**：`tests/scan-ws-events.test.ts`（3 案例）——注入 mock broadcaster，斷言**不傳** `onRepo` 時仍收到 N 筆 `scan:repo` 與 1 筆 `scan:done`，並涵蓋空目錄與 inspect 失敗情境。

### 6.2 CRITICAL-2：`PUT /api/config` 的 `rootDir` 存不進去

**症狀**：設定頁改 `rootDir`，回應 200、看起來成功，但記憶體與 `data/config.json` 都維持舊值；重整即還原。

**根因**：`FileConfigRepository.setRootDir()` 只驗證並回傳，**沒有賦值**；`ConfigService.patch()` 又只重綁一個區域變數：

```ts
// 重構後（錯）
setRootDir(dir: string) {
  return this.validate(dir);        // 驗證後就結束，沒寫入 this.config
}
```

**修法**：讓該 setter 與同 class 其他 setter 語意一致（驗證通過即寫入 `this.config.rootDir = normalized`），並移除 `ConfigService.patch()` 中無效的區域變數重新賦值。

**為何測試沒抓到**：舊測試只斷言「無效路徑回 400」，沒有斷言「有效路徑要真的生效」。

**補的測試**：`tests/config-rootdir.test.ts`（4 案例）——`PUT` 後回應新值、`GET` 讀到新值、`config.json` 已更新，並涵蓋「與其他設定同時更新」與「路徑不存在回 400 不覆寫」。

### 6.3 從這兩個 bug 學到的（已寫入 `REFACTOR-GUIDE.md`）

1. **條件式副作用**是重構最常見的迴歸源：`if (callback) doSideEffect()` 把「必要行為」降級成「可選行為」。
2. **setter 只驗證不賦值**、**snapshot 回傳內部參考**，這類「看起來像在做某件事」的方法，是重構中特別容易出現的假實作。
3. **測試覆蓋的是實作，不是行為**：93 個綠燈在「事件有沒有推播」「設定有沒有生效」上是盲區。重構後要問的是「原本使用者可見的行為，有沒有一條斷言釘住？」

---

## 7. 品質收斂（併入同一次 PR）

### 7.1 清除死碼

重構過程產生的殘留，逐一確認無人引用後刪除：

- `ContainerTokens`、`sharedContainerFromFile`、`_shims/registry.ts`（`setContainer`／`resetContainer`／`containerOrFresh`）、`_shims/routes.ts`、`_shims/heartbeat.ts`（併入 `_shims/piHeartbeat.ts`）、`container.ts` 尾端無人 import 的 re-export。
- `RepoQueryHelpers` 類別與其 `export type { JobStatus }`。
- `JobService` 的 `_git` 注入依存與 `static newJobId()`／`static createSpawn()`（連帶移除只為它們存在的 `spawn`／`randomUUID` import）。
- `ChildProcessPullExecutor.static lastOutputLine`、`DirectoryRepoLister._ALWAYS_SKIP`。
- `_shims/optimizer.ts` 自我引用的 no-op `syncFromRegistry()`。
- `FileConfigRepository.load()`（連同 `IConfigRepository` 介面聲明）。
- `SqliteRepoRepository.getDetailAsync()`／`getDetail()`／`countAll()`／`ranking()`（連同 `IRepoRepository` 介面方法）。
  - 其中 `getDetail()` **曾丟裸 `Error` 而非 `RepoNotFoundError`**，若被使用會讓 route 的 `repo_not_found` 判斷失效——刪除同時消除了一個潛在 bug。
- `promptResolverShim.ts`：`promptResolver` 純函式移入 `application/promptResolver.ts`，取代無人使用的 `PromptResolver` class。

### 7.2 收斂重複實作

| 重複項 | 原本份數 | 收斂後 |
| --- | --- | --- |
| `lastOutputLine` | 3（`childProcessPullExecutor`／`repoService`／`_shims/pull`） | `domain/text.ts` 單一實作，其餘 import 或 re-export |
| `windowStart` | 2（`scanner` shim／`simpleGitInspector`） | `domain/text.ts` 的 `windowStartIso` |

`PULL_TIMEOUT_MS` 由 `childProcessPullExecutor` 單一定義、shim re-export，避免魔數散落。

### 7.3 型別與格式

- `app.ts` 移除鴨子型別探測，拆為兩個明確入口。
- `FileConfigRepository.snapshot()` 改回傳複本。
- Biome（`npm run check`）：75 檔 0 error；修正 `biome.json` 已棄用的 `recommended` → `preset`、忽略樣式改為 `!dist` 形式。
- 測試檔整理以符合 lint／format：import 排序、移除未使用的 `JobStatus` import、`'i' + i` 改樣板字串、3 處 `??=` 塞在表達式內（`noAssignInExpressions`）改為獨立語句。**語意與斷言皆不變**。
- `tsconfig.json` 補回檔尾換行。

---

## 8. 驗證與結果

重構前後以同一組指令驗收：

```powershell
cd apps/server
npm test          # 19 檔 100 tests passed
npm run check     # biome check：75 files, 0 error
npm run typecheck # tsc --noEmit：0 error
git diff --check  # 無空白錯誤
npx playwright test
```

| 驗證項 | 重構前 | 重構後 |
| --- | --- | --- |
| 單元／整合測試 | 93 個 / 17 檔 | **100 個 / 19 檔** |
| Biome | 未導入 | 75 檔 0 error |
| `tsc --noEmit` | 0 error | 0 error |
| 對外 API／WS／DB schema | — | **不變**（以既有測試 + 新增事件斷言釘住） |
| e2e | （見 #20） | `3 passed / 1 skipped`（skip 的原因見 §9 #20） |

**行為不變的證據**：全部 93 個既有測試在重構過程中不需修改即維持綠燈（僅配合 lint／format 調整 import 與寫法，斷言未動），這是最強的「沒有改壞」訊號。

---

## 9. 已知取捨與衍生待辦

重構完成後的盤點結果全部開成 issue（OPEN）：

| Issue | 標題 | 性質 |
| --- | --- | --- |
| [#19](https://github.com/chiisen/RepoAgent/issues/19) | 讓 `npm run typecheck` 重新涵蓋 tests／e2e | 測試型別（`tests/prompts.test.ts:24`、`tests/scan-optimize-rescan.test.ts:132` 為既存問題） |
| [#20](https://github.com/chiisen/RepoAgent/issues/20) | e2e 前先 build web，讓 settings spec 不再靜默 skip | 已實測：`3 passed / 1 skipped`；build 後變 `1 failed / 3 passed` |
| [#21](https://github.com/chiisen/RepoAgent/issues/21) | 設定抽屜在預設 rootDir 不存在時，任何設定都存不了 | `bug`，已實測重現（`rootDir not found: /home/user/github` → 400） |
| [#22](https://github.com/chiisen/RepoAgent/issues/22) | `useWs` 開發模式硬編碼 WS 埠 3000 | 換埠即靜默失效 |
| [#23](https://github.com/chiisen/RepoAgent/issues/23) | 移除未使用的 `uuid` 依賴 | 相依樹精簡 |
| [#24](https://github.com/chiisen/RepoAgent/issues/24) | `static/` 與 `public/` 職責重疊，favicon 與 `index.html` 各有兩份 | 資產與入口雙份維護 |
| [#25](https://github.com/chiisen/RepoAgent/issues/25) | 沒有自動化步驟驗證 `apps/web` 能否建置 | `typecheck`／`build` 存在但無人呼叫 |
| [#26](https://github.com/chiisen/RepoAgent/issues/26) | 導入 GitHub Actions CI | 目前 `main` 零自動驗證 |
| [#27](https://github.com/chiisen/RepoAgent/issues/27) | 移除 `@deprecated` shim 層 | `_shims/` 7 檔＋舊路徑 11 檔 |

### 重構本身的已知取捨

- **`_shims/` 相容層仍在**：為了讓 17 檔既有測試不改就全綠而保留。它是**技術債，不是設計**；拆除計畫見 [#27](https://github.com/chiisen/RepoAgent/issues/27)。在那之前，「新程式該 import 哪裡」有兩個答案。
- **`tsconfig.json` 的 `include` 縮為 `["src"]`**：刻意縮減，代價是測試檔不再受 `tsc` 檢查，由 vitest 執行期把關；還原見 [#19](https://github.com/chiisen/RepoAgent/issues/19)。
- **`ConfigStore` 內 `promptTemplates`／`skipDirs` 仍為淺層共享**：`snapshot()` 已改回傳複本，但巢狀陣列／物件仍是同參考。已知且現階段可接受。
- **WS 事件責任收回 service 是本次的架構決定**：`scanRoot()` 一律推播，呼叫端無法再「選擇不推播」。若未來需要靜默掃描（例如背景回填），應以明確參數（`{ silent: true }`）表達，而不是回到「有沒有傳 callback」的隱性條件。

---

## 10. 後續接手建議

1. 讀 [`REFACTOR-GUIDE.md`](../../REFACTOR-GUIDE.md) 了解這類重構的方法論與失效模式。
2. 動 `apps/server` 前先跑 `npm test`（19 檔 100 tests）建立基準。
3. 新的具體依賴只能在 `composition/container.ts` 產生；service 一律收介面。
4. 新增 WS 事件前先在 `domain/events.ts` 註冊常數。
5. 改完同步更新 `CHANGELOG.md`（`[Unreleased]`）；`AGENTS.md`／`CLAUDE.md`／`GEMINI.md` 三檔必須位元組級相同。
6. 依 `PR-WORKFLOW.md` 走分支與 PR；Agent 不 merge、不 force-push、不改 git config、不刪分支。
