# 更新日誌

本檔案格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，
版本規範遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### 新增

- 新增 `startJob` mock-spawn 回歸測試（6 項）：spawn 參數鎖定、成功/失敗單次 `job:done`、ENOENT 提示、Windows `shell` 解析、cancel 實際殺進程、逾時 SIGTERM→SIGKILL。

### 修正

- 修正 `index.ts` 於 ESM 下使用 `__dirname` 導致雙平台啟動即崩潰，改以 `import.meta.url` 推導路徑。
- 修正 `optimizer` 以 `fs.accessSync` 預檢 `pi` 指令造成 PATH 上的 `pi` 被誤判失敗，改以後端 `spawn` 的 `ENOENT` 事件判定。
- 新增 Windows 相容：`spawn` 於 Windows 啟用 `shell` 以解析 `pi.cmd/.bat/.ps1`，macOS/Linux 維持無 shell；`windowsHide` 隱藏多餘視窗。
- 修正 `optimizer` 結束流程：`job:done` 重複發送、`finishedAt` 提早寫入、`cancelJob` 未實際終止子進程；改為 SIGTERM 後 10 秒 SIGKILL 的跨平台終止流程。
- 修正 job log 與 repo 路徑改用絕對路徑，避免服務啟動工作目錄不同造成漂移；log 換行相容 CRLF/LF。
- `scanner` 黑名單目錄比對改為大小寫不敏感（Windows 檔案系統相容）。
- `apps/server` 新增 `engines: node >= 22`（`node:sqlite` 需求）。
