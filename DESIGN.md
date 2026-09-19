# Design System — RepoAgent

## Product Context
- **What this is:** 本機 Git 專案儀表板：掃下一層 repo、看乾淨／髒、pull、呼叫 pi 優化。
- **Who it's for:** 單人開發者，長時間對螢幕掃卡片與 log。
- **Space/industry:** 開發者內部工具（非行銷站）。
- **Project type:** App UI／dashboard（資料密、任務導向）。

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian — 炭黑底＋磷光綠點綴（不是整頁塗綠）。
- **Decoration level:** minimal。
- **Mood:** 終端／IDE：中性表面、綠色只出現在焦點與狀態。
- **Anti-patterns:** 紫漸層、三欄 icon 卡、全置中、一律大圓角、emoji 當圖示。

## Typography
- **Display / Body / UI:** `system-ui, "Segoe UI", sans-serif` — 繁中優先、零網路字型、避免 FOUT。
- **Code / log:** 繼承 UI（pre 不另載網字）；日後可加 `ui-monospace, "Cascadia Mono", "Sarasa Mono TC"`。
- **Scale:** 13（meta／pre）／14（控制項）／15（卡片標題）／16（body／toast）／1.15rem（抽屜 h2）。
- **Line-height:** body／meta 1.55；標題 1.35。

## Color
- **Approach:** restrained — 中性炭黑為主，綠色只當 accent。
- **Dark only**（`color-scheme: dark`）。正文中性灰白，不要綠調字。

### Primitive
| Token | Hex | 角色 |
|-------|-----|------|
| `--ink-950` | `#08090a` | input |
| `--ink-900` | `#0e1012` | 頁面底 |
| `--ink-800` | `#15181c` | 頂欄／抽屜 |
| `--ink-700` | `#1b1f24` | 卡片 |
| `--ink-600` | `#262b32` | 按鈕 |
| `--line` | `#3d444d` | 邊框 |
| `--phos` | `#3ddc84` | 強調／焦點 |
| `--phos-bright` | `#6aef9c` | 成功／乾淨 |
| `--paper` | `#eceef0` | 正文 |
| `--paper-dim` | `#a8aeb6` | 次要字 |
| `--honey` | `#e0b35a` | 警告／dirty |
| `--clay` | `#e07060` | 失敗 |

### Semantic
`--bg` `--surface` `--card` `--border` `--text` `--muted` `--accent` `--input` `--btn` `--ok` `--warn` `--danger`

燈號**必須**顏色＋文字（乾淨／有變更／失敗）。

## Spacing
- **Base unit:** 8px（4px 微調）。
- **Density:** compact（儀表板）。
- **Radius:** 控制項 8px、卡片／遮罩 12px。

## Layout
- **Approach:** grid-disciplined；卡片牆 `minmax(280px, 1fr)`。
- **卡片存在理由:** 每張卡是一個 repo 的操作單元（詳情／更新／優化），不是裝飾格。

## Motion
- **Approach:** minimal-functional。
- **Duration:** hover 150ms、抽屜 200ms、spin 0.7s。
- 只動 `background`／`border-color`／`transform`／`opacity`。

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-19 | 森林綠科技木、深色 only、system-ui | 使用者要綠＋科技感；本機工具不載網字 |
| 2026-09-19 | 次要字改亮、token 三層 | design-review：muted 對比、禁組件硬編碼 |
| 2026-09-19 | 放棄整頁橄欖綠，改炭黑＋磷光綠 | 全綠底濁、對比差；綠色只留給狀態與焦點 |
