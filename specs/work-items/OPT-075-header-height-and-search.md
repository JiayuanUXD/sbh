# Task Packet：OPT-075 顶栏加高到 64px，并加常驻搜索入口

> 状态：**实施中**
> 创建日期：2026-09-09
> 来源：eBay 前端对标分析（本轮清单项 S1）+ 用户拍板「不冲突，导航栏高度可以适当增加一些，现在的太窄显得小气」
> **相关**：2026-09-03 从顶栏移除「获取选址方案」CTA 的决定（本项不与之冲突，理由见 §2.1）

---

## 1. 一句话

顶栏从 44px 抬到 64px（移动端 56px），并在导航左侧放一个常驻搜索入口，
让「搜索」在离开首页之后依然够得着。

## 2. 已定的决策

### 2.1 顶栏放搜索，与「顶栏不放 CTA」不冲突

2026-09-03 移除的是**转化钩子**（「获取选址方案」按钮），理由是顶栏不该替页面做转化。
搜索是**导航**，不是转化：它把用户送去列表页，不产生线索、不打断浏览。用户已确认不冲突。

### 2.2 高度取 64 / 56

| 断点 | `--header-height` | 理由 |
|---|---|---|
| ≥768 | **64px** | 容得下 40px 高的搜索控件加上下各 12px 呼吸。44 → 64 是 +45%，肉眼上明显不再「小气」 |
| <768 | **56px** | 移动端首屏寸土寸金；56 仍能放下 36px 的搜索图标钮 |

不取 72（`--sp-8`）：那是三行头的量级，与「中性极简」的克制相悖。
不取 56 一刀切：桌面端正是「显得小气」的那一档。

### 2.3 现状盘点：偏移全部走 token，无硬编码

已用 `rg -- '--header-height'` 核实，全站**没有一处硬编码 44px 的偏移量**：

| 位置 | 用法 | 改 token 后 |
|---|---|---|
| `styles.css:60` | 唯一定义处 | **手改** |
| `styles.css:429` | `.site-header__inner { height: var(--header-height) }` | 自动 |
| `detail.css:362` | 决策卡 `top: calc(--header-height + --dt-sticky-bar-h + 16px)` | 自动 |
| `detail.css:453` / `:490` | 楼盘锚点条 `top: var(--header-height)` | 自动 |
| `detail.css:589` | 锚点落点 `scroll-margin-top: calc(…)` | 自动 |
| `recruit.css:145` | 招募页侧栏 `top: calc(--header-height + 24px)` | 自动 |
| `home.css:18` / `:135` | Hero 上探头部、内页顶部留白 | 自动，但 Hero 视频区随之变高，**需走查首屏构图** |
| `SiteHeader.tsx:105` | 滚动阈值 `window.scrollY > 40`，注释写「约导航高度」 | **手改**，唯一的 JS 侧联动 |
| `home.css:134` | 注释写「44px 头部」 | **手改注释**，避免又一处文档漂移 |

`tests/detail-components-contract.test.ts:688` 断言的是 `calc()` 表达式而非数值，不会红。

### 2.4 导航断点 1280 → 1024，并把导航间距收到 32px

1024–1279 这一档原本只有汉堡（iPad 横屏、13 寸窗口都落在这里）。顶栏加高之后，
一个 64px 高的头里只放一个汉堡会更显空，所以同批把断点降到 1024。

`.site-nav` 的 `gap` 从 `--sp-7`(56) 收到 `--sp-6`(32)。**这一条的理由写错过一次，此处以实测为准：**

> 我最初按「每项约 70px」估算，得出 56px 间距下导航约 826px、在 1024 的容器里装不下，
> 于是把收窄写成「降断点的前提」。**1024 实测推翻了它**：导航项实际只有约 46px 宽，
> 56px 间距下导航 658px，容器 945px 里仍余 52px，不溢出。

收窄的真实理由是**余量**，不是可行性：

| gap | 导航宽 | 容器 945px 内余量 |
|---|---|---|
| `--sp-7` 56px（原值） | 658px | 52px |
| `--sp-6` 32px（本次） | 514px | 196px |

52px 余量太薄，而主导航文案是**后台可配的**（OPT-054 的 `mainNav`）——运营把「找办公室」
改成「找办公室出租」就会顶破。收到 32 后余量 196px，够吸收几次文案变长。

代价是所有桌面宽度下导航都紧凑一档，这是一处未经用户点名的视觉改动，需在验收时一并看。

**桌面断点共四处，必须同档**：`.city-switcher` / `.site-nav` / `.site-menu-toggle` /
`.mobile-drawer__overlay`（第四处第一轮漏改，会导致 1024–1279 已显示横排导航、抽屉遮罩仍可见），
外加 `SiteNav.tsx` 的 `DESKTOP_NAV_MIN_WIDTH`。

1024–1279 区间搜索只显示图标；≥1280 才展开为输入框。

### 2.5 首页透明态不显示搜索框

首页 Hero 已有 `HomeSearchPill`（centerpiece）。顶栏搜索在**首页未滚动时隐藏**，
滚过阈值后随实底头一起淡入——复用现成的 `isHome && !scrolled` 状态，不新增状态机。
避免首页同屏出现两个搜索框。

## 3. 组件形态

新增 `src/components/frontend/HeaderSearch.tsx`（`'use client'`）。

**不复用 `HomeSearchPill`**：那套内部控件是 44px 高（`home.css:169/172/183`），
且带「筛选」三下拉面板，整体塞不进 64px 的头。两者共享的是**参数语义**（`q` → `/[city]/listings?q=`），
不是 DOM。为免两处漂移，把 URL 拼装抽到 `src/lib/frontend/search-submit.ts`，两边同用。

| 断点 | 形态 |
|---|---|
| ≥1024（= 桌面导航断点） | 常驻输入框，40px 高、`--r-pill` 全圆、`--bg` 底、左侧放大镜图标，`flex: 0 1 320px`。1024 处头部余量 196px，会自动缩到约 288px，仍好用 |
| <1024 | 收成 40×40 图标钮；点击展开为覆盖头部内容区的输入行（两端定位，右侧给汉堡留位），220ms `cubic-bezier(.33,1,.68,1)` 上浮（借自 eBay 实测曲线），Esc / 失焦收起 |

**输入框断点与导航断点同为 1024，不另设 1280**：分开只会多出一档「有横排导航却只有搜索图标」
的中间态，而 1024 的余量本来就够。

无障碍：`role="search"`、`<label class="visually-hidden">`、展开态 `aria-expanded`，
Esc 关闭后焦点归还触发器（与 `SiteNav` 抽屉同一套口径）。

原生 `action` + `method="get"` + `name="q"` 作为兜底：JS 未就绪时回车也能搜到，
有 JS 时 `onSubmit` 接管走客户端导航。

## 3.1 走查发现并修掉的两个缺陷

都是浏览器实测才暴露的，typecheck 与 4705 个单测全程绿：

1. **375 宽下展开的搜索框左边溢出到 −46px。** 覆盖层原本挂在 `.header-search`（只有 40px 宽、
   位置靠左）上用 `right: 0` + 算出来的 `width`，算术漏项就越界。改为**以
   `.site-header__inner` 为定位基准、left/right 两端定位**，宽度由容器保证，不做任何算术。
   修后 375 下 left=16 / right=307，完全在视口内。
2. **Esc 后焦点没回到触发器。** 原写法在 Esc 处理里紧跟 `setOpen(false)` 调 `focus()`，
   而那一刻 toggle 还是 `display:none`（要等 React 重渲染），对隐藏元素 `focus()` 静默失败，
   焦点掉到 body。改为用 ref 标记 + 收起后的那一轮 effect 里归还。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/app/(frontend)/styles.css:60` | `--header-height: 64px`；新增 `<768` 媒体查询覆写为 56px |
| `src/app/(frontend)/styles.css` | `.site-nav { gap: var(--sp-6) }`；三处 `@media (min-width:1280px)`（`.city-switcher` / `.site-nav` / `.site-menu-toggle`）改 1024；新增 `.header-search*` 规则 |
| `src/app/(frontend)/styles/home.css:134` | 注释里的「44px 头部」同步 |
| `src/components/frontend/SiteHeader.tsx` | 滚动阈值跟随新高度；渲染 `HeaderSearch`，首页透明态不渲染 |
| `src/components/frontend/SiteNav.tsx:21,164` | 两处 `matchMedia('(min-width: 1280px)')` 改 1024 |
| `src/components/frontend/HeaderSearch.tsx` | 新增 |
| `src/lib/frontend/search-submit.ts` | 新增，抽出 URL 拼装；`HomeSearchPill` 改为调用它 |

## 5. 验收判据

**typecheck 干净 + 单测全绿 ≠ 可用**（CLAUDE.md 硬规矩）。必须在浏览器里逐条走过：

1. **四处 sticky 无重叠无跳位**：房源详情决策卡、楼盘详情锚点条、招募页侧栏、首页 Hero 上探。
2. **锚点落点不被头遮住**：楼盘详情点锚点条各项，标题完整可见。
3. **首页透明头**：未滚动时无搜索框、透明；滚过 64px 切实底并出现搜索框，时机不早不晚。
4. **搜索可用**：从列表页 / 详情页 / 资讯页回车，都到 `/[city]/listings?q=`；列表页 pill 预填 `q`。
5. **三档断点**：1400 / 1200 / 900 三个宽度截图，导航与搜索的显隐符合 §3 的表，无换行无溢出。
6. **E2E**：`tests/e2e/` 不在 pre-push 闸门里（见记忆「E2E 不在本地闸门里」），改了导航必须自查并补「非首页搜索」用例。

证据存 `artifacts/verification/OPT-075/`。

## 6. 不在本项范围

- 「下滑隐藏、上滑露出」的移动端头（eBay 实测有，我们可选借，另开）
- 搜索建议词 / 热门组合 chip（清单项 S2，第二批）
- 顶栏收藏入口（依赖 C 端账号体系，用户已定「收藏需登录」，未排期）
