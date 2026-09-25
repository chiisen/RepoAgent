# 更新日誌

本檔案格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，
版本規範遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### 新增

- 架構重構為 Clean Architecture 三層 + DI：後端 src/ 拆分為 `domain/`（純型別與介面）、`application/`（業務服務）、`infrastructure/`（SQLite / Git / FS / Process / WS adapters）、`composition/container.ts`（唯一允許 `new` 具體實例的組裝根）、`routes/_internal/`（Controller，建構子注入 service）、`_shims/`（向後相容舊 import）。所有 service 與 controller 透過建構子注入介面（`IRepRepository`、`IGitInspector`、`IPullExecutor`、`IRepoLister`、`IEventBroadcaster`、`IProcessRunner` 等），無硬編碼的 `new` 具體實例。
- Lint / Formatter 工具：採用 Biome（`@biomejs/biome` 2.5+），新增 `biome.json` 與 `npm run lint`／`npm run format`／`npm run check` 指令，範圍依 `biome.json` 的 `files.includes` 涵蓋 `src`／`tests`／`e2e`，全部零錯誤、零警告；並修正 `biome.json` 已棄用的 `recommended` 為 `preset`、忽略樣式改為 `!dist` 形式。

### 變更

- 舊 `src/{db,scanner,config,extras,pull,optimizer,piHeartbeat,routes/*}.ts` 改為 thin re-export shim（標 `@deprecated`），內部委派給 composition root；93 個測試（17 檔）零行為修改全綠。
- 測試檔整理以符合 lint／format：修正 import 排序、移除未使用的 `JobStatus` import、`'i' + i` 改樣板字串，並將 3 處 `??=` 塞在表達式內（`noAssignInExpressions`）改為獨立語句；`e2e/` 三檔亦僅做 import 排序與格式化。語意與斷言皆不變。
- WS 事件型別集中於 `domain/events.ts`（`WS_EVENT.JOB_LOG`／`JOB_DONE`／`SCAN_DONE`／`SCAN_REPO`）取代散落的字串常數。
- `tsconfig.json` 將 `include` 由 `["src", "tests"]` 改為 `["src"]`：測試改由 vitest 執行期驗證，避免殘留的測試檔型別問題污染 production typecheck；補回測試型別並還原範圍另見 issue #19。
- 清除重構殘留的死碼與依賴方向瑕疵：刪除無人引用的 `ContainerTokens`、`sharedContainerFromFile`、`_shims/registry.ts`（含 `setContainer`／`resetContainer`／`containerOrFresh`）、`_shims/routes.ts`、`_shims/heartbeat.ts`（併入 `_shims/piHeartbeat.ts`）與 `container.ts` 尾端無人 import 的 re-export；`app.ts` 改直接依賴 `composition/_sharedContainer.ts`，不再反向 import `_shims/`。

### 修正

- 回歸修正：`POST /api/scan` 不再推播 WebSocket `scan:repo`／`scan:done`。重構把「要不要廣播」綁在呼叫端的 `onRepo` 回呼上，而 `routes/_internal/scan.ts` 未傳該參數，導致掃描過程不再即時串流（issue #3 回歸）、其他分頁也收不到完成通知。改為事件責任收回 service：`scanRoot()` 無條件推播每個 repo 的 `scan:repo`，並在 `scans.finish()` 後補推一筆 `scan:done`；`src/index.ts` 的背景回填改為 `scanRoot(rootDir)` 且不再自行推播，避免重複。
- 回歸修正：`PUT /api/config` 的 `rootDir` 驗證通過、回應 200，但記憶體與 `data/config.json` 都維持舊值（設定頁改完重整即還原）。`FileConfigRepository.setRootDir()` 原本只驗證並回傳、不賦值，`ConfigService.patch()` 也只重綁區域變數。改為讓該 setter 與同 class 其他 setter 語意一致（驗證通過即寫入 `this.config.rootDir`），並移除無效的區域變數重新賦值。
- 測試補強：新增 `tests/scan-ws-events.test.ts`（注入 mock broadcaster，斷言不傳 `onRepo` 時仍收到 N 筆 `scan:repo` 與 1 筆 `scan:done`，含空目錄與 inspect 失敗情境）與 `tests/config-rootdir.test.ts`（`PUT /api/config {rootDir}` → 回應新值、`GET /api/config` 讀到新值、`config.json` 已更新，含與其他設定同時更新及不存在的路徑回 400 不覆寫）。測試數 93 → 100，檔案 17 → 19。
- 清除死碼：`RepoQueryHelpers` 類別與其 `export type { JobStatus }`、`JobService` 的 `_git` 注入依存與 `static newJobId()`／`static createSpawn()`（連帶移除只為它們而存在的 `spawn`／`randomUUID` import）、`ChildProcessPullExecutor` 的 `static lastOutputLine`、`DirectoryRepoLister._ALWAYS_SKIP`、`_shims/optimizer.ts` 的自我引用 no-op `syncFromRegistry()`、`FileConfigRepository.load()`（連同 `IConfigRepository` 介面聲明）、`SqliteRepoRepository` 的 `getDetailAsync()`／`getDetail()`／`countAll()`／`ranking()`（連同 `IRepoRepository` 介面方法，其中 `getDetail()` 曾丟裸 `Error` 而非 `RepoNotFoundError`，留著會讓 route 的 `repo_not_found` 判斷失效）。
- 收斂重複實作：三份 `lastOutputLine`（`childProcessPullExecutor`／`repoService`／`_shims/pull`）與兩份 `windowStart`（`scanner` shim／`simpleGitInspector`）集中至 `domain/text.ts`，其餘改為 import 或 re-export；`promptResolver` 純函式由 `promptResolverShim.ts` 移入 `application/promptResolver.ts`（取代無人使用的 `PromptResolver` class），並刪除 `promptResolverShim.ts`。
- `FileConfigRepository.snapshot()` 改回傳複本 `{ ...this.config }`：原本直接回傳內部參考，呼叫端改動會滲透進 repo 內部狀態，與「snapshot」語意不符。
- `app.ts` 移除以鴨子型別探測 `Container`／`DatabaseSync` 的雙重簽名，拆為兩個明確入口 `createApp(container)`（省略時沿用 `sharedContainer()`）與 `createAppWithDb(db)`；`tests/scan-optimize-rescan.test.ts` 改用後者。
- `apps/server/tsconfig.json` 補回檔尾換行。`include` 維持 `["src"]` 的縮減與後續處理另開 issue #19 追蹤（`tests/prompts.test.ts:24`、`tests/scan-optimize-rescan.test.ts:132` 為既存型別問題，非本次重構造成）。

### 新增

- 頂部 commit 次數橫向長條圖與時間窗篩選：`GET /api/repos` 新增 `commitRanking`（全庫，含總計／今日／本週／本月，不受搜尋／篩選影響）；React 與 fallback 於標題列下方顯示前 10 名，可切換排行基準（總計／今日／本週／本月，日曆制、本機時區）。
- 掃描新增 `commitsToday／commitsWeek／commitsMonth`（`git rev-list --count --since=<日曆起點>`）與 `commitCount`（`git rev-list --count HEAD`），`repos` 增四欄位（含舊庫 migration）。
- 卡片顯示 `commit 次數`：React 與 fallback 卡片於「最後 commit」下方顯示總 commit 數。
- 列表頂部統計：`GET /api/repos` 新增 `stats`（全庫 `total`／`dirty`，不受搜尋／篩選影響）；React 與 fallback 頂欄顯示「N 個專案 · 有變更 D」，有搜尋或篩選時追加「檢視 n 個（有變更 d）」。
- 掃描即時串流顯示：伺服器每掃完一個 repo 即寫入並以 WebSocket 推播 `scan:repo`；React 與 fallback 收到後依目前搜尋／篩選／排序逐張插入卡片並累加統計（不再等掃完才一次出現）。

### 變更

- 標題列路徑輸入框改為不放大（`flex: 0 1 20rem`），僅維持可縮小，不再吃滿剩餘空間。
- 代理文件（`AGENTS.md`／`CLAUDE.md`／`GEMINI.md`）新增模組快取約束：自製原生 ESM 開發伺服器每次載入換新 `?v=` 並沿整條 `import` 鏈傳遞同一指紋；Vite 與建置產物沿用既有指紋、勿手動覆寫。
- 卡片標題下方加分隔線：`.title` 加 `padding-bottom: 8px` 與 `border-bottom: 1px solid var(--border)`（純 CSS、不動 DOM；React 與 fallback 同步）。
- 掃描改為逐 repo 邊掃邊寫（併發 6），並在掃描開始即刪除非本輪 `rootDir` 的舊列（原本掃完才刪）；換目錄時卡片牆立即歸零後逐張補上。
- 移除全屏「掃描中」遮罩，改為標題列下方細進度列（沿用 `GET /api/scan/progress` 顯示 `n/total · 目前專案`），掃描期間卡片牆保持可見可捲動。

### 修正

- 掃描串流時畫面卡頓：逐張插入卡片時每個 `scan:repo` 都重繪整張卡片牆（未 memo）。`RepoCard` 改以 `React.memo` 包裝，並把 `onDetail／onPull／onOpt` 以 `useCallback` 固定參考、`RepoGrid` 直接傳穩定回呼（不再每次建立 inline 箭頭），逐張插入時只重繪新增那張。
- 排行榜切換基準時整頁跳動：非總計基準會濾掉 0 筆專案，長條數由總計 10 根降到本週 7／今日 1／該時間窗全空 0 根，面板高度隨之由 269px 縮到 203／71／43px，下方卡片網格（202 張）整片位移並重新排版重繪（CLS 0.03–0.10、最多位移 214px）。`.chart` 改為保留 10 列滿版高度（`min-height: 253px`＝10×16px＋9×6px 列距，不含 padding-top 16px；React 與 fallback 同修），實測切換後 `gridShift` 由 −198／−214px 歸零、CLS 0，JS 成本不變（1–4ms、無長任務）。
- 舊庫升級後排行榜只剩「總計」有資料：`repos` 新增的 `commitsToday／commitsWeek／commitsMonth` 由 migration 以預設 0 帶入，未重掃前排行非總計檢視全空。啟動時以 `PRAGMA user_version` 偵測落後，取本 DB 最後一次掃描的 `scans.rootDir`（非共用 config，避免複製／測試 DB 誤掃真實目錄）背景重掃一次回填後標記版本（`needsCommitStatsBackfill`／`markCommitStatsBackfilled`／`lastScanRootDir`），無 repo 或該目錄不存在則直接標記；回填失敗不標記，下次啟動重試。
- e2e `overview.spec.ts`：`pageerror` 亦過濾 Chrome 擴充功能來源（`content_main.js`／`content_guard.js`／`chrome-extension://` 及 `Could not establish connection`），避免沉浸式翻譯等擴充的未捕捉例外誤判為本頁錯誤。

## [0.3.0] - 2026-09-19

### 新增

- 卡片進階欄位（issue #14）：語言／目錄大小／活躍度；設定預設關閉，開啟後掃描每 repo 最多另計 2 秒，不放寬 git 12 秒逾時。
- pi 優化結束 toast 用高對比配色（完成亮綠、失敗亮紅、取消黃）並加粗；抽屜 job 狀態字同色加粗。
- pi 優化結束時右下角 toast 提醒（完成／失敗／取消，含專案名）；`job:done` 帶 status。
- 優化 job 執行中每 5 秒心跳（`$ still running`）並沖刷無換行殘行（`$ partial stdout/stderr`），避免 pi 長考時抽屜卡在 spawn 那一行。

- 掃描黑名單可編輯：`skipDirs` 持久化；`.git` 仍強制略過（issue #13）。
- 儀表板視覺小修：8px 間距、卡片／頂欄對比、按鈕 hover／focus、窄螢幕 rootDir 全寬；不換路由與狀態庫（issue #17）。
- 可選遞迴掃描：`scanRecursive`（預設 false）與 `scanDepth` 1–5；略過 `node_modules` 等，找到 `.git` 不再往內走（issue #12）。
- 多 prompt 樣板：`promptTemplates`／`activePromptId`；optimize 可帶 `promptId`；設定可增刪，頂部可選本次樣板（issue #11）。
- pi 併發上限（設定 `piConcurrency` 1–4，預設 2）：不同 repo 可同時跑，同 repo 或達上限回 409；取消單一 job 不影響其他（issue #10）。
- 掃描寫入 `remoteUrl`／`ahead`／`behind`（對照本地 tracking ref，不 fetch）；卡片顯示遠端與領先／落後；無 upstream 顯示「無 upstream」（issue #9）。
- `tests/scan-optimize-rescan.test.ts`：API 全鏈 scan → optimize（mock pi exit 0）→ 自動重掃，斷言 job.diff 與 `GET /api/repos`（issue #7）。

### 變更

- 儀表板改炭黑底＋磷光綠強調（綠色不再鋪滿畫面）；`DESIGN.md` 對齊。燈號綠／蜜黃／陶土，文字雙通道不變。
- 測試期預設改用簡短 prompt（只回 OK、列根層前 10 檔、不改檔）；正式樣板仍在設定／頂部可選「預設」。
- 根目錄 `npm run dev`／`build`／`start`／`test`：一鍵起 Vite+Express（issue #15）；Vite 開發時 WS 連 3000。
- README 對齊 0.2.0：正式 UI 為有 `dist` 時送 React、否則 fallback；拿掉「dist 尚未建置」與過時的 `/config`、測試筆數、目錄結構（issue #16）。

## [0.2.0] - 2026-09-18

### 新增

- Vite React 正式前端（issue #6）：`apps/web` 建置 `dist` 後後端優先送 React 儀表板；功能對等 fallback（掃描／搜尋篩選排序／卡片牆／詳情／pull／優化 WS 監控），並補設定抽屜四欄位；無 `dist` 時仍降級 `public` fallback。
- Playwright 補掃描／篩選／詳情／dirty pull／優化入口與手機寬度；e2e 改用暫存 DB，避免寫入本機 `repoagent.db`。
- 優化完成自動重掃：pi exit 0 後重掃該 repo 並記錄前後 diff（dirty／branch／hash），`GET /api/jobs/:id` 與 `job:done` 事件皆帶 diff；前端 drawer 顯示差異、結束時重整卡片牆（issue #2）。
- WS 即時推播：後端同埠建 WS server，廣播 `scan:done`／`job:log`／`job:done`（既有 emit 保留相容）；前端連線即時更新 log 與狀態、斷線自動重連＋降級輪詢（issue #3）。
- job log 輪轉：`data/jobs` 保留最新 50 個 `.log`（mtime 排序，超過刪檔不刪 DB 紀錄，失敗為 best-effort 不影響主流程）；optimize 建 job 與 pull 寫 log 共用同一上限（issue #4 收尾）。

### 變更

- Agent 指引（`AGENTS.md`／`CLAUDE.md`／`GEMINI.md`）：正式 UI 改為有 `apps/web/dist/index.html` 時優先送 Vite React，否則 `public` fallback（不再寫「dist 尚未為預設」）。

## [0.1.0] - 2026-09-17

### 新增

- 修正中文 prompt 經 cmd 被切碎：`shell:true` 下 cmd.exe 把含空白的中文 prompt 拆成多段 messages（pi 誤讀還跑去列父目錄），改走 stdin 傳 UTF-8，並吞掉 EPIPE；手動驗證 pi 可正確回應。

- 取消改用 `taskkill /PID /T /F` 連進程樹砍掉：Windows 下 `shell:true` 會包 cmd，只殺 wrapper 會留下孤兒 pi 續跑（實測確認）。

- 預設優化 prompt 測試期簡化＋提速：只回「OK」＋列根目錄前 10 檔、不改檔案；去掉 `repo=/branch=` 尾巴（pi 會拿它當待查證問題多跑數輪工具）並要求直接回答；spawn 加 `--offline`（跳過啟動期網路動作，實測啟動波動降為 1～2 秒）與 `--thinking minimal` 降推理檔。換回正式優化 prompt 時記得把 thinking 調回。
- 修正心跳誤報：只認檔名啟動時間與 job 相差 3 分鐘內的 pi session，不再被舊 job／孤兒進程的寫檔誤導。

- 卡片「用 pi 優化」按下後右側 drawer 即時監控：每 2 秒輪詢 `GET /api/jobs/:id` 顯示狀態／exitCode／起訖時間與 log 尾 50 行，支援取消（`DELETE /api/jobs/:id`），完成或失敗自動停止輪詢。

- 卡片顯示最後按「更新」的時間與 pull 回傳的最後一行（`lastPullAt` / `lastPullMsg`）。

- 卡片「更新」：對單一 repo 執行 `git pull --ff-only`（dirty 跳過、無 upstream 失敗、成功後重掃該卡，log 寫入 `data/jobs/pull-*.log`）。

- 新增 HTTP 煙霧測試（`GET /`、`favicon.ico`、`/api/health`、`scan/progress` 契約）與 Playwright 總覽頁（本頁無例外）。
- 新增 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`（三者必須內容同步，由 vitest `agent-docs-sync` 把關）。

- fallback 儀表板頂部可直接貼上 `rootDir` 路徑後掃描（Enter 或「掃描」）。
- 新增缺口 API：`GET /api/repos/:id`（詳情：status 前 50 行＋近 5 筆 commit）、`POST /api/repos/:id/optimize`（建 job 並啟動）、`GET /api/jobs/:id`（狀態＋log 尾 50 行）、`DELETE /api/jobs/:id`（取消）。
- 新增 `tests/jobs.test.ts` 端點測試（8 項，spawn 哨兵 mock＋真 git 透傳）。
- 新增設定模組 `configStore` 與 `GET/PUT /api/config`（rootDir/piPath/promptTemplate/timeout，持久化至 `data/config.json`）。

### 變更

- 優化 prompt 由測試期簡化版（回 OK＋列前 10 檔、不改檔案）換回規格 §4.3 正式版（分析品質並執行安全的優化）；`pi` spawn 移除 `--thinking minimal`，複雜重構不再降推理檔（`--offline`、`--print`、`--approve`、stdin 傳 prompt 維持）。

### 修正

- 啟動方式改 `npm start`（tsx 已收為本地依賴，免去 npx 連 registry，啟動 9 秒→3 秒）：同步 `README.md` 與 `AGENTS.md`／`CLAUDE.md`／`GEMINI.md`。

- 卡片「最後更新」時間與訊息改用不同字體顏色（時間灰、訊息白），避免兩者難以區分。
- 修正 `optimizer` 的 pi 呼叫參數：`pi` 無 `build` 子命令與 `--repo` 選項（log 報 `Unknown option: --repo`），改為非互動 `pi --print --approve <prompt>` 並以 `cwd` 指定 repo（`--approve` 避免未受信目錄在無 TTY 下無聲卡死）；job log 首行記 spawn 指令／pid／cwd、尾行記 exit code，無換行殘行也落檔，空 log 更好偵錯。

- `git pull` 改 `execFile` 硬逾時 25 秒並禁止互動憑證，避免「更新中」卡死；前端 30 秒中止請求。

- 正式啟動改用 `data/repoagent.db`（不再 `:memory:`），避免重開 server 後卡片 id 失效、`POST /pull` 404。

- `rootDir` 尾端多餘 `\` `/` 會正規化（`D:\github\` → `D:\github`）；輸入框在失焦／貼上／掃描時同步顯示。

- 修正 `GET /` 在 `apps/web/dist` 尚未建置時落入 Express 預設 404（並觸發 Chrome `default-src 'none'` CSP）；改為優先 `web/dist`、否則提供 `web/public` fallback 儀表板。
- 補 `favicon.svg` 並讓 `GET /favicon.ico` 回傳該圖，避免瀏覽器預設請求變成 404。
- 掃描改用 `git status --porcelain`、單 repo 12s 逾時、並行 6，避免數百個專案卡在「掃描中」；前端 90s 未回應會解除按鈕。
- 掃描中顯示進度 `已掃 n / 總數`（`GET /api/scan/progress` 輪詢）。
- 換目錄再掃描會刪除不在新 `rootDir` 的舊 repo，列表不再混入上一層路徑的專案。
- 修正 `index.ts` 於 ESM 下使用 `__dirname` 導致雙平台啟動即崩潰，改以 `import.meta.url` 推導路徑。
- 修正 `optimizer` 以 `fs.accessSync` 預檢 `pi` 指令造成 PATH 上的 `pi` 被誤判失敗，改以後端 `spawn` 的 `ENOENT` 事件判定。
- 新增 Windows 相容：`spawn` 於 Windows 啟用 `shell` 以解析 `pi.cmd/.bat/.ps1`，macOS/Linux 維持無 shell；`windowsHide` 隱藏多餘視窗。
- 修正 `optimizer` 結束流程：`job:done` 重複發送、`finishedAt` 提早寫入、`cancelJob` 未實際終止子進程；改為 SIGTERM 後 10 秒 SIGKILL 的跨平台終止流程。
- 修正 job log 與 repo 路徑改用絕對路徑，避免服務啟動工作目錄不同造成漂移；log 換行相容 CRLF/LF。
- `scanner` 黑名單目錄比對改為大小寫不敏感（Windows 檔案系統相容）。
- 修正 `job` 物件攜帶 Node `Timeout` 導致 API `res.json` 循環引用崩潰：逾時計時器改存獨立 `timeoutMap`。
- `apps/server` 新增 `engines: node >= 22`（`node:sqlite` 需求）。
- 修正 `config.ts` ESM 相容（移除 `require`/`__dirname`），修正設定路由掛載至 `/api/config`。
- 修 `scanner.ts` upsert 缺 `lastPullAt`／`lastPullMsg` 導致 `npm run typecheck` 失敗；並移除 simple-git 構造參數中實際無效的 `spawnOptions.env`（3.36 僅支援 uid／gid，傳 env 會被靜默忽略），改以 `process.env` 預設值落實規格 §4.2 防憑證等待（`GIT_TERMINAL_PROMPT=0` 等）。
- 修 `tests/api.test.ts` 固定 port `34567` 競態（`EADDRINUSE`／`fetch failed`）：改動態 port 並等待 `listening`／`close`。
