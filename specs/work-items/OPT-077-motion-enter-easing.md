# Task Packet：OPT-077 统一「面板出现」的进场曲线

> 状态：**实施中**
> 创建日期：2026-09-09
> 来源：eBay 前端对标分析（本轮清单项 D1）

---

## 1. 一句话

抽屉、移动筛选面板、弹层、返回顶部这四处「从无到有」的出现，此前用三条不同曲线
（还有一处干脆没动画）；统一到一个新的 `--ease-enter`。

## 2. 范围被实测收窄：**不做退场，也不加 `--ease-exit`**

原清单项写的是「补进 / 出两条缓动，并规定弹层类的进出时长」，依据是 eBay 实测的
「进 333ms quick-enter、出 167ms soft-exit」这条不对称规律。落地时查了本仓库现状：

| 消费方 | 改动前 |
|---|---|
| `.mobile-drawer` | `drawer-slide-in 200ms var(--ease-standard)` |
| `.ls-msheet`（移动筛选面板） | `ls-msheet-slide-up 200ms var(--ease-apple)` |
| `.modal` / `.modal__overlay` | **没有任何动画**，硬切出现 |
| `.back-to-top` | 只有 hover 的 0.15s 过渡，出现是硬切 |
| 骨架 shimmer | `1.4s/1.6s ease-in-out infinite`，是持续态不是进出 |

**全站没有一处退场动画**——这几个组件都是 React 直接卸载（`if (!visible) return null`
之类），DOM 一走动画就无处可跑。要做退场必须先给每个组件引入延迟卸载，而那会牵动
焦点归还（OPT-075 刚踩过：对仍是 `display:none` 的元素调 `focus()` 会静默失败）。
那是独立工作项。

因此本项**只加 `--ease-enter`，不加 `--ease-exit`**——没有消费方的 token 是死重。

## 3. 改动

| 文件 | 改动 |
|---|---|
| `styles.css` token 区 | 新增 `--ease-enter: cubic-bezier(0, 0, 0, 1)`（取自 eBay Evo 的 `--motion-easing-quick-enter`，2026-09-09 实测其弹层与折叠头都在用） |
| `styles.css` `.mobile-drawer` | 曲线 `--ease-standard` → `--ease-enter`（时长不动） |
| `list.css` `.ls-msheet` | 曲线 `--ease-apple` → `--ease-enter`（时长不动） |
| `styles.css` `.modal__overlay` / `.modal` | 新增进场：遮罩 200ms 淡入、面板 320ms 淡入 + 上浮 8px |
| `styles.css` `.back-to-top` | 新增进场：200ms 淡入 + 上浮 6px。组件本就是挂载/卸载式的，纯 CSS 即生效，不改组件 |
| `.agent/frontend.md` | 写进动效纪律：此类元素一律用 `--ease-enter`；并写明「没有 `--ease-exit`」及其原因 |

**时长一概不动**，本项只统一曲线。减少动效由 `styles.css` §2 的通配 `!important` 规则
兜住，四处都不需要单独写 `@media (prefers-reduced-motion)`。

## 4. 验收（真实 Chrome，`prefers-reduced-motion: false`）

| 元素 | 实测 |
|---|---|
| `--ease-enter` | 解析为 `cubic-bezier(0, 0, 0, 1)` |
| `.back-to-top` | 滚过 400px 后挂载，`back-to-top-in` 200ms 运行中，computed `0.2s cubic-bezier(0,0,0,1)` |
| `.modal__overlay` | computed `0.2s cubic-bezier(0,0,0,1) modal-overlay-in` |
| `.modal` | `modal-panel-in` 320ms，采样时 `currentTime` 300/320，运行中 |
| `.mobile-drawer` | computed `0.2s cubic-bezier(0,0,0,1) drawer-slide-in` |
| `.ls-msheet`（375 视口） | `animationName: ls-msheet-slide-up`、`animationTimingFunction: cubic-bezier(0,0,0,1)` |

`pnpm typecheck` 干净；`pnpm test` 343 文件 / 4705 用例通过。

**验这一项必须确认 `prefers-reduced-motion` 为 false**——它跟随 Windows 的「动画效果」
系统开关（设置 › 辅助功能 › 视觉效果），关着的时候通配规则会把动画压到 0.01ms，
四条断言全部看不出差别。
