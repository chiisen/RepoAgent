# 更新日誌

本檔案格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，
版本規範遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### 新增

- 新增缺口 API：`GET /api/repos/:id`（詳情：status 前 50 行＋近 5 筆 commit）、`POST /api/repos/:id/optimize`（建 job 並啟動）、`GET /api/jobs/:id`（狀態＋log 尾 50 行）、`DELETE /api/jobs/:id`（取消）。
- 新增 `tests/jobs.test.ts` 端點測試（8 項，spawn 哨兵 mock＋真 git 透傳）。

### 修正

- 修正 `index.ts` 於 ESM 下使用 `__dirname` 導致雙平台啟動即崩潰，改以 `import.meta.url` 推導路徑。
- 修正 `optimizer` 以 `fs.accessSync` 預檢 `pi` 指令造成 PATH 上的 `pi` 被誤判失敗，改以後端 `spawn` 的 `ENOENT` 事件判定。
- 新增 Windows 相容：`spawn` 於 Windows 啟用 `shell` 以解析 `pi.cmd/.bat/.ps1`，macOS/Linux 維持無 shell；`windowsHide` 隱藏多餘視窗。
- 修正 `optimizer` 結束流程：`job:done` 重複發送、`finishedAt` 提早寫入、`cancelJob` 未實際終止子進程；改為 SIGTERM 後 10 秒 SIGKILL 的跨平台終止流程。
- 修正 job log 與 repo 路徑改用絕對路徑，避免服務啟動工作目錄不同造成漂移；log 換行相容 CRLF/LF。
- `scanner` 黑名單目錄比對改為大小寫不敏感（Windows 檔案系統相容）。
- 修正 `job` 物件攜帶 Node `Timeout` 導致 API `res.json` 循環引用崩潰：逾時計時器改存獨立 `timeoutMap`。
- `apps/server` 新增 `engines: node >= 22`（`node:sqlite` 需求）。
