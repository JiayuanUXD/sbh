import { unstable_cache } from 'next/cache'

import {
  ARTICLES_CATEGORY_TAG as PUBLIC_ARTICLES_CATEGORY_TAG,
  BUILDINGS_CATEGORY_TAG,
  LISTINGS_CATEGORY_TAG,
  SITEMAP_TAG,
  buildBuildingCanonicalParams,
  applyMemoryFilters,
  assembleListingSearchResult,
  buildCanonicalSearchParams,
  buildListingScanCacheKey,
  buildingsCityTag,
  computeFacets,
  createSearchContext,
  facetsTag,
  hydrateListingCards,
  getArticleBySlug,
  getBuildingBySlug,
  getBuildingDetail,
  getDetailRecommendations,
  getHomepage,
  getListingBySlug,
  getListingDistrictOptions,
  getPageBySlug,
  getPlatformHomepageStats,
  getRelatedBuildings,
  getRelatedListings,
  homeTag,
  listPublishedArticles,
  listPublishedPages,
  listingsCityTag,
  omitListingSearchDimensions,
  scanListings,
  searchBuildingsFiltered,
  searchBuildingsPage,
  searchListingsSitemapPage,
  selectListingPage,
  toScanInput,
  type BuildingSearchInput,
  type HomepageStats,
  type ListingCardViewModel,
  type ListingScanRow,
  type ListingSearchDimension,
  type ListingSearchInput,
  type SearchFacets,
} from '@/domain/public-catalog'

const PAGES_CATEGORY_TAG = 'public:pages'
export const ARTICLES_CATEGORY_TAG = PUBLIC_ARTICLES_CATEGORY_TAG

/** 前台频道：租赁或出售。两者共用查询与组件，只是作用域不同。 */
export type SearchChannel = 'lease' | 'sale'

function canonicalCitySlug(citySlug: string): string {
  return createSearchContext(citySlug).city
}

/**
 * 同一时刻、同一缓存键的重查询合并成一个 promise（in-flight coalescing）。
 *
 * ## 为什么 `unstable_cache` 自己不做这件事（读源码确认，不是推测）
 *
 * `node_modules/next/dist/server/web/spec-extension/unstable-cache.js`：
 * `workStore.pendingRevalidates` 只守住「命中但已过期→后台重算」与「未命中→写回」
 * 两条路径；**未命中本身是无条件执行回调的**。于是 N 个并发的同 key miss 会各跑
 * 一次回调。列表路由是 `force-dynamic`，`q` 又是自由文本（缓存键空间无上界），
 * 冷未命中是常态而非罕见：编排层一次 fan-out 三份 facet，冷路径上就是三次
 * `adapter.findEffectiveListings`（不分页、`depth: 2`、水合商户关系——OPT-031
 * 认定的 sitemap 70 秒超时源头）打向共享 TencentDB。
 *
 * ## 为什么是这个形状，而不是 React `cache()`
 *
 * React `cache()` 也能做请求级去重，但它依赖渲染期的 async dispatcher：在本仓库
 * 的 vitest（node 环境、非 `react-server` 条件）里 `cache()` 恒为「无缓存」直通，
 * **去重行为无法被测试量到**，只能靠推理声称——而「靠推理声称缓存会命中」正是本次
 * 被推翻的那句注释。这里改用与运行时无关的纯 JS 合并表，冷路径查询次数可以在
 * `tests/opt036-facet-query-dedupe.test.ts` 里被数出来。
 *
 * ## 边界（都是刻意的）
 *
 *   - **结算即摘除**：不保留已完成的结果。留着等于在 `unstable_cache` 之外再造一层
 *     不受 `revalidate` / tag 管辖、永不失效的进程内缓存，后台改了数据前台刷不出来。
 *     因此这不是缓存，只是「别让同一个问题同时问 N 遍」。
 *   - **跨请求共享**：键是「城市 + 频道 + canonical」，结果与用户无关，两个并发请求
 *     共用同一次查询与 `unstable_cache` 给它们同一条缓存条目是同一件事，顺带挡住了
 *     缓存击穿（同一秒涌入的同 URL 请求只打一次库）。
 *   - **失败一起失败**：合并期间的错误对共享者一视同仁，与它们各自去查、各自撞上
 *     同一个故障没有区别；失败同样摘除，不会把一次抖动固化成常驻错误。
 */
const inFlightQueries = new Map<string, Promise<unknown>>()

function coalesceInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlightQueries.get(key) as Promise<T> | undefined
  if (existing) return existing
  const pending = run()
  inFlightQueries.set(key, pending)
  const forget = () => {
    if (inFlightQueries.get(key) === pending) inFlightQueries.delete(key)
  }
  pending.then(forget, forget)
  return pending
}

/** Private factory memoization; callers only receive typed public wrappers. */
function memoizeByCity<T>(create: (citySlug: string) => T): (citySlug: string) => T {
  const cache = new Map<string, T>()
  return (citySlug) => {
    const existing = cache.get(citySlug)
    if (existing !== undefined) return existing
    const created = create(citySlug)
    cache.set(citySlug, created)
    return created
  }
}

function listingCacheTags(citySlug: string): string[] {
  return [
    LISTINGS_CATEGORY_TAG,
    listingsCityTag(citySlug),
    homeTag(citySlug),
    SITEMAP_TAG,
  ]
}

function buildingCacheTags(citySlug: string): string[] {
  return [
    BUILDINGS_CATEGORY_TAG,
    buildingsCityTag(citySlug),
    homeTag(citySlug),
    SITEMAP_TAG,
  ]
}

function mixedSupplyCacheTags(citySlug: string): string[] {
  return [...listingCacheTags(citySlug), ...buildingCacheTags(citySlug)]
}

const getCachedHomepageByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    // 首页是租赁语境（精选房源、热门商圈、按类型浏览都按租金展示），
    // 出售供给不参与首页曝光，等出售频道上线后单独规划入口。
    async () => getHomepage(createSearchContext(citySlug, undefined, 'lease')),
    ['homepage', citySlug],
    {
      tags: [
        ...mixedSupplyCacheTags(citySlug),
        ARTICLES_CATEGORY_TAG,
        facetsTag(citySlug),
      ],
      revalidate: 300,
    },
  ),
)

export function getCachedHomepage(citySlug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedHomepageByCity(city)()
}

// 根页 `/`（平台入口）跨城汇总 stats：城市清单不固定（新城上线即变），不能像
// 其余 getCached* 那样用 memoizeByCity 按单城预建缓存条目，改为按「排序后的城市
// 清单」拼 key 直接缓存整份汇总结果——city 顺序不该影响缓存命中，故先排序再入 key。
const platformStatsCache = new Map<string, () => Promise<HomepageStats>>()

export function getCachedPlatformStats(citySlugs: readonly string[]): Promise<HomepageStats> {
  const key = [...new Set(citySlugs.map(canonicalCitySlug))].sort().join(',')
  let entry = platformStatsCache.get(key)
  if (!entry) {
    entry = unstable_cache(
      async () => getPlatformHomepageStats(key ? key.split(',') : []),
      ['platform-stats', key],
      {
        tags: key ? key.split(',').flatMap((slug) => mixedSupplyCacheTags(slug)) : [],
        revalidate: 300,
      },
    )
    platformStatsCache.set(key, entry)
  }
  return entry()
}

const getCachedListingBySlugByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (slug: string) => getListingBySlug(slug, createSearchContext(citySlug)),
    ['listing-by-slug', citySlug],
    { tags: listingCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedListingBySlug(citySlug: string, slug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedListingBySlugByCity(city)(slug)
}

const getCachedRelatedListingsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (listingSlug: string, limit: number = 6) =>
      getRelatedListings(listingSlug, createSearchContext(citySlug), { limit }),
    ['related-listings', citySlug],
    { tags: mixedSupplyCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedRelatedListings(
  citySlug: string,
  listingSlug: string,
  limit: number = 6,
) {
  const city = canonicalCitySlug(citySlug)
  return getCachedRelatedListingsByCity(city)(listingSlug, limit)
}

const getCachedDetailRecommendationsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (listingSlug: string, limit: number = 6) =>
      // OPT-068：候选来自**已缓存**的整城扫描（与列表页同一条），不再为每个商圈 /
      // 行政区各打一次不分页 depth 2 查询——详情页冷开 2.8–4.1 秒的主因就在那里。
      getDetailRecommendations(listingSlug, createSearchContext(citySlug), {
        limit,
        scan: (input) => getCachedListingScan(citySlug, input, 'all'),
      }),
    ['detail-recommendations', citySlug],
    { tags: mixedSupplyCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedDetailRecommendations(
  citySlug: string,
  listingSlug: string,
  limit: number = 6,
) {
  const city = canonicalCitySlug(citySlug)
  return getCachedDetailRecommendationsByCity(city)(listingSlug, limit)
}

const getCachedRelatedBuildingsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (buildingSlug: string, limit: number = 6) =>
      getRelatedBuildings(buildingSlug, createSearchContext(citySlug), { limit }),
    ['related-buildings', citySlug],
    { tags: mixedSupplyCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedRelatedBuildings(
  citySlug: string,
  buildingSlug: string,
  limit: number = 6,
) {
  const city = canonicalCitySlug(citySlug)
  return getCachedRelatedBuildingsByCity(city)(buildingSlug, limit)
}

// 未筛选版 getCachedSearchBuildings（曾包 domain searchBuildings）已在
// OPT-036 Task 13 删除：楼盘列表页自 Task 12 起全部走 getCachedSearchBuildingsFiltered，
// 保留这条无生产调用方的路径只会让「照着抄一个楼盘列表」的人重新绕回未筛选查询。

const getCachedSearchBuildingsFilteredByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    // canonicalQuery 只用于让不同筛选条件落进不同缓存条目（unstable_cache 按参数
    // 序列化派生 key），函数体内不直接使用——真正的筛选逻辑吃 input 本身。
    async (canonicalQuery: string, input: BuildingSearchInput) => {
      void canonicalQuery
      return searchBuildingsFiltered(input, createSearchContext(citySlug))
    },
    ['search-buildings-filtered', citySlug],
    {
      tags: [...buildingCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

/**
 * 楼盘列表页筛选/排序/分页查询（OPT-036 Task 2）。
 *
 * 楼盘页整页只发这一次查询（没有 facet fan-out——候选清单与逐维度命中数由
 * `searchBuildingsFiltered` 在同一趟里算出来），因此**不存在房源页那种同一次渲染
 * 内的放大**。这里仍然过一层 `coalesceInFlight`，挡的是另一件事：同一秒涌入的同
 * URL 并发请求在冷缓存下各跑一次 `searchBuildings`（同样是不分页、`depth: 2` 的
 * 那条查询）。合并键与缓存键同构。
 */
export function getCachedSearchBuildingsFiltered(
  citySlug: string,
  input: BuildingSearchInput,
) {
  const city = canonicalCitySlug(citySlug)
  const canonicalQuery = buildBuildingCanonicalParams(input).toString()
  return coalesceInFlight(
    ['search-buildings-filtered', city, canonicalQuery].join(' '),
    () => getCachedSearchBuildingsFilteredByCity(city)(canonicalQuery, input),
  )
}

type SitemapBuildingPageLoader = () => ReturnType<typeof searchBuildingsPage>

const getCachedSitemapBuildingsPageByCity = memoizeByCity((citySlug) => {
  const pages = new Map<string, SitemapBuildingPageLoader>()
  return (page: number, limit: number) => {
    const cacheKey = `${page}:${limit}`
    const existing = pages.get(cacheKey)
    if (existing) return existing()
    const load = unstable_cache(
      async () => searchBuildingsPage(
        createSearchContext(citySlug),
        { page, limit },
      ),
      ['sitemap-buildings-page', citySlug, `page:${page}`, `limit:${limit}`],
      {
        tags: [
          ...buildingCacheTags(citySlug),
          `${buildingsCityTag(citySlug)}:page:${page}:limit:${limit}`,
        ],
        revalidate: 300,
      },
    )
    pages.set(cacheKey, load)
    return load()
  }
})

export function getCachedSitemapBuildingsPage(
  citySlug: string,
  page: number,
  limit: number,
) {
  const city = canonicalCitySlug(citySlug)
  const normalizedPage = Math.max(1, Math.floor(page))
  const normalizedLimit = Math.min(500, Math.max(1, Math.floor(limit)))
  return getCachedSitemapBuildingsPageByCity(city)(normalizedPage, normalizedLimit)
}

type SitemapListingPageLoader = () => ReturnType<typeof searchListingsSitemapPage>

const getCachedSitemapListingsPageByCity = memoizeByCity((citySlug) => {
  const pages = new Map<string, SitemapListingPageLoader>()
  return (page: number, limit: number) => {
    const cacheKey = `${page}:${limit}`
    const existing = pages.get(cacheKey)
    if (existing) return existing()
    const load = unstable_cache(
      async () => searchListingsSitemapPage(
        createSearchContext(citySlug),
        { page, limit },
      ),
      ['sitemap-listings-page', citySlug, `page:${page}`, `limit:${limit}`],
      {
        tags: [
          ...listingCacheTags(citySlug),
          `${listingsCityTag(citySlug)}:sitemap:page:${page}:limit:${limit}`,
        ],
        revalidate: 300,
      },
    )
    pages.set(cacheKey, load)
    return load()
  }
})

export function getCachedSitemapListingsPage(
  citySlug: string,
  page: number,
  limit: number,
) {
  const city = canonicalCitySlug(citySlug)
  const normalizedPage = Math.max(1, Math.floor(page))
  const normalizedLimit = Math.min(500, Math.max(1, Math.floor(limit)))
  return getCachedSitemapListingsPageByCity(city)(normalizedPage, normalizedLimit)
}

const getCachedBuildingDetailByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (slug: string) => getBuildingDetail(slug, createSearchContext(citySlug)),
    ['building-detail', citySlug],
    {
      tags: [...mixedSupplyCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

export function getCachedBuildingDetail(citySlug: string, slug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedBuildingDetailByCity(city)(slug)
}

const getCachedBuildingBySlugByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (slug: string) => getBuildingBySlug(slug, createSearchContext(citySlug)),
    ['building-by-slug', citySlug],
    { tags: buildingCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedBuildingBySlug(citySlug: string, slug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedBuildingBySlugByCity(city)(slug)
}

/**
 * 扫描频道：列表页按租 / 售分频道；详情推荐与首页统计不分频道（`'all'`）。
 * 进缓存键与合并键，不同频道不得互相顶替结果。
 */
export type ScanChannel = SearchChannel | 'all'

/**
 * 房源扫描缓存（OPT-068）。
 *
 * 缓存的是紧凑的 `ListingScanRow[]`（不是整页卡片）：键只含会进 where 的维度
 * （面积 / 商圈 / 地铁 / 关键词 / 可用日期），区域 / 类型 / 价格单位 / 价格区间 /
 * 页码 / 排序的任意组合都命中**同一条**。列表页与三份 facet 因此共享一次扫描；
 * 冷路径从「最多 5 页 depth 2 全字段 × 2–4 次」降到「一次 select/populate 收窄的扫描」。
 *
 * 行体积上限见 supply-adapter.ts 的 `LISTING_SCAN_CANDIDATE_LIMIT` 注释（2MB 红线）。
 * 回调必须返回数组：`unstable_cache` 走 JSON 序列化，`Map` 会静默变成 `{}`。
 */
const getCachedListingScanByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    // scanKey 只为进缓存键；channel 作为函数参数而非 keyParts，同样会被序列化进键。
    async (scanKey: string, scanInput: ListingSearchInput, channel: ScanChannel) => {
      void scanKey
      const ctx = createSearchContext(citySlug, undefined, channel === 'all' ? undefined : channel)
      return scanListings(scanInput, ctx)
    },
    ['listing-scan', citySlug],
    {
      tags: [...listingCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

export function getCachedListingScan(
  citySlug: string,
  input: ListingSearchInput,
  channel: ScanChannel = 'lease',
): Promise<readonly ListingScanRow[]> {
  const city = canonicalCitySlug(citySlug)
  const scanInput = toScanInput(input)
  const scanKey = buildListingScanCacheKey(input)
  // 合并键与缓存键同构（城市 + 频道 + 扫描键），理由见 coalesceInFlight 注释。
  return coalesceInFlight(
    ['listing-scan', city, channel, scanKey].join(' '),
    () => getCachedListingScanByCity(city)(scanKey, scanInput, channel),
  )
}

/**
 * 本页卡片缓存：键是本页 id 列表。同一批 id 出现在不同筛选组合的同一页时复用；
 * 24 张卡片 ≈ 30KB，远在 2MB 之内。回捞不分频道（id 已经是频道内选出来的）。
 */
const getCachedListingCardsByIdsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async (idsKey: string, ids: readonly number[]) => {
      void idsKey
      return hydrateListingCards(ids, createSearchContext(citySlug))
    },
    ['listing-cards', citySlug],
    { tags: listingCacheTags(citySlug), revalidate: 300 },
  ),
)

export function getCachedListingCardsByIds(
  citySlug: string,
  ids: readonly number[],
): Promise<readonly ListingCardViewModel[]> {
  if (ids.length === 0) return Promise.resolve([])
  const city = canonicalCitySlug(citySlug)
  const idsKey = ids.join(',')
  return coalesceInFlight(
    ['listing-cards', city, idsKey].join(' '),
    () => getCachedListingCardsByIdsByCity(city)(idsKey, ids),
  )
}

/**
 * 房源列表查询：扫描（缓存）→ 内存选页 → 本页卡片（缓存）。
 *
 * @param businessType 频道；缺省 lease 保持既有调用不变。出售频道传 sale——
 *   两者共用同一套查询与组件，只是作用域不同。
 */
export async function getCachedSearchListings(
  citySlug: string,
  canonicalQuery: string,
  input: ListingSearchInput,
  businessType: SearchChannel = 'lease',
) {
  void canonicalQuery
  const rows = await getCachedListingScan(citySlug, input, businessType)
  const page = selectListingPage(rows, input)
  const cards = await getCachedListingCardsByIds(citySlug, page.ids)
  return assembleListingSearchResult(page, cards, input)
}

const getCachedListingDistrictOptionsByCity = memoizeByCity((citySlug) =>
  unstable_cache(
    async () => getListingDistrictOptions(createSearchContext(citySlug)),
    ['listing-district-options', citySlug],
    {
      tags: [...mixedSupplyCacheTags(citySlug), facetsTag(citySlug)],
      revalidate: 300,
    },
  ),
)

export function getCachedListingDistrictOptions(citySlug: string) {
  const city = canonicalCitySlug(citySlug)
  return getCachedListingDistrictOptionsByCity(city)()
}

/**
 * facet：与列表共用同一份扫描缓存（频道进键，租售计数不串），聚合是纯内存操作，
 * 不再单独建一条 `unstable_cache`——facet 本身已经不是「昂贵查询」了。
 */
export async function getCachedSearchFacets(
  citySlug: string,
  canonicalQuery: string,
  input: ListingSearchInput,
  businessType: SearchChannel = 'lease',
): Promise<SearchFacets> {
  void canonicalQuery
  const rows = await getCachedListingScan(citySlug, input, businessType)
  return computeFacets(applyMemoryFilters(rows, { ...input, page: 1, sort: 'recommended' }))
}

/**
 * 剥掉指定维度后的 facet 统计（OPT-036 Task 11）。
 *
 * 剥离语义与「为什么必须剥」见 `omitListingSearchDimensions` 的注释——一句话：
 * `getSearchFacets` 的 facetInput 保留了 `priceUnit`，选中某个计价单位后其余
 * 单位计数恒为 0，「另有 N 套按 X 报价」提示条会静默消失。列表页的单位计数、
 * 筛选行候选计数、空态②的逐条退路命中数都必须走这一条。
 *
 * 缓存策略：**先剥离、再用剥离后的 input 拼 canonical 当缓存键**，直接复用
 * `getCachedSearchFacets` 那一条缓存工厂。这样剥不同维度只要落到同一份 input
 * 就命中同一条缓存——最常见的情形（用户只选了单位、没选区域时，剥 `priceUnit`
 * 与剥 `district` 得到的是同一份输入）因此只查一次库，而不是每个维度各查一次。
 * `page`/`sort` 一并归一，避免同一份筛选条件因为页码不同而分裂成多条缓存。
 */
export function getCachedSearchFacetsIgnoring(
  citySlug: string,
  input: ListingSearchInput,
  dimensions: readonly ListingSearchDimension[],
  businessType: SearchChannel = 'lease',
) {
  const stripped = omitListingSearchDimensions(input, dimensions)
  const facetInput: ListingSearchInput = { ...stripped, page: 1, sort: 'recommended' }
  const canonicalQuery = buildCanonicalSearchParams(facetInput).toString()
  return getCachedSearchFacets(citySlug, canonicalQuery, facetInput, businessType)
}

// Articles and pages intentionally remain global in Plan 2.
export const getCachedPageBySlug = unstable_cache(
  async (slug: string) => getPageBySlug(slug),
  ['page-by-slug'],
  { tags: [PAGES_CATEGORY_TAG, SITEMAP_TAG] },
)

export const getCachedPublishedPages = unstable_cache(
  async (limit: number = 500) => listPublishedPages({ limit }),
  ['published-pages'],
  { tags: [PAGES_CATEGORY_TAG, SITEMAP_TAG] },
)

export const getCachedPublishedArticles = unstable_cache(
  async (page: number = 1, pageSize: number = 12) =>
    listPublishedArticles({ page, pageSize }),
  ['published-articles'],
  {
    tags: [ARTICLES_CATEGORY_TAG, SITEMAP_TAG],
    revalidate: 300,
  },
)

export const getCachedArticleBySlug = unstable_cache(
  async (slug: string) => getArticleBySlug(slug),
  ['article-by-slug'],
  {
    tags: [ARTICLES_CATEGORY_TAG, SITEMAP_TAG],
    revalidate: 300,
  },
)
