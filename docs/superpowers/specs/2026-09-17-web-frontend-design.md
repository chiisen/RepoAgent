# RepoAgent Web 前端（React 重寫）設計規格

- 日期：2026-09-17
- 狀態：待審（使用者已批准設計方向，待審閱本文件）
- 對應 issue：#6（前端儀表板）
- 前置規格：`docs/superpowers/specs/2026-09-15-repoagent-design.md`（後端 API／WS／資料模型沿用，不更動）
- 範圍決議：與現有 `apps/web/public` fallback **功能對等**重寫＋補設定頁；fallback 保留作降級；設定頁用抽屜（無路由）。

## 1. 背景與目標

後端已完成（掃描／pull／optimize／WS 推播／設定 API），正式 UI 應為 Vite React 打包之 `apps/web/dist`（後端 `findIndexHtml` 已優先採用）。現況 `apps/web` 僅有原生 JS fallback（`public/`），#6 要求補上 React 正式版。

目標：
1. React 重寫 fallback 全部功能（掃描、搜尋／篩選／排序、卡片牆、詳情抽屜、pull、優化即時監控）。
2. 新增設定抽屜（讀寫 `GET/PUT /api/config` 四欄位）。
3. `vite build` 產出 `dist` 後，後端**一行不改**即送新 UI；無 `dist` 時仍回 fallback。

非目標（明確不做）：
- 黑名單可編輯：config API 無此欄位，維持 server 常數 `SKIP_DIRS`，不新增端點。
- react-router、外部狀態庫（Query／Redux）、UI 框架、視覺大改版。
- 後端任何改動（API／WS 協議凍結；e2e 加測除外）。

## 2. 架構

```
apps/web/
├─ package.json        # scripts: dev / build / preview / test
├─ vite.config.ts      # outDir: dist；dev server proxy /api＋WS→ http://localhost:3000
├─ index.html          # Vite 入口
└─ src/
   ├─ main.tsx         # 掛載
   ├─ App.tsx          # 單頁組裝＋全域狀態（useState）
   ├─ api.ts           # REST 封裝（fetch＋錯誤正規化，沿用 fallback 語義）
   ├─ useRepos.ts      # 列表載入／篩選／排序／重掃
   ├─ useWs.ts         # WS 連線／重連／降級旗標（沿用訊息協議）
   ├─ format.ts        # 純函數：燈號、時間、diff 文案（可單測）
   ├─ components/
   │   ├─ Header.tsx   # rootDir＋掃描＋搜尋＋篩選＋排序
   │   ├─ RepoGrid.tsx ＋ RepoCard.tsx
   │   └─ Drawer.tsx   # 三態：detail／job／settings
   └─ index.css        # 深色系（視覺與 fallback 一致）
```

依賴：react、react-dom、vite、typescript（＋ vitest 測純函數；Playwright 沿用 server 端 e2e）。無其他 runtime 依賴。

## 3. 元件與互動（對等映射）

| fallback 現況 | React 對應 | 備註 |
|---|---|---|
| header rootDir 輸入＋掃描鈕＋進度遮罩 | Header | 掃描中 disabled、進度 `已掃 n／總數`（輪詢 `scan/progress`，沿用） |
| 搜尋／篩選／排序 | Header | 同 query 參數語義 |
| 卡片（燈號＋分支／狀態／最後 commit／上次掃描／最後更新） | RepoCard | 燈號＋文字雙通道維持（色盲友善） |
| 詳情抽屜（status 前 50＋log5） | Drawer(detail) | 同 `GET /api/repos/:id`  shape |
| 更新按鈕（pull） | RepoCard | dirty 409／無 upstream／逾時語義沿用 |
| 優化抽屜（log 尾 50＋心跳＋diff＋取消） | Drawer(job) | 同 `GET /api/jobs/:id` shape；結束自動重整卡片牆 |
| （無） | Drawer(settings) | 四欄位讀寫，儲存成功 toast，失敗顯示後端錯誤訊息 |

## 4. 資料流

REST（凍結，照搬）：
- `GET /api/repos?q=&filter=&sort=`、`GET /api/repos/:id`
- `POST /api/scan`＋`GET /api/scan/progress`、`GET/PUT /api/config`
- `POST /api/repos/:id/optimize`、`POST /api/repos/:id/pull`
- `GET /api/jobs/:id`、`DELETE /api/jobs/:id`

WS（凍結，照搬 `{"type", ...}` 協議）：
- 連線成功：job 輪詢降為 5 秒（心跳保鮮）；`job:log` 直接 append、`job:done` 立即刷新＋重整卡片牆、`scan:done` toast＋重整。
- 斷線：3 秒重連；斷線期間輪詢 3 秒（規格 §4.4 降級語義，數字沿用 fallback 實作）。

## 5. 錯誤處理

- 空列表顯示「尚無專案，請先掃描」；rootDir 缺失／不存在顯示後端錯誤 toast。
- 掃描 90 秒／pull 30 秒前端逾時語義沿用（AbortController）。
- pi 路徑錯誤顯示後端明確錯誤（非轉圈卡死）。
- WS 連不上不報錯（靜默重連＋降級輪詢 cover）。

## 6. 建置與整合

1. `cd apps/web && npm install && npx vite build` → `apps/web/dist/`。
2. 重啟後端（`npm start`），`GET /` 命中 `dist/index.html`（`findIndexHtml` 既有順序）。
3. 後端零改動；`data/`、`node_modules/`、`dist/` 皆已在 `.gitignore`（`dist/` 規則已存在）。
4. Dev 流程：`vite dev`＋proxy，後端跑 `:3000`。

## 7. 測試計畫

- Playwright（沿用 `apps/server/e2e/`，不新增配置）：既有總覽 smoke 在 dist 建好後自然覆蓋 dist 版；新增「設定抽屜開啟→儲存→toast」流程不斷言副作用（PUT 同值寫回）。
- vitest（`apps/web` 內）：`format.ts` 純函數（燈號分類、diff 文案、時間裁切）。
- 降級驗證：暫時移走 `dist`，確認 `GET /` 回 fallback 且 smoke 仍過（還原後重建）。
- DoD：`tsc --noEmit`（web）、`vite build` 成功（warning 可接受）、`git diff --check`。

## 8. 驗收標準（關 #6 條件）

1. `vite build` 產出 `dist`，後端 src 未改一行（僅 e2e 加測），`GET /` 送 dist 版。
2. 第 3 節對等功能全可用（含設定抽屜四欄位讀寫）。
3. `apps/server` 既有 `npm test`＋Playwright 全過（含新增設定流程）。
4. 移除 `dist` 後 fallback 降級成立（一次性手動驗證）。

## 9. 風險與對策

- 後端 API 漂移：本 spec 凍結 §4.4 契約；若後端先變，需同步更新本文件。
- 中文／空白路徑：顯示層僅透傳字串，spawn 安全已由後端 args 陣列保障。
- 首次建置依賴下載：`npm ci` 鎖版； pioneer 風險低。
