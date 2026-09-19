# RepoAgent

指定目錄下的 git 專案管理儀表板：掃描下一層專案、卡片顯示精簡狀態（分支／乾淨與否／最後 commit），並可呼叫外部 `pi` CLI 做程式碼品質優化。

目前版本：**0.3.0**（`main`）。

## 規格

- 後端：`docs/superpowers/specs/2026-09-15-repoagent-design.md`
- 前端：`docs/superpowers/specs/2026-09-17-web-frontend-design.md`
- 技術：Node 22+、Express、`node:sqlite`、單一 port（預設 3000）
- UI：有 `apps/web/dist/index.html` 時送 Vite React；否則 `apps/web/public` fallback。`GET /` 不會落到 Express 預設 404。

## 快速開始

從**專案根目錄**執行。

```powershell
npm install
npm run dev
```

開發用 Vite：`http://localhost:5173`（`/api` 與 WebSocket 連後端 3000）。

單 port（正式 UI 由 Express 送 `dist`）：

```powershell
npm run build
npm start
```

開 `http://localhost:3000`。`dist/` 不納版控；未 build 時仍可用 `public` fallback。不要在根目錄直接跑 `tsx src/index.ts`。

---

## 網頁操作

### 掃描

- 頂部貼上 `rootDir`（例如本機的 github 目錄），Enter 或按「掃描」。
- 預設只掃**下一層**；設定可開遞迴（深度 1–5）。有 `.git` 才納管。
- 燈號：綠乾淨、黃有變更、紅掃描失敗。
- 可搜尋名稱、篩選全部／乾淨／有變更、依名稱或最後 commit 排序。

### 卡片動作

- **詳情**：status 前段與近 5 筆 commit。
- **更新**：該卡 `git pull --ff-only`（dirty 跳過、無 upstream 失敗）。
- **用 pi 優化**：可設併發 1–4（預設 2）；即時 log；exit 0 後重掃並顯示前後 diff。同一專案或達上限時 409。

### 設定

頂部「設定」開抽屜（沒有 `/config` 路由），可改：

- `rootDir`
- pi 路徑（`pi` 或絕對路徑）
- prompt 樣板（可多筆、選預設；頂部可選本次優化用哪一個）
- timeout（秒）
- pi 併發（1–4，預設 2）
- 遞迴掃描與深度
- 掃描黑名單（目錄名，每行一個）

`pi` 需自行安裝；路徑錯誤應出現明確失敗，不應卡死。

---

## API（curl）

後端就緒即可呼叫，與是否已 `vite build` 無關。

```powershell
curl http://localhost:3000/api/health
curl http://localhost:3000/api/config
curl http://localhost:3000/api/repos
curl -X POST http://localhost:3000/api/scan -H "Content-Type: application/json" -d "{\"rootDir\":\"你的目錄\"}"
```

job 用掃描／優化回傳的 UUID：`GET /api/jobs/:id`、`DELETE /api/jobs/:id`。

---

## 測試

```powershell
cd apps/web
npm test
cd ../server
npm test
npx playwright test
```

Playwright 忽略 Chrome 擴充功能（`content_main.js`）的 console。本頁錯誤看堆疊是否為 `(index)`。

---

## 已知限制

- 未執行 `apps/web` 建置時走 fallback，功能對等但無獨立設定抽屜（fallback 頂部只改 rootDir）。
- 預設僅掃描下一層（可選遞迴）；pi 預設最多 2 個同時跑。
- 不內建安裝 `pi`。

---

## 專案結構

```
.
├─ apps/server/     # Express + WS（port 3000）
├─ apps/web/        # Vite React（src／static）；public 為 fallback；dist 建置產物
├─ data/            # config.json、*.db 不納版控
├─ CHANGELOG.md
└─ README.md
```
