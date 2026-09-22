# PR 工作流程（通用規範）

> 可直接複製到任何使用 Git + GitHub 的專案。
> 目的：讓 AI Agent 與人類以一致方式開分支、發 PR、自我 Code Review、修正並回覆，最後由人類合併。
> 本文件所有 `<...>` 皆為佔位，請依專案替換（例如 `<owner>/<repo>`、`<test>`、`<lint>`）。

## 0. 適用與前置

- 適用所有 Agent；開發一律走分支與 PR，**不直接提交 `main`**。
- 前置：`gh` 已登入且有該 repo 寫入權限（`gh auth status`）。

## 1. 開分支

- 命名：`feat/<scope>`、`fix/<scope>`、`docs/<scope>`；一律從最新 `main` 切出。
- `git checkout main && git pull && git checkout -b feat/<scope>`

## 2. 提交

- 提交前先問使用者「是否開始 Git 提交流程？」經核准後執行。
- Commit 格式：`<type>(<scope>): <subject>`（主旨與內容使用專案慣用語言）。
- `git add <指定檔案>` → `git commit` → `git push -u origin <branch>`

## 3. 開 PR

- `gh pr create --base main --head <branch> --title "..." --body "..."`
- body 必含：摘要、變更、測試結果；並以 `Closes #<issue>` 連動 issue。

## 4. 自我 Code Review（開 PR 後、合併前必做）

### 4.1 取得差異

- `git fetch origin main --quiet && git diff origin/main`

### 4.2 兩段式檢查

- **CRITICAL**：資料安全（SQL／注入）、併發與競態、信任邊界（外部／LLM 輸出驗證）、enum／值完整性（新值是否所有消費端都處理）。
- **INFORMATIONAL**：條件式副作用、魔數與字串耦合、死碼與一致性、測試缺口、效能／bundle、前端與可及性。
- 只回報真問題，附 `file:line` 與修法；已修者不重複提。

### 4.3 把意見貼回 PR

- 整體評論：`gh pr review <n> --comment --body-file <body.md>`
- 行內評論（Files changed）：以 `gh api` 建立帶 `comments` 的 review：

  ```bash
  gh api -X POST repos/<owner>/<repo>/pulls/<n>/reviews --input <review.json>
  ```

  `review.json`：

  ```json
  {
    "commit_id": "<PR head SHA>",
    "event": "COMMENT",
    "body": "整體說明（可空）",
    "comments": [{ "path": "src/a.js", "line": 12, "side": "RIGHT", "body": "問題與建議" }]
  }
  ```

  - `line` 必須是「新檔」且在 diff 內的行；`side: "RIGHT"` 代表新檔側。
  - 取得 head SHA：`gh pr view <n> --json headRefOid -q .headRefOid`

## 5. 依意見修正

- 分類處理：
  - **AUTO-FIX**（機械、安全）：直接改。
  - **NEEDS INPUT**（需判斷／安全敏感／大改／改動使用者可見行為）：先問使用者。
- 修正後推上**同一分支**（不另開 PR）。

## 6. 逐則回覆留言

- 取留言 id：`gh api repos/<owner>/<repo>/pulls/<n>/comments -q '.[] | "\(.id)\t\(.path):\(.line)"'`
- 回覆（掛在該討論串下）：

  ```bash
  gh api -X POST repos/<owner>/<repo>/pulls/<n>/comments/<id>/replies -f body='已修（<commit SHA>）：...'
  ```

## 7. 合併（一律由人類處理）

- Agent **不** merge、**不** force-push、**不**改 git config、**不**刪分支。
- 若 PR body 有 `Closes #<issue>`，合併後 issue 會自動關閉。

## 8. 收尾驗證

- 測試全綠、格式檢查、`git diff --check`。
- 範例：`npm test`、`npx prettier --check .`、`git diff --check`（依專案替換）。

## 9. 導入其他專案

1. 複製本檔到目標專案根目錄。
2. 在該專案的 Agent 規範檔（`AGENTS.md`／`CLAUDE.md`／`GEMINI.md` 等）加一行：
   `> Git／PR 流程一律依 [PR-WORKFLOW.md](./PR-WORKFLOW.md)。`
3. 依專案替換 §0 佔位（測試／lint 指令、分支前綴等）。

## 附註：多帳號（gh）

- 切換：`gh auth switch --user <account>`（或 `gh auth switch` 互動選單）。
- `gh` 帳號只影響 gh 指令；git push 走 remote／SSH，需另設。
