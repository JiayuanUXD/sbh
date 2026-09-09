# OPT-077 浏览器走查证据

日期：2026-09-09 ｜ 分支：`feat/opt-077-motion-tokens-5e85`
环境：本地 `pnpm dev`（:3717）；真实 Chrome（视口 976）+ Browser pane（375 模拟视口）
**前提：`prefers-reduced-motion` 实测为 false**（Windows「动画效果」已开启）。关着的时候
`styles.css` §2 的通配 `!important` 会把动画压到 0.01ms，下面四条断言全部看不出差别。

## 1. token

`getComputedStyle(document.documentElement).getPropertyValue('--ease-enter')`
→ `cubic-bezier(0, 0, 0, 1)`

## 2. 四处消费方

| 元素 | 实测 |
|---|---|
| `.back-to-top` | 滚过 400px 挂载；`getAnimations()` 返回 `back-to-top-in` dur 200 state running；computed `0.2s cubic-bezier(0,0,0,1) back-to-top-in`。截图正好抓到淡入中的按钮 |
| `.modal__overlay` | computed `0.2s cubic-bezier(0,0,0,1) modal-overlay-in` |
| `.modal` | `modal-panel-in` dur 320，采样时 currentTime 300、state running、opacity 0.9987（正在收尾） |
| `.mobile-drawer` | computed `0.2s cubic-bezier(0,0,0,1) drawer-slide-in`（200ms 动画在采样时已跑完，故 `getAnimations()` 为空） |
| `.ls-msheet` | 375 视口下 `animationName: ls-msheet-slide-up`、`animationTimingFunction: cubic-bezier(0,0,0,1)` |

弹层与抽屉均可正常 Esc 关闭。

## 3. 为什么没有 `--ease-exit`

全站没有一处退场动画：这几个组件都是 React 直接卸载，DOM 一走动画无处可跑。
做退场要先给每个组件引入延迟卸载，并同时验焦点归还（OPT-075 踩过：对仍是
`display:none` 的元素调 `focus()` 静默失败）。没有消费方的 token 是死重，
所以本次只落 `--ease-enter`，并把这条判断写进 `.agent/frontend.md`。

## 4. 闸门

- `pnpm typecheck`：干净
- `pnpm test`：343 文件 / 4705 用例通过，8 文件 41 用例跳过
