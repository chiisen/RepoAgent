# RepoAgent
指定目錄下的 git 專案管理儀表板：掃描下一層專案、卡片式顯示精簡狀態（分支/乾淨與否/最後 commit），並可呼叫外部 pi CLI 做程式碼品質優化。

## 規格
- `docs/superpowers/specs/2026-09-15-repoagent-design.md`
- 技術棧：Node 24 + Express + node:sqlite 單 port 伺服
- 狀態：開發中（branch `main`，V1 功能已合併）

## 快速開始

以下指令皆從**專案根目錄**執行。

### 1. 安裝相依項
```powershell
cd apps/server
npm install
```

### 2. 啟動後端伺服器
```powershell
cd apps/server
npm start
```
伺服器將在 `http://localhost:3000` 啟動。

### 3. 開啟網頁
直接在瀏覽器開啟：`http://localhost:3000`

> 正式 UI：`cd apps/web && npm install && npm run build` 後重啟後端，`GET /` 會送 React `dist`。未建置時使用 `apps/web/public` fallback。

---

## 網頁功能操作指南

### 2.1 目錄掃描
- **頁面頂部**顯示當前 `rootDir` (預設 `D:\github`)
- 點擊 **「掃描」按鈕**
- 伺服器會掃描 `rootDir` 下一層所有子目錄
- **含 `.git`** 的子目錄會被納入管理並顯示為卡片
- **不含 `.git`** 的子目錄會被跳過

### 2.2 卡片狀態閾值
每張卡片顄示：
- **🟢 綠色**：乾淨 (`git status --porcelain` 為空)
- **🟡 黃色**：有變更 (有未提交的修改)
- **🔴 紅色**：失敗 (掃揲過程發生錯誤)

卡片欄位說明：
- **分支**：目前所在分支名稱
- **最後 commit**：最近一次 commit 的時間 + 訊息前段
- **M/A/D 計數**：Modified/New/Deleted 檔案計數

### 2.2 修改檔案後重掃
1. 在某個已納管專案資料夾下（`rootDir` 的下一層）新增或修改一個檔案
2. 返回網頁，點擊 **「重新掃描」** 按鈕
3. 觀察該卡片：
   - **預期**：原本 🟢 變 🟡 黃色
   - 卡身計數會變化 (如 `M 1` 表示新增/修改 1 個檔案)

### 2.3 呼叫外部 pi CLI 進行優化
> **先決條件**：你必須已安裝 `pi` CLI 並能在終端機中運行，或在設定頁填寫絕對路徑。

1. 點擊 **「設定」** 按鈕，或直接訪問 `http://localhost:3000/config`
2. 在「pi 路徑」欄位填入：
   - `pi` (如果已加入系統 PATH)
   - 或是絕對路徑 (如 `C:\Program Files\pi\bin\pi.exe`)
3. 點擊「儲存」
4. 返回主頁面，任選一個專案卡片
5. 點擊卡片右下角 **「用 pi 優化」** 按鈕
6. 即會顯示即時 log，過程會：
   - 呼叫 `pi` 分析程式碼品質
   - 顯示串流中的輸出訊息
   - 完成後自動重新掃描該專案
   - 顯示優化前後的狀態差異

### 2.4 停用 pi (失敗情境測驗)
- 在設定頁將 pi 路徑清空或填入錯誤路徑
- 點擊「用 pi 優化」
- **預期**：應該顯示明確的錯誤訊息 (如 "pi 指令未找到，請檢查路徑")，而非頁面卡死或轉圈轉

---

## 3. API 直接操作 (替代網頁)

因目前前端 dist 尚未建置，若想直接透過 API 操作，可使用 curl:

```powershell
# 1. 健康檢查
curl http://localhost:3000/api/health
# {"ok":true}

# 2. 查看專案列表
curl http://localhost:3000/api/repos
# {"repos":[],"total":0} (尚未掃描)

# 3. 啟動掃描（rootDir 改成你要掃的目錄）
curl -X POST http://localhost:3000/api/scan -H "Content-Type: application/json" -d "{\"rootDir\":\"..\"}"

# 4. 查看設定
curl http://localhost:3000/api/config

# 5. 修改設定 (rootDir)
curl -X PUT http://localhost:3000/api/config -H "Content-Type: application/json" -d "{\"rootDir\":\"..\"}"

# 6. 列出 job 狀態
curl http://localhost:3000/api/jobs/1
# {"status":"not_found"} (stub)
```

---

## 4. 補建前端 (完整 UI 體驗)

```powershell
cd apps/web
npm install
npm run build
# 重啟 apps/server 的 npm start 後開啟 http://localhost:3000
```

建置後有卡片牆、搜尋／篩選／排序、詳情與優化抽屜、設定抽屜（rootDir／pi 路徑／樣板／timeout）。

---

## 5. 已知限制

- **未執行 `apps/web` 建置時**：`GET /` 走 fallback 基礎介面；`npm run build` 後為 React 正式版
- **pi CLI 必須手動安裝**：本專案不自動安裝 pi，請自行安裝或提供絕對路徑
- **僅掃描下一層**：不支援遞迴掃描子目錄
- **單一 pi job 佇列**：同一時間只能進行一個優化作業，新請求會進入佇列

---

## 開發者資訊

- **規格書**：`docs/superpowers/specs/2026-09-15-repoagent-design.md`
- **測試**：`npm test` (vitest，15/15 PASS)
- **授權**：請參閱 `LICENSE`
- **分支**：`main` (合併自 `feat/repoagent-v1` 與 `feat/repoagent-v1-config`)

---

## 專案結構概覽

```
.
├─ apps/server/           # Node Express 後端 (port 3000)
│   ├─ src/               # 來源碼
│   │   ├─ db.ts          # node:sqlite Schema
│   │   ├─ index.ts       # Express + WS + Router
│   │   ├─ config.ts      # 設定管理
│   │   ├─ routes/        # API 端點
│   │   ├─ scanner.ts     # 掃描引擎
│   │   └─ optimizer.ts   # Job queue / pi 優化
│   └─ tests/             # 15 個 vitest 測試
├─ apps/web/              # 前端 (Vite + React，待 build)
│   └─ src/               # UI 組件 (預留)
│   └─ public/            # 靜態資源
├─ .gitignore
├─ CHANGELOG.md           # `- feat: RepoAgent V1 上線 2026-09-15`
├─ package.json           # workspace: ["apps/*"]
└─ README.md              # 本檔案