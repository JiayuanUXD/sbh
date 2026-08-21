# Task Packet：OPT-036 列表页 Apple 中性极简改版（房源列表 + 楼盘列表）

> 状态：**实施完成，待合并**（实施结果见文末 §7，遗留见 §8）
> 创建日期：2026-08-21　实施完成：2026-08-21
> 分支：`feat/opt-036-listing-pages-redesign-8f2a`（叠在 `feat/frontend-apple-redesign-c4e5` 之上，base `d80232e`）
> 设计依据：`docs/SBH设计任务讨论/房源列表.dc.html`、`楼盘列表.dc.html`
> 前置：OPT-035 首页批次（token 层、导航页脚、`.agent/frontend.md` 视觉规则）
> 验证证据：`artifacts/verification/OPT-036/`

全量改版共 6 个页面族。OPT-035 完成首页；本工作项覆盖两个列表页；详情页另立 OPT-037。

## 0. 设计决策（取自设计稿默认方案）

沿用 OPT-035 已裁定的口径：**`.dc.html` 为唯一事实源**。四份稿均未标「已锁定」，但各自设了默认方案，且不是首个选项（筛选条选 C 而非 A），属讨论后的收敛结果，直接采用：

| 决策点 | 结论 |
|---|---|
| 筛选条形态 | **C · 分行文本条件区**（不吸顶，随页面滚走）——两页一致 |
| 租金单位机制 | **方案 1 · 常驻分段切换（单位即结果集）** |
| 房源列表结果布局 | **A · 卡片网格**（横向列表行 B 作为视图切换保留） |
| 楼盘列表结果布局 | **A · 4 列卡片网格** |
| 楼盘「暂无在租」 | **A · 降权分组 + 换紧凑行** |
| 内容容器 | **1280px**（列表页放宽；首页与详情页仍 1180）· section padding 32 |

## 1. 与首页刻意不同的视觉规格

列表页是筛选页不是浏览页，密度优先。以下几条**不得直接复用首页组件**：

| 项 | 首页 | 列表页 |
|---|---|---|
| 卡片阴影 | 静态微阴影 `--shadow` | **无阴影无边框**，靠 `#fff` 对 `#f5f5f7` 分层 |
| 卡片 hover | `translateY(-6px)` + 阴影加深 | **仅底色** `#fff → #fbfbfd`，200ms，不位移（避免整片网格抖动） |
| 图上渐变 | `rgba(0,0,0,.42)` → 0，底部 45% | `rgba(0,0,0,.46)` → 0，底部 **44%** |
| 卡图比例 | 供给卡 4:3 | 房源卡 4:3；**楼盘卡 16:10**（封面多为横向街景） |
| 容器 | 1180 | **1280** |

> **2026-08-21 实施期推翻（用户指示「样式上如果能一致最好一致」）**：本表前三行**不采用**。
> 卡片阴影 / hover / 图上渐变 / 图上标签一律走全站共享基元 `styles/surface.css` 的 `.sf-*`
> （详见 `.superpowers/sdd/cross-batch-design-decisions.md`）：`.sf-card` 保留静态 `--shadow`，
> hover 位移由首页的 -6px 与列表页的「不位移」折中为 **-2px / 320ms**（首页一并下调），
> 渐变统一 `rgba(0,0,0,.42)` / 45%。实际保留的刻意差异只剩后两行：**容器 1280 与 section
> padding 32**（布局刚需），外加卡图比例（房源 4:3 / 楼盘 16:10）与价格定宽盒宽度。

## 2. 房源列表

### 2.1 租金单位机制（本页核心难题）

商办报价天然三种单位——`元/月`、`元/㎡/天`、`元/工位/月`——**彼此无法换算**（缺面积或工位数时换不了），因此无法跨单位排序或比较。

方案 1 落地形态：
- 单位分段控件常驻页头下方：外壳 `#e9e9ed`、radius 980、padding 4、段高 32、选中白底 600
- 切换单位即切换结果集，URL 反映在 `?priceUnit=`（域层已有 `rentUnit → PriceDisplayUnit` 白名单，且 `rent-asc/rent-desc` 排序缺单位会降级为推荐排序——地基已具备）
- **必须明确告知被排除了多少**：结果区末尾白底条列出其余单位的套数（如「536 / 418 套」），可一键切换

### 2.2 筛选形态 C

- 白底 radius 18、padding 10/32，5 行：位置 / 类型 / 价格 / 面积 / 装修，每行单选
- 行 padding 上下 14；选项 15px 纯文本，未选 `--ink`，选中 `--accent-link` 500
- 底栏：1px 分隔线上方放计数 13/500 tabular + 已选 chip（28 高）+ 清除
- 筛选 pill：36 高、padding 0 14、radius 980、13/500
- **激活态零色相**：底 `#1d1d1f` 文字 `#fff`；未选底 `#fff` 文字 `--ink-2`
- 「更多」徽标 18×18 radius 980、底 `--ink`、11px tabular
- 二级面板：白底 radius 18、padding 24/28/20、4 列 gap 24/28；输入框 36 高 radius 10 底 `#f5f5f7`（面板内反向分层）
- 排序是文本级控件（13px 纯文本、当前项 `--accent-link` 500、无背景无边框）——**权重刻意低于筛选**：筛选改结果集，排序只改顺序

### 2.3 房源卡

- 六项信息排布：类型压在图上；标题 / 位置各一行；**价格与面积同一行**
- 字号：标题 17/600/1.35 · 位置 13/1.4 · 价格 22/600 · 面积 13
- **价格对齐（R1 核心）**：数字放进定宽右对齐盒 + tabular-nums + 两位小数固定 → 各卡小数点落在同一相对位置。`元/㎡/天` 用 **58px**；`元/月` 用 **88px**（六位数 `316,200` 需更宽）
- padding 14/16/16 · 圆角 18

### 2.4 三种空态（含义不同，必须分别设计）

| 空态 | 形态 |
|---|---|
| ① 该条件本身无货 | 标题 22/600 + 主按钮 40 高 accent + 次按钮 40 高 `#f5f5f7` |
| ② 筛选后无结果 | **逐条退路行 56 高**，每行给一个可放宽的条件与其命中数（15/600 tabular），点击**只改一个参数** |
| ③ 页码越界 | **不显示「没有结果」**，直接给「最后一页」与「第 1 页」两个出口 |

### 2.5 分页

页码 36×36、当前项底 `--ink`、每页 24、写入 `?page=`。维持分页而非无限滚动（稿中有判断依据段落）。

## 3. 楼盘列表

### 3.1 「暂无在租」降权分组（方案 A）

楼盘本身是有价值内容（楼宇字典），不能像房源那样直接隐藏。方案 A：
- 分组标题 15/600 + 计数 13 `--ink-2` + 说明 13 `--ink-3`，上方 1px 分隔线 + 24 间距
- 暂无在租组换**紧凑行**：两列 gap 12/16、行高 **64**、radius 14、padding 12/16
- 缩略图 48×48 radius 10、占位色 `#a1a1a6`（比在租卡的 `#8e8e93` 更浅）
- 文字：楼名 15/600（**不弱化**）· 资料 12 `--ink-3` tabular
- 「上新通知我」：32 高 pill、底 `#f5f5f7`、12/500 `--ink-2`
- 与在租卡的高度差 182 : 64 —— 降权靠密度差而非灰度

### 3.2 楼盘卡

- 图 16:10；等级标签压在图上（白底 92%、12/600、**无色相**——超甲级与乙级同底色）
- 字号：楼名 17/600 · 地址 13 · 地铁 13 · **在租套数 19/600** · 面积 13
- 卡底数据行：margin-top 8 + padding-top 10 + 1px 分隔线
- 在租套数用 26px 定宽右对齐 + tabular-nums
- padding 14/16/16 · 圆角 18

### 3.3 筛选能力拉齐

原先楼盘列表只有区域 + 等级两个维度，用户从房源列表切过来会明显感到变弱。补齐为：**区域 · 等级 · 地铁 · 在租面积 · 竣工年代 · 仅看有在租**。
- 「仅看有在租」是开关 pill：36 高 pill 内嵌 34×20 开关——**唯一允许用 accent 底的筛选项**
- 排序项：在租最多（默认）· 在租面积 · 等级 · 竣工最新

## 4. 移动稿（375）

- 卡单列 343；房源图 343×257；section 左右 16
- 单位分段全宽 36 高，常驻标题栏内并随页面吸顶
- 标题栏 padding-top 54（吸顶后仍留出灵动岛）
- 筛选入口：底部悬浮 pill 44 高，带条件数与**实时结果数**
- 抽屉：高 88%、顶部圆角 24、底栏 48 高按钮、分组间距 24 + 1px 分隔线
- 移动筛选是独立抽屉 UI，**不是桌面横条的等比缩小**

## 5. 硬约束（继承 OPT-035 并新增）

- 筛选状态的事实来源是 **URL**，任何筛选/排序/分页都反映在地址栏，可直接分享；不得出现只存在于内存的临时状态
- 价格必须携带币种、租售类型、周期和单位；**不可跨单位聚合或排序**
- 标签零色相；筛选激活态用底色深浅而非色相
- 数字一律 tabular-nums；缺失显示 `—` 不显示 0
- 空态必须给退路，不能只说「没有结果」
- 中文 `letter-spacing: normal`；容器流体规则不加媒体查询；断点只用 767 / 1023
- 视觉验收**不排在最后**：结果区一接线就截图，之后每个区块改完即看

## 6. 验收

- `pnpm typecheck` + `pnpm test` + `pnpm lint` 无新增错误
- 四断点（375 / 768 / 1440 / 1920）逐屏截图人工确认，不接受只报数值
- 三种空态、单位切换、筛选清除、页码越界逐条走查并截图
- 价格小数点跨卡对齐（同单位下）实测
- 对比度全部 ≥4.5:1
- 证据存 `artifacts/verification/OPT-036/`

---

## 7. 实施结果（2026-08-21）

分支 `feat/opt-036-listing-pages-redesign-8f2a`，`d80232e..` 共 34 个提交，分 14 个任务四组推进
（A 域层 → B 组件 → C 接线 → D 收尾）。

### 7.1 交付内容

**域层**（`src/domain/public-catalog`）

- 新增 `BuildingSearchInput` / `BuildingSort` 与解析、canonical（`building-search.ts`）：楼盘筛选从视图层
  内存过滤下沉到查询层，六个维度（区域 · 等级 · 地铁 · 在租面积 · 竣工年代 · 仅看有在租）全部有现成字段，
  **本批次零数据库变更**。
- `searchBuildingsFiltered`：筛选 → 排序 → `partitionByStock` → **合并成一条序列后再分页**（不是每组各自
  分页），返回 `groups` / `withStockTotal` / `withoutStockTotal` / `unfilteredTotalDocs` / `dimensionHits`。
- `sumEffectiveLeasableAreaByBuildings` → `aggregateEffectiveSupplyByBuildings`（同一条 SQL 加 `COUNT(*)`），
  `BuildingSummaryViewModel` 增 `listingCount` / `typicalFloorArea` / `completionDate`。
- 新增按维度剥离的 facet 查询 `omitListingSearchDimensions` / `getSearchFacetsIgnoring`，缓存层
  `getCachedSearchFacetsIgnoring` **先剥离再用剥离后的 canonical 当缓存键**，三份 facet 常见情形只查一次库。

**共享层**

- 新建 `styles/surface.css`（`.sf-card` / `.sf-scrim` / `.sf-phototag` / `.sf-media` / `.sf-num`），
  `home.css` 回改复用，`list.css` 直接复用。OPT-037 / 038 继续复用，不得再写第二份。
- 新建 `lib/frontend/listing-url.ts`（`cloneSearchParams` / `buildHref` / `buildPriceUnitHref` /
  `parseListingViewMode`）与 `lib/frontend/listing-display.ts`（跨目录展示映射收敛点）。

**组件**（`components/frontend/listing/`，16 个）

`FilterFormC` `FilterPill` `PriceUnitSegment` `ExcludedUnitsBar` `ResultToolbar` `ListPager`
`ListingResultCard` `ListingResultRow` `BuildingResultCard` `BuildingCompactRow`
`EmptyNoStock` `EmptyFiltered` `EmptyOutOfRange` `MobileFilterTrigger` `MobileFilterSheet` `MobileFilterShell`。

**编排**：`CityListingsView` / `CityBuildingsView` 接线，`/[city]/listings`、`/[city]/sale`、
`/[city]/buildings` 及各自 legacy 路由。

**清理**：删除 6 个零引用组件（`FilterBar` / `MobileFilterDrawer` / `ListingGrid` /
`BuildingFilterBar` / `BuildingGrid` / `BuildingListCard`）+ 其专测，删除无生产调用方的
`getCachedSearchBuildings` / `getCachedSearchBuildingsByCity`。

### 7.2 验证证据

`artifacts/verification/OPT-036/`：

| 路径 | 内容 |
|---|---|
| `task3/` | 首页回改 `.sf-*` 前后裁图对比（`crop-b1/b3-old/new`）+ 1440/375 全页 + dev-story 预览页 |
| `task11/` | 房源列表四断点（375/768/1440/1920）+ 三种空态 + 单位切换 + 行版式 + 移动抽屉开/选后 + legacy 路由 |
| `task12-*.png` | 楼盘列表四断点 + 开关开启态 + 筛选后空态 + 移动抽屉 |
| `card-*.png` / `filter-*.png` / `price-unit.png` / `toolbar-pager.png` / `empty-states.png` / `mobile-*.png` | 各组件任务在 `/dev-story/opt036` 上的单件验收 |
| `task12-fix-*.png` / `task12-fix2-offbucket-chip.png` | 修复轮的先红后绿实证 |

守卫测试：`tests/opt036-listings-view-wiring.test.ts`（13 条）、`tests/opt036-buildings-view-wiring.test.ts`
（12 条）断言**编排层的调用行为与结构**而非底层工具函数；`tests/opt036-building-search.test.ts` /
`opt036-building-search-result.test.ts` 覆盖域层。所有新增守卫做过变异验证（故意改坏 → 确认变红 → 还原）。

门禁：`pnpm typecheck` + `pnpm test`（3373 passed）+ `pnpm lint` 全绿，改动前后 warning 基线一致。

### 7.3 实施期推翻的计划假设（下游勿再引用旧说法）

1. **§1 前三行的「两套卡片系统」不采用**（见 §1 下方的推翻说明）。
2. **楼盘卡在租套数盒 26px → `min-width: 36px`**：实测三位数 `128` 在 26px 下 `scrollWidth` 已 35px 会粘连；
   且必须用 `min-width` 而非 `width`（后者是硬上限，四位数重演粘连）。
3. **筛选条行数与设计稿不同**：房源页 4 行（无「装修」——`ListingSearchInput` 尚无该维度，造一行等于死控件，
   见 §8 OPT-039）；楼盘页 5 行文本 + 1 行开关，**没有价格行**（楼盘本身无报价）。数值维度按「下限/上限
   单选」建模而非区间桶（`FilterRow` 一行一参数）。
4. **grade 排序按产品序「超甲级在前」**，不跟随 `BUILDING_GRADE_LABELS` 的键序（后者是声明顺序不是排名）。
   计划里「照 label map 键序」那句是错误指令。
5. **`?view=` 不进 canonical**，但地址栏保留（只改渲染不改结果集）。
6. **窄屏 `.ls-toolbar` 顺手改版**：375 下计数被压成 47px 宽断成四行，两页均改为计数与排序各占一行。

### 7.4 已回写的常驻规则

`payload-office-platform/.agent/frontend.md`：§视觉（`.sf-*` 共享基元与加载顺序）、新增 §列表页（筛选页）、
§React 与类型（URL 唯一事实源 + 必删 `page` + 判断逻辑单点化）、§状态（三种空态语义 + 开宽接口不降级）、
新增 §工程纪律（`aria-current` / 逐类名清理 / 守卫落在失效点 / 子代理环境级告警须复验）。

## 8. 遗留（交给下一批实施者）

### 8.1 已立工作项

| 编号 | 内容 |
|---|---|
| `OPT-039-listing-decoration-dimension.md` | 房源筛选补「装修」维度。字段在 `Listings` 上已存在，缺的是 `ListingSearchInput` 的维度与解析。两个坑：复用既有 `DECORATION_STATUSES` 白名单别写第二份；`omitListingSearchDimensions` 漏补不报错，只会让空态②少一条退路 |
| `OPT-040-city-route-filter-whitelist.md` | `city-routes.ts` 的 `selectBuildingQuery` 只保留 `grade`，本批次新建的 5 个维度（district / metro / 在租面积 / 竣工 / onlyWithStock）在 legacy 307 跳转与**切换城市**两条路径上全部被丢弃。白名单口径属多城工作项，不该在接线任务里悄改 |

### 8.2 未立工作项的已知缺口

1. **`.ls-filterc` 在 375 下的触达缺口**：该容器没有 `<768px` 隐藏规则，整块筛选条在移动端照常渲染，
   其中 36 高开关 pill、28 高 chip、行内纯文本选项均低于 44px 触达下限（缺口继承自房源页，不是楼盘开关独有）。
   移动端主路径是抽屉里 52 高整行可点的 `.ls-msheet__switch`，但那不会让筛选条里的控件变可触达。
   修法需先决定筛选条在窄屏下的归属（隐藏 or 整块加大触达尺寸），是横跨两个列表页的一次性处置。
2. **`Modal.tsx` 与 `MobileFilterSheet` 的焦点陷阱 / Esc / 滚动锁逻辑重复**：两者 chrome 差异太大，
   字面复用不现实，本批次接受了重复。**改任一处必须同时检查另一处**。若 OPT-037/038 再出现第三个浮层，
   届时应抽一个 headless 的焦点陷阱 hook 而不是复制第三份。
3. **`findEffectiveBuildings` 的 200 条硬上限**：`searchBuildingsFiltered` 继承 supply-adapter 的
   `limit = 200` 并在 JSDoc 记明。某城有效公开楼盘超过 200 个时，筛选/排序/分页都只作用于前 200 条，
   **静默截断无告警**。放宽需先评估查询成本，改走分页适配器（类似 `findEffectiveBuildingsPage`），
   不是简单调大数字。当前七城种子数据远未触顶，属容量型风险不是缺陷。
4. **需求 6「移动抽屉 open 状态不被重挂」只有间接守护**：「Suspense 不会因 `searchParams` 重新 suspend」
   是运行时性质无法单测，现靠「列表路由链路上无 Suspense、**无 `loading.tsx`**」这条断言
   （`opt036-listings-view-wiring.test.ts:193`）+ 一次端到端 probe（375 下给 shell 根节点打运行时标记 →
   点筛选项 → URL 变、抽屉仍开、标记仍在）间接保证。**将来给列表路由加 `loading.tsx` 会让该断言变红：
   那时必须重做端到端验证，不能只删断言。**
5. **`ListingResultCard` 的出售（one-time）定宽盒未验证**：8 位数总价会溢出 88px。注释已写明复用到出售
   语境前需重新定宽并补 fixture。
6. **`.listing-card--list` 及其子规则当前无渲染调用方**（唯一曾传 `view="list"` 的 `ListingGrid.tsx` 已删），
   但保留文件 `ListingCard.tsx` 仍声明 `view` 属性，删除属于静默削弱保留文件的公开能力，按「拿不准就留着」
   处理，CSS 注释里写明了理由。
7. **本地种子库只有 6 个楼盘**（5 有在租 + 1 暂无），真实路由上造不出第 2 页——「分页跨组边界」只有域层证据，
   无路由层截图。
