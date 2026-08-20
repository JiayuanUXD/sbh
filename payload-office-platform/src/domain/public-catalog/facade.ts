/**
 * 公开目录查询门面（Public Catalog Query Facade）
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7、§8、§11
 *           specs/frontend-mvp/tasks.md F1.3、F1.4
 *           FRONTEND_AGENT.md §6.1、§6.2、§6.3
 *
 * 职责：
 *   - 路由层与组件的唯一查询入口；
 *   - 组合 SupplyAdapter → Mapper → 稳定排序 → 分页 → 缓存 tag；
 *   - 不接收原始 Payload 文档进入组件层（mapper 投影在 Facade 内完成）；
 *   - 不在 Facade 内部拼 Payload `where`（由 SupplyAdapter 负责）。
 *
 * 守护不变量：
 *   - 价格排序前必须 isSameRentUnit 校验，否则仅返回同首单位的子集；
 *   - 推荐与最新排序以 listing_id 升序收束，跨页稳定；
 *   - 输入参数非法由 search-params 解析器降级，Facade 不再次抛错；
 *   - 失效供给返回 null/空数组，不混入失效数据；
 *   - 使用 PayloadSupplyAdapter（M4.7）：查询层有效供给谓词 + 逐条精筛，
 *     前台、预览、楼盘聚合、Dashboard 对同一房源可见性结论一致。
 */

import type { Listing, Building } from '@/payload-types'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  BuildingSupplySnapshot,
  DistrictViewModel,
  DistrictCardViewModel,
  ArticleCardViewModel,
  ArticleDetailViewModel,
  ArticleListResult,
  HomepageStats,
  HomepageTypeSummary,
  ListingCardViewModel,
  ListingDetailViewModel,
  MediaViewModel,
  NearbyListingViewModel,
  PageDetailViewModel,
  PageSummaryViewModel,
  PublicRouteIdentity,
} from './contracts'
import { haversineKm } from './geo'
import type { BuildingSupplyInput } from './building-supply'
import { buildBuildingSupplySnapshot, emptyBuildingSupplySnapshot } from './building-supply'
import type { BuildingSearchInput } from './building-search'
import { applyBuildingFilters, sortBuildings } from './building-search'
import {
  mapBuildingDetail,
  mapBuildingSummary,
  mapDistrict,
  mapDistrictCard,
  mapMedia,
  mapArticleCard,
  mapArticleDetail,
  mapListingCard,
  mapListingDetail,
  mapPageDetail,
  mapPageSummary,
} from './mappers'
import {
  buildCanonicalSearchParams,
  parseListingSearchInput,
} from './search-params'
import {
  filterByRentUnit,
  filterByPriceKey,
  isSameRentUnit,
  paginate,
  priceKeyOf,
  stableSortCards,
} from './stable-sort'
import { createSearchContext } from './types'
import type { ListingSort, ListingSearchInput, Pagination, SearchContext } from './types'
import type {
  EffectiveListingSitemapPage,
  SupplyAdapter,
} from './supply-adapter'
import { getDefaultSupplyAdapter } from './supply-adapter'
import {
  rankDetailRecommendations,
  type RecommendationCandidate,
  type RecommendationContext,
  type RecommendationResult,
  type ReasonCode,
} from '@/domain/recommendation/detail-recommendations'

// ---------------------------------------------------------------------------
// 公共返回类型
// ---------------------------------------------------------------------------

/** 房源搜索结果：包含分页元数据、当前页卡片与 canonical URL */
export type ListingSearchResult = Readonly<{
  docs: readonly ListingCardViewModel[]
  pagination: Pagination
  /** 用于 canonical URL / sitemap；queryHash 由 canonical 派生 */
  canonical: string
  /** 是否经过 rentUnit 过滤（价格排序时可能缩窄结果集） */
  filteredByRentUnit: boolean
}>

/** 房源搜索的昂贵中间结果：已完成有效供给精筛、映射、排序，但尚未分页。 */
export type ListingSearchSource = Readonly<{
  docs: readonly ListingCardViewModel[]
  filteredByRentUnit: boolean
}>

/** 首页数据：精选房源 + 热门区域 + 精选楼盘 + 商圈卡 + 最新资讯 */
export type HomepageData = Readonly<{
  featuredListings: readonly ListingCardViewModel[]
  districts: readonly DistrictViewModel[]
  /** 精选楼盘（默认取 8 张，匹配首页两行布局） */
  featuredBuildings: readonly BuildingSummaryViewModel[]
  /** 商圈卡：区域 + 代表楼盘封面（无代表封面的商圈不进入卡片区） */
  districtCards: readonly DistrictCardViewModel[]
  /** 最新资讯（默认取 5 条，按 publishedAt 倒序） */
  latestArticles: readonly ArticleCardViewModel[]
  /** 真实统计计数：有效房源 / 有效楼盘 / 前台可见商圈（与列表页、商圈链接同口径） */
  stats: HomepageStats
  /** 按 listingType 聚合的计数与代表封面 */
  typeSummaries: Readonly<Record<string, HomepageTypeSummary>>
  /** 核心商圈附近房源：按距城市中心升序，排除已在精选区展示的房源，上限 5 条 */
  nearbyListings: readonly NearbyListingViewModel[]
}>

/** 搜索 facet：当前可见房源的分布统计 */
export type SearchFacets = Readonly<{
  districts: ReadonlyArray<DistrictViewModel & { count: number }>
  listingTypes: ReadonlyArray<{ value: string; count: number }>
  rentUnits: ReadonlyArray<{ value: string; count: number }>
  totalDocs: number
}>

/** 楼盘详情聚合：楼盘 + 同一 asOf 下的供给快照。 */
export type BuildingDetailResult = Readonly<{
  building: BuildingDetailViewModel | null
  supply: BuildingSupplySnapshot
}>

/** 楼盘列表搜索结果（含在租面积聚合） */
export type BuildingSearchResult = Readonly<{
  docs: readonly BuildingSummaryViewModel[]
  totalDocs: number
}>

/** 楼盘列表页筛选/排序/分页结果（OPT-036 Task 2）。 */
export type BuildingFilteredResult = Readonly<{
  docs: readonly BuildingSummaryViewModel[]
  totalDocs: number
  page: number
  totalPages: number
  /** 各筛选维度的候选值与命中数，供筛选条渲染与空态退路使用 */
  facets: Readonly<{
    districts: ReadonlyArray<{ slug: string; name: string; count: number }>
    grades: ReadonlyArray<{ value: string; count: number }>
    metros: ReadonlyArray<{ slug: string; name: string; count: number }>
  }>
}>

/** One public building page for bounded catalog enumeration. */
export type BuildingSearchPageResult = Readonly<{
  docs: readonly BuildingSummaryViewModel[]
  page: number
  hasNextPage: boolean
  nextPage: number | null
}>

/** 楼盘详情页（不含房源聚合）：仅楼盘 DTO */
export type BuildingDetailPageResult = Readonly<{
  building: BuildingDetailViewModel | null
}>

/** 情境推荐结果（P2 Task 5） */
export type DetailRecommendationItem = Readonly<{
  card: ListingCardViewModel
  reasonCodes: readonly ReasonCode[]
}>

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 从原始 Listing 文档提取 lastEffectiveMaintainedAt 时间戳
 *
 * 过渡实现：使用 `updatedAt`（M4.7 后切换为 `lastEffectiveMaintainedAt`）。
 */
function lastEffectiveMaintainedAtOf(listing: Listing): number {
  const v = (listing as { updatedAt?: unknown }).updatedAt
  if (typeof v !== 'string' || v.length === 0) return -Infinity
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : -Infinity
}

/**
 * 把 Listing 列表映射为 ListingCardViewModel 列表，丢弃映射失败的项。
 */
function mapListingsToCards(
  listings: readonly Listing[],
): ListingCardViewModel[] {
  const cards: ListingCardViewModel[] = []
  for (const raw of listings) {
    const card = mapListingCard(raw)
    if (card) cards.push(card)
  }
  return cards
}

/**
 * 从 ListingCardViewModel 反查原始 Listing 的 lastEffectiveMaintainedAt
 *
 * 由于 ListingCardViewModel 不暴露 updatedAt，Facade 在排序时持有原始 listing 映射，
 * 通过 stableSortKey（listing-<id>）回查。
 */
function buildLastEffAtLookup(
  listings: readonly Listing[],
): (card: ListingCardViewModel) => number {
  const map = new Map<number, number>()
  for (const l of listings) {
    map.set(l.id, lastEffectiveMaintainedAtOf(l))
  }
  return (card) => map.get(card.id) ?? -Infinity
}

/**
 * 价格排序预处理：若卡片价格单位不一致，按首个非空单位过滤。
 *
 * 守护不变量（design.md §7.4、FRONTEND_AGENT.md §6.3）：
 *   - 禁止跨 rentUnit 价格排序；
 *   - UI 应在 sort=rent-asc/rent-desc 且未指定 rentUnit 时提示"已按统一单位显示"。
 */
function prepareCardsForPriceSort(
  cards: readonly ListingCardViewModel[],
  input: ListingSearchInput,
): { cards: ListingCardViewModel[]; filteredByRentUnit: boolean } {
  if (input.sort !== 'price-asc' && input.sort !== 'price-desc') {
    return { cards: cards.slice(), filteredByRentUnit: false }
  }
  // 已显式选定 rentUnit：直接按该单位过滤
  if (input.priceUnit) {
    return {
      cards: filterByRentUnit(cards, input.priceUnit),
      filteredByRentUnit: cards.some((card) => card.price != null && card.price.displayUnit !== input.priceUnit),
    }
  }
  // 未指定 rentUnit 但请求价格排序：取首个非空单位
  if (isSameRentUnit(cards)) {
    return { cards: cards.slice(), filteredByRentUnit: false }
  }
  const firstWithPrice = cards.find((c) => c.price != null)
  if (!firstWithPrice?.price) {
    return { cards: cards.slice(), filteredByRentUnit: false }
  }
  return {
    cards: filterByPriceKey(cards, priceKeyOf(firstWithPrice.price)!),
    filteredByRentUnit: true,
  }
}

/**
 * 给楼盘 VM 批量补上在租面积与在租套数（一次 SQL 聚合覆盖全部楼盘）。
 *
 * 曾用名 attachLeasableArea——只补面积时这个名字是准的，加了套数以后继续叫它
 * 就是误导，改名同时改了行为（两个字段一起补，不是分两次查）。
 *
 * 缺这两个字段的后果不只是少显示数字：BuildingListCard 会据此判定
 * 「暂无在租」并给封面加 grayscale 降饱和，整片卡片发灰。首页与楼盘列表页
 * 必须走同一条聚合，否则同一楼盘在两个页面上结论相反。
 */
async function attachSupplyAggregates(
  summaries: readonly BuildingSummaryViewModel[],
  ctx: SearchContext,
  adapter: SupplyAdapter,
): Promise<BuildingSummaryViewModel[]> {
  if (summaries.length === 0) return []
  // 强制 lease 而非跟随 ctx：这两个字段叫「在租面积」「在租套数」，语义上只算租赁
  // 供给，与调用方当前在哪个频道无关。出售频道页上的楼盘卡片同样应该显示租赁口径
  // 的在租数据，一套 3800 万的待售整层不能被算进去。
  const aggregateByBuilding = await adapter.aggregateEffectiveSupplyByBuildings(
    summaries.map((s) => s.id),
    { ...ctx, businessType: 'lease' },
  )
  return summaries.map((s) => {
    const agg = aggregateByBuilding.get(String(s.id))
    if (!agg) return s
    const next = { ...s }
    // area / count 各自独立判空：SQL 层已把非正面积归零，但套数来自同一批真实
    // 存在的有效房源行，不因面积数据质量问题被连累——面积缺失不该让套数也消失。
    if (agg.area > 0) next.leasableArea = agg.area
    if (agg.count > 0) next.listingCount = agg.count
    return next
  })
}

/**
 * 首页商圈卡默认张数。
 *
 * 栅格 4 列、大卡跨 2x2，1 大 + 4 小恰好填满 2 行。
 * 展示哪些商圈由 Locations 的「前台可见」控制，本常量只限制张数。
 */
const DEFAULT_DISTRICT_CARDS_LIMIT = 5

/** 每张商圈卡最多列出的代表楼盘名数量 */
const AREA_CARD_BUILDINGS_MAX = 4

/** 计算分页元数据 */
function buildPagination(
  totalDocs: number,
  page: number,
  pageSize: number,
): Pagination {
  const safePageSize = pageSize > 0 ? pageSize : 1
  const totalPages = Math.max(1, Math.ceil(totalDocs / safePageSize))
  // page < 1 视为非法 → 回退为 1；page > totalPages 不 clamp（与 paginate 一致）
  const safePage = Math.max(1, page)
  return {
    page: safePage,
    pageSize: pageSize as 24,
    totalDocs,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
  }
}

// ---------------------------------------------------------------------------
// Facade 函数
// ---------------------------------------------------------------------------

/**
 * 解析 URLSearchParams 为 ListingSearchInput（路由层入口）
 *
 * 路由层应使用此函数；解析后传入 searchListings。
 */
export function parseSearchInput(sp: URLSearchParams): ListingSearchInput {
  return parseListingSearchInput(sp)
}

/**
 * 生成 canonical 查询串（用于链接、sitemap 与 canonical URL）
 */
export function buildCanonical(input: ListingSearchInput): string {
  return buildCanonicalSearchParams(input).toString()
}

/**
 * 搜索房源：返回分页卡片列表与 canonical URL
 *
 * 步骤：
 *   1. adapter.findEffectiveListings → 原始 Listing[]
 *   2. mapListingCard → ListingCardViewModel[]
 *   3. 价格排序预处理（按 rentUnit 分组）
 *   4. stableSortCards（listing_id 收束）
 *   5. paginate → 当前页
 *
 * @param input 搜索输入（由 parseListingSearchInput 生成）
 * @param ctx 查询上下文（含 asOf / 时区 / 城市）
 * @param adapter 可选注入适配器（测试用）
 */
export async function searchListings(
  input: ListingSearchInput,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<ListingSearchResult> {
  const source = await buildListingSearchSource(input, ctx, adapter)
  return paginateListingSearchSource(source, input)
}

/**
 * 构建房源搜索源数据：完成有效供给精筛、卡片映射和全局排序，但不分页。
 *
 * 列表页缓存可复用该结果，使 `/listings?page=2` 不再重复执行最重的候选集查询。
 */
export async function buildListingSearchSource(
  input: ListingSearchInput,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<ListingSearchSource> {
  const rawListings = await adapter.findEffectiveListings(input, ctx)
  const cards = mapListingsToCards(rawListings)
  const { cards: sortTarget, filteredByRentUnit } = prepareCardsForPriceSort(cards, input)
  const lastEffAt = buildLastEffAtLookup(rawListings)
  const sorted = stableSortCards(sortTarget, input.sort ?? 'recommended', lastEffAt)

  return {
    docs: sorted,
    filteredByRentUnit,
  }
}

/** 对已缓存的房源搜索源数据做轻量分页，保持原有 canonical 与分页语义。 */
export function paginateListingSearchSource(
  source: ListingSearchSource,
  input: ListingSearchInput,
): ListingSearchResult {
  const paged = paginate(source.docs, input.page, input.pageSize)
  return {
    docs: paged.docs,
    pagination: buildPagination(paged.totalDocs, input.page, input.pageSize),
    canonical: buildCanonicalSearchParams(input).toString(),
    filteredByRentUnit: source.filteredByRentUnit,
  }
}

/**
 * 搜索楼盘列表：返回所有有效公开楼盘（含在租面积聚合）
 *
 * 步骤：
 *   1. adapter.findEffectiveBuildings → 原始 Building[]
 *   2. mapBuildingSummary → BuildingSummaryViewModel[]
 *   3. attachSupplyAggregates 一次 SQL 聚合补齐在租面积与在租套数（不再逐楼盘查房源）
 */
export async function searchBuildings(
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<BuildingSearchResult> {
  const rawBuildings = await adapter.findEffectiveBuildings(ctx)
  const summaries: BuildingSummaryViewModel[] = []
  for (const raw of rawBuildings) {
    const summary = mapBuildingSummary(raw)
    if (summary) summaries.push(summary)
  }
  const docs = await attachSupplyAggregates(summaries, ctx, adapter)
  return { docs, totalDocs: docs.length }
}

/**
 * 在筛选前的全集上计算各筛选维度的候选值与命中数。
 *
 * 必须传入筛选前的全集：如果在 applyBuildingFilters 之后算 facets，选中一个
 * 区域后其它区域会因为已被过滤掉而从筛选条里消失（自我擦除 bug）。
 */
function buildBuildingFacets(
  docs: readonly BuildingSummaryViewModel[],
): BuildingFilteredResult['facets'] {
  const districts = new Map<string, { name: string; count: number }>()
  const grades = new Map<string, number>()
  const metros = new Map<string, { name: string; count: number }>()

  for (const doc of docs) {
    if (doc.district) {
      const entry = districts.get(doc.district.slug)
      districts.set(doc.district.slug, { name: doc.district.name, count: (entry?.count ?? 0) + 1 })
    }
    if (doc.grade) {
      grades.set(doc.grade, (grades.get(doc.grade) ?? 0) + 1)
    }
    if (doc.nearestMetro) {
      const entry = metros.get(doc.nearestMetro.slug)
      metros.set(doc.nearestMetro.slug, { name: doc.nearestMetro.name, count: (entry?.count ?? 0) + 1 })
    }
  }

  return {
    districts: Array.from(districts.entries()).map(([slug, { name, count }]) => ({ slug, name, count })),
    grades: Array.from(grades.entries()).map(([value, count]) => ({ value, count })),
    metros: Array.from(metros.entries()).map(([slug, { name, count }]) => ({ slug, name, count })),
  }
}

/**
 * 楼盘列表筛选/排序/分页（OPT-036 Task 2）。
 *
 * 步骤：searchBuildings 取全集 → 在全集上算 facets（筛选前）→
 * applyBuildingFilters → sortBuildings → 按 input.page/pageSize 切片。
 *
 * **200 条上限**：底层 `adapter.findEffectiveBuildings(ctx)` 默认 `limit = 200`
 * （见 supply-adapter.ts），本函数继承这个上限、不在此处放宽。当一个城市的有效
 * 公开楼盘超过 200 个时，筛选/排序/分页都只作用于前 200 条，结果会静默截断——
 * 放宽上限需要先评估查询成本，届时应改走分页适配器（类似 findEffectiveBuildingsPage），
 * 而不是简单调大这个数字。
 */
export async function searchBuildingsFiltered(
  input: BuildingSearchInput,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<BuildingFilteredResult> {
  const { docs: allDocs } = await searchBuildings(ctx, adapter)
  const facets = buildBuildingFacets(allDocs)
  const filtered = applyBuildingFilters(allDocs, input)
  const sorted = sortBuildings(filtered, input.sort)
  const { docs, totalDocs, totalPages } = paginate(sorted, input.page, input.pageSize)
  return {
    docs,
    totalDocs,
    page: Math.max(1, input.page),
    totalPages,
    facets,
  }
}

/**
 * sitemap 房源页：不做展示映射，直接透传适配器的轻量条目。
 *
 * 与 searchBuildingsPage 的差别是这里**没有** mapXxx 一步——sitemap 只要 URL 和
 * lastmod，映射成展示模型正是 /sitemap.xml 线上超时的成本来源（见 OPT-031）。
 */
export async function searchListingsSitemapPage(
  ctx: SearchContext,
  options: Readonly<{ page: number; limit: number }>,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<EffectiveListingSitemapPage> {
  return adapter.findEffectiveListingsSitemapPage(ctx, options)
}

export async function searchBuildingsPage(
  ctx: SearchContext,
  options: Readonly<{ page: number; limit: number }>,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<BuildingSearchPageResult> {
  const result = await adapter.findEffectiveBuildingsPage(ctx, options)
  const docs: BuildingSummaryViewModel[] = []
  for (const raw of result.docs) {
    const summary = mapBuildingSummary(raw)
    if (summary) docs.push(summary)
  }
  return {
    docs,
    page: result.page,
    hasNextPage: result.hasNextPage,
    nextPage: result.nextPage,
  }
}

/**
 * 按 slug 获取房源详情；不存在或失效返回 null
 *
 * 注意：详情页路由应基于此结果决定 404，不接收原始 Payload 文档。
 */
export async function getListingBySlug(
  slug: string,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<ListingDetailViewModel | null> {
  const raw = await adapter.findEffectiveListingBySlug(slug, ctx)
  if (!raw) return null
  return mapListingDetail(raw)
}

/**
 * 按 slug 获取楼盘详情
 *
 * 楼盘停用或不存在返回 null；路由层据此返回 404。
 */
export async function getBuildingBySlug(
  slug: string,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<BuildingDetailViewModel | null> {
  const raw = await adapter.findEffectiveBuildingBySlug(slug, ctx)
  if (!raw) return null
  return mapBuildingDetail(raw, ctx.asOf)
}

/** Minimal cityless lookup used only by legacy/correction listing redirects. */
export async function resolveListingRouteIdentity(
  slug: string,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<PublicRouteIdentity | null> {
  const identity = await adapter.findListingRouteIdentity(slug)
  return identity ? { slug: identity.slug, citySlug: identity.citySlug } : null
}

/** Minimal cityless lookup used only by legacy/correction building redirects. */
export async function resolveBuildingRouteIdentity(
  slug: string,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<PublicRouteIdentity | null> {
  const identity = await adapter.findBuildingRouteIdentity(slug)
  return identity ? { slug: identity.slug, citySlug: identity.citySlug } : null
}

/**
 * 楼盘详情聚合：楼盘 + 楼内有效房源 + 按 rentUnit 分组价格区间
 *
 * design.md §5.5：不同币种、租售类型或租赁单位不得合并成一个价格区间。
 */
export function getBuildingDetail(
  slug: string,
  ctx: SearchContext,
  adapter?: SupplyAdapter,
): Promise<BuildingDetailResult>
export function getBuildingDetail(
  slug: string,
  ctx: SearchContext,
  input: BuildingSupplyInput,
  adapter?: SupplyAdapter,
): Promise<BuildingDetailResult>
export async function getBuildingDetail(
  slug: string,
  ctx: SearchContext,
  inputOrAdapter: BuildingSupplyInput | SupplyAdapter = {},
  suppliedAdapter?: SupplyAdapter,
): Promise<BuildingDetailResult> {
  const adapter: SupplyAdapter = 'findEffectiveListingsByBuilding' in inputOrAdapter
    ? inputOrAdapter as SupplyAdapter
    : suppliedAdapter ?? getDefaultSupplyAdapter()
  const input: BuildingSupplyInput = 'findEffectiveListingsByBuilding' in inputOrAdapter
    ? {}
    : inputOrAdapter
  const buildingRaw = await adapter.findEffectiveBuildingBySlug(slug, ctx)
  if (!buildingRaw) {
    return { building: null, supply: emptyBuildingSupplySnapshot(ctx.asOf) }
  }
  const building = mapBuildingDetail(buildingRaw, ctx.asOf)
  const listingsRaw = await adapter.findEffectiveListingsByBuilding(
    buildingRaw.id,
    ctx,
  )
  const cards = mapListingsToCards(listingsRaw)
  return {
    building,
    supply: buildBuildingSupplySnapshot(cards, input, ctx.asOf),
  }
}

/**
 * 相关楼盘：同商圈（无商圈时同行政区）的当前有效公开楼盘，排除自身。
 */
export async function getRelatedBuildings(
  slug: string,
  ctx: SearchContext,
  options: Readonly<{ limit?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly BuildingSummaryViewModel[]> {
  const limit = normalizeRelatedBuildingLimit(options.limit)
  if (limit === 0) return []
  const current = await adapter.findEffectiveBuildingBySlug(slug, ctx)
  if (!current) return []
  const nearby = await adapter.findEffectiveBuildingsNear(current.id, ctx, limit)
  const summaries: BuildingSummaryViewModel[] = []
  for (const raw of nearby) {
    if (String(raw.id) === String(current.id)) continue
    const summary = mapBuildingSummary(raw)
    if (summary) summaries.push(summary)
  }
  return summaries.slice(0, Math.max(0, limit))
}

function normalizeRelatedBuildingLimit(limit: number | undefined): number {
  if (limit == null) return 6
  if (!Number.isFinite(limit)) return 0
  return Math.max(0, Math.floor(limit))
}

/**
 * 楼内房源列表（用于楼盘详情页楼内房源模块）
 *
 * 支持排除当前房源（避免在详情页推荐自己）。
 */
export async function getListingsByBuilding(
  buildingId: number | string,
  ctx: SearchContext,
  options: Readonly<{ excludeListingId?: number | string; sort?: ListingSort; limit?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly ListingCardViewModel[]> {
  const listingsRaw = await adapter.findEffectiveListingsByBuilding(
    buildingId,
    ctx,
    options.excludeListingId,
  )
  const cards = mapListingsToCards(listingsRaw)
  const lastEffAt = buildLastEffAtLookup(listingsRaw)
  const sorted = stableSortCards(cards, options.sort ?? 'recommended', lastEffAt)
  const limit = options.limit
  return limit != null && limit > 0 ? sorted.slice(0, limit) : sorted
}

/**
 * 相关推荐：同楼盘有效房源（排除当前房源）
 *
 * design.md §7.3、§5.4：相关推荐必须经过同一有效供给查询。
 */
export async function getRelatedListings(
  listingSlug: string,
  ctx: SearchContext,
  options: Readonly<{ limit?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly ListingCardViewModel[]> {
  const listing = await adapter.findEffectiveListingBySlug(listingSlug, ctx)
  if (!listing) return []
  const buildingRef = listing.building
  // building 关系可能为 id（depth=0）；过渡适配器返回 depth=2，已填充
  const buildingId =
    typeof buildingRef === 'object' && buildingRef !== null
      ? buildingRef.id
      : (buildingRef as number | string | null)
  if (buildingId == null) return []
  return getListingsByBuilding(
    buildingId,
    ctx,
    { excludeListingId: listing.id, sort: 'recommended', limit: options.limit ?? 6 },
    adapter,
  )
}

/**
 * 询盘目标有效性复核（用于 POST /api/inquiries 提交前）
 *
 * 返回 null 时调用方应将询盘转为通用需求路径，不创建有效房源兴趣关系。
 */
export async function assertEffectiveListing(
  slug: string,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<ListingCardViewModel | null> {
  const raw = await adapter.assertEffectiveListingBySlug(slug, ctx)
  if (!raw) return null
  return mapListingCard(raw)
}

/**
 * 询盘楼盘目标有效性复核。与房源复核共用 Public Catalog facade，
 * 使路由层不会接触 Payload 查询条件或原始文档。
 */
export async function assertEffectiveBuilding(
  slug: string,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<BuildingDetailViewModel | null> {
  const raw = await adapter.findEffectiveBuildingBySlug(slug, ctx)
  if (!raw) return null
  return mapBuildingDetail(raw, ctx.asOf)
}

/**
 * 房源列表页区域筛选选项。
 *
 * 列表页只需要公开可见区域，不应为筛选栏加载整套首页数据。
 */
export async function getListingDistrictOptions(
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly DistrictViewModel[]> {
  const districts = await adapter.findEffectiveDistricts(ctx)
  const result: DistrictViewModel[] = []
  for (const district of districts) {
    const mapped = mapDistrict(district)
    if (mapped) result.push(mapped)
  }
  return result
}

/**
 * 空搜索输入：解析空 URLSearchParams 得到的默认 ListingSearchInput。
 *
 * getHomepage 的全集房源查询（stats.listings / typeSummaries / nearbyListings 三个
 * 特性共用同一次 findEffectiveListings 调用）需要一个不带任何筛选条件的 input，
 * 提为模块级常量避免每次调用重复解析。
 */
const EMPTY_LISTING_INPUT = parseSearchInput(new URLSearchParams(''))

/**
 * 首页数据：精选房源 + 热门区域 + 精选楼盘 + 商圈卡 + 最新资讯
 *
 * design.md §5.2：精选、热门区域数量使用同一 asOf 与谓词。
 * T2 扩展：在原有两路查询基础上，并行拉取精选楼盘与最新资讯，
 * 并由精选楼盘按商圈派生代表封面，组装商圈卡（避免对全量房源做计数聚合）。
 * OPT-035 Task 3：追加一次全集 findEffectiveListings + findEffectiveBuildings
 *   + findCityCenter 查询，喂给 stats 计数 / typeSummaries 聚合 / nearbyListings
 *   三个特性——同一次查询喂三个特性，避免重复对全量房源做计数聚合。
 */
export async function getHomepage(
  ctx: SearchContext,
  options: Readonly<{
    featuredLimit?: number
    featuredBuildingsLimit?: number
    latestArticlesLimit?: number
    districtCardsLimit?: number
  }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<HomepageData> {
  const featuredLimit = options.featuredLimit ?? 8
  // 楼盘过取（默认 30）以获得足够商圈代表封面，首页精选展示再截 8 张
  const buildingsFetchLimit = Math.max(options.featuredBuildingsLimit ?? 30, featuredLimit)
  const articlesLimit = options.latestArticlesLimit ?? 5
  // 商圈卡默认 9 张：栅格 4 列、大卡占 2x2，1 大 + 8 小恰好填满 3 行。
  // 不设上限时商圈一多首页会被撑爆且末行留豁口（15 个商圈时末行只剩 2 张）。
  // 只截卡片区，不影响 districts（首页搜索框的区域下拉仍列出全部前台可见商圈）。
  const districtCardsLimit = options.districtCardsLimit ?? DEFAULT_DISTRICT_CARDS_LIMIT

  const [
    featuredListings,
    districts,
    businessAreas,
    featuredBuildings,
    latestArticles,
    allEffectiveListings,
    allEffectiveBuildings,
    cityCenter,
  ] = await Promise.all([
    adapter.findFeaturedListings(ctx, featuredLimit),
    adapter.findEffectiveDistricts(ctx),
    adapter.findEffectiveBusinessAreas(ctx),
    adapter.findFeaturedBuildings(ctx, buildingsFetchLimit),
    adapter.findLatestArticles(articlesLimit),
    // 一次全集查询喂三个特性：stats.listings 计数、typeSummaries 聚合、nearbyListings。
    // 口径与列表页 buildListingSearchSource 一致（同 findEffectiveListings + mapListingsToCards）。
    adapter.findEffectiveListings(EMPTY_LISTING_INPUT, ctx),
    // 口径与楼盘列表页 searchBuildings 一致（findEffectiveBuildings 默认 limit 200）
    adapter.findEffectiveBuildings(ctx),
    adapter.findCityCenter ? adapter.findCityCenter(ctx) : Promise.resolve(null),
  ])

  const cards = mapListingsToCards(featuredListings)
  const lastEffAt = buildLastEffAtLookup(featuredListings)
  const sorted = stableSortCards(cards, 'recommended', lastEffAt)

  const districtVMs: DistrictViewModel[] = []
  for (const d of districts) {
    const vm = mapDistrict(d)
    if (vm) districtVMs.push(vm)
  }

  // 精选楼盘：先全部映射为 VM（带 district + coverImage），再按排序取前 N 张
  const buildingVMs: BuildingSummaryViewModel[] = []
  for (const b of featuredBuildings) {
    const vm = mapBuildingSummary(b)
    if (vm) buildingVMs.push(vm)
  }
  // 只对最终展示的切片聚合：楼盘是过取的（默认 30，供商圈封面挑选）
  const featuredBuildingSlice = await attachSupplyAggregates(
    buildingVMs.slice(0, featuredLimit),
    ctx,
    adapter,
  )

  // 商圈卡：按商圈（而非行政区）聚合。楼盘已按 recommendedOrder 排序，故同一
  // 商圈内首个命中的楼盘即代表封面，前几个名字即代表楼盘。
  const byArea = new Map<string, { cover: NonNullable<MediaViewModel> | null; names: string[] }>()
  for (const raw of featuredBuildings) {
    const ba = raw.businessDistrict
    if (typeof ba !== 'object' || ba === null) continue
    const slug = ba.slug
    if (!slug) continue
    const entry = byArea.get(slug) ?? { cover: null, names: [] }
    const vm = mapBuildingSummary(raw)
    if (!entry.cover && vm?.coverImage) entry.cover = vm.coverImage
    if (entry.names.length < AREA_CARD_BUILDINGS_MAX) entry.names.push(raw.name)
    byArea.set(slug, entry)
  }

  const districtCards: DistrictCardViewModel[] = []
  for (const area of businessAreas) {
    if (districtCards.length >= districtCardsLimit) break
    const areaVM = mapDistrict(area)
    if (!areaVM) continue
    const agg = byArea.get(areaVM.slug)
    // 质量门槛：库中商圈有 205 个而多数暂无楼盘，没有在营楼盘的不进卡片区，
    // 否则首页会出现只有名字的空卡。
    if (!agg || agg.names.length === 0) continue
    // 封面优先取运营在后台配置的商圈封面，缺省回退该商圈首个有封面的楼盘
    const cover = mapMedia(area.coverImage, area.name) ?? agg.cover ?? null
    const card = mapDistrictCard(area, cover, agg.names)
    if (card) districtCards.push(card)
  }

  const latestArticleVMs: ArticleCardViewModel[] = []
  for (const a of latestArticles) {
    const vm = mapArticleCard(a)
    if (vm) latestArticleVMs.push(vm)
  }

  // 全集卡片：喂 stats.listings / typeSummaries / nearbyListings 三个特性，
  // 与列表页 buildListingSearchSource 共用同一个 findEffectiveListings 口径。
  const allCards = mapListingsToCards(allEffectiveListings)

  const stats: HomepageStats = {
    listings: allCards.length,
    // 与楼盘列表页 searchBuildings 的 totalDocs = docs.length 同口径：mapBuildingSummary
    // 过滤后计数，不是原始 findEffectiveBuildings 返回长度。
    buildings: allEffectiveBuildings.filter((b) => mapBuildingSummary(b) !== null).length,
    // 与「全部 N 个商圈」链接口径一致：前台可见商圈总数，不受 districtCardsLimit 截断影响。
    businessAreas: businessAreas.length,
  }

  const typeSummaries: Record<string, HomepageTypeSummary> = {}
  for (const card of allCards) {
    const key = card.listingType
    if (!key) continue
    const prev = typeSummaries[key]
    typeSummaries[key] = {
      count: (prev?.count ?? 0) + 1,
      cover: prev?.cover ?? card.coverImage ?? null,
    }
  }

  // 核心商圈附近房源：排除已在精选区展示的房源（避免首页同一张卡片重复出现），
  // 按到城市中心的直线距离升序，tie-break 用 stableSortKey 保证跨请求稳定。
  const featuredSlugs = new Set(sorted.map((c) => c.slug))
  const nearbyListings: NearbyListingViewModel[] =
    cityCenter == null
      ? []
      : allCards
          .filter((c) => !featuredSlugs.has(c.slug) && c.building?.coordinates != null)
          .map((c) => ({
            ...c,
            distanceKm: Math.round(haversineKm(cityCenter, c.building!.coordinates!) * 10) / 10,
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm || a.stableSortKey.localeCompare(b.stableSortKey))
          .slice(0, 5)

  return {
    featuredListings: sorted,
    districts: districtVMs,
    featuredBuildings: featuredBuildingSlice,
    districtCards,
    latestArticles: latestArticleVMs,
    stats,
    typeSummaries,
    nearbyListings,
  }
}

/**
 * 平台汇总 stats（根页 `/` 口径）：并发拉取各城 stats，按同一口径逐城计数后求和。
 *
 * 与 getHomepage 内 stats 字段同口径（findEffectiveListings + mapListingsToCards /
 * findEffectiveBuildings + mapBuildingSummary 过滤 / findEffectiveBusinessAreas），
 * 只是维度从单城换成跨城求和——根页是平台入口，不归属任何单一城市。
 * 空城市清单直接返回全零，不触发任何 adapter 调用。
 */
export async function getPlatformHomepageStats(
  citySlugs: readonly string[],
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<HomepageStats> {
  const perCity = await Promise.all(
    citySlugs.map(async (slug) => {
      const ctx = createSearchContext(slug, undefined, 'lease')
      const [listings, buildings, areas] = await Promise.all([
        adapter.findEffectiveListings(EMPTY_LISTING_INPUT, ctx),
        adapter.findEffectiveBuildings(ctx),
        adapter.findEffectiveBusinessAreas(ctx),
      ])
      return {
        listings: mapListingsToCards(listings).length,
        buildings: buildings.filter((b) => mapBuildingSummary(b) !== null).length,
        businessAreas: areas.length,
      }
    }),
  )
  return perCity.reduce(
    (acc, s) => ({
      listings: acc.listings + s.listings,
      buildings: acc.buildings + s.buildings,
      businessAreas: acc.businessAreas + s.businessAreas,
    }),
    { listings: 0, buildings: 0, businessAreas: 0 },
  )
}

/**
 * 可从 `ListingSearchInput` 上剥离的筛选维度。
 *
 * 一个维度对应「用户在界面上做的一次选择」，而不是一个字段名——价格是
 * `priceMin`/`priceMax` 两个字段、单位是 `priceUnit` 连带派生的
 * `pricePeriod`/`priceBasis` 三个字段。按维度而不是按字段剥离，调用方才不需要
 * 知道哪些字段是同一次选择投影出来的（漏剥一个派生字段不会报错，只会算出一个
 * 半剥离的错口径）。
 */
export type ListingSearchDimension =
  | 'priceUnit'
  | 'district'
  | 'businessArea'
  | 'metro'
  | 'listingType'
  | 'price'
  | 'area'
  | 'availableBefore'
  | 'q'

/**
 * 从搜索输入里剥掉指定维度，其余条件原样保留。
 *
 * **为什么需要它（剥 `priceUnit` 这一条尤其关键）**：`getSearchFacets` 构造的
 * `facetInput = { ...input, page: 1, sort: 'recommended' }` **保留了 `priceUnit`**。
 * 于是用户一旦选中某个计价单位，`findEffectiveListings` 就只返回该单位的房源，
 * 其余单位的计数恒为 0 —— 列表页的「另有 N 套按 X 报价，因单位不可换算未计入
 * 本结果集」提示条会因为全部计数为 0 而 `return null`，那条诚实提示**永远不出现，
 * 且不报任何错**。而结果集只含一种单位正是本页比价机制的代价，没有这条提示，
 * 机制就从「帮用户比价」变成「悄悄藏起大部分库存」。
 *
 * 正确口径是：算各单位计数时剥掉 `priceUnit`，**其余筛选条件（区域/类型/价格
 * 区间/面积/关键词/可入驻时间）全部保留**——用户要看到的是「另有 536 套按
 * 元/月 报价（且符合他其余的条件）」，不是全库总数。这与 Task 2 的
 * 「facets 必须算在筛选之前，否则选中一项后其余项自我擦除」是同一个病。
 *
 * 同理适用于筛选条各行的候选计数（算「黄浦有多少套」时必须先剥掉当前已选的
 * 区域）和空态②的逐条退路命中数（算「放宽面积后有多少套」时剥掉面积）。
 *
 * 剥掉 `priceUnit` 时必须连带处理两件事，否则得到的是半剥离的错口径：
 *   1. `pricePeriod` / `priceBasis` 是 `priceUnit` 的派生投影，一起删；
 *   2. 价格排序（`price-asc`/`price-desc`）在缺 `priceUnit` 时不可比，
 *      与解析层 `normalizeSort` 同一口径降级为 `recommended`。
 */
export function omitListingSearchDimensions(
  input: ListingSearchInput,
  dimensions: readonly ListingSearchDimension[],
): ListingSearchInput {
  const drop = new Set<ListingSearchDimension>(dimensions)
  const next: Record<string, unknown> = { ...input }

  if (drop.has('priceUnit')) {
    delete next.priceUnit
    delete next.pricePeriod
    delete next.priceBasis
  }
  if (drop.has('district')) delete next.district
  if (drop.has('businessArea')) delete next.businessArea
  if (drop.has('metro')) delete next.metro
  if (drop.has('listingType')) delete next.listingType
  if (drop.has('price')) {
    delete next.priceMin
    delete next.priceMax
  }
  if (drop.has('area')) {
    delete next.areaMin
    delete next.areaMax
  }
  if (drop.has('availableBefore')) delete next.availableBefore
  if (drop.has('q')) delete next.q

  if (next.priceUnit == null && (next.sort === 'price-asc' || next.sort === 'price-desc')) {
    next.sort = 'recommended'
  }

  return next as unknown as ListingSearchInput
}

/**
 * 剥掉指定维度后的 facet 统计。
 *
 * 剥离理由与语义见 `omitListingSearchDimensions` 的注释——本函数只是把
 * 「先剥离、再按同一口径统计」这两步固定在域层，避免调用方在编排层各自拼一份
 * 剥离逻辑（漏剥 `pricePeriod` 之类的派生字段不会报错，只会静默算错）。
 *
 * 与 `getSearchFacets` 共用同一条查询路径与 asOf，因此这里算出来的 `totalDocs`
 * 与「用户真的把那个条件去掉后打开列表页」看到的总数完全一致——空态②承诺的
 * 「数字是放宽后的真实命中数，不是估算」靠的就是这一点。
 */
export async function getSearchFacetsIgnoring(
  input: ListingSearchInput,
  ctx: SearchContext,
  dimensions: readonly ListingSearchDimension[],
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<SearchFacets> {
  return getSearchFacets(omitListingSearchDimensions(input, dimensions), ctx, adapter)
}

/**
 * 搜索 facet：当前可见房源的分布统计
 *
 * design.md §5.3、§7：facet 必须复用同一 asOf 与谓词，不允许独立查询。
 *
 * 实现策略：
 *   - 复用 adapter.findEffectiveListings（不带分页约束）；
 *   - 在内存中按 district / listingType / rentUnit 聚合。
 *
 * 注意：facet 跟随当前搜索条件（findEffectiveListings(facetInput)），
 * totalDocs 与列表页 searchListings 使用同一筛选口径，保证 N 一致
 * （OPT-009 移动筛选估算复用此口径）。
 */
export async function getSearchFacets(
  input: ListingSearchInput,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<SearchFacets> {
  // facet 查询使用宽松 input（去除分页与排序），保证总数与列表一致
  const facetInput: ListingSearchInput = {
    ...input,
    page: 1,
    sort: 'recommended',
  }
  const rawListings = await adapter.findEffectiveListings(facetInput, ctx)
  const cards = mapListingsToCards(rawListings)

  const districtCounts = new Map<string, { vm: DistrictViewModel; count: number }>()
  const listingTypeCounts = new Map<string, number>()
  const rentUnitCounts = new Map<string, number>()

  for (const c of cards) {
    if (c.building?.district) {
      const key = c.building.district.slug
      const existing = districtCounts.get(key)
      if (existing) {
        existing.count += 1
      } else {
        districtCounts.set(key, { vm: c.building.district, count: 1 })
      }
    }
    if (c.listingType) {
      listingTypeCounts.set(c.listingType, (listingTypeCounts.get(c.listingType) ?? 0) + 1)
    }
    if (c.price) {
      rentUnitCounts.set(c.price.displayUnit, (rentUnitCounts.get(c.price.displayUnit) ?? 0) + 1)
    }
  }

  return {
    districts: Array.from(districtCounts.values()).map(({ vm, count }) => ({
      ...vm,
      count,
    })),
    listingTypes: Array.from(listingTypeCounts.entries()).map(([value, count]) => ({
      value,
      count,
    })),
    rentUnits: Array.from(rentUnitCounts.entries()).map(([value, count]) => ({
      value,
      count,
    })),
    totalDocs: cards.length,
  }
}

/**
 * 按 slug 获取全站已发布内容页详情；草稿/删除/不存在返回 null
 *
 * F6.1：内容页路由 /pages/[slug] 与首页 slug='home' 渲染入口。
 * SupplyAdapter 已过滤 status=published + 未逻辑删除；mapper 进一步投影字段白名单。
 * 返回 null 时路由层应调用 notFound()。
 */
export async function getPageBySlug(
  slug: string,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<PageDetailViewModel | null> {
  const raw = await adapter.findPublishedPageBySlug(slug)
  if (!raw) return null
  return mapPageDetail(raw)
}

/**
 * 列出全站所有已发布公开页面（用于 sitemap）
 *
 * F6.4：sitemap 调用此方法生成 /pages/<slug> URL。
 * home slug 由调用方转换为 /（不重复 /pages/home）。
 */
export async function listPublishedPages(
  options: Readonly<{ limit?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly PageSummaryViewModel[]> {
  const pages = await adapter.findPublishedPages(options.limit)
  const summaries: PageSummaryViewModel[] = []
  for (const p of pages) {
    const s = mapPageSummary(p)
    if (s) summaries.push(s)
  }
  return summaries
}

/**
 * 全站资讯详情：/news/[slug]
 *
 * 仅返回已发布资讯；草稿、删除、不存在返回 null。
 */
export async function getArticleBySlug(
  slug: string,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<ArticleDetailViewModel | null> {
  const raw = await adapter.findPublishedArticleBySlug(slug)
  if (!raw) return null
  return mapArticleDetail(raw)
}

/**
 * 全站资讯列表：/news 列表页（分页）
 *
 * 仅返回已发布资讯，按 publishedAt 倒序。page 从 1 起。
 */
export async function listPublishedArticles(
  options: Readonly<{ page?: number; pageSize?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<ArticleListResult> {
  const { docs, totalDocs } = await adapter.findPublishedArticles(options)
  const cards: ArticleCardViewModel[] = []
  for (const a of docs) {
    const vm = mapArticleCard(a)
    if (vm) cards.push(vm)
  }
  const pageSize = Math.min(Math.max(options.pageSize ?? 12, 1), 48)
  const page = Math.max(options.page ?? 1, 1)
  const totalPages = Math.max(1, Math.ceil(totalDocs / pageSize))
  return { docs: cards, totalDocs, page, totalPages }
}


// ---------------------------------------------------------------------------
// 可解释情境推荐（P2 Task 5）
// ---------------------------------------------------------------------------

/**
 * 从原始 Listing 提取 building.businessDistrict 的 ID（关系可能是 number 或展开对象）
 */
function extractBuildingBusinessDistrictId(listing: Listing): number | null {
  const building = listing.building
  if (typeof building !== 'object' || building === null) return null
  const bd = (building as Building).businessDistrict
  if (typeof bd === 'number') return bd
  if (bd && typeof bd === 'object' && 'id' in bd) {
    const id = (bd as { id?: unknown }).id
    if (typeof id === 'number') return id
  }
  return null
}

/**
 * 从原始 Listing 提取 building.district 的 ID
 */
function extractBuildingDistrictId(listing: Listing): number | null {
  const building = listing.building
  if (typeof building !== 'object' || building === null) return null
  const d = (building as Building).district
  if (typeof d === 'number') return d
  if (d && typeof d === 'object' && 'id' in d) {
    const id = (d as { id?: unknown }).id
    if (typeof id === 'number') return id
  }
  return null
}

/**
 * 从原始 Listing 提取价格单位的 displayUnit 字符串
 */
function extractPriceUnit(listing: Listing): string | null {
  const price = listing.price
  if (!price) return null
  const unit = price.unit
  const period = price.period
  // listing.rentUnit 是 Payload 文档的旧字段（数据库列），与 URL 参数 priceUnit
  // 同名不同义，改名重构不涉及它。
  if (!unit || !period) return listing.rentUnit ?? null
  // 映射到 displayUnit 格式
  if (unit === 'sqm' && period === 'day') return 'rmb-sqm-day'
  if (unit === 'suite' && period === 'month') return 'rmb-month'
  if (unit === 'seat' && period === 'month') return 'rmb-seat-month'
  return listing.rentUnit ?? null
}

/**
 * 从原始 Listing 提取价格金额
 */
function extractPriceAmount(listing: Listing): number | null {
  if (listing.price?.amount != null) return listing.price.amount
  return listing.rent ?? null
}

/**
 * 把原始 Listing 转为推荐候选
 */
function listingToCandidate(listing: Listing): RecommendationCandidate {
  return {
    id: listing.id,
    listingType: listing.listingType,
    businessType: listing.businessType ?? 'lease',
    area: listing.area ?? null,
    priceAmount: extractPriceAmount(listing),
    priceUnit: extractPriceUnit(listing),
    buildingDistrictId: extractBuildingDistrictId(listing),
    buildingBusinessDistrictId: extractBuildingBusinessDistrictId(listing),
  }
}

/**
 * 从原始 Listing 提取 building.businessDistrict 的 slug（关系在 depth=3 时已展开为 Location 对象）
 */
function extractBuildingBusinessDistrictSlug(listing: Listing): string | null {
  const building = listing.building
  if (typeof building !== 'object' || building === null) return null
  const bd = (building as Building).businessDistrict
  if (bd && typeof bd === 'object' && 'slug' in bd) {
    const slug = (bd as { slug?: unknown }).slug
    if (typeof slug === 'string' && slug.length > 0) return slug
  }
  return null
}

/**
 * 从原始 Listing 提取 building.district 的 slug
 */
function extractBuildingDistrictSlug(listing: Listing): string | null {
  const building = listing.building
  if (typeof building !== 'object' || building === null) return null
  const d = (building as Building).district
  if (d && typeof d === 'object' && 'slug' in d) {
    const slug = (d as { slug?: unknown }).slug
    if (typeof slug === 'string' && slug.length > 0) return slug
  }
  return null
}

/**
 * 可解释情境推荐（P2 Task 5）
 *
 * 基于当前房源上下文，从同商圈/同行政区有效供给中确定性打分排序，
 * 返回最多 6 条推荐，每条附带可读理由。
 *
 * 不变量：
 *   - 不读取 cookie、localStorage、用户 ID、手机号
 *   - 不使用跨会话历史
 *   - 确定性：相同输入始终产出相同顺序
 *   - 只使用有效供给（复用 SupplyAdapter 有效供给谓词）
 *
 * @param listingSlug - 当前详情页房源 slug
 * @param ctx - 搜索上下文（asOf、city）
 * @param options - 可选参数
 * @param adapter - 供给适配器（可注入测试替身）
 */
export async function getDetailRecommendations(
  listingSlug: string,
  ctx: SearchContext,
  options: Readonly<{ limit?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly DetailRecommendationItem[]> {
  // 1. 加载当前房源原始文档（depth=3，含 building.businessDistrict）
  const currentListing = await adapter.findEffectiveListingBySlug(listingSlug, ctx)
  if (!currentListing) return []

  // 2. 构建推荐上下文
  const context: RecommendationContext = {
    currentListingId: currentListing.id,
    listingType: currentListing.listingType,
    businessType: currentListing.businessType ?? 'lease',
    area: currentListing.area ?? null,
    priceAmount: extractPriceAmount(currentListing),
    priceUnit: extractPriceUnit(currentListing),
    buildingDistrictId: extractBuildingDistrictId(currentListing),
    buildingBusinessDistrictId: extractBuildingBusinessDistrictId(currentListing),
  }

  // 3. 获取候选房源：同商圈或同行政区的有效供给
  //    优先使用 businessDistrict（商圈），fallback 到 district（行政区）
  //    findEffectiveListings 的 businessArea/district 参数使用 slug 字符串
  const businessDistrictSlug = extractBuildingBusinessDistrictSlug(currentListing)
  const districtSlug = extractBuildingDistrictSlug(currentListing)

  let candidateListings: readonly Listing[]
  if (businessDistrictSlug != null) {
    // 同商圈候选
    candidateListings = await adapter.findEffectiveListings(
      { businessArea: [businessDistrictSlug], page: 1, pageSize: 24 },
      ctx,
    )
  } else if (districtSlug != null) {
    // 同行政区候选
    candidateListings = await adapter.findEffectiveListings(
      { district: [districtSlug], page: 1, pageSize: 24 },
      ctx,
    )
  } else {
    // 无地理信息，退化为同楼盘
    const buildingRef = currentListing.building
    const buildingId =
      typeof buildingRef === 'object' && buildingRef !== null
        ? buildingRef.id
        : (buildingRef as number | string | null)
    if (buildingId == null) return []
    candidateListings = await adapter.findEffectiveListingsByBuilding(
      buildingId,
      ctx,
      currentListing.id,
    )
  }

  if (candidateListings.length === 0) return []

  // 4. 转为候选对象并打分
  const candidates = candidateListings.map(listingToCandidate)
  const ranked = rankDetailRecommendations(candidates, context)

  // 5. 限制数量
  const limit = options.limit ?? 6
  const topResults = ranked.slice(0, limit)

  // 6. 把获胜候选映射回 ListingCardViewModel
  const winnerIds = new Set(topResults.map((r) => r.candidate.id))
  const winnerListings = candidateListings.filter((l) => winnerIds.has(l.id))
  const cardMap = new Map<number, ListingCardViewModel>()
  for (const l of winnerListings) {
    const card = mapListingCard(l)
    if (card) cardMap.set(l.id, card)
  }

  // 7. 按打分顺序组装结果
  const items: DetailRecommendationItem[] = []
  for (const r of topResults) {
    const card = cardMap.get(r.candidate.id)
    if (card) {
      items.push({ card, reasonCodes: r.reasonCodes })
    }
  }

  return items
}
