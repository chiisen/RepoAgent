# 更新日誌

本檔案格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，
版本規範遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### 新增

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
