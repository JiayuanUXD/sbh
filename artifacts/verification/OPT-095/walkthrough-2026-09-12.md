# OPT-095 本地走查记录（2026-09-12）

环境：worktree `E:\wt-095`，分支 `feat/opt-095-detail-display-fixes-8e61`（基于 `origin/master` `1425c49`），`next dev -p 3727`，本地 PG `postgres` 库 `migrate:status` 88/88 已执行、无 pending。本树初始缺 gitignore 的 `media/` 磁盘存储目录（画廊显示「图片暂未加载」），从主树复制 53 个文件后取证——环境问题，与代码无关。

截图由 Playwright（`@playwright/test` chromium，1440×900 / 375×900）直出，DOM 判据在同一脚本里读取。

## ① 房源详情「所在楼盘」封面 + 概况表楼宇服务三行

根因：`mapListingDetail` 以 `...card` 继承了 `mapListingCard`（OPT-047）收窄过的 `building`。修法：详情用未收窄的 `mapBuildingSummary(listing.building)`。

| 路由 / 视口 | 结果 | 证据 |
|---|---|---|
| `/shanghai/listings/jingan-center-fullfloor` 1440 | `.building-summary-card__media img` `currentSrc=…/cover-west-nanjing-premium-center-768x432.webp`，naturalWidth 480；`[data-media-state="missing"]` 计数 0；楼盘摘要「面向金融、咨询…」同时回来 | `listing-detail-building-card-1440.png` |
| 同上 | 「房源概况」参数表：`空调=中央空调（VAV 变风量）`、`网络=电信 / 联通 / 移动`、`停车费=1200 元/月`（与该楼盘详情页「楼宇服务」同源字段） | `listing-detail-spec-rows-1440.png` |
| curl 直出（无浏览器） | `huangpu-bund-traditional` / `hp-300sqm-traditional` 同样 `<img src="/api/media/file/cover-huangpu-bund-768x432.webp">` + 三行有值 | — |

线上对照（改前，2026-09-12 抽查生产）：`pu-fa-yin-hang-da-sha-2` 等 3 套房源 `.building-summary-card__media` 均为占位 `data-media-state="missing"`，而其楼盘 164 `coverImage=18156` 非空。

## ② 顶栏客服前缀

| 路由 / 视口 | 结果 | 证据 |
|---|---|---|
| `/shanghai` 1440 | `.service-phone` 文本「客服 021 6888 8888」，高 36px 单行；`.service-phone__prefix` / `__number` 计算 display 均非 none（flex item 报 block） | `header-desktop-1440.png` |
| `/shanghai` 375 | 前缀与号码 `display:none`，入口 44×44 只图标 | `header-mobile-375.png` |
| 抽屉 375 | 第一行仍是「客服电话 021 6888 8888」，无 `service-phone__prefix` | `drawer-mobile-375.png` |

## ③ 楼盘详情桌面供给表缩略图

| 路由 / 视口 | 结果 | 证据 |
|---|---|---|
| `/shanghai/buildings/west-nanjing-premium-center` 1440 | 7 行每行 `.building-supply-browser__table-thumb` 存在，`<img>` 均加载（种子库房源无自有封面，全部走楼盘封面兜底口径）；行高 69 ≥ 56；标题链接 `.building-supply-browser__table-primary` 原样 | `building-supply-table-1440.png` |
| 同上 375 | `<table>` 计数 0，`[data-listing-card-variant="building-supply"]` 卡片 5 张——移动端不变 | DOM |
| 无封面行 | 种子数据没有「房源与楼盘都无封面」的行，占位分支由 `tests/detail-components-contract.test.ts`「无封面出共享占位」用例覆盖 | 单测 |

## 闸门

- `typecheck` 干净
- `lint` 0 error，35 warning（master 基线 34；+1 是 `BuildingSupplyBrowser.tsx` 新增 `<img>` 触发的 `@next/next/no-img-element`，与同目录 `BuildingSummaryCard` / `BuildingCompactRow` 手写 `<img>` 同类——C 端刻意不用 `next/image`，走 `cardCoverProps` 的 srcset，见 `lib/frontend/media-srcset.ts`）
- `test:changed`：158 files / 1877 passed（含 `listing-card-payload-size` 的「building 只保留卡片链路字段」——OPT-047 收窄未回退）
- E2E 自查：`tests/e2e/detail-pages.spec.ts` 只用 `.building-supply-browser__table`、`tbody tr`、`a[href$=…]`、`__footnote` 选择器，本次未改；全量 E2E 留 CI
