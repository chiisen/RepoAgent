# RepoAgent 設計規格書 — 指定目錄 Git 專案管理 + pi 優化

- 日期：2026-09-15
- 狀態：已確認（四節設計經使用者確認）
- 技術方案：方案 1 Node.js 全端單體
- 存放路徑：`docs/superpowers/specs/2026-09-15-repoagent-design.md`

## 1. 背景與目標

使用者在本機有大量 git 專案，分散於某個指定目錄下一層（例如 `D:\github\*`）。
需要一個好閱讀的 Web 儀表板，一眼看出每個專案的基礎狀態，
並能對指定專案呼叫外部 `pi` CLI 做程式碼品質優化。

V1 目標：
1. 設定 rootDir，僅掃下一層是否為 git repo，是才納管。
2. 每專案顯示精簡狀態：分支、乾淨與否、最後 commit 時間與訊息。
3. 可對單一專案啟動一次 pi 優化，即時看 log，完成自動重掃。
4. Windows 11 + PowerShell 7 優先可用。

非目標（V1 明確不做）：
遞迴掃描、ahead/behind、remote URL、contributor/語言/大小/活躍度、
多併發優化、多 prompt 模板、權限管理。

## 2. 架構

```
[Browser React] <--HTTP/WS--> [Node Express API] --> [Scanner: simple-git]
                                             \--> [Optimizer: pi CLI spawn]
                                             \--> [SQLite: repos/scans/jobs]
```

- 單一 npm 專案，`apps/server` + `apps/web`。
- `npm run dev` 同起前後端，`npm run build` 把 web 打包進 `server/public`，正式只跑一個 port（預設 3000）。
- 前端只讀 DB，不直接跑 git。掃描與優化皆由後端執行，經 WS 推播進度。
- SQLite 單檔存放於 `data/repoagent.db`，job log 存檔於 `data/jobs/{jobId}.log`。

### 後端模組邊界

- `configStore`：rootDir、pi 指令樣板、pi 絕對路徑、port、timeout。
- `scanner`：列目錄 → 判斷 `.git` → 跑 git 指令取精簡欄位 → 寫 DB。
- `optimizer`：job queue（V1 單併發，一次只跑一個 pi）、spawn、串流 log、逾時與取消、完成後重掃。
- `db`：三表 `repos / scans / jobs`。
- `api + ws`：REST + WebSocket 推播 `scan:done`、`job:log`、`job:done`。

## 3. 功能設計

### 3.1 總覽頁 `/`

頂部 Bar：
- rootDir 顯示 + 變更按鈕、重新掃描按鈕、搜尋框、篩選（全部/乾淨/有變更）、排序（名稱/最後 commit）。

卡片牆：
- 每 repo 一卡。標題列 = 名稱 + 燈號文字雙通道：
  - 綠「乾淨」、黃「有變更」、紅「失敗」。
  - 非 git 目錄跳過不顯示（不佔卡片牆）。
- 卡身四行：
  1. 分支 `branch`
  2. 狀態 `乾淨` 或 `M x A y D z`（由 `status --porcelain` 計數，V1 顯示總數與前綴統計即可）
  3. 最後 commit `YYYY-MM-DD HH:mm + 前 72 字訊息`
  4. 上次掃描 `relative time`
- 卡尾動作：`詳情`、`用 pi 優化`。job 執行中時按鈕 disabled 並顯示進度條。

### 3.2 詳情抽屜

- 點詳情右滑出，不跳頁。
- 內容：`git status --short` 前 50 行、`git log -5`（hash|date|subject）、上次優化報告摘要 + 完整 log 連結。

### 3.3 優化執行視圖

- 按下後卡片直接變進度態，抽屜下方追加即時 log 區（WS 串流）。
- 完成顯示 `成功/失敗 + 耗時 + 重掃後狀態差異`（例如 dirty 否→是表示 pi 改了東西）。

### 3.4 設定

- rootDir、pi 執行檔絕對路徑（預設 `pi` 走 PATH）、指令樣板文字框、timeout 秒數（預設 600）。
- 黑名單目錄：預設跳過 `node_modules、.superpowers`（即使含 `.git` 也不掃）。

## 4. 資料流與 pi CLI 整合

### 4.1 資料模型（SQLite）

```sql
repos(id TEXT PK, name TEXT, path TEXT UNIQUE, branch TEXT, isDirty INTEGER,
      dirtyCount INTEGER, lastCommitHash TEXT, lastCommitTime TEXT,
      lastCommitMsg TEXT, lastScannedAt TEXT, lastError TEXT);
scans(id INTEGER PK AUTOINC, rootDir TEXT, startedAt TEXT, finishedAt TEXT,
      total INTEGER, okCount INTEGER, failCount INTEGER);
jobs(id TEXT PK, repoId TEXT, prompt TEXT, status TEXT,
     logPath TEXT, exitCode INTEGER, startedAt TEXT, finishedAt TEXT);
```

狀態枚舉：`queued/running/done/failed/cancelled`。

### 4.2 掃描流

1. `POST /api/scan {rootDir}` → 建 scans 紀錄 → `fs.readdir(rootDir, {withFileTypes:true})` 只取目錄。
2. 每目錄依序：
   - 不存在 `.git` → 跳過。
   - 跑 `rev-parse --abbrev-ref HEAD` 取分支。
   - 跑 `status --porcelain` 判斷 dirty + 計數。
   - 跑 `log -1 --format=%H|%ad|%s --date=iso` 取最後 commit。
   - 寫入 repos（upsert by path）。
3. 單一 repo 失敗不中斷整批，該筆寫 `lastError`，前台紅燈。
4. rootDir 不存在/無權限 → 400 + 明確訊息，前端 toast。

git 失敗對照：
- `not a git repository` → 視為跳過。
- 其餘錯誤 → 該 repo 標失敗。

### 4.3 優化流（程式碼品質優先）

預設 prompt 樣板：
```
分析此 repo 的程式碼品質（異味、重複、依賴老舊），提出並執行安全的優化，
保留 git 可回退，輸出繁中摘要。repo={repoPath} branch={branch}
```

- `POST /api/repos/:id/optimize {prompt?}` → 建 job（queued）。V1 單併發：已有 running 則新 job 排隊等待。
- 執行：`spawn(piPath, buildArgs(prompt, repoPath), {cwd: repoPath})`。
- stdout/stderr 逐行追加 `data/jobs/{jobId}.log` + WS 廣播 `job:log {jobId, line}`。
- 完成碼 0 → done → 自動重掃該 repo → WS `job:done` 帶前後 diff。
- 非 0 / 逾時 → failed，紅燈 + 錯誤尾 20 行。
- `DELETE /api/jobs/:id` → SIGTERM，10 秒不死才 SIGKILL → cancelled。
- pi 不存在（ENOENT）→ 立即 failed，提示去設定頁修正 pi 路徑。

### 4.4 API 草案

- `GET /api/repos?q=&filter=&sort=` → 卡片列表。
- `GET /api/repos/:id` → 含 status/log 前 50 行/log5。
- `POST /api/scan` → 觸發全量掃描。
- `POST /api/repos/:id/optimize` → 建 job。
- `GET /api/jobs/:id` → job 狀態 + log 尾。
- `DELETE /api/jobs/:id` → 取消。
- `GET /api/config` / `PUT /api/config` → 設定。
- WS：`scan:done`、`job:log`、`job:done`。斷線前端重連 + 降級每 3 秒輪詢 job。

## 5. 非功能需求

- 效能：50 repo 掃描 < 15 秒；首屏 < 1.5 秒（讀 DB）。
- 可用性：字級 >=14px、燈號 + 文字雙通道（色盲友善）。
- 可攜：路徑一律 `path.resolve`，支援 Windows 中文路徑與空白路徑（spawn 用 args 陣列不拼接字串）。
- 資料保留：log 保留最近 50 個 job 檔，超過刪檔不刪 DB 紀錄。

## 6. 成功標準（驗收）

1. 設定 rootDir 按掃描，下一層 git 專案全列出，分支/乾淨/最後 commit 正確。
2. 任一 repo 改一行不提交，重掃後該卡變黃且計數 +1。
3. 按優化能看到即時 log，完成後自動重掃且狀態更新。
4. 拔掉 pi 指令能看到明確失敗提示而非卡死。

## 7. 測試計畫

- 後端 `vitest`：
  - scanner fixture：temp dir `git init + commit + dirty` 三態斷言。
  - optimizer：mock spawn 回放 log，斷言 WS 事件順序。
  - API e2e：scan→optimize→rescan 全鏈。
- 前端 `playwright` smoke：mock API 回 3 種燈號，斷言不斷行 + 截圖。
- 手動：Windows 實機 `D:\github\chiisen` 驗證中文路徑，`git diff --check` 通過。

## 8. 決策紀錄

- 應用型態：A Web 儀表板（好閱讀優先）。
- pi 形式：外部 pi CLI（非內建 AI）。
- 優化優先：程式碼品質。
- 掃描深度：僅下一層。
- 狀態粒度：精簡版。
- 技術棧：Node Express + better-sqlite3 + Vite React（單 port 伺服）。

## 9. 風險與對策

- pi 輸出不可控 → 只串流不解析，以 exit code 判成敗，重掃 git 狀態為準。
- 長時間優化卡死 → 預設 10 分鐘 timeout + 取消按鈕。
- 中文/空白路徑 → spawn args 陣列 + path.resolve，全鏈手動驗證。
- 誤改程式碼 → prompt 要求保留 git 可回退，優化前記錄 `lastCommitHash` 以便比對。
