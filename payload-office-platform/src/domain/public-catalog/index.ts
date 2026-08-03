/**
 * 领域：公开目录门面（domain/public-catalog）
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7、§8、§11
 *           FRONTEND_AGENT.md §6.1、§6.2、§6.3
 *
 * 职责边界：
 *   - 定义公开 DTO 与 mapper，把 Payload 文档投影成只读视图模型
 *   - 提供 Facade 函数（搜索、详情、楼盘、首页、facet、相关推荐、内容页）与 SupplyAdapter 契约
 *   - 字段白名单：不向浏览器暴露审核、举报、商户资质、内部电话、权限、审计
 *   - SupplyAdapter 消费统一有效供给谓词 + 精筛（M4.7 已就绪）；DTO 与 Facade 不变
 *
 * 不变量（FRONTEND_AGENT.md §6.1、§6.2）：
 *   - 路由层与组件只调用 Facade，不拼 Payload where
 *   - 页面和组件只消费这里的 DTO，不接收原始 Payload 文档
 *   - mapper 使用明确字段白名单
 *   - 媒体、价格、面积、时间和 SEO 使用统一值对象
 *
 * F1.3-F1.5 进度：
 *   - contracts/mappers 已完成（F0）
 *   - types/search-params/stable-sort 已完成（F1.3+F1.4）
 *   - facade.ts 与 supply-adapter.ts 已完成（M4.7：生产实现消费有效供给谓词 + 精筛）
 *   - F1.5 契约测试覆盖 Facade 与稳定排序（详见 tests/public-catalog-*.test.ts）
 *   - F1.6 已完成：删除过渡适配器与旧 status=available 内联谓词
 *
 * F6.1-F6.4 进度：
 *   - contracts/mappers 新增 PageDetailViewModel / PageSummaryViewModel（F6.1）
 *   - facade 新增 getPageBySlug / listPublishedPages（F6.1 + F6.4）
 *   - supply-adapter 新增 findPublishedPageBySlug / findPublishedPages（F6.1 + F6.4）
 */

export * from './contracts'
export {
  buildBuildingSupplySnapshot,
  emptyBuildingSupplySnapshot,
} from './building-supply'
export type { BuildingSupplyInput } from './building-supply'
export * from './mappers'
export * from './types'
export {
  parseListingSearchInput,
  parseBuildingSupplySearchParams,
  buildCanonicalSearchParams,
  legacyRentUnitToPriceKey,
} from './search-params'
export { normalizePublicMediaUrl } from './media-url'
export {
  stableSortCards,
  priceKeyOf,
  isSameRentUnit,
  filterByRentUnit,
  filterByPriceKey,
  paginate,
} from './stable-sort'
export {
  computeUsableArea,
  deriveSeatRange,
  convertPrice,
} from './detail-values'
export type { EstimatedNumber } from './detail-values'
export type {
  SupplyAdapter,
  SupplyAdapterFactory,
  AdapterCallContext,
} from './supply-adapter'
export {
  createPayloadSupplyAdapter,
  getDefaultSupplyAdapter,
  setDefaultSupplyAdapterFactory,
  __resetDefaultSupplyAdapterForTest,
} from './supply-adapter'
export {
  // 类型
  type ListingSearchResult,
  type HomepageData,
  type SearchFacets,
  type BuildingDetailResult,
  type BuildingDetailPageResult,
  type BuildingSearchResult,
  // 函数
  parseSearchInput,
  buildCanonical,
  searchListings,
  searchBuildings,
  getListingBySlug,
  getBuildingBySlug,
  getBuildingDetail,
  getRelatedBuildings,
  getListingsByBuilding,
  getRelatedListings,
  getDetailRecommendations,
  type DetailRecommendationItem,
  assertEffectiveListing,
  assertEffectiveBuilding,
  getHomepage,
  getSearchFacets,
  getPageBySlug,
  listPublishedPages,
  getArticleBySlug,
  listPublishedArticles,
} from './facade'

// F6.5 缓存 tag 体系与领域事件失效
export {
  PUBLIC_CACHE_TAG_PREFIX,
  SITEMAP_TAG,
  ALL_PUBLIC_CACHE_TAG_GROUPS,
  homeTag,
  listingTag,
  buildingTag,
  listingsTag,
  facetsTag,
  pageTag,
  cityLevelSafeInvalidationTags,
  isPublicCacheTag,
} from './cache-tags'
export {
  type TagInvalidator,
  computeAffectedTags,
  createCacheInvalidatorConsumer,
  createNextTagInvalidator,
  registerCacheInvalidatorConsumers,
  CACHE_INVALIDATOR_EVENT_TYPES,
} from './cache-invalidator'
