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
