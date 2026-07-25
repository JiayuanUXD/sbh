/**
 * 领域：公开目录门面（domain/public-catalog）
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7、§8、§11
 *           FRONTEND_AGENT.md §6.1、§6.2、§6.3
 *
 * 职责边界：
 *   - 定义公开 DTO 与 mapper，把 Payload 文档投影成只读视图模型
 *   - 提供 Facade 函数（搜索、详情、楼盘、首页、facet、相关推荐）与 SupplyAdapter 契约
 *   - 字段白名单：不向浏览器暴露审核、举报、商户资质、内部电话、权限、审计
 *   - 当前过渡实现直接消费 Payload 文档；M4.7 服务就绪后替换 SupplyAdapter 内部，DTO 与 Facade 不变
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
 *   - facade.ts 与 supply-adapter.ts 已完成（F1.3：骨架；过渡实现待 M4.7 替换）
 *   - F1.5 契约测试覆盖 Facade 与稳定排序（详见 tests/public-catalog-*.test.ts）
 *   - F1.6 删除旧 status=available 查询需等 M4.7 完成后才能执行
 */

export * from './contracts'
export * from './mappers'
export * from './types'
export {
  parseListingSearchInput,
  buildCanonicalSearchParams,
} from './search-params'
export {
  stableSortCards,
  isSameRentUnit,
  filterByRentUnit,
  paginate,
} from './stable-sort'
export type {
  SupplyAdapter,
  SupplyAdapterFactory,
  AdapterCallContext,
} from './supply-adapter'
export {
  createTransitionalPayloadAdapter,
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
  // 函数
  parseSearchInput,
  buildCanonical,
  searchListings,
  getListingBySlug,
  getBuildingBySlug,
  getBuildingDetail,
  getListingsByBuilding,
  getRelatedListings,
  assertEffectiveListing,
  getHomepage,
  getSearchFacets,
} from './facade'
