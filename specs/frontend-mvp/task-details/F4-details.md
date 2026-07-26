# 前台任务：F4：房源详情与楼盘详情

> 返回：[任务索引](../tasks.md)

## 6. F4：房源详情与楼盘详情

- [x] 4.1 实现房源详情服务端路由
  - 按 slug 读取当前发布版本并执行请求时有效性复核。
  - 完成面包屑、metadata、404 和数据错误边界。
  - 不允许从旧缓存或旧查询展示失效房源。
  - _Requirement: R5, R9；Page PRD: FP-03 §4, §6_
  - 实现：[listings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx)
    - 通过 `getListingBySlug` Facade 接入公开目录 DTO（替换 `lib/frontend/queries`）。
    - `defaultSearchContext` 提供统一 `asOf`/`Asia/Shanghai`/`public-web` 上下文。
    - `notFound()` 走 Next 404 边界；失效房源不再从旧缓存展示。
    - `generateMetadata` 生成 title / description / canonical / OG / robots。

- [x] 4.2 实现房源图片与核心决策区
  - 完成响应式画廊、缩略图、全屏、键盘和失败占位。
  - 桌面实现粘性决策卡，移动端实现不遮挡正文的固定咨询栏。
  - 价格、面积、工位、入驻时间、位置和亮点使用统一格式。
  - _Requirement: R5, R10；Page PRD: FP-03 §3.1–§3.2_
  - 实现：[ListingGallery.tsx](file:///e:/github/sbh/payload-office-platform/src/components/frontend/ListingGallery.tsx)、[styles.css §14](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/styles.css)
    - 16:10 主图 + 缩略图横滚 + 全屏 lightbox（Esc/←/→、焦点锁定、焦点归还）。
    - 失败占位 SVG，主图 click 触发全屏；缩略图 click/Enter/Space 切换。
    - 桌面 `.detail__decision` sticky（top 含 site-header-height），移动端 `display: none`。
    - 移动端 `.detail__mobile-bar` fixed bottom，含 rent + title + InquiryModal，桌面 `display: none`。
    - `.detail` 在移动端补 `padding-bottom: 88px` 避免遮挡。

- [x] 4.3 实现房源内容、楼盘摘要和相关推荐
  - 服务端白名单渲染富文本。
  - 同楼盘和相似推荐再次使用统一有效供给查询并排除当前房源。
  - 相关模块为空时安全隐藏。
  - _Requirement: R5, R9；Page PRD: FP-03 §3.3_
  - 实现：[listings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx)
    - `<RichText data={listing.description} />` 服务端白名单渲染。
    - `getRelatedListings(slug, ctx, { limit: 6 })` 复用同一 SupplyAdapter，排除当前 listing.id。
    - 楼盘摘要与"查看楼盘"链接仅在 `building` 非空时渲染；相关模块为空安全隐藏。

- [x] 4.4 实现楼盘详情与公开规则
  - 展示楼盘主视觉、位置、交通、等级、配套和介绍。
  - Building、城市或区域不可公开时返回 404。
  - 楼盘可公开但无房源时保留内容和通用咨询，不显示虚假在租信息。
  - _Requirement: R6, R9；Page PRD: FP-04 §3–§5_
  - 实现：[buildings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx)
    - `getBuildingDetail(slug, ctx)` 返回 building / listings / priceRanges；`building == null` 时 `notFound()`。
    - `generateMetadata` 同房源路径，含 canonical / OG / robots。
    - 楼盘无房源时仍展示楼盘信息与通用询价 CTA，不伪造"在租"数据。

- [x] 4.5 实现楼盘有效供给聚合与楼内列表
  - 使用同一 `asOf` 生成房源数、面积区间和价格区间。
  - 按租售、币种和单位分组，不生成跨单位统一区间。
  - 楼内卡片复用 Public Catalog DTO 和房源卡片。
  - _Requirement: R6, R9；Page PRD: FP-04 §3.3–§4_
  - 实现：[buildings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx)、[facade.ts#getBuildingDetail](file:///e:/github/sbh/payload-office-platform/src/domain/public-catalog/facade.ts)
    - Facade 内 `buildPriceRangesByUnit` 按 `rentUnit` 分组，跨单位不合并。
    - 楼内卡片直接复用 `ListingCard` + `ListingCardViewModel` DTO。
    - 聚合统计：在租房源数、面积区间（min/max）、价格区间组数、立即可入驻数。


- [x] 4.6 完成详情 SEO、分享与埋点
  - 实现 canonical、OG、结构化数据和 sitemap 资格。
  - 分享 URL 不携带个人筛选数据。
  - 接入画廊、楼盘跳转、相关推荐、楼内房源和咨询事件。
  - _Requirement: R8, R10；Page PRD: FP-03 §7, FP-04 §6_
  - 实现：[listings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx)、[buildings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx)
    - canonical 与 OG 已在 F4.1/F4.4 由 `generateMetadata` 生成（含 `alternates.canonical` 与 `openGraph.url`）。
    - 结构化数据（JSON-LD）：房源页 `Product + Offer`，仅声明 name/url/description/image/offers(price/priceCurrency/url)，不伪造 availability/availabilityStarts；楼盘页 `Place`，仅当存在有效房源时附加 `AggregateOffer[]`（按 rentUnit 分组），不伪造 rating。
    - sitemap 资格：[sitemap.ts](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/sitemap.ts) 已包含 listings/buildings，且复用 `buildingOperationalWhere`/`listingBuildingOperationalWhere` 谓词，与详情页可见性一致。
    - 分享 URL：详情页路由为 `/listings/<slug>` 与 `/buildings/<slug>`，不携带 query 或个人筛选数据。
    - 埋点钩子：`InquiryModal`（询价 CTA）、`ListingGallery`（画廊交互）、`ListingCard`（楼内/相关卡片点击）已具备客户端交互；楼盘跳转链接标记 `data-event-name="listing_building_link_click"`，可由后续 F6 SDK 通过事件委托采集。

- [x] 4.7 验收房源与楼盘详情
  - 执行 FP-03、FP-04 全部验收条款。
  - 验证房源/楼盘在各类失效事件后的 404、聚合和推荐撤销。
  - 验证三种租金单位、出售价格、无相关推荐和无有效房源。
  - _Requirement: R5, R6, R9, R10_
  - 验收证据：
    - **类型/构建/测试**：`pnpm typecheck` 通过；`pnpm test` 51 文件 / 856 用例全部通过；`pnpm build` 成功（NEXT_PUBLIC_SITE_URL=http://localhost:3717）。
    - **失效一致性**：[public-catalog-facade.test.ts](file:///e:/github/sbh/payload-office-platform/tests/public-catalog-facade.test.ts) §「失效供给一致性」覆盖草稿、已出租、逻辑删除、停用楼盘四类失效条件在「列表/详情/相关推荐/询盘候选」中的统一返回 null/空数组；停用楼盘房源不出现在 sitemap（sitemap.ts 复用同一 `listingBuildingOperationalWhere`）。
    - **三种租金单位**：fixture 含 `rmb-month`(1001)、`rmb-sqm-day`(1002)、`rmb-seat-month`(1003)；价格排序预处理测试验证未指定 rentUnit 时按首单位过滤、显式 rentUnit 时仅返回该单位；楼盘聚合 `priceRanges` 按 unit 分组、跨单位不合并。
    - **无相关推荐**：`getRelatedListings` 在 listing 或 building 关系缺失时返回空数组，详情页 `relatedFiltered.length > 0` 守卫安全隐藏相关模块。
    - **无有效房源**：`getBuildingDetail` 在楼盘可公开但无房源时返回空 listings/priceRanges，楼盘页仍展示楼盘信息与通用询价 CTA（不伪造"在租"数据）。
    - **手动 E2E**：可启动 `pnpm dev` 后访问 `/listings/<slug>` 与 `/buildings/<slug>` 走查；建议覆盖 3 种租金单位房源、停用楼盘 404、无房源楼盘。
