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
  DistrictViewModel,
  ListingCardViewModel,
  ListingDetailViewModel,
  MediaViewModel,
  PageDetailViewModel,
  PageSummaryViewModel,
} from './contracts'
import {
  mapBuildingDetail,
  mapBuildingSummary,
  mapDistrict,
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
  isSameRentUnit,
  paginate,
  stableSortCards,
} from './stable-sort'
import type { ListingSort, ListingSearchInput, Pagination, SearchContext } from './types'
import type { SupplyAdapter } from './supply-adapter'
import { getDefaultSupplyAdapter } from './supply-adapter'

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

/** 首页数据：精选房源 + 热门区域 */
export type HomepageData = Readonly<{
  featuredListings: readonly ListingCardViewModel[]
  districts: readonly DistrictViewModel[]
}>

/** 搜索 facet：当前可见房源的分布统计 */
export type SearchFacets = Readonly<{
  districts: ReadonlyArray<DistrictViewModel & { count: number }>
  listingTypes: ReadonlyArray<{ value: string; count: number }>
  rentUnits: ReadonlyArray<{ value: string; count: number }>
  totalDocs: number
}>

/** 楼盘详情聚合：楼盘 + 楼内房源 + 价格区间 */
export type BuildingDetailResult = Readonly<{
  building: BuildingDetailViewModel | null
  listings: readonly ListingCardViewModel[]
  /** 按相同 rentUnit 分组的价格区间；跨单位不合并 */
  priceRanges: ReadonlyArray<{
    unit: string
    min: number
    max: number
    count: number
  }>
}>

/** 楼盘详情页（不含房源聚合）：仅楼盘 DTO */
export type BuildingDetailPageResult = Readonly<{
  building: BuildingDetailViewModel | null
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
  if (input.sort !== 'rent-asc' && input.sort !== 'rent-desc') {
    return { cards: cards.slice(), filteredByRentUnit: false }
  }
  // 已显式选定 rentUnit：直接按该单位过滤
  if (input.rentUnit) {
    return {
      cards: filterByRentUnit(cards, input.rentUnit),
      filteredByRentUnit: cards.length > 0 && cards[0].price?.unit !== input.rentUnit,
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
    cards: filterByRentUnit(cards, firstWithPrice.price.unit),
    filteredByRentUnit: true,
  }
}

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
  const rawListings = await adapter.findEffectiveListings(input, ctx)
  const cards = mapListingsToCards(rawListings)
  const { cards: sortTarget, filteredByRentUnit } = prepareCardsForPriceSort(cards, input)
  const lastEffAt = buildLastEffAtLookup(rawListings)
  const sorted = stableSortCards(sortTarget, input.sort ?? 'recommended', lastEffAt)
  const paged = paginate(sorted, input.page, input.pageSize)

  return {
    docs: paged.docs,
    pagination: buildPagination(paged.totalDocs, input.page, input.pageSize),
    canonical: buildCanonicalSearchParams(input).toString(),
    filteredByRentUnit,
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
  return mapBuildingDetail(raw)
}

/**
 * 楼盘详情聚合：楼盘 + 楼内有效房源 + 按 rentUnit 分组价格区间
 *
 * design.md §5.5：不同币种、租售类型或租赁单位不得合并成一个价格区间。
 */
export async function getBuildingDetail(
  slug: string,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<BuildingDetailResult> {
  const buildingRaw = await adapter.findEffectiveBuildingBySlug(slug, ctx)
  if (!buildingRaw) {
    return { building: null, listings: [], priceRanges: [] }
  }
  const building = mapBuildingDetail(buildingRaw)
  const listingsRaw = await adapter.findEffectiveListingsByBuilding(
    buildingRaw.id,
    ctx,
  )
  const cards = mapListingsToCards(listingsRaw)
  const lastEffAt = buildLastEffAtLookup(listingsRaw)
  const sorted = stableSortCards(cards, 'recommended', lastEffAt)
  return {
    building,
    listings: sorted,
    priceRanges: buildPriceRangesByUnit(sorted),
  }
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
 * 首页数据：精选房源 + 热门区域
 *
 * design.md §5.2：精选、热门区域数量使用同一 asOf 与谓词。
 */
export async function getHomepage(
  ctx: SearchContext,
  options: Readonly<{ featuredLimit?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<HomepageData> {
  const [featuredListings, districts] = await Promise.all([
    adapter.findFeaturedListings(ctx, options.featuredLimit ?? 6),
    adapter.findEffectiveDistricts(ctx),
  ])
  const cards = mapListingsToCards(featuredListings)
  const lastEffAt = buildLastEffAtLookup(featuredListings)
  const sorted = stableSortCards(cards, 'recommended', lastEffAt)
  const districtVMs: DistrictViewModel[] = []
  for (const d of districts) {
    const vm = mapDistrict(d)
    if (vm) districtVMs.push(vm)
  }
  return {
    featuredListings: sorted,
    districts: districtVMs,
  }
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
 * 注意：MVP 阶段 facet 不随搜索条件变化（仅基于全量有效房源）；
 * 若需 facet 跟随当前条件，需在 adapter 层增加 facet 专用方法（M4.7 后）。
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
      rentUnitCounts.set(c.price.unit, (rentUnitCounts.get(c.price.unit) ?? 0) + 1)
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
 * 按 slug 获取已发布的内容页详情；草稿/删除/不存在返回 null
 *
 * F6.1：内容页路由 /pages/[slug] 与首页 slug='home' 渲染入口。
 * SupplyAdapter 已过滤 status=published + 未逻辑删除；mapper 进一步投影字段白名单。
 * 返回 null 时路由层应调用 notFound()。
 */
export async function getPageBySlug(
  slug: string,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<PageDetailViewModel | null> {
  const raw = await adapter.findPublishedPageBySlug(slug, ctx)
  if (!raw) return null
  return mapPageDetail(raw)
}

/**
 * 列出所有已发布的公开页面（用于 sitemap）
 *
 * F6.4：sitemap 调用此方法生成 /pages/<slug> URL。
 * home slug 由调用方转换为 /（不重复 /pages/home）。
 */
export async function listPublishedPages(
  ctx: SearchContext,
  options: Readonly<{ limit?: number }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly PageSummaryViewModel[]> {
  const pages = await adapter.findPublishedPages(ctx, options.limit ?? 1000)
  const summaries: PageSummaryViewModel[] = []
  for (const p of pages) {
    const s = mapPageSummary(p)
    if (s) summaries.push(s)
  }
  return summaries
}

// ---------------------------------------------------------------------------
// 工具：按 rentUnit 分组价格区间
// ---------------------------------------------------------------------------

/**
 * 按 rentUnit 分组计算价格区间
 *
 * design.md §5.5：不同币种、租售类型或租赁单位不得合并成一个价格区间。
 */
function buildPriceRangesByUnit(
  cards: readonly ListingCardViewModel[],
): ReadonlyArray<{ unit: string; min: number; max: number; count: number }> {
  const groups = new Map<string, { min: number; max: number; count: number }>()
  for (const c of cards) {
    if (!c.price) continue
    const unit = c.price.unit
    const existing = groups.get(unit)
    if (existing) {
      existing.min = Math.min(existing.min, c.price.amount)
      existing.max = Math.max(existing.max, c.price.amount)
      existing.count += 1
    } else {
      groups.set(unit, {
        min: c.price.amount,
        max: c.price.amount,
        count: 1,
      })
    }
  }
  return Array.from(groups.entries()).map(([unit, r]) => ({
    unit,
    ...r,
  }))
}
