# RepoAgent — Agent 指引

> **同步規則（強制）**：`AGENTS.md`、`CLAUDE.md`、`GEMINI.md` **必須位元組級相同**（含換行）。只改其中一份 = 未完成。改完後執行 `apps/server` 的 `npm test`（含 `agent-docs-sync`）。三檔若不一致，禁止 commit。

## 這是什麼

本機 Git 專案儀表板：掃 `rootDir` **下一層**、有 `.git` 才納管，卡片顯示分支／乾淨與否／最後 commit，並可呼叫外部 `pi` CLI 做程式碼品質優化。

- 規格：`docs/superpowers/specs/2026-09-15-repoagent-design.md`
- 技術：Node 22+、Express、`node:sqlite`、單一 port（預設 3000）
- 佈局：`apps/server` 後端；有 `apps/web/dist/index.html` 時優先送 Vite React，否則 `apps/web/public` fallback

## 啟動（專案根目錄）

```powershell
npm install
npm run dev
```

開發：瀏覽器開 `http://localhost:5173`（Vite；`/api` 與 WS 連 3000）。單 port：`npm run build` 後 `npm start`，開 `http://localhost:3000`。不要在根目錄直接跑 `tsx src/index.ts`。

## 實作約束

- 掃描只用 `git status --porcelain`，禁止完整 `git.status()` 掃盡未追蹤檔。
- 單 repo git 硬逾時 12 秒；並行上限 6；`GIT_TERMINAL_PROMPT=0`。
- 換 `rootDir` 再掃必須**覆蓋** `repos`（刪掉不在本輪的舊列）。
- 無 `apps/web/dist/index.html` 時送 `apps/web/public`，`GET /` 不得落到 Express 預設 404。
- `data/config.json`、`data/*.db*` 不納版控。
- 路徑用 `path.resolve`／spawn args 陣列，支援 Windows 中文與空白路徑。
- 卡片「更新」僅 `git pull --ff-only`：dirty 跳過、無 upstream 失敗、45 秒逾時；不要做全部 pull 或自動 stash/merge。

## 測試

```powershell
cd apps/server
npm test
npx playwright test
```

Playwright 忽略 Chrome 擴充功能（`content_main.js`）的 console。本頁錯誤看堆疊是否為 `(index)`。

## Git

- Conventional Commits，主旨與內文 **繁體中文**。
- 使用者說 commit / push 才執行；不要 `git push --force`。
- 變更後更新根目錄 `CHANGELOG.md`（Keep a Changelog，繁中）。

## 回覆

對使用者使用**繁體中文**。
