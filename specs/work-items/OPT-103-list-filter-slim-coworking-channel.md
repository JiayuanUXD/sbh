# Task Packet：OPT-103 列表页筛选瘦身 + 共享办公独立频道

> 状态：**已实施，待合并**（分支 `feat/opt-103-list-filter-slim-694d`，证据 `artifacts/verification/OPT-103/`）
> 创建日期：2026-09-19
> 来源：用户「前端优化」四条：①楼盘列表去掉在租状态筛选、去掉「xx 个楼盘符合条件」；
> ②楼盘列表增加商圈（对齐房源列表）；③房源列表去掉租金单位筛选、去掉「xx 套符合条件」；
> ④共享办公页面去掉「租金单位 元/工位/月」行、去掉类型筛选条件、默认为共享办公、去掉「xx 套符合条件」那一行。
> 设计阶段三次拍板：共享办公做成**独立频道路由 `/coworking`**（对齐 `/sale`）；「后面那一行」指的是
> **筛选状态底栏**（计数 + chip + 清除全部），工具条（显示第 N 套 · 排序 · 版式）保留；
> 去掉单位行后「租金上限」行与「价格 ↑↓」排序**一并不再展示**；出售频道 `/sale` 的「计价单位」行一并去掉。

---

## 1. 一句话

三个列表页各减一行控件、楼盘页补一行商圈、`FilterFormC` 底栏不再报数；共享办公从
`/listings?type=coworking` 升格为 `/[city]/coworking` 独立频道（类型锁定、不进 URL），
导航目标 `listings-type-coworking` 改指新频道，**零数据迁移、零 schema 变化**。

## 2. 行为变化（按页面）

### 2.1 楼盘列表 `/[city]/buildings`（`CityBuildingsView`）

| 项 | 改前 | 改后 |
|---|---|---|
| 筛选行 | 位置 / 等级 / 地铁 / 在租面积 / 竣工年代 / **在租状态（开关 pill）** | 位置 / **商圈** / 等级 / 地铁 / 在租面积 / 竣工年代 |
| 底栏 | 「N 个楼盘符合条件 │ chip… │ 清除全部」 | 「chip… │ 清除全部」；无已选条件时整行不渲染 |
| 移动抽屉 | 含「仅看有在租」开关 | 不含 |
| `?onlyWithStock=1` 老链接 | 开关高亮 | 仍生效；底栏补一个可清除 chip「在租状态：仅看有在租」（走既有 `extraPicks` 机制） |

商圈行口径**逐字对齐房源页（OPT-099）**：

- 位于「位置」行之下；未选行政区时候选为空 → `FilterFormC` 既有规则整行不渲染。
- 候选与计数来自「剥掉 `businessArea`、**保留其余条件（含 district）**」的 facet，级联由此白送。
- 「位置」行 `clearsKeys: ['businessArea']`：切区 / 清区连商圈一起清。
- 「位置」行自身的候选计数要**连商圈一起剥**（`omit(['district','businessArea'])`），否则选了商圈后其余区计数全 0、用户切不走（OPT-099 走查实测）。
- chip / 空态②退路文案用商圈名（词表来自扫描行的 `businessDistrict`），查不到就只印「商圈」，**绝不回显 slug**。

### 2.2 房源列表 `/[city]/listings` 与出售频道 `/[city]/sale`（`CityListingsView`）

| 项 | 改前 | 改后 |
|---|---|---|
| 页头下方 | 「租金单位 / 计价单位」分段控件（`PriceUnitSegment`） | 不渲染 |
| 筛选行 | 位置 / 商圈 / 类型 / 建筑形态 / 租金上限（仅选定单位后） / 面积下限 | 位置 / 商圈 / 类型 / 建筑形态 / 面积下限（租金上限行因永远零候选而不出现） |
| 工具条排序 | 推荐 / 最新 / 价格 ↑↓（仅选定单位后） | 推荐 / 最新 |
| 结果区下方 | 「另有 N 套按其它单位报价」提示条（仅选定单位后） | 恒不渲染 |
| 底栏 | 「N 套符合条件 │ …」 | 「chip… │ 清除全部」；无条件整行不渲染 |
| `?priceUnit=` 老链接 | 单位分段高亮 | 仍生效（域层不动）；页头副题「共 N 套按 X 报价的在租房源」；租金上限行、价格排序照旧出现——**只是没有控件能把它写进 URL**；「另有 N 套按其它单位报价」提示条恒不渲染（它是换单位的入口，与分段控件同一家族） |

页头副题「共 N 套在租房源」保留（那是页头，不是底栏）。

### 2.3 共享办公频道 `/[city]/coworking`（新）+ `/coworking`（legacy 兜底）

对齐 `/sale` 的实现方式（`[city]/sale/page.tsx` + `sale/page.tsx`），`CityListingsView` 增加
`channel="coworking"`：

- 路由层把 `listingType` **强制**为 `['coworking']`（覆盖 URL 里任何 `type=`），canonical **不输出 `type`**（`buildCanonicalSearchParams` 前先剥掉）。查询走既有 `getCachedSearchListings`（缓存键是城市 + 频道扫描，分页/筛选在内存里按 `input` 做，类型锁定不影响缓存正确性）。
- 页头：标题「{城市}共享办公」，副题「共 N 套共享办公房源」。
- **不渲染**：单位行（同 2.2）、「类型」筛选行、筛选状态底栏的**计数**（全站已去）；「类型：共享办公」chip 不出现（类型不是这个页面的条件，是它的定义）。
- **保留**：位置 / 商圈 / 建筑形态 / 面积下限行；工具条（显示第 1–N 套 · 推荐 / 最新 · 网格/横排）；分页；移动抽屉（不含类型行）。
- 底栏例外：手写 URL 带 `?q=` / `?metro=` / `?availableBefore=` 这类没有筛选行的条件时，底栏为这几个 chip 出现——「生效条件必须可见」是既有铁律，正常点击流程碰不到。
- 空态：无筛选零结果 → 空态①「{城市}的共享办公房源还在收录中」；有筛选零结果 → 空态②逐条退路（类型不在退路清单里）。
- SEO：`CityMetadataPageType` 增 `coworking`，标题「{城市}共享办公 · 工位与联合办公」，描述「{城市}共享办公、联合办公与灵活工位在租房源。」；canonical 指向频道自身 `/[city]/coworking?…`；sitemap 与 `/listings` 同口径：每个已开城城市**无条件**收录 `{prefix}/coworking`（sitemap 条目不带 listingType，不为此扩 adapter 的 select；出售频道那种按数量设门槛的做法不沿用）。
- `city-routes.ts`：`CityPageType` 增 `coworking`、`RESERVED_CITY_ROOT_SEGMENTS` 增 `coworking`、解析 `/coworking` 与 `/[city]/coworking`、`buildCityPath('coworking')`、城市切换保留查询串（规则同 `listings`）。
- 导航：`nav-targets.ts` 的 `listings-type-coworking` 目标 `href` 改为 `/coworking`（生产 `SiteSettings.mainNav` 存的是目标 id，**零数据迁移**）；`public-nav.ts` / `site-settings-view.ts` 兜底表里的 `/listings?type=coworking` 同步改；首页类型卡 `HomeTypeCards` 的 coworking 卡 `href` 改 `/coworking`；页脚「联合办公」同源改。**「找办公室」页类型行不动**——那里的「共享办公」仍是普通筛选。

### 2.4 全站：`FilterFormC` 底栏

- 删掉「N {countNoun}符合条件」文本，`totalCount` / `countNoun` 两个 prop 从组件签名移除（组件内无其它用途）。
- 底栏只在 `hasPicks` 时渲染；分隔线随之删掉（它原本分隔计数与 chip）。
- 移动端 `MobileFilterSheet` 底部「查看 N 套」按钮**不变**（那是 CTA，不是报数）。

## 3. 改动面

### 3.1 域层（`src/domain/public-catalog/`）

| 文件 | 改动 |
|---|---|
| `building-search.ts` | `BuildingSearchInput.businessArea?: readonly string[]`；解析 `businessArea`（`parseDedupedStringArray`）；canonical 输出（排序后 append，位置在 `district` 之后）；`applyBuildingFilters` 按 `doc.businessDistrict.slug` 过滤（缺失视为不命中）；`BuildingSearchDimension` 增 `'businessArea'`；`BUILDING_CLEARABLE_DIMENSIONS` 增；`BUILDING_DIMENSION_PARAM_KEYS.businessArea = ['businessArea']`；`omitBuildingSearchDimensions` 处理 |
| `contracts.ts` | `BuildingSummaryViewModel.businessDistrict?: DistrictViewModel` |
| `mappers.ts` | `mapBuildingSummary` 补 `businessDistrict: mapDistrict(populated?.businessDistrict)` |
| `facade.ts` | `buildBuildingFacets` 增 `businessAreas`（slug/name/count）；`searchBuildingsFiltered`：`facets.businessAreas` 取「剥 businessArea」子集，`facets.districts` 改取「剥 district + businessArea」子集；`dimensionHits.businessArea` |
| `search-params.ts` | 无改动（房源侧已有 businessArea） |

### 3.2 前台编排与组件

| 文件 | 改动 |
|---|---|
| `src/lib/frontend/building-filter-rows.ts` | 增商圈行（位置行之后，级联口径见 2.1）；位置行 `clearsKeys: ['businessArea']`；`BuildingFacets` 增 `businessAreas`；dimensions 增 `businessArea`（activeText 用 `vocabularyName`）；`onlyWithStock` 维度**保留**（老链接 chip 需要它） |
| `src/components/frontend/city/CityBuildingsView.tsx` | 删 `switchRow` 构造与传递；`rowActiveKeys` 不再加开关键；页头副题保留 |
| `src/components/frontend/city/CityListingsView.tsx` | 增 `channel?: 'lease' \| 'sale' \| 'coworking'`（替代 `businessType`，值 `coworking` 时查询频道仍是 `lease`）；`CHANNEL_COPY.coworking`；不渲染 `PriceUnitSegment` 与 `ExcludedUnitsBar`（组件文件保留，2.2 表末行的老链接分支照旧）；coworking 时 `rows` 过滤掉 `type` 行、`extraPicks` 跳过 `listingType` 维度、`noStockNoun` 取频道名词；`unitFacets` 的取数仍要（页头「价格面议」差额句依赖它） |
| `src/components/frontend/listing/FilterFormC.tsx` | 删 `totalCount` / `countNoun` / `switchRow` 与 `FilterSwitch` 类型；底栏仅 `hasPicks` 时渲染；`countActivePicks` 签名去掉 `switchRow` |
| `src/components/frontend/listing/MobileFilterShell.tsx` / `MobileFilterSheet.tsx` | 删 `switchRow` prop 与开关渲染 |
| `src/app/(frontend)/styles/list.css` | 删 `.ls-filterc__switch*`、`.ls-filterc__count`、`.ls-filterc__divider`、`.ls-msheet__switch*` |
| `src/lib/frontend/listing-filter-rows.ts` | 无改动（类型行的剔除在编排层做，函数契约不变） |

### 3.3 路由与导航

| 文件 | 改动 |
|---|---|
| `src/app/(frontend)/[city]/coworking/page.tsx`（新） | 照 `[city]/sale/page.tsx`：解析 → 强制 `listingType` → canonical（剥 type）→ `CityListingsView channel="coworking"` |
| `src/app/(frontend)/coworking/page.tsx`（新） | 照 `sale/page.tsx`：多城市开关下 301 到 `/{defaultCity}/coworking?…`，否则 legacy 渲染 |
| `src/lib/frontend/coworking-channel.ts`（新） | `coworkingChannelPath(citySlug?)`、`lockCoworkingInput(input)`（强制类型 + 供 canonical 剥 type 的纯函数），与 `sale-channel.ts` 同形 |
| `src/lib/frontend/city-routes.ts` | 见 2.3 |
| `src/lib/frontend/metadata.ts` | `CityMetadataPageType` 增 `coworking` + 文案 |
| `src/lib/frontend/nav-targets.ts` | `listings-type-coworking.href → '/coworking'`（其余类型目标不动） |
| `src/lib/frontend/public-nav.ts`、`site-settings-view.ts`、`components/frontend/home/HomeTypeCards.tsx` | `/listings?type=coworking → /coworking` |
| `src/app/(frontend)/sitemap.ts` | 每个已开城城市增 `{prefix}/coworking`（无条件，同 `/listings`） |

### 3.4 不做的事

- 不删 `onlyWithStock` / `priceUnit` / `PriceUnitSegment` / `ExcludedUnitsBar` 的域层与组件能力（老链接照常工作）。
- 不改「找办公室」页类型行；不改楼盘详情页供给筛选（`BuildingSupplyBrowser` 有自己的单位分段）。
- 不做数据迁移；`SiteSettings` 不动。

## 4. 测试

### 4.1 单测（vitest）

- `tests/building-search-business-area.test.ts`（新）：解析 / 去重 / canonical 顺序 / `applyBuildingFilters` 命中与缺失 / `omitBuildingSearchDimensions('businessArea')` / facets `businessAreas` 计数取自剥离子集、`districts` 计数取自「剥 district+businessArea」子集。
- `tests/building-filter-rows*.test.ts`：商圈行位置、未选区时空候选、`clearsKeys`、`activeText` 不回显 slug；无 switch。
- `tests/opt036-buildings-view-wiring.test.ts` / `opt036-listings-view-wiring.test.ts`：改期望——无 `switchRow`、无 `totalCount`、无 `PriceUnitSegment`；`?onlyWithStock=1` 老链接出 chip。
- `FilterFormC` 相关：底栏无计数；无 pick 不渲染底栏。
- `tests/city-routes.test.ts` / `city-route-pages.test.ts`：`coworking` 页型解析、`buildCityPath`、路由页强制类型 + canonical 不含 type、legacy 301。
- `tests/opt096-nav-submenu.test.ts` / `site-nav-current.test.ts` / nav-targets 相关：目标 href 为 `/coworking`，当前页高亮。
- `tests/production-deploy-config.test.ts` 等守卫不受影响（不动发布链路）。

### 4.2 E2E（`tests/e2e/`，CI 跑）

- 现有断言「符合条件」「仅看有在租」「租金单位」「计价单位」的用例逐条改。
- 新增 `coworking-channel.spec.ts`（照 `sale-channel.spec.ts`）：主导航「共享办公」落到 `/shanghai/coworking`；无类型行；卡片全是共享办公；点位置筛选 URL 不带 `type`。

### 4.3 浏览器走查（完成前必做）

本地 dev（`E:\wt-lsopt`，端口 3731）@1440 与 375：
`/shanghai/buildings`（含选区后商圈行出现、切区商圈清空）、`/shanghai/listings`、`/shanghai/sale`、
`/shanghai/coworking`（含移动抽屉）、`/shanghai/buildings?onlyWithStock=1` 与 `/shanghai/listings?priceUnit=rmb-sqm-day` 老链接。
截图与 innerText 核对存 `artifacts/verification/OPT-103/`。

## 5. 验收

- [x] `typecheck` / `lint` / `pnpm test` 全绿；改动过的 E2E 本地单跑通过（数字见 `artifacts/verification/OPT-103/README.md`「闸门」节，摘自 Task 8：typecheck 0 输出 exit 0；lint 35 条改动前既有警告、0 error；`pnpm test` 393 文件 / 5220 用例全绿；`coworking-channel.spec.ts` + `sale-channel.spec.ts` 在 `MULTI_CITY_ROUTING_ENABLED=false/true` 两种状态下分别 8 passed/1 skipped、5 passed）
- [x] 走查截图齐全，文案用 innerText 核对（不用低分辨率截图读中文）（实际覆盖 7 个页面/场景共 19 张截图，超出 brief 原定「四个页面」，逐条断言见 README 走查表；`/shanghai/buildings` 商圈行验证因本地夹具「静安/浦东」楼盘缺 `businessDistrict` 数据改用「长宁」区验证，已在 README 注明为数据限制、非代码问题）
- [x] 老链接三种（`onlyWithStock` / `priceUnit` / `listings?type=coworking`）行为如 §2（三者均实测通过，见 README 走查表第 2/4/6 行）
- [x] 生产后台主导航「共享办公」无需改配置即指向新频道（`navTargetById('listings-type-coworking').href === '/coworking'`）（源码核对 `src/lib/frontend/nav-targets.ts` + Task 8 全量单测覆盖，非浏览器走查项，见 README 走查表第 8 行）
