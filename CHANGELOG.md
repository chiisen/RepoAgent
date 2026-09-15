# 更新日誌

本檔案格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，
版本規範遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### 新增

- 新增 HTTP 煙霧測試（`GET /`、`favicon.ico`、`/api/health`、`scan/progress` 契約）與 Playwright 總覽頁（本頁無例外）。
- 新增 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`（三者必須內容同步，由 vitest `agent-docs-sync` 把關）。

- fallback 儀表板頂部可直接貼上 `rootDir` 路徑後掃描（Enter 或「掃描」）。
- 新增缺口 API：`GET /api/repos/:id`（詳情：status 前 50 行＋近 5 筆 commit）、`POST /api/repos/:id/optimize`（建 job 並啟動）、`GET /api/jobs/:id`（狀態＋log 尾 50 行）、`DELETE /api/jobs/:id`（取消）。
- 新增 `tests/jobs.test.ts` 端點測試（8 項，spawn 哨兵 mock＋真 git 透傳）。
- 新增設定模組 `configStore` 與 `GET/PUT /api/config`（rootDir/piPath/promptTemplate/timeout，持久化至 `data/config.json`）。

### 修正

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
