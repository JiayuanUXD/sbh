# Task Packet：OPT-119 区域 / 商圈落地页

> 状态：**待合并**（分支 `feat/opt-119-area-landing-pages-be12`；合并即上线，闸门通过后自动全量切流）
> 创建日期：2026-10-16
> 来源：SEO 勘查（OPT-118 的姊妹项）——最大的流量机会是「徐汇区写字楼出租」「陆家嘴办公室租金」这类区域 / 商圈词，而现在只有带筛选参数的列表页和楼盘 / 房源详情页。
> 与 OPT-118 互不依赖；沿用它的两条规则：sitemap 的 `lastmod` 只写真实时间、JSON-LD 的 URL 一律绝对。

---

## 1. 线上现状（2026-10-16，`shangban.cc`）

| 现象 | 说明 |
|---|---|
| `/shanghai/listings?district=xuhui` 可索引、自 canonical | 标题与 `/shanghai/listings` 完全相同（「上海在租房源 · 商办租赁」），正文只是房源网格，没有区域信息 |
| `?district=` 只认行政区 slug | 商圈要用另一个参数 `?businessArea=`（OPT-103），且 `/news/[slug]` 的「相关商圈」链接仍写成 `?district=<商圈slug>`，对商圈根本不生效 |
| 线上可见：9 个行政区（含 `xuhui` `jingan` `pudong` `huangpu` …）+ 22 个可见商圈 | 行政区 slug 是 `xuhui` 这种裸拼音；商圈 slug 两种风格并存（`xujiahui` / `shanghai-hongqiao-shangwuqu`），**全表 slug 全局唯一** |
| 全站没有任何页面承载「均价 / 区间 / 热门楼盘」这类区域级信息 | 价格口径与脚本见 `artifacts/verification/OPT-118/` |

## 2. 设计决定

### 2.1 URL：`/{city}/area/{locationSlug}`，行政区与商圈共用一个路由

- **不用** `/{city}/buildings/{区slug}`：`/[city]/buildings/[slug]` 已经是楼盘详情页，同一段位置装两种实体，需要在详情页 404 前再兜一层区域查询，并且楼盘 slug 与区域 slug 没有任何唯一性约束，迟早撞名。
- `slug` 在 `locations` 表全局唯一，所以一个路由即可：按 slug 查地点，`type` 为 `district` 或 `business_area` 才渲染，其余（城市、地铁站、不可见、停用、跨城）一律 404。
- 只有**带城市前缀**这一种形态（线上 `MULTI_CITY_ROUTING_ENABLED=true`，无前缀路径本来就 307 到前缀路径）。多城开关关闭时前缀路由是 `noindex`，本页同样 `noindex` 且不进 sitemap。
- `city-routes.ts` 新增 `area-detail` 页面类型，加入 4 个穷举 switch 与埋点白名单。

### 2.2 与 `?district=` / `?businessArea=` 筛选页的关系（避免重复内容）

- 落地页自 canonical，是该词的「内容页」；筛选页是「工具页」。
- 筛选页**仅当**规范化后的查询恰好只有一个 `district` 或一个 `businessArea`（无其他条件、非第 2 页）、且对应落地页达到收录门槛时，canonical 指向落地页；其余组合（叠加了类型 / 面积 / 价格等条件）保持自 canonical，不动。
- 落地页内「查看全部房源 / 楼盘」按钮指向筛选页，筛选页再 canonical 回来——两页互相引用但不互相取代。

### 2.3 收录门槛（防薄内容）

- 只为**前台可见（`frontendVisible`）且启用**的行政区 / 商圈生成页面；其余 404。
- 页面存在 ≠ 收录：有效在租房源数 < `AREA_LANDING_MIN_LISTINGS`（10）时页面照常渲染诚实空态，但 `noindex, follow` 且不进 sitemap。
- 价格区块需要 ≥ `AREA_LANDING_MIN_PRICE_SAMPLES`（10）条「元/㎡/天」报价样本，否则整块不渲染（不显示 0、不编造）。

### 2.4 数字口径（全部来自有效供给，页面上注明「挂牌价，非成交价」）

- 与 OPT-118 一致：租赁、单位 `元/㎡/天`（其它单位不可换算，不参与聚合；另有 N 套按其它单位报价时如实说明）。
- 统计由 **同一份有效供给 SQL**（`effectiveSupplySqlFrom`）算出：在租套数、楼盘数、日单价 min / P25 / 中位数 / P75 / max、面积中位数、最近更新时间。**不另写谓词。**
- 月租估算：`日单价 × 面积 × 30`（与 `estimateMonthlyRent` 同口径），文案写明估算方式。
- 「区域介绍」：优先用后台 `Locations.description`（运营可编辑）；缺省时只用数据事实拼一段（楼盘数、在租套数、主要商圈），**不编造地理 / 历史描述**。
- FAQ 全部由上述数字模板生成，没有数据支撑的问题不出。

### 2.5 页面内容

面包屑 → H1 + 数据摘要 → 区域介绍 → 租金参考（中位数 + P25–P75 + min–max + 100㎡ 月租估算）→ 下辖商圈 / 同区商圈（带在租套数与中位价，互链）→ 热门楼盘（按在租套数，复用 `BuildingSummaryCard`）→ 相关资讯（`articles.relatedDistricts`，行政区页含其下辖商圈的资讯）→ FAQ → 查看全部房源 / 楼盘入口。

### 2.6 SEO

- 每页唯一 `title` / `description`（含真实数字）/ `canonical` / 单个 `h1`。
- JSON-LD：`BreadcrumbList`（首页 → 城市 → [行政区 →] 本页，URL 全绝对）+ `ItemList`（热门楼盘，URL 绝对）。**不写** `FAQPage`（Google 已限制其富结果，只增加维护面）、**不写**价格类结构化数据（区域不是商品）。
- sitemap：达标页面进静态 sitemap；`lastmod` = 该区域有效房源 `updated_at` 的最大值（真实时间），取不到则不写。
- 内链：落地页互链（行政区 ⇄ 商圈）；`/news/[slug]` 相关商圈链接改指落地页（顺带修掉 `?district=<商圈slug>` 的失效链接）；楼盘详情面包屑 / 首页商圈卡的改动见 §4。

## 3. 范围与非目标

做：路由、域层统计与文案、SQL、缓存、页面与样式、sitemap、筛选页 canonical 收敛、资讯相关商圈链接、测试、浏览器验收。

不做（单独立项）：
- 无前缀（legacy）路径的落地页；
- 地铁站 / 板块之外的落地页类型（按楼盘类型 × 区域的组合页，如「徐汇区甲级写字楼」）；
- 区域封面图、地图（后台 `coverImage` 有字段，但本期不展示，避免与首页商圈卡混用语义）；
- 价格走势 / 同比环比（没有历史快照，不编造）；
- 出售口径（`business=sale` 不进索引，沿 OPT-096）。

## 4. 验收

- [x] `typecheck` / `lint` / `test` 全绿；新增单测覆盖：路由分类、门槛与路径、文案与 FAQ（含缺数据降级）、SQL 文本只复用有效供给片段 + 真库语义、JSON-LD 绝对 URL、sitemap 条目与 lastmod、筛选页 canonical 收敛的每个分支。
- [x] 本地隔离库浏览器实测：行政区页、商圈页、薄页（noindex）、404（城市 / 不可见 / 不存在 slug）、桌面 + 375 宽、控制台无报错；`curl` 核对 `<title>` / canonical / JSON-LD / sitemap 条目。
- [x] 证据存 `artifacts/verification/OPT-119/`。
- 未验证（合并后才有）：生产真实表现、Google 富媒体测试、百度收录、Core Web Vitals。

## 5. 实现摘要与发现

- 新增：`domain/public-catalog/{area-landing,area-landing-sql,area-landing-facade}.ts`、`lib/frontend/{area-landing-seo,area-landing-canonical}.ts`、`app/(frontend)/[city]/area/[slug]/page.tsx`、`app/(frontend)/_lib/location-filter-canonical.ts`、`components/frontend/city/AreaLandingView.tsx`、`styles/area.css`。
- 改动面：`city-routes.ts`（`area-detail`）、`supply-adapter.ts`（两个可选适配器方法）、`listing-query-sql.ts`（导出价格归一片段，行为不变）、`cached-queries.ts`、`sitemap-shards.ts`、房源 / 楼盘两个列表路由的 `generateMetadata`、首页 Hero chips 与商圈卡、资讯详情相关商圈链接、`detail-metadata.ts`（仅把 `validateSiteOrigin` 改为导出）。
- **发现的既有缺陷（顺带修掉）**：首页热门商圈卡与资讯「相关商圈」把**商圈** slug 塞进 `?district=`，该参数只认行政区，商圈 slug 被静默丢弃，用户落在未筛选的全城列表。落地页把这些入口接到 `/{city}/area/<slug>`。
- **与 OPT-118 的合并**：两边改了同几个文件的不同区域（`sitemap-shards.ts` 的静态页 lastmod、`news/[slug]/page.tsx` 的 JSON-LD、`detail-metadata.ts`、`tests/sitemap-static-routes.test.ts`）。本分支基于 `origin/master`，不含 OPT-118；两者合并时 sitemap 里落地页条目的 `lastModified` 写法（真实时间或省略）与 OPT-118 的规则一致，无需调整。
- 刻意没做：见 §3，以及 `.agent/frontend.md`「区域 / 商圈落地页」的已知缺口（详情页面包屑区域名没链到落地页，因 DTO 缺「区域是否前台可见」）。
