# OPT-075 浏览器走查证据

日期：2026-09-09 ｜ 分支：`feat/opt-075-header-search-e5b5`
环境：本地 `pnpm dev`（:3717），真实 Chrome + Claude Browser pane（后者用于精确模拟窄视口）

> 取证说明：Browser pane 不合成帧时 IntersectionObserver / rAF / scroll 事件不触发，
> 因此滚动类断言在真实 Chrome 里做；真实 Chrome 的窗口缩放改不动 CSS 视口（恒 1665），
> 因此断点类断言在 pane 里用模拟视口做。两者都是几何/计算样式实测，非目视估计。

## 1. 五档断点（pane，模拟视口）

| 视口 | `--header-height` | 头部实测高 | 搜索 | 导航 | 汉堡 | 城市切换 | 横向溢出 |
|---|---|---|---|---|---|---|---|
| 1440 | 64px | 64 | 输入框 320px | flex | none | block | 无 |
| 1200 | 64px | 64 | 输入框 | flex | none | block | 无（余 372px）|
| 1024 | 64px | 64 | 输入框 288px | flex | none | block | 无（余 196px）|
| 1000 | 64px | 64 | 图标 | none | flex | none | 无 |
| 375  | 56px | 56 | 图标 | none | flex | none | 无 |

## 2. 详情页四处 sticky（真实 Chrome，滚动到 900/1400）

- 房源详情决策卡：`position: sticky`，`top: 136px` = 64 + 56 + 16（token 推导正确），不压头部。
- 楼盘详情锚点条：`position: sticky`，`top: 64px`，紧贴头部下沿（gap = 0），高 56px。
- 锚点落点：点「楼盘参数」后目标 `top = 132px`（= 64 + 56 + 12），距锚点条底 120px 有 **12px 净空**，未被遮挡。
- `#supply` 的 `scroll-margin-top` 计算值 132px，与 token 一致。

## 3. 首页透明头（真实 Chrome，真实鼠标滚动）

- 页顶：`site-header--transparent`，**不渲染顶栏搜索**（Hero 已有 `HomeSearchPill`），头高 64。
- 真实滚动 5 格（scrollY 500）：透明类移除，顶栏搜索出现，头高仍 64。

## 4. 搜索可用性（真实 Chrome）

- 在 `/news` 顶栏输入「静安」回车 → 跳转 `/shanghai/listings?q=%E9%9D%99%E5%AE%89`。
- 落地后顶栏输入框回填「静安」，关键词可见可改写。

## 5. 窄屏展开（pane，375）

- 点图标展开：表单 left=16 / right=307，**完全在视口内**，无横向溢出，焦点自动进入输入框。
- Esc：收起、`aria-expanded=false`、**焦点归还触发器**。

## 6. 走查中发现并修掉的缺陷

1. 375 下展开框左边溢出到 −46px（覆盖层挂错定位基准 + 宽度算术漏项）→ 改为以
   `.site-header__inner` 为基准的两端定位。
2. Esc 后焦点掉到 body（对仍为 `display:none` 的触发器调 `focus()`）→ 改为收起后的
   effect 里归还。
3. `.mobile-drawer__overlay` 的桌面断点漏改（仍为 1280）→ 已同步到 1024。
4. 「收窄导航间距是降断点的前提」这一判断被实测推翻（56px 间距下 1024 仍余 52px），
   已把源码注释与工作项改为实测数字，收窄的理由改述为「余量」。

## 7. 闸门

- `pnpm typecheck`：干净
- `pnpm test`：343 文件 / 4705 用例通过，8 文件 41 用例跳过
- E2E 不在本地闸门内，改了导航需在 CI 或手动跑 `tests/e2e/`
