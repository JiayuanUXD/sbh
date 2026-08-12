/**
 * 前台缓存查询封装（design.md §9 / F6.5）
 *
 * 职责：
 *   - 用 Next.js `unstable_cache` 包装 Public Catalog Facade 调用
 *   - 为每个查询标记 cache tag，供领域事件失效（cache-invalidator.ts）
 *   - 仅在生产/预览运行时生效；测试中直接调用 Facade 原函数
 *
 * 设计取舍：
 *   - `unstable_cache` 的 `tags` 在闭包中静态，无法按参数动态生成
 *     （如 `public:listing:<id>`）。因此 cached function 用「类别级」tag
 *     （如 `public:listings`、`public:home:shanghai`），失效时同类别全量清空。
 *   - 这是 MVP 阶段的务实选择：失效粒度粗但保证正确性，避免陈旧数据。
 *   - 后续若启用 Cache Components，可改用 `cacheTag` 指令实现细粒度失效。
 *
 * 失效映射（cache-invalidator.ts computeAffectedTags）：
 *   - listing.* / report.supply_* → public:listing:<id> + public:home:<city> + public:facets:<city> + public:sitemap
 *   - 由于 cached function 标记的是类别级 tag，cache-invalidator 在失效时
 *     同时调用具体 tag 与类别级 tag（详见 cache-invalidator.ts 注释）
 *
 * 不变量：
 *   - cached function 不接收 SupplyAdapter 参数（统一用默认生产 adapter）
 *   - 测试中直接调用 Facade 原函数（注入 fake adapter），不经过缓存
 *   - 所有 cached function 的 cache key 自动包含参数（unstable_cache 行为）
 */

import { unstable_cache } from 'next/cache'

import {
  ARTICLES_CATEGORY_TAG as PUBLIC_ARTICLES_CATEGORY_TAG,
  createSearchContext,
  buildCanonicalSearchParams,
  buildListingSearchSource,
  getBuildingBySlug,
  getBuildingDetail,
  getArticleBySlug,
  getHomepage,
  getListingDistrictOptions,
  getListingBySlug,
  getPageBySlug,
  listPublishedArticles,
  getRelatedBuildings,
  getRelatedListings,
  getDetailRecommendations,
  getSearchFacets,
  listPublishedPages,
  paginateListingSearchSource,
  searchBuildings,
  type ListingSearchInput,
} from '@/domain/public-catalog'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  SITEMAP_TAG,
  facetsTag,
  homeTag,
} from '@/domain/public-catalog'

// ---------------------------------------------------------------------------
// 通用 tag 常量（类别级）
// ---------------------------------------------------------------------------

/**
 * 房源列表/详情类别 tag
 *
 * cached function 用此 tag；cache-invalidator 失效 listing:* 事件时
 * 调用 revalidateTag('public:listings')，清空所有房源相关缓存。
 */
const LISTINGS_CATEGORY_TAG = 'public:listings'

/** 楼盘类别 tag */
const BUILDINGS_CATEGORY_TAG = 'public:buildings'

/** 内容页类别 tag */
const PAGES_CATEGORY_TAG = 'public:pages'

/** 资讯类别 tag */
export const ARTICLES_CATEGORY_TAG = PUBLIC_ARTICLES_CATEGORY_TAG

// ---------------------------------------------------------------------------
// 默认搜索上下文
// ---------------------------------------------------------------------------

/**
 * MVP 单城市默认上下文
 *
 * 所有 cached function 共用同一 asOf（首次缓存时的时间戳）。
 * 失效后重新查询会获取新的 asOf。
 */
function defaultCtx() {
  return createSearchContext(siteConfig.defaultCity)
}

// ---------------------------------------------------------------------------
// Cached Facade Wrappers
// ---------------------------------------------------------------------------

/**
 * 首页数据（精选房源 + 热门区域）
 *
 * tags：home:shanghai + sitemap + listings 类别 + facets:shanghai
 * 失效触发：listing.* / report.supply_* / building.* 事件
 */
export const getCachedHomepage = unstable_cache(
  async () => {
    return getHomepage(defaultCtx())
  },
  ['homepage'],
  {
    tags: [
      homeTag('shanghai'),
      SITEMAP_TAG,
      LISTINGS_CATEGORY_TAG,
      facetsTag('shanghai'),
    ],
    revalidate: 300,
  },
)

/**
 * 房源详情（按 slug 缓存）
 *
 * tags：listings 类别 + home:shanghai + sitemap
 * 失效触发：listing.* / report.supply_* 事件
 */
export const getCachedListingBySlug = unstable_cache(
  async (slug: string) => {
    return getListingBySlug(slug, defaultCtx())
  },
  ['listing-by-slug'],
  {
    tags: [
      LISTINGS_CATEGORY_TAG,
      homeTag('shanghai'),
      SITEMAP_TAG,
    ],
  },
)

/**
 * 房源相关推荐（同楼盘其他房源）
 *
 * tags：listings 类别 + buildings 类别 + sitemap
 * 失效触发：listing.* / building.* 事件
 */
export const getCachedRelatedListings = unstable_cache(
  async (listingSlug: string, limit: number = 6) => {
    return getRelatedListings(listingSlug, defaultCtx(), { limit })
  },
  ['related-listings'],
  {
    tags: [
      LISTINGS_CATEGORY_TAG,
      BUILDINGS_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
  },
)

/**
 * 房源详情解释型相关推荐。
 *
 * tags：listings 类别 + buildings 类别 + sitemap；300 秒兜底重新验证
 */
export const getCachedDetailRecommendations = unstable_cache(
  async (listingSlug: string, limit: number = 6) => {
    return getDetailRecommendations(listingSlug, defaultCtx(), { limit })
  },
  ['detail-recommendations'],
  {
    tags: [
      LISTINGS_CATEGORY_TAG,
      BUILDINGS_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
    revalidate: 300,
  },
)

/**
 * 楼盘相关推荐。
 *
 * tags：buildings 类别 + listings 类别；300 秒兜底重新验证
 */
export const getCachedRelatedBuildings = unstable_cache(
  async (buildingSlug: string, limit: number = 6) => {
    return getRelatedBuildings(buildingSlug, defaultCtx(), { limit })
  },
  ['related-buildings'],
  {
    tags: [
      BUILDINGS_CATEGORY_TAG,
      LISTINGS_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
    revalidate: 300,
  },
)

/**
 * 楼盘搜索结果（全量楼盘 + 在租面积聚合）
 *
 * tags：buildings 类别 + listings 类别
 * 失效触发：building.* / listing.* 事件；300 秒兜底重新验证
 */
export const getCachedSearchBuildings = unstable_cache(
  async () => {
    return searchBuildings(defaultCtx())
  },
  ['search-buildings'],
  {
    tags: [
      BUILDINGS_CATEGORY_TAG,
      LISTINGS_CATEGORY_TAG,
    ],
    revalidate: 300,
  },
)

/**
 * 楼盘详情聚合（楼盘 + 楼内房源 + 价格区间）
 *
 * tags：buildings 类别 + listings 类别 + home:shanghai + sitemap
 * 失效触发：building.* / listing.* 事件
 */
export const getCachedBuildingDetail = unstable_cache(
  async (slug: string) => {
    return getBuildingDetail(slug, defaultCtx())
  },
  ['building-detail'],
  {
    tags: [
      BUILDINGS_CATEGORY_TAG,
      LISTINGS_CATEGORY_TAG,
      homeTag('shanghai'),
      facetsTag('shanghai'),
      SITEMAP_TAG,
    ],
  },
)

/**
 * 楼盘详情（不含房源聚合）
 *
 * tags：buildings 类别 + sitemap
 * 失效触发：building.* 事件
 */
export const getCachedBuildingBySlug = unstable_cache(
  async (slug: string) => {
    return getBuildingBySlug(slug, defaultCtx())
  },
  ['building-by-slug'],
  {
    tags: [
      BUILDINGS_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
  },
)

/**
 * 房源搜索源数据（按 canonical query 去除 page 后缓存）
 *
 * tags：listings 类别 + facets:shanghai + home:shanghai + sitemap
 * 失效触发：listing.* / report.supply_* 事件
 *
 * page 不进入昂贵源数据的 cache key；翻页只做内存切片，避免重复读取
 * 同一筛选条件下的完整有效供给候选集。
 */
export function buildListingSearchSourceCacheKey(input: ListingSearchInput): string {
  return buildCanonicalSearchParams({ ...input, page: 1 }).toString()
}

export const getCachedListingSearchSource = unstable_cache(
  async (sourceCacheKey: string, input: ListingSearchInput) => {
    void sourceCacheKey
    return buildListingSearchSource(input, defaultCtx())
  },
  ['listing-search-source'],
  {
    tags: [
      LISTINGS_CATEGORY_TAG,
      facetsTag('shanghai'),
      homeTag('shanghai'),
      SITEMAP_TAG,
    ],
    revalidate: 300,
  },
)

/**
 * 房源搜索结果：复用去 page 的昂贵源数据缓存，再按当前 page 分页。
 *
 * @param canonicalQuery 完整 canonical 查询串；保留参数兼容现有 route 调用
 * @param input 完整搜索输入（分页在缓存命中后执行）
 */
export async function getCachedSearchListings(
  canonicalQuery: string,
  input: ListingSearchInput,
) {
  void canonicalQuery
  const sourceInput = { ...input, page: 1 }
  const sourceCacheKey = buildListingSearchSourceCacheKey(input)
  const source = await getCachedListingSearchSource(sourceCacheKey, sourceInput)
  return paginateListingSearchSource(source, input)
}

/**
 * 房源列表区域筛选选项。
 *
 * 只读取有效区域，避免列表页为了筛选栏加载首页精选房源、楼盘、资讯等数据。
 */
export const getCachedListingDistrictOptions = unstable_cache(
  async () => {
    return getListingDistrictOptions(defaultCtx())
  },
  ['listing-district-options'],
  {
    tags: [
      BUILDINGS_CATEGORY_TAG,
      LISTINGS_CATEGORY_TAG,
      facetsTag('shanghai'),
    ],
    revalidate: 300,
  },
)

/**
 * 搜索 facet（按 canonical query 缓存）
 *
 * tags：facets:shanghai + listings 类别 + sitemap
 * 失效触发：listing.* / report.supply_* 事件
 */
export const getCachedSearchFacets = unstable_cache(
  async (canonicalQuery: string, input: ListingSearchInput) => {
    return getSearchFacets(input, defaultCtx())
  },
  ['search-facets'],
  {
    tags: [
      facetsTag('shanghai'),
      LISTINGS_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
  },
)

/**
 * 内容页详情（按 slug 缓存）
 *
 * tags：pages 类别 + sitemap
 * 失效触发：page.* 事件（如 page.published / page.unpublished）
 *
 * 注意：unstable_cache 的 tags 在闭包中静态，无法按 slug 动态生成 `public:page:<slug>`。
 * 失效时 cache-invalidator 调用 revalidateTag('public:pages') 清空所有内容页缓存。
 */
export const getCachedPageBySlug = unstable_cache(
  async (slug: string) => {
    return getPageBySlug(slug)
  },
  ['page-by-slug'],
  {
    tags: [
      PAGES_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
  },
)

/**
 * 已发布页面列表（用于 sitemap）
 *
 * tags：pages 类别 + sitemap
 * 失效触发：page.* 事件
 */
export const getCachedPublishedPages = unstable_cache(
  async (limit: number = 500) => {
    return listPublishedPages({ limit })
  },
  ['published-pages'],
  {
    tags: [
      PAGES_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
  },
)

/**
 * 已发布资讯列表。
 *
 * tags：articles 类别 + home:shanghai + sitemap
 * 失效触发：article.* 事件；300 秒兜底重新验证。
 */
export const getCachedPublishedArticles = unstable_cache(
  async (page: number = 1, pageSize: number = 12) => {
    return listPublishedArticles({ page, pageSize })
  },
  ['published-articles'],
  {
    tags: [
      ARTICLES_CATEGORY_TAG,
      homeTag('shanghai'),
      SITEMAP_TAG,
    ],
    revalidate: 300,
  },
)

/**
 * 资讯详情（按 slug 缓存）。
 *
 * tags：articles 类别 + home:shanghai + sitemap
 * 失效触发：article.* 事件；300 秒兜底重新验证。
 */
export const getCachedArticleBySlug = unstable_cache(
  async (slug: string) => {
    return getArticleBySlug(slug)
  },
  ['article-by-slug'],
  {
    tags: [
      ARTICLES_CATEGORY_TAG,
      homeTag('shanghai'),
      SITEMAP_TAG,
    ],
    revalidate: 300,
  },
)
