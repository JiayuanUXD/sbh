# T1 左侧导航 1024–1440px 不可点击 — 根因与验证

日期：2026-08-26 · 分支 `feat/admin-ux-batch-6a11` · 本地 dev（3717）+ 浏览器实测

## 根因

1. Payload 3.86 `NavProvider`（`@payloadcms/ui/dist/elements/Nav/context.js`）在视口
   ≤1440px（断点 `l`）时 `setNavOpen(false)`；`NavWrapper` 对 `aside.nav` 设置
   **`inert` 属性** → 整棵导航子树不可交互（elementFromPoint 直接穿透到
   `.template-default`）。
2. `custom.scss:735`（`min-width: 1024px`）强制导航可见并隐藏汉堡开关 → 1024–1440px
   区间「看得见、点不动」，窗口拉宽也不自愈（状态锁死，需刷新）。
3. 叠加缺陷：`AdminNavigationClient` 的 mounted/宽度初始化放在
   `requestAnimationFrame` 里——不合成帧的标签页（后台标签等）rAF 不触发，
   `isDesktop` 恒 false，「收起导航」按钮也不渲染。

## 修复

`src/components/admin/AdminNavigationClient.tsx`：
- 引入 `useNav()`，桌面态（≥1024px）强制 `setNavOpen(true)`（消除 inert）；
- mounted/宽度初始化从 rAF 回调改为 effect 直接执行。

## 实测证据（1200×800 视口）

修复前：
```
{"vw":1200,"attrs":{"class":"nav nav--nav-animate nav--nav-hydrated","inert":""},"inertProp":true}
所有分组按钮 elementFromPoint → DIV.template-default（不可命中）
```

修复后：
```
{"vw":1200,"inert":false,"cls":"nav nav--nav-open nav--nav-animate nav--nav-hydrated"}
点击「房源运营」分组 → open:true；点击「房源列表」→ location.pathname=/admin/collections/listings
「收起导航」按钮正常渲染（isDesktop 正确为 true）
```

---

## 追加修复（用户复测反馈：拖动窗口从宽变窄仍不可点，刷新才好）

### 第一版为何不够

第一版只做了**状态层**修复（桌面态 `setNavOpen(true)`）。它要求「NavProvider 先置
false、本组件的效果再置回 true」这一渲染时序每轮都成立；而真实拖拽会连续触发 resize，
Payload 反复改自己的状态，只要有一轮回置没跑到，`inert` 就留在 DOM 上——表现正是
「拖窄后点不动、刷新才好」（刷新走的是加载路径，被第一版覆盖，所以刷新有效）。

同时确认：Payload 的断点 **硬编码** 在 `@payloadcms/ui` 的 Root provider
（`l: (max-width: 1440px)`），不可通过配置改，只能在应用侧兜。

### 第二版：把不变量钉在 DOM 上

`AdminNavigationClient` 增加 MutationObserver：桌面态下 `aside.nav` 一旦出现 `inert`
就立即摘除，与 React 渲染时序解耦；移动态（<1024px）不介入（模态导航关闭时带 inert
是正确的可访问性行为）。状态层修复保留，保证 Payload 自身状态与派生 class 自洽。

### 实测（本地 dev，1200×900）

复现前提：本会话隐藏面板不合成帧 → rAF 饿死 → Payload 断点根本不重算，
`resize_window` 也不向页面派发 resize 事件（`--vw` 停在 16px）。故先把 rAF 打补丁为
setTimeout 并手动派发 resize，才拿到**真实链路**复现（`--vw` 16px→12px 证明断点已重算）。
第一版在此环境下的「resize 后仍可点」是假绿，不足以证伪用户的报告。

| 场景 | 结果 |
|---|---|
| 1600px 加载 → 拖窄至 1200px（连续 12 次 resize） | `--vw` 12px、`inert=false`、按钮可命中 ✓ |
| 连续 30 次 resize 抖动 | `inert=false`、可点击 ✓ |
| 对抗性：直接 `setAttribute('inert','')` | 同一微任务内被摘掉，可点击 ✓ |
| 状态层：经 NavContext `setNavOpen(false)` | `inert=false`、`nav--nav-open` 恢复、可点击 ✓ |
| 端到端点击「楼盘库」 | 跳转 `/admin/collections/buildings` ✓ |
| 移动态 900px 加载 | `inert=true`、汉堡可见（**未被误伤**）✓ |

### 回归守卫

`tests/admin-nav-desktop-inert.test.ts`：守状态层与 DOM 层两条机制、移动态不介入、
初始化不得用 rAF，以及 Payload `l` 断点仍为 1440px（升级改动则红灯，提示重算适用区间）。
已用「摘掉 MutationObserver → 测试变红」反向验证守卫有效。
