# Task Packet：OPT-096 房源「建筑形态」多选字段 + 主导航租赁 / 出售二级菜单

> 状态：**已实施，待合并**（OPT-095 已于 2026-09-12 上线）
> 创建日期：2026-09-12
> 来源：用户 5 项需求中的第 1、5 项；其余三项见 OPT-095

---

## 1. 一句话

① 房源新增独立多选字段「建筑形态」（独栋 / 双排 / 联排），后台可维护、C 端列表可筛、详情参数表可见；
② 主导航「找办公室」「找楼盘」各自带「租赁 / 出售」二级菜单，其中「找楼盘 → 出售」落到新增的楼盘列表出售口径 `/buildings?business=sale`。

## 2. 设计裁定（2026-09-12 与用户确认）

| 问题 | 裁定 |
|---|---|
| 「房源类型加独栋 / 双排 / 联排，支持多选」怎么落 | **新增独立字段** `buildingForm`（多选），不动 `listingType`。理由：`listingType` 单选被 20+ 处消费（筛选、首页类型卡聚合、导航目标池 PG 枚举、供给导入按中文名匹配、审核队列），改 hasMany 是全链路 schema 变更；且 `serviced-office` 在 C 端已显示为「独栋办公」，把「独栋」塞进同一枚举会撞车 |
| 三个取值 | `detached`=独栋、`double-row`=双排、`townhouse`=联排。非必填、不参与完整度门、不参与有效供给谓词 |
| C 端露出 | 房源详情参数表（面积与格局组，默认显示，走 OPT-083 站点设置显隐）+ 房源列表筛选器。**不上**卡片标签（OPT-047 2MB 缓存红线） |
| 筛选行形态 | 与现有「类型」行同款：单选 pill 行、URL 层 `form` 参数接受多值、计数为 0 的候选不渲染。多选是**字段**的能力，不改筛选 UI 的既有交互 |
| 二级菜单机制 | **代码规则，不做后台可配子项**：主导航行目标为 `listings` / `buildings` 时自动挂固定子项。后台可配子项要数组套数组 + 新目标进 PG 枚举，本次不做 |
| 「找楼盘 → 出售」落点 | 楼盘列表新增出售口径 `?business=sale`：只列有有效出售房源的楼盘，聚合按 `sale` 算，卡片「N 套在租」→「N 套在售」；无参数仍是租赁口径，现有 URL 行为不变 |

## 3. 做法

### 3.1 建筑形态字段

| 层 | 改动 |
|---|---|
| `src/domain/review/listing-fields.ts` | `BUILDING_FORMS = ['detached','double-row','townhouse']`、`BUILDING_FORM_LABELS`、`isBuildingForm`；与 `LISTING_TYPES` 同一写法 |
| `src/collections/Listings.ts` 基本信息 | 新增 `buildingForm`：`select`、`hasMany: true`、`options` 由上表生成，紧挨「类型」；不 `markPublishRequired` |
| 迁移（一条） | `listings_building_form` 子表（Payload hasMany select 的标准形态）+ `enum_listings_building_form`；`site_settings` 加详情参数显隐列（见 3.3）。`pnpm generate:types` 后 `Listing['buildingForm']` 为 `('detached'\|'double-row'\|'townhouse')[] \| null` |
| `src/domain/public-catalog/contracts.ts` | `ListingDetailViewModel` 加 `buildingForm: readonly BuildingForm[]`（只进详情 DTO，不进卡片） |
| `src/domain/public-catalog/mappers.ts` `mapListingDetail` | 映射 `buildingForm`（非法值过滤、去重） |
| `src/domain/supply-import/listing-row.ts` | 不改：导入模板本次不加「建筑形态」列（非目标） |

### 3.2 列表筛选（`form`）

| 层 | 改动 |
|---|---|
| `src/domain/public-catalog/search-params.ts` | `BUILDING_FORM_WHITELIST`；`parseListingSearchInput` 读 `form`（多值）→ `input.buildingForm`；`buildCanonicalSearchParams` 输出 `form`；`ListingSearchDimension` 加 `buildingForm` |
| `src/domain/public-catalog/supply-adapter.ts` | `LISTING_SCAN_SELECT` 加 `buildingForm` |
| `src/domain/public-catalog/listing-scan.ts` | 扫描行加 `buildingForm: readonly string[]`；`buildingForm` 进 `SCAN_MEMORY_DIMENSIONS`（行级小值域，缓存键坍缩口径同 `listingType`）；内存过滤：行的 form 与 input 有交集即命中；facets 加 `buildingForms` 计数 |
| `src/lib/frontend/listing-filter-rows.ts` | 维度清单加 `buildingForm`（label「建筑形态」，paramKeys `['form']`）；筛选行加 `{ key: 'form', label: '建筑形态', options }`，0 计数隐藏、当前已选保留；`LISTING_CLEARABLE_DIMENSIONS` 加入 |
| `src/lib/frontend/listing-display.ts` | `BUILDING_FORM_LABEL`（C 端标签，与域层标签同值，本次不另起文案） |
| `CityListingsView` / `MobileFilterSheet` | 行数据驱动，理论上零改动；若有按 key 硬编码的行序或高度，补上 |
| `src/lib/frontend/city-routes.ts` 等把 input 写回 URL 的地方 | 带上 `form` |

### 3.3 详情参数表

| 层 | 改动 |
|---|---|
| `src/lib/frontend/detail-spec/fields.ts` | listing 登记表 `space` 组加 `{ key: 'buildingForm', label: '建筑形态', defaultVisible: true }` |
| `src/lib/frontend/detail-spec/listing-rows.ts` | resolver：`ctx.buildingForm` 非空 → 按 `BUILDING_FORM_LABELS` 映射后「、」拼接；空 → null（该行不渲染） |
| `src/globals/site-settings-spec-fields.ts` + 迁移 | 显隐列随登记表生成；`tests/opt083-detail-spec-registry.test.ts` 的零变化清单更新 |

### 3.4 导航二级菜单

| 层 | 改动 |
|---|---|
| `src/lib/frontend/nav-targets.ts`（或新文件 `nav-submenu.ts`） | `NAV_SUBMENU_BY_TARGET`：`listings → [{租赁, /listings}, {出售, /sale}]`、`buildings → [{租赁, /buildings}, {出售, /buildings?business=sale}]`；`resolveNavRow` 输出的 `PublicNavItem` 加可选 `children` |
| `src/lib/frontend/public-nav.ts` | `PublicNavItem` 类型加 `children?: readonly PublicNavItem[]`；`MAIN_NAV_ITEMS` 默认值同步（兜底路径也要有下拉） |
| `SiteNav` 桌面 | 有 `children` 的项渲染为 `<div class="site-nav__group">父链接 + <ul class="site-nav__menu">`，`:hover` / `:focus-within` 展开，父链接 `aria-haspopup="true"` + `aria-expanded` 由 CSS 态驱动（不引入 state）；子项 `cityAwareHref` 同父项处理；`aria-current` 判定：子项命中时父项也高亮 |
| `SiteNav` 抽屉 | 父项一行，其下缩进两行子项，都是 `mobile-drawer__link` |
| `styles/` | `.site-nav__group` / `__menu` / `__sub`：白底、`--shadow-*`、圆角、`--sp-*` 间距；透明头下的下拉仍是白底深字 |
| `tests/public-nav.test.ts`、`tests/site-nav*.test.ts` | 更新主导航快照；新增「listings / buildings 项带两个子项、其余项无子项」断言 |

### 3.5 楼盘列表出售口径

| 层 | 改动 |
|---|---|
| `src/domain/public-catalog/building-search.ts` | `BuildingSearchInput.business?: 'sale'`；解析 `business=sale`（只认这一个值，其余忽略）；canonical 输出 |
| `src/domain/public-catalog/facade.ts` | `searchBuildings` / `attachSupplyAggregates`：`business === 'sale'` 时聚合改 `businessType: 'sale'`，并**只保留 count > 0 的楼盘**；租赁口径完全不变（仍强制 lease） |
| `BuildingSummaryViewModel` | 不加新字段：`listingCount` / `leasableArea` 在出售口径下就是在售套数 / 在售面积，语义由页面 scope 决定。卡片文案从 props 传入 `stockUnitLabel`（「套在租」/「套在售」） |
| 楼盘页路由 + `CityBuildingsView` | `createSearchContext(city, now, input.business)`；缓存 key 含 `business`；页面标题 / metadata「{城市}写字楼出售」；「仅看有在租」开关在出售口径下隐藏（恒为真）；`BuildingCompactRow`「暂无在租」分组在出售口径下不出现 |
| `building-filter-rows.ts` | 所有筛选 href 保留 `business` 参数（同 `priceUnit` 不可清除的处理方式） |
| `sitemap` / `sale-channel.ts` | 出售楼盘列表**不进 sitemap**、`noindex`（与 `/sale` 同口径：有效出售房源为 0 时 noindex；本次简化为恒 noindex, follow） |

## 4. 验收

- [x] 单测：`isBuildingForm`；`parseListingSearchInput` 的 `form` 白名单与 canonical 回写；扫描行过滤「交集命中」与 facet 计数；`mapListingDetail.buildingForm` 去重过滤
- [x] 单测：`attachMainNavSubmenu`（代替 `resolveNavRow`——子项按目标 href 挂，不在行解析里做） 对 `listings` / `buildings` 产出子项，其余为空；`SiteNav` 渲染下拉结构（桌面 + 抽屉）
- [x] 单测：`parseBuildingSearchInput` 的 `business`；`searchBuildings` 出售口径只含有在售房源的楼盘且聚合为 sale
- [x] 迁移：`pnpm migrate:dry-run` 无禁用模式；`up` / `down` 齐全；本地 `payload migrate` 后 `/admin` 房源表单出现「建筑形态」多选
- [x] 后台浏览器：新建 / 编辑房源勾选独栋 + 联排 → 保存 → 回读两值；清空可保存
- [x] C 端浏览器：`/shanghai/listings?form=detached` 只出带独栋的房源、筛选行回显；详情参数表出现「建筑形态：独栋、联排」；站点设置关掉该项后不再显示
- [x] C 端浏览器：1440 顶栏 hover「找办公室」出现租赁 / 出售，键盘 Tab 到父项后子项可达；`/shanghai/sale` 页面「找办公室」父项高亮；375 抽屉里父项下缩进两行
- [x] C 端浏览器：`/shanghai/buildings?business=sale` 只列有在售房源的楼盘、卡片「N 套在售」；`/shanghai/buildings` 与改动前一致（对照截图）
- [x] E2E 自查：`tests/e2e/` 中 `site-nav` / `buildings` 列表 / 筛选行相关用例
- [x] `typecheck` / `lint` / `test:changed`（193 files / 2456）/ `payload-types.ts` 未入库

证据：`artifacts/verification/OPT-096/`。

## 5. 不在本项内

后台可配的导航子项；供给导入模板加「建筑形态」列；楼盘出售口径进 sitemap / 首页入口；`listingType` 枚举与标签的任何变化；筛选 UI 改多选交互。
