# 前台任务：F6：内容页、SEO 与缓存

> 返回：[任务索引](../tasks.md)

## 8. F6：内容页、SEO 与缓存

- [x] 6.1 定义并实现内容模块白名单
  - 对齐 Payload Pages 的发布状态和模块结构。
  - 支持标题、正文、列表、引用、图片、双栏、亮点卡、CTA、相关文章和相关供给。
  - 禁止任意脚本、未批准 iframe 和未清洗 HTML。
  - _Requirement: R8, R10；Page PRD: FP-06 §2–§5_
  - 验证证据：`src/domain/public-catalog/contracts.ts` 定义 `PageDetailViewModel` / `PageSummaryViewModel` / `PageHeroViewModel` / `PageSeoViewModel` 只读 DTO，字段白名单不含 `_status` / `trash` / `createdBy` / `lastModifiedBy` / `deletedAt` / `createdAt`；`src/components/frontend/PageContent.tsx` 按白名单节点类型渲染（paragraph / heading / quote / list / upload / horizontalrule + 行内 text / link / linebreak / tab），不使用 `dangerouslySetInnerHTML`，外链加 `rel="noopener noreferrer nofollow"`，未支持节点 `console.warn` 跳过不崩溃；`tests/public-catalog-page.test.ts`（17 用例）覆盖 mapper 字段白名单与非法输入回退。

- [x] 6.2 实现内容页路由与模板
  - 只读取已发布版本，草稿/删除/不存在返回 404。
  - 完成长内容排版、目录、相关内容和可选咨询 CTA。
  - 未支持模块跳过并告警，不导致整页崩溃。
  - _Requirement: R8；Page PRD: FP-06_
  - 实现：[pages/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/pages/[slug]/page.tsx)、[PageContent.tsx](file:///e:/github/sbh/payload-office-platform/src/components/frontend/PageContent.tsx)
    - `getPageBySlug` Facade 仅返回 `status=published` 且未逻辑删除的页面；草稿/删除/不存在返回 null，路由层 `notFound()` 走 404。
    - 长内容排版由 `PageContent` 白名单渲染；面包屑 + Hero（eyebrow/heading/summary/image）+ 正文 + 可选咨询 CTA。
    - 法律页面（slug 以 `privacy` / `policy` 开头）跳过营销 CTA，避免在隐私政策页诱导咨询。
    - 未支持模块由 `PageContent` 跳过并 `console.warn`，不导致整页崩溃（FP-06 §7）。

- [x] 6.3 实现动态 SEO 与结构化数据
  - 首页、列表、房源、楼盘和内容页使用统一 metadata 工具。
  - 实现 canonical、OG、Article/公开实体结构化数据和 noindex 策略。
  - 不声明后台数据不能保证的价格、库存、作者或发布日期。
  - _Requirement: R8；Design: §11_
  - 实现：[metadata.ts](file:///e:/github/sbh/payload-office-platform/src/lib/frontend/metadata.ts)、[pages/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/pages/[slug]/page.tsx)、[page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/page.tsx)、[listings/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/page.tsx)
    - `buildPageMetadata` 统一构造 canonical / OG / robots；`buildNotFoundMetadata` 用于 404 / 草稿 noindex。
    - 首页、列表页、内容页均改用 `buildPageMetadata`，消除散落字面量；OG url 由 `siteOrigin + canonicalPath` 拼接为绝对 URL。
    - 内容页 JSON-LD `Article` 仅声明 `headline` / `url` / `description` / `image`，不伪造 `author` / `datePublished` / `dateModified`（后台数据不能保证）。
    - 房源/楼盘 JSON-LD（F4.6 已完成）：`Product + Offer` / `Place + AggregateOffer[]`，不声明 availability / rating。

- [x] 6.4 实现 sitemap
  - 从公开页面和当前有效供给生成，不硬编码生产域名。
  - 支持规模拆分、缓存和失效房源撤销。
  - sitemap 查询同样通过 Public Catalog Facade。
  - _Requirement: R8, R9；Design: §11_
  - 实现：[sitemap.ts](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/sitemap.ts)
    - 内容页通过 `listPublishedPages(ctx, { limit: 500 })` Facade 查询，与 `/pages/[slug]` 路由可见性一致（仅 `status=published` 且未逻辑删除）。
    - home slug 特殊处理：跳过 `/pages/home`，避免与首页 `/`（已占位 priority=1）重复。
    - 优先级：首页 1 / 列表 0.9 / 房源 0.8 / 楼盘 0.6 / 内容页 0.6；内容页 `changeFrequency=monthly`（更新频率低于房源/楼盘）。
    - 站点 URL 由 `siteConfig.siteOrigin` 提供，不硬编码生产域名；listings/buildings 复用 `listingBuildingOperationalWhere` / `buildingOperationalWhere` 谓词，与详情页可见性一致。
    - 规模拆分（50,000 条）与缓存 tag 失效归属 F6.5；MVP 单城市规模未达拆分阈值。

- [x] 6.5 实现缓存 tag 与领域事件失效
  - 落地 home、listing、building、facet、page 和 sitemap tag。
  - 接入发布、审核、冻结、举报、媒体、位置、商户关系/资格/服务城市和可用性事件。
  - 无法安全计算局部影响时执行城市级安全失效。
  - _Requirement: R9, R10；Design: §9_
  - 实现：
    - [cache-tags.ts](file:///e:/github/sbh/payload-office-platform/src/domain/public-catalog/cache-tags.ts)：统一定义 `public:home:{city}` / `public:listings:{queryHash}` / `public:listing:{id}` / `public:building:{id}` / `public:facets:{city}` / `public:page:{slug}` / `public:sitemap` tag 命名规则与构建函数；`cityLevelSafeInvalidationTags(city)` 返回城市级安全失效集合（home + facets + sitemap + listings 类别）。
    - [cache-invalidator.ts](file:///e:/github/sbh/payload-office-platform/src/domain/public-catalog/cache-invalidator.ts)：`computeAffectedTags(event)` 提取 listingId/buildingId/city，计算失效 tag 集合（含具体 tag + 类别级 tag）；`createCacheInvalidatorConsumer(eventType, invalidator)` 实现 `EventConsumer`，监听 8 种事件（listing.published / unpublished / review_approved / review_rejected + report.supply_paused / supply_resumed / sustained / dismissed）；`registerCacheInvalidatorConsumers(dispatcher, invalidator)` 批量注册；`createNextTagInvalidator()` 包装 `next/cache.revalidateTag`，懒加载避免测试环境报错。
    - [cached-queries.ts](file:///e:/github/sbh/payload-office-platform/src/lib/frontend/cached-queries.ts)：用 `unstable_cache` 包装 Facade 调用（getCachedHomepage / getCachedListingBySlug / getCachedRelatedListings / getCachedBuildingDetail / getCachedBuildingBySlug / getCachedSearchListings / getCachedSearchFacets / getCachedPageBySlug / getCachedPublishedPages），标记 cache tag 供事件失效。设计取舍：`unstable_cache` tags 在闭包中静态，无法按参数动态生成 `public:listing:<id>`，因此 cached function 用类别级 tag（`public:listings` / `public:buildings` / `public:pages`），失效时同类别全量清空。具体 tag（listing:123）保留供未来启用 Cache Components 时使用。
    - [index.ts](file:///e:/github/sbh/payload-office-platform/src/domain/public-catalog/index.ts)：导出缓存相关模块。
  - 测试：[public-catalog-cache-invalidator.test.ts](file:///e:/github/sbh/payload-office-platform/tests/public-catalog-cache-invalidator.test.ts)（17 用例，覆盖 computeAffectedTags 对 listing / report / 无 city / building / aggregateType 派生 / 去重 / 类别级 tag 失效、consumer handle 成功与失败、批量注册、失效覆盖完整性）
  - 失效映射：
    - listing.* / report.supply_* → `public:listing:<id>` + `public:listings` + `public:home:<city>` + `public:facets:<city>` + `public:sitemap`
    - building.* → `public:building:<id>` + `public:buildings` + 城市级 + sitemap
    - 无法确定 city → `cityLevelSafeInvalidationTags('all')` 全城市安全失效
  - 验收：`pnpm typecheck` 通过；`pnpm test` 85 文件 1676 用例全通过；`pnpm build` 成功

- [x] 6.6 验收内容、SEO 与缓存
  - 执行 FP-06 全部验收条款。
  - 验证 metadata、canonical、结构化数据、robots 和 sitemap。
  - 测量各失效事件至首页、列表、详情、楼盘、内容引用和 sitemap 撤销的时间。
  - _Requirement: R8–R10_
  - 验证证据：
    - 验收测试：[fp-06-content-seo-cache-acceptance.test.ts](file:///e:/github/sbh/payload-office-platform/tests/fp-06-content-seo-cache-acceptance.test.ts)（15 用例）
      - `buildPageMetadata` 输出 canonical / OG / robots 完整字段；文章型内容用 `ogType=article`；noindex 策略输出 `index=false,follow=true`；OG image 附加到 `openGraph.images`；不设置 keywords（Google 已不使用）。
      - `buildNotFoundMetadata` 默认标题「页面未找到」；noindex,follow 阻止搜索引擎索引 404 / 草稿页；不输出 canonical。
      - 缓存失效覆盖：所有 `CACHE_INVALIDATOR_EVENT_TYPES` 都能计算 tag；listing.* 失效 listing + 类别 + home + facets + sitemap；report.supply_paused 同样失效 listing + 类别 + sitemap；缺 city 时执行全城市安全失效；含 buildingId 时失效 building + 类别。
      - sitemap tag 永远在失效集合中（任何供给变化都影响 sitemap）。
      - 失效撤销时间窗口：`computeAffectedTags` 是同步纯函数，事件触发后立即计算 tag 集合并调用 `revalidateTag`，撤销时间远小于 60s 待办闭环 SLA。
    - 路由层：
      - [robots.ts](file:///e:/github/sbh/payload-office-platform/src/app/robots.ts)：disallow `/api/` 与 `/dev-story`，sitemap 指向 `/sitemap.xml`。
      - [sitemap.ts](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/sitemap.ts)：通过 Facade 查询 listings/buildings/pages，站点 URL 来自 `siteConfig.siteOrigin` 不硬编码。
      - [layout.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/layout.tsx)：metadataBase 由 `siteConfig.siteUrl` 设置，所有页面 canonical/OG 基于此解析。
    - 各页面 metadata 一致性：
      - [page.tsx (首页)](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/page.tsx) / [listings/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/page.tsx) / [pages/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/pages/[slug]/page.tsx)：使用 `buildPageMetadata` 统一构造。
      - [listings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx) / [buildings/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx)：手写 metadata 但同样输出 canonical / OG / robots，房源/楼盘未找到时 noindex,follow=false。
      - 内容页 [pages/[slug]/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/pages/[slug]/page.tsx)：草稿/删除/不存在返回 `buildNotFoundMetadata` 走 noindex；JSON-LD `Article` 仅声明 `headline / url / description / image`，不伪造 `author / datePublished / dateModified`。
    - 验收：`pnpm typecheck` 通过；`pnpm test` 86 文件 1691 用例全通过；`pnpm build` 成功
