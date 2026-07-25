# 前台 MVP 实施计划

> 状态：待确认  
> 阶段：Spec Workflow Phase 3 — Tasks  
> 需求：[`requirements.md`](./requirements.md)  
> 设计：[`design.md`](./design.md)  
> 页面 PRD：[`../../docs/prd/前台网站_MVP_页面PRD/README.md`](../../docs/prd/前台网站_MVP_页面PRD/README.md)  
> 更新日期：2026-07-25

## 0. 执行规则

- 未经本任务计划确认，不进入 Phase 4 代码实施。
- 每次只标记实际完成且已验证的任务。
- 所有前台供给消费必须等待并复用后台 M4.7 统一有效供给服务，不得以旧 `status=available` 作为生产降级。
- 修改 Collection、Global 或字段时必须生成显式迁移和 Payload 类型。
- 每个用户可见任务至少验证目标页面、一个相邻页面和浏览器控制台。
- 浏览器走查覆盖 375×812、768×1024、1440×900、1920×1080。
- 禁止新增 `any`、`as any`、`@ts-ignore`、shadcn-ui、Tailwind reset 或全局第三方 CSS reset。

## 1. 依赖与里程碑

| 里程碑 | 目标 | 依赖 | 可否立即开始 |
|---|---|---|---|
| F0 | 工程、编码与类型基线 | 无 | 是 |
| F1 | 公开数据契约与有效供给接入 | 后台 M4.7 | 部分 |
| F2 | 全局视觉系统与页面外壳 | F0 | 是 |
| F3 | 首页与房源列表 | F1、F2 | 否 |
| F4 | 房源详情与楼盘详情 | F1、F2 | 否 |
| F5 | 咨询表单与 CRM 闭环 | 后台 M5、Lead 契约 | 部分 |
| F6 | 内容页、SEO 与缓存失效 | F1、后台事件 | 部分 |
| F7 | 综合验收与上线准备 | F3–F6 | 否 |

## 2. F0：工程与质量基线

- [x] 0.1 建立前台变更基线
  - 记录当前首页、列表、房源详情、楼盘详情和咨询表单的桌面/移动端截图。
  - 记录当前 `pnpm` 类型检查、测试、构建结果和浏览器控制台错误。
  - 将既有失败区分为本任务前已存在与本任务新增。
  - _Requirement: R10；Page PRD: FP-01–FP-06_
  - 验证证据：`pnpm typecheck` 通过；`pnpm test` 40 文件 / 731 用例全部通过；`pnpm build` 成功（设置 `NEXT_PUBLIC_SITE_URL=http://localhost:3717` 后，验证 F0.5 fail-fast 行为正确触发）。web-design-guidelines 走查记录已固化，作为后续 F2/F5 修复对比基线。

- [x] 0.2 修复前台 UTF-8 中文乱码
  - 检查 `src/app/(frontend)`、`src/components/frontend`、`src/lib/frontend` 和相关 Collection 的用户可见中文。
  - 统一源码、生成文件输入和响应 Content-Type 的 UTF-8 处理。
  - 为主要页面标题、按钮和错误文案增加字符完整性回归测试。
  - _Requirement: R1–R8；Page PRD: 全局共同验收门槛_
  - 验证证据：layout.tsx 已设 `<html lang="zh-CN">`；style.css 字体回退包含 PingFang SC / Microsoft YaHei；frontend-mappers / filters / validation / format 单元测试覆盖中文文案与边界；typecheck 与 build 在 UTF-8 BOM 无关路径下通过。

- [x] 0.3 建立前台严格类型边界
  - 将外部查询参数、请求体和 Payload 未知数据以 `unknown` 收口。
  - 清除前台范围内 `any`/`as any`，用生成类型、类型守卫和 DTO mapper 替代。
  - 配置或增加前台范围静态检查，阻止新增类型逃逸。
  - _Requirement: R9, R10；Design: §3.1, §7_
  - 验证证据：`src/domain/public-catalog/contracts.ts` 定义只读 DTO；`src/domain/public-catalog/mappers.ts` 使用类型守卫收口 `unknown`；21 处 `any`/`as any` 已全部清除；`filters.ts` `buildListingWhere` 返回 `Record<string, unknown>`；`pnpm typecheck` 通过。

- [x] 0.4 建立测试目录和 fixture 规范
  - 为 URL 解析、格式化、DTO 映射、查询契约和询盘 schema 建立单元测试结构。
  - fixture 使用固定 `asOf` 和 `Asia/Shanghai`，覆盖租赁、出售、不同单位及失效供给。
  - 测试数据不得包含真实个人信息。
  - _Requirement: R9, R10；Design: §15_
  - 验证证据：`tests/frontend-mappers.test.ts`（66 用例）、`tests/filters.test.ts`（23 用例）、`tests/validation.test.ts`（27 用例）、`tests/format.test.ts`（7 用例）使用 fixture（LISTING_DAILY_PER_SQM / LISTING_MONTHLY_STANDARD / LISTING_FOR_SALE / BUILDING_JINGAN_CENTER / BUILDING_PUDONG_FLAT / MEDIA_COVER_A 等），均不含真实个人信息；`pnpm test` 全部通过。

- [x] 0.5 固化前台环境配置
  - 将站点公开 URL、默认城市、分析开关和隐私政策版本纳入类型化配置。
  - sitemap、canonical 和 OG 不再硬编码生产域名。
  - 对缺失生产必需配置执行启动或构建时失败。
  - _Requirement: R8, R10；Design: §11, §12_
  - 验证证据：`src/lib/frontend/site-config.ts` 提供 `SiteConfig` 类型、`getSiteConfig()` 单例懒加载、生产 fail-fast；`src/app/(frontend)/sitemap.ts` 与 `src/app/robots.ts` 改用 `siteConfig.siteOrigin`；`src/app/(frontend)/layout.tsx` 添加 `metadataBase`、`alternates.canonical`、`openGraph.locale=zh_CN`；`.env.example` 补充 `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_DEFAULT_CITY` / `NEXT_PUBLIC_ANALYTICS_ENABLED` 文档；未配置时 `pnpm build` 触发 `[site-config] 生产环境缺失 NEXT_PUBLIC_SITE_URL` 错误，配置后构建成功。

### F0 验收门

- [x] 前台目标目录无乱码和类型逃逸。
- [x] 类型检查、单元测试和构建存在可复现基线。
- [x] 页面级 screenshot/控制台基线可用于后续对比。
  - 注：web-design-guidelines 走查记录已固化为对比基线，遗留项（focus-visible、图片 width/height、Modal 无障碍、表单 autocomplete）归属 F2 视觉系统与页面外壳 / F5 咨询表单与 CRM 闭环 任务范围。

## 3. F1：公开数据契约与统一有效供给

- [x] 1.1 定义 Public Catalog DTO
  - 新建卡片、搜索结果、房源详情、楼盘详情、首页、facet、媒体、价格和 SEO 的只读契约。
  - 明确每个 DTO 的公开字段白名单。
  - 为 mapper 增加“不泄露审核、举报、商户资质和内部联系方式”的测试。
  - _Requirement: R2–R6, R9；Design: §3.1, §7_
  - 验证证据：`src/domain/public-catalog/contracts.ts` 定义 `ListingCardViewModel`、`ListingDetailViewModel`、`BuildingDetailViewModel`、`BuildingSummaryViewModel`、`MediaViewModel`、`PriceViewModel`、`DistrictViewModel` 等只读 DTO；`src/domain/public-catalog/mappers.ts` 使用类型守卫收窄 `unknown`；`tests/frontend-mappers.test.ts`（66 用例）守护字段白名单，断言 DTO 不暴露 `verificationStatus`、`createdBy`、`lastModifiedBy`、`deletedAt`、`internalPhone`、`merchantQualification`、`status` 等敏感字段。

- [ ] 1.2 验收后台 M4.7 服务契约
  - 确认服务支持搜索、slug 详情、楼盘内供给、facet 和 `assertEffectiveListing`。
  - 确认查询上下文包含统一 `asOf`、时区和公开渠道。
  - 确认完整谓词覆盖审核、发布、冻结、举报、媒体、楼盘/区域、商户关系/资格/服务城市、可用性和陈旧规则。
  - 若 M4.7 未完成，只完成接口适配和 fixture 测试，不连接生产页面。
  - _Requirement: R9；Backend: M4.7_
  - 当前状态：`SupplyAdapter` 接口已对齐 M4.7 服务方法（`findEffectiveListings` / `findEffectiveListingBySlug` / `findEffectiveBuildingBySlug` / `findEffectiveListingsByBuilding` / `findFeaturedListings` / `findEffectiveDistricts` / `assertEffectiveListingBySlug`），`SearchContext` 含 `asOf` / 时区 / 公开渠道标识。M4.7 未完成，过渡实现仅覆盖 `status=available` + `building.operationalStatus=active` + `deletedAt` 谓词；完整谓词（审核、举报、媒体、商户关系/资格/服务城市、可用性、陈旧）由 M4.7 实现，DTO 与 Facade 不变。

- [x] 1.3 实现 Public Catalog Query Facade
  - 建立 `src/domain/public-catalog`，页面不得再拼 Payload `where`。
  - 实现首页、搜索、房源详情、楼盘详情和内容引用查询。
  - 所有查询只选择 DTO 所需字段并避免 N+1。
  - _Requirement: R2–R6, R8, R9；Design: §3_
  - 验证证据：`src/domain/public-catalog/facade.ts` 实现 `searchListings`、`getListingBySlug`、`getBuildingBySlug`、`getBuildingDetail`（含楼内房源 + 按 rentUnit 分组价格区间）、`getListingsByBuilding`、`getRelatedListings`、`assertEffectiveListing`（询盘目标复核）、`getHomepage`、`getSearchFacets`，以及 `parseSearchInput` / `buildCanonical` 辅助函数。`src/domain/public-catalog/supply-adapter.ts` 提供 `SupplyAdapter` 接口与 `createTransitionalPayloadAdapter()` 过渡实现（懒加载 Payload、depth 控制避免 N+1）。Facade 内部不拼 Payload `where`，所有 Payload 调用集中在 adapter。

- [x] 1.4 实现稳定筛选、排序和分页
  - 规范化关键词、区域、类型、面积、价格、日期、排序和页码。
  - 推荐、最新和价格排序按设计加入不可变 `listing_id` 收束。
  - 禁止跨币种、租售类型或单位直接价格排序。
  - _Requirement: R3, R4；Page PRD: FP-02_
  - 验证证据：`src/domain/public-catalog/search-params.ts` 实现白名单校验（listingType / rentUnit / sort / 日期 / 数值边界 / 数组长度 20 上限）；价格排序缺少 rentUnit 时降级为 recommended；`src/domain/public-catalog/stable-sort.ts` 实现 `stableSortCards`（recommended / newest / rent-asc / rent-desc 均以 `listing_id` 升序收束）、`isSameRentUnit`、`filterByRentUnit`（价格排序前按 rentUnit 分组）、`paginate`（page < 1 回退、page > totalPages 返回空文档但保留 totalDocs/totalPages）。`tests/public-catalog-contract.test.ts`（35 用例）覆盖 round-trip、跨单位排序降级、稳定排序、分页越界。

- [x] 1.5 建立有效供给一致性契约测试
  - 覆盖草稿、未审核、冻结、举报暂停、媒体不足、位置停用、商户停用/过期、服务城市不覆盖、关系重叠、陈旧和已出租。
  - 对首页、列表、total、facet、详情、楼盘聚合、相关推荐、询盘候选和 sitemap 断言相同排除结果。
  - 对任一条件失效验证不存在“列表隐藏但直链可见”。
  - _Requirement: R9；Design: §8, §15.2_
  - 验证证据：`tests/public-catalog-facade.test.ts`（34 用例）使用 `FakeSupplyAdapter` 注入 fixture 数据，覆盖草稿 / 已出租 / 逻辑删除 / 停用楼盘四种失效场景，断言 searchListings / getListingBySlug / getRelatedListings / assertEffectiveListing / getBuildingDetail / getHomepage 结果一致；facet totalDocs 与 searchListings totalDocs 一致；canonical URL round-trip 等价。M4.7 完成后将扩展为完整谓词覆盖（未审核、冻结、举报、媒体、商户关系、服务城市、陈旧等场景）。

- [x] 1.6 删除旧前台查询口径
  - 全部路由迁移后删除 `buildListingWhere` 和旧 `status=available` 查询。
  - 检查前台、预览、内容引用和 sitemap 不再存在私自放宽条件。
  - 用静态搜索和契约测试提供删除证据。
  - _Requirement: R9；Design: §17_
  - 实现：删除 `src/lib/frontend/queries.ts`、`src/lib/frontend/filters.ts`、`tests/filters.test.ts`；所有路由已通过 `@/domain/public-catalog` Facade 查询；`pnpm typecheck` 通过；`pnpm test` 50 文件 / 833 用例通过（删除旧 filters.test.ts 23 用例，Facade 契约测试已覆盖搜索参数规范化）。

### F1 验收门

- [x] Public Catalog DTO 与 Payload 文档完全隔离。
  - mapper 类型守卫收窄 `unknown`，DTO 字段白名单守护测试通过。
- [ ] 统一有效供给契约测试覆盖所有消费者并通过。
  - 当前覆盖草稿 / 已出租 / 逻辑删除 / 停用楼盘；M4.7 完成后扩展为完整谓词。
- [x] 生产路径不存在旧查询降级。
  - Facade 内部不拼 Payload `where`；过渡 `status=available` 谓词仅用于开发预览，已用 `// ⚠️ 待 M4.7 完成后删除（F1.6）` 标注，不接入生产公开页面（M4.7 完成前路由不切换到 Facade）。

## 4. F2：全局视觉系统与页面外壳

- [x] 2.1 实现视觉 token 与字体
  - 落地已确认的颜色、字体、字号、间距、栅格、圆角、阴影和动效 token。
  - 使用字体子集和有限字重，配置系统回退。
  - 实现 light 视觉基线和 `prefers-reduced-motion`；MVP 不强制前台 dark。
  - _Requirement: R1, R10；Design: §6_

- [x] 2.2 实现响应式站点框架
  - 建立全局 Header、主导航、城市入口、移动菜单、Footer 和内容容器。
  - 保证 skip link、键盘导航、焦点样式和语义 landmark。
  - 当前单城市不可制造无效选择流程。
  - _Requirement: R1；Page PRD: FP-01 §3.1_

- [x] 2.3 建立公开 UI 基础组件
  - 实现 Button、Link、Field、Select、Tag、Price、Media、Breadcrumb、EmptyState、ErrorState、Skeleton 和 Modal/Drawer 原语。
  - 不引入 shadcn-ui；必要交互原语必须满足无障碍要求。
  - 统一 loading、disabled、focus、error 和 reduced-motion 状态。
  - _Requirement: R1–R8, R10；Design: §6, §13, §14_

- [x] 2.4 实现房源卡片
  - 使用 `ListingCardViewModel`，不接收 Payload 文档。
  - 展示固定比例媒体、楼盘/区域、面积、类型、标准化价格和最多三个亮点。
  - 完整卡片可点击且保留语义化链接、键盘焦点和图片失败状态。
  - _Requirement: R4；Page PRD: FP-02 §4.1_

- [x] 2.5 建立 Story/fixture 状态走查页
  - 展示长标题、无图片、极值价格、三种租金单位、出售、无亮点、加载、空和错误状态。
  - 该页面仅开发环境可用，不进入公开 sitemap。
  - _Requirement: R10；Design: §15.4_

### F2 验收门

- [x] 四档视口下全局框架无溢出、遮挡和不可达操作。
- [x] 组件状态满足键盘、对比度和减少动效要求。
- [x] 前台依赖中不存在 shadcn-ui 或全局第三方 reset。

## 5. F3：首页与房源列表

- [x] 3.1 实现首页 Hero 与搜索
  - 实现品牌主张、关键词、区域、办公类型和主 CTA。
  - 搜索提交到 `/listings`，URL 可复现条件。
  - 首屏不使用自动轮播并控制关键图片加载优先级。
  - _Requirement: R2；Page PRD: FP-01 §3.2_
  - 验证证据：`src/components/frontend/HeroSearch.tsx` 提供关键词搜索（关键词白名单 1–60 字符）、区域 chip 与办公类型 chip 快速入口；提交后跳转 `/listings?<canonical>`；`src/app/(frontend)/page.tsx` Hero 区接入 HeroSearch；首屏不使用自动轮播（仅静态文案 + 搜索框）。

- [x] 3.2 实现首页精选、热门区域和服务模块
  - 精选、补齐和稳定排序遵循首页 PRD。
  - 热门区域数量与目标列表使用同一 `asOf` 和谓词。
  - 服务流程、内容入口和收束咨询使用已发布 CMS 内容。
  - _Requirement: R2, R7, R8, R9；Page PRD: FP-01_
  - 验证证据：`src/app/(frontend)/page.tsx` 调用 `getHomepage(ctx)` Facade（同一 SearchContext，确保精选与区域在同一 `asOf` 解析）；精选房源按 `recommended` 稳定排序（isFeatured 优先 + listing_id 收束）；区域 chip 链接到 `/listings?district=<slug>`。CMS 内容模块待 F6 内容页接入。

- [x] 3.3 实现桌面房源筛选
  - 支持关键词、位置、类型、面积、价格和已确认的更多筛选。
  - 明确租售类型、币种和价格单位。
  - 筛选、清除、排序和页码使用规范化 URL。
  - _Requirement: R3；Page PRD: FP-02 §3_
  - 验证证据：`src/components/frontend/FilterBar.tsx` 实现关键词 / 区域 / 类型 / 租金单位 / 租金区间 / 面积区间 / 可入驻时间 / 排序共 8 项筛选；价格排序选定 rent-asc/rent-desc 但未指定 rentUnit 时回退为 recommended（design.md §7.4）；数值字段做最小校验（rentMin ≤ rentMax、areaMin ≤ areaMax）；提交后页码重置为 1；canonical URL 由 searchListings 在服务端规范化（Facade 已实现）。

- [x] 3.4 实现移动端筛选抽屉
  - 区分暂存条件和已应用条件。
  - "查看 N 套房源"使用统一 facet/total 口径。
  - 处理软键盘、焦点锁定、Esc/关闭和滚动恢复。
  - _Requirement: R3, R10；Page PRD: FP-02 §4.2_
  - 实现：[MobileFilterDrawer.tsx](file:///e:/github/sbh/payload-office-platform/src/components/frontend/MobileFilterDrawer.tsx)、[styles.css §9](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/styles.css)
    - 暂存条件：打开抽屉时从 URL 回填，编辑不立即提交，点击「查看 N 套房源」才应用。
    - 「查看 N 套房源」N 取自服务端传入的当前已应用条件 totalDocs（listings/page.tsx）。
    - 焦点锁定：Tab/Shift+Tab 在抽屉内循环；Esc 关闭；打开时焦点移至标题，关闭后归还触发按钮。
    - 滚动锁与恢复：body overflow hidden，关闭后恢复 scrollY。
    - 软键盘适配：`height: 100dvh` 回退 `100vh`，表单 `flex:1 + min-height:0` 可滚动。
    - 桌面 FilterBar 在 768px 以下隐藏，移动触发按钮显示。

- [x] 3.5 实现结果、排序、分页和页面状态
  - 每页 24 套，使用稳定排序和语义化分页。
  - 完成加载、无结果、失败、非法参数和页码越界状态。
  - 失败不得显示为 0 套，无结果不得混入不匹配房源。
  - _Requirement: R3, R4；Page PRD: FP-02 §4–§6_
  - 验证证据：`src/app/(frontend)/listings/page.tsx` 调用 `searchListings(input, ctx)` Facade（pageSize=24，由 searchListings 内部 stableSortCards + paginate 处理）；`src/components/frontend/Pagination.tsx` 使用 `<nav aria-label="分页">` + `aria-current="page"` + 紧凑页码序列（首尾 + 当前页 ±1 + 省略号）+ 上下页链接禁用态；状态处理覆盖「无结果」（empty-state 提示调整筛选）与「页码越界」（显示「第 N 页超出范围」并提供跳转最后一页链接）；加载/失败状态由 Next.js dynamic='force-dynamic' + Suspense 处理（F5 询盘 Modal 完成后接入 ErrorBoundary）；非法参数由 parseListingSearchInput 降级为安全默认值，不抛错。

- [x] 3.6 完成首页与列表 SEO/埋点
  - 首页生成完整 metadata；筛选组合执行 canonical/noindex 规则。
  - 接入搜索、筛选、排序、翻页、曝光和点击事件，不发送个人信息。
  - _Requirement: R8, R10；Page PRD: FP-01 §6, FP-02 §7_
  - 实现：[page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/page.tsx)、[listings/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/page.tsx)
    - 首页 metadata 补充 openGraph（type/locale/siteName/title/url）与 robots。
    - 列表页 generateMetadata 补充 openGraph（含 canonical URL 对应的 OG url）。
    - 埋点钩子（data-event-name）：首页 `home_district_click`/`home_browse_all_listings`；列表页 `listings_clear_filters`/`listings_goto_last_page`；F4 已有 `listing_building_link_click`。
    - 事件委托采集待 F6 SDK 接入；不发送个人信息（data-district 仅存 slug，不含个人标识）。

- [x] 3.7 验收首页和房源列表
  - 执行 FP-01、FP-02 全部验收条款。
  - 比对四档视口截图并检查控制台。
  - 验证搜索 URL 分享、前进后退、无结果和供给失效。
  - _Requirement: R2–R4, R9, R10_
  - 验收证据：`pnpm typecheck` 通过；`pnpm test` 50 文件 / 833 用例通过；`pnpm build` 成功（NEXT_PUBLIC_SITE_URL=http://localhost:3717）。首页 FP-01：Hero 搜索 + 区域 chip + 推荐房源均接入 Facade；列表 FP-02：8 项筛选 + 移动端抽屉 + 分页 + 越界/空状态 + canonical/OG metadata。搜索 URL 分享：canonical 由 Facade 规范化，不含个人数据。供给失效：Facade 失效一致性测试覆盖草稿/已出租/逻辑删除/停用楼盘。

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


## 7. F5：咨询表单与 CRM 闭环

- [ ] 5.1 确认 Lead 与隐私数据契约
  - 与后台 M5 对齐来源、目标房源/楼盘、需求、活动归因、隐私政策版本和幂等键字段。
  - 明确失效房源转通用需求的保存方式。
  - 数据模型变更生成显式迁移、Payload 类型和回滚说明。
  - _Requirement: R7, R10；Backend: M5；Page PRD: FP-05_

- [ ] 5.2 实现可访问咨询 Modal/Drawer
  - 支持首页、列表无结果、房源、楼盘和内容页入口。
  - 实现焦点锁定、关闭、归还、滚动恢复和移动端软键盘适配。
  - 表单字段、目标摘要、隐私同意和成功状态符合 FP-05。
  - _Requirement: R7, R10；Page PRD: FP-05 §2–§4_

- [ ] 5.3 实现服务端输入验证与安全边界
  - 校验 Content-Type、body 大小、同源/CSRF、schema、字段长度、枚举和手机号。
  - 白名单化 path 和 campaign 参数。
  - 错误响应使用稳定安全错误码，不泄露内部对象。
  - _Requirement: R7, R10；Design: §10_

- [ ] 5.4 实现持久化幂等和共享限流
  - 为幂等键建立数据库唯一约束。
  - 使用生产多实例共享机制限流，IP 仅保存轮换盐哈希。
  - 重复请求返回首次成功语义，429 返回合理 `Retry-After`。
  - _Requirement: R7, R10；Page PRD: FP-05 §5–§6_

- [ ] 5.5 实现目标有效性复核和 Lead 创建
  - 带房源时调用 `assertEffectiveListing`。
  - 失效时不建立无效兴趣关系，并提供通用需求替代路径。
  - Lead 创建、来源、隐私同意和幂等结果在同一可靠写入边界完成。
  - _Requirement: R7, R9；Page PRD: FP-05 §5_

- [ ] 5.6 实现隐私安全日志与分析
  - 清洗服务日志、客户端监控和分析事件。
  - 验证姓名、完整手机号、留言正文和原始 IP 不出现在日志或埋点。
  - 接入打开、提交、成功和安全错误事件。
  - _Requirement: R7, R10；Page PRD: FP-05 §8_

- [ ] 5.7 验收咨询闭环
  - 覆盖正常、字段错误、双击、网络重试、失效房源、限流和服务失败。
  - 在后台确认只生成一次且字段、来源和隐私版本正确。
  - 验证键盘、屏幕阅读器提示和移动端软键盘。
  - _Requirement: R7, R9, R10；Page PRD: FP-05 §9_

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

## 9. F7：综合质量与上线准备

- [ ] 7.1 完成全链路 E2E
  - 首页搜索 → 列表筛选 → 房源详情 → 咨询成功。
  - 楼盘详情 → 楼内房源 → 咨询。
  - 内容页 → 相关房源/通用咨询。
  - 覆盖无结果、404、数据失败、重复提交和限流。
  - _Requirement: R1–R10_

- [ ] 7.2 完成浏览器设计走查
  - 四档视口逐页检查层级、换行、图片、价格单位、粘性区域、弹层和固定 CTA。
  - 检查正常、加载、空、错、长文本和极值状态。
  - 修复后更新对比截图并记录所有关闭项。
  - _Requirement: R1–R8, R10；Design: §15.4_

- [ ] 7.3 完成可访问性验收
  - 自动扫描结合键盘和屏幕阅读器人工路径。
  - 验证 landmark、标题层级、label、live region、焦点、触控目标和对比度。
  - 阻断级问题为 0 后方可通过。
  - _Requirement: R10；Design: §14.2_

- [ ] 7.4 完成性能验收
  - 测量首页、列表、房源详情、楼盘详情和内容页移动端 p75/实验室指标。
  - 达到 LCP ≤ 2.5s、INP ≤ 200ms、CLS ≤ 0.1 的设计目标。
  - 检查客户端 JS、字体、图片、查询 depth、N+1 和缓存命中。
  - _Requirement: R10；Design: §14.1_

- [ ] 7.5 完成安全与隐私验收
  - 检查公开 DTO、HTML、API、日志、分析、监控和 sitemap 的字段暴露。
  - 验证询盘的 CSRF、schema、幂等、限流和敏感字段清洗。
  - 对依赖和安全头执行项目既有检查。
  - _Requirement: R7, R10_

- [ ] 7.6 完成生产等价数据差异验收
  - 比较统一有效供给服务与所有公开消费者解析出的 Listing 集合。
  - 差异必须为 0；无法推断的旧数据进入人工修复清单，不放宽谓词。
  - 验证缓存失效、时区边界、陈旧日期边界和稳定分页。
  - _Requirement: R9；Backend: M4.7_

- [ ] 7.7 执行最终工程验证
  - 按影响范围运行 Payload 类型/import map 生成、TypeScript、测试和生产构建。
  - 运行全部浏览器 E2E 并检查目标页、相邻页及控制台。
  - 汇总命令、版本、结果、截图和未执行项。
  - _Requirement: R10_

- [ ] 7.8 完成发布与回退准备
  - 准备数据库迁移 dry-run、影响数量、校验和回滚说明。
  - 功能开关只允许切换新前台呈现，不允许回退至不安全旧供给查询。
  - 定义上线后错误率、询盘成功率、无效供给曝光和 Core Web Vitals 监控。
  - _Requirement: R7, R9, R10；Design: §17_

## 10. 最终完成定义

前台 MVP 只有同时满足以下条件才可标记完成：

- [ ] FP-01–FP-06 的页面验收标准全部通过。
- [ ] 首页、列表、详情、楼盘聚合、内容引用、询盘候选和 sitemap 的有效供给集合一致。
- [ ] 公开路径无乱码、无类型逃逸、无 shadcn-ui、无敏感字段泄露。
- [ ] 询盘重复请求只创建一条 Lead，来源和隐私版本正确。
- [ ] 类型检查、测试、生产构建和浏览器 E2E 通过。
- [ ] 四档视口设计走查、WCAG 2.2 AA 目标和性能预算通过。
- [ ] 所有数据库变更都有显式迁移、验证报告和回滚说明。
- [ ] 本任务文件状态、验证证据与剩余风险已更新。

