# OPT-079 浏览器走查证据

日期：2026-09-09 ｜ 分支：`refactor/opt-079-token-consolidation-bae4`
环境：本地 `next dev` **3000 端口**（3717 被另一个会话的 worktree dev server 占用，
按「多 worktree 各用独立端口」的纪律未去动它）+ Claude Browser pane

本项的硬要求是**零视觉变化**，所以验收全部对计算值，不靠目视。

## 1. token 解析

- `--bg-hover` → `#ececf0`
- `--media-placeholder` → `#8e8e93`

## 2. 占位色未变（收口前后同值）

`.sf-media`（列表卡图）、`.hm-bento-card`（首页瓷砖）计算值均为 `rgb(142, 142, 147)`。

## 3. hover 规则全部走 token

运行时枚举样式表，7 条规则均已变为 `background: var(--bg-hover)`：
`.ls-filterc__chip:hover` / `.ls-filterc__switch:hover` / `.ls-empty__btn--secondary:hover` /
`.ls-empty .ls-empty__btn-slot > *:hover` / `.ls-emptyfiltered__clear-all:hover` /
`.ls-msheet__footer-reset:hover` / `.building-supply-browser__filter:hover:not([data-active])`。

## 4. 两条轨道

| | 首页 `.hm-rail__track` | 周边 `.nearby-strip` |
|---|---|---|
| display | flex | flex |
| overflow-x | auto | auto |
| scroll-snap-type | x mandatory | x mandatory |
| scroll-behavior | smooth | smooth |
| **scrollbar-width** | none | **none（本次修掉的偏差）** |
| gap | 16（保持） | 12（保持） |
| 本页专属留白 | `padding-left: 48px` + `scroll-padding-left` calc（保持） | `padding: 4px`（保持） |
| 卡宽 / 吸附 | 400px / start（保持） | 200px / start（保持） |

收口前 `.nearby-strip` 是全站唯一挂着原生滚动条的横滑轨道。

## 5. 闸门

- `pnpm typecheck`：干净
- `pnpm test`：343 文件 / 4705 用例通过，8 文件 41 用例跳过
