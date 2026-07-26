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

- [ ] 6.5 实现缓存 tag 与领域事件失效
  - 落地 home、listing、building、facet、page 和 sitemap tag。
  - 接入发布、审核、冻结、举报、媒体、位置、商户关系/资格/服务城市和可用性事件。
  - 无法安全计算局部影响时执行城市级安全失效。
  - _Requirement: R9, R10；Design: §9_

- [ ] 6.6 验收内容、SEO 与缓存
  - 执行 FP-06 全部验收条款。
  - 验证 metadata、canonical、结构化数据、robots 和 sitemap。
  - 测量各失效事件至首页、列表、详情、楼盘、内容引用和 sitemap 撤销的时间。
  - _Requirement: R8–R10_
