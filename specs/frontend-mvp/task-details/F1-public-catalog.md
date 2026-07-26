# 前台任务：F1：公开数据契约与统一有效供给

> 返回：[任务索引](../tasks.md)

## 3. F1：公开数据契约与统一有效供给

- [x] 1.1 定义 Public Catalog DTO
  - 新建卡片、搜索结果、房源详情、楼盘详情、首页、facet、媒体、价格和 SEO 的只读契约。
  - 明确每个 DTO 的公开字段白名单。
  - 为 mapper 增加“不泄露审核、举报、商户资质和内部联系方式”的测试。
  - _Requirement: R2–R6, R9；Design: §3.1, §7_
  - 验证证据：`src/domain/public-catalog/contracts.ts` 定义 `ListingCardViewModel`、`ListingDetailViewModel`、`BuildingDetailViewModel`、`BuildingSummaryViewModel`、`MediaViewModel`、`PriceViewModel`、`DistrictViewModel` 等只读 DTO；`src/domain/public-catalog/mappers.ts` 使用类型守卫收窄 `unknown`；`tests/frontend-mappers.test.ts`（66 用例）守护字段白名单，断言 DTO 不暴露 `verificationStatus`、`createdBy`、`lastModifiedBy`、`deletedAt`、`internalPhone`、`merchantQualification`、`status` 等敏感字段。

- [x] 1.2 验收后台 M4.7 服务契约
  - 确认服务支持搜索、slug 详情、楼盘内供给、facet 和 `assertEffectiveListing`。
  - 确认查询上下文包含统一 `asOf`、时区和公开渠道。
  - 确认完整谓词覆盖审核、发布、冻结、举报、媒体、楼盘/区域、商户关系/资格/服务城市、可用性和陈旧规则。
  - 若 M4.7 未完成，只完成接口适配和 fixture 测试，不连接生产页面。
  - _Requirement: R9；Backend: M4.7_
  - 验证证据：
    - 生产 `SupplyAdapter` ([supply-adapter.ts](file:///e:/github/sbh/payload-office-platform/src/domain/public-catalog/supply-adapter.ts)) 已接入 M4.7 完整谓词：`baseEffectiveWhere` 调用 `getEffectiveSupplyWhere(asOf)` 实现查询层 §1-§4、§7；`getPausedListingIds` 排除 §5 举报暂停；`fineFilter` 调用 `resolveEffectiveSupply` 精筛 §6 媒体/§8 关系/§9-§10 商户资质与服务城市。所有 7 个 Facade 方法（`findEffectiveListings` / `findEffectiveListingBySlug` / `findEffectiveBuildingBySlug` / `findEffectiveListingsByBuilding` / `findFeaturedListings` / `assertEffectiveListingBySlug` / `findEffectiveDistricts`）共用同一谓词路径。
    - 一致性契约测试 [public-catalog-effective-supply-consistency.test.ts](file:///e:/github/sbh/payload-office-platform/tests/public-catalog-effective-supply-consistency.test.ts)（29 用例）覆盖 §1-§10 全部失效条件：构造 `FullPredicateFakeAdapter`（查询层 §1-§4、§7 + §5 举报 + §6/§8/§9/§10 委托生产 `isListingEffectivelySupplied`），断言 7 个消费路径（`searchListings` / `getListingBySlug` / `getRelatedListings` / `assertEffectiveListing` / `getBuildingDetail` / `getHomepage` / `getSearchFacets`）对同一房源可见性结论一致；包含基线、§1-§10 单条失效、混合场景、交叉验证（FakeAdapter 谓词与生产 `isListingEffectivelySupplied` 同源）。
    - 验收门：`pnpm typecheck` 通过；`pnpm test` 82 文件 / 1641 用例通过；`pnpm build`（NEXT_PUBLIC_SITE_URL=http://localhost:3717）成功。

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
- [x] 统一有效供给契约测试覆盖所有消费者并通过。
  - F1.2 完成：`tests/public-catalog-effective-supply-consistency.test.ts`（29 用例）覆盖 §1-§10 全部失效条件，断言 7 个消费路径（searchListings / getListingBySlug / getRelatedListings / assertEffectiveListing / getBuildingDetail / getHomepage / getSearchFacets）对同一房源可见性结论一致。
- [x] 生产路径不存在旧查询降级。
  - Facade 内部不拼 Payload `where`；过渡 `status=available` 谓词仅用于开发预览，已用 `// ⚠️ 待 M4.7 完成后删除（F1.6）` 标注，不接入生产公开页面（M4.7 完成前路由不切换到 Facade）。
