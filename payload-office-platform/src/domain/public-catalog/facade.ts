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
import type { BuildingSearchDimension, BuildingSearchInput } from './building-search'
import {
  BUILDING_CLEARABLE_DIMENSIONS,
  applyBuildingFilters,
  omitBuildingSearchDimensions,
  partitionByStock,
  sortBuildings,
} from './building-search'
import {
  mapBuildingDetail,
  mapBuildingSummary,
  mapDistrict,
  mapDistrictCard,
  mapMedia,
  mapArticleCard,
  mapArticleDetail,
  mapListingCard,
  mapListingCoverFull,
  mapListingDetail,
  mapPageDetail,
  mapPageSummary,
} from './mappers'
import {
  buildCanonicalSearchParams,
  parseListingSearchInput,
} from './search-params'
import { paginate, stableSortCards } from './stable-sort'
import {
  applyMemoryFilters,
  computeFacets,
  rowToCandidate,
  rowsFromListings,
  selectListingPage,
  toScanInput,
  type ListingPageSelection,
  type ListingScanRow,
} from './listing-scan'
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

/** 楼盘列表页筛选/排序/分页结果（OPT-036 Task 2，Task 12 补分组与计数）。 */
export type BuildingFilteredResult = Readonly<{
  /**
   * 当前页文档，顺序即**合并后的序列**：有在租的排完才排暂无在租
   * （comp「分组不跨页拆分」）。视图层直接按顺序渲染，不再自己重排。
   */
  docs: readonly BuildingSummaryViewModel[]
  /**
   * 当前页的两个分组。分组发生在域层而不是视图层——视图若拿 `docs` 自己
   * `partitionByStock`，恰好也能得到同样的结果，但那等于把「先分组再分页」这条
   * 规则复制成两份实现，其中一份（视图）随时可能被改成「每组各自分页」而不报错。
   */
  groups: Readonly<{
    withStock: readonly BuildingSummaryViewModel[]
    withoutStock: readonly BuildingSummaryViewModel[]
  }>
  totalDocs: number
  /** 筛选后**全部页**里有在租的楼盘数（分组标题计数 / 「仅看有在租」开关计数）。 */
  withStockTotal: number
  /** 筛选后**全部页**里暂无在租的楼盘数。 */
  withoutStockTotal: number
  /** 不叠加任何筛选时的楼盘总数（空态主按钮「查看全部 N 个楼盘」/「清除全部条件 · N」）。 */
  unfilteredTotalDocs: number
  page: number
  totalPages: number
  /** 各筛选维度的候选值与命中数，供筛选条渲染与空态退路使用 */
  facets: Readonly<{
    districts: ReadonlyArray<{ slug: string; name: string; count: number }>
    grades: ReadonlyArray<{ value: string; count: number }>
    metros: ReadonlyArray<{ slug: string; name: string; count: number }>
  }>
  /**
   * 单独放宽某一个维度后的命中数（空态②逐条退路：「取消『位置：静安』这一个条件 → 12」）。
   * 六个维度恒有值，未生效的维度其值等于当前 `totalDocs`（放宽一个没生效的条件不改变结果）。
   */
  dimensionHits: Readonly<Record<BuildingSearchDimension, number>>
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
 * 给楼盘 VM 批量补上在租面积与在租套数（一次 SQL 聚合覆盖全部楼盘）。
 *
 * 曾用名 attachLeasableArea——只补面积时这个名字是准的，加了套数以后继续叫它
 * 就是误导，改名同时改了行为（两个字段一起补，不是分两次查）。
 *
 * 缺这两个字段的后果不只是少显示数字：楼盘列表页的 BuildingCompactRow
 * 会据此判定「暂无在租」并把该楼盘降权到紧凑行分组（OPT-036 Task 5/13；
 * 曾用 BuildingListCard 的 grayscale 封面方案，随该文件在 Task 13 一并删除）。
 * 首页与楼盘列表页必须走同一条聚合，否则同一楼盘在两个页面上结论相反。
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
 * 商圈卡**候选池**上限（OPT-060）。
 *
 * 这里返回的不是最终展示的张数：视图层（`CityHomeView`）会先按运营配置的
 * 「精选区域」重排，再截到 bento 的 5 个坑位。池子必须明显大于 5，否则精选
 * 区域只能调这 5 张的内部顺序、拉不进第 6 名的商圈——那正是 OPT-060 要修的缺陷。
 *
 * 上限 20 是权衡：库里前台可见商圈约两百个，全量返回会让首页 DTO 白白变大；
 * 而运营的精选区域上限是 12（`CitySiteProfiles.featuredRegions` 的 maxRows），
 * 20 足够覆盖。
 *
 * **质量门槛不在这里放宽**：无在营楼盘的商圈仍然不进池（见下面组装处），
 * 否则卡片点进去是空结果页。
 */
const DEFAULT_DISTRICT_CARD_POOL_LIMIT = 20

/** 每张商圈卡最多列出的代表楼盘名数量 */
const AREA_CARD_BUILDINGS_MAX = 4

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

/** 扫描提供方：给缓存层注入「已缓存的扫描」用（见 cached-queries.ts#getCachedListingScan）。 */
export type ListingScanProvider = (
  input: ListingSearchInput,
  ctx: SearchContext,
) => Promise<readonly ListingScanRow[]>

/**
 * 扫描房源：一次轻量扫描拿到紧凑行（OPT-068）。
 *
 * 生产适配器实现了 `scanEffectiveListings`（select / populate 收窄，只收扫描输入——
 * 剥掉区域 / 类型 / 价格这四个内存维度，见 listing-scan.ts 头注释）。测试 fake 只有
 * `findEffectiveListings` 时，把**完整** input 交给它、让它按自己的规则过滤（既有
 * fake 都是这么写的），再把结果投影成行；行上再应用一遍内存维度是幂等的。
 */
export async function scanListings(
  input: ListingSearchInput,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly ListingScanRow[]> {
  if (adapter.scanEffectiveListings) return adapter.scanEffectiveListings(toScanInput(input), ctx)
  return rowsFromListings(await adapter.findEffectiveListings(input, ctx))
}

/**
 * 按 id 回捞本页卡片，**按 ids 顺序**返回。
 *
 * 回捞再过一次完整有效供给谓词：扫描之后才失效（下架、商户停用、被举报暂停）的
 * 房源在这里被静默丢掉，页面上少一张卡而不是出现一张过期卡。
 */
export async function hydrateListingCards(
  ids: readonly number[],
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly ListingCardViewModel[]> {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  const docs = adapter.findEffectiveListingsByIds
    ? await adapter.findEffectiveListingsByIds(ids, ctx)
    : (await adapter.findEffectiveListings(EMPTY_LISTING_INPUT, ctx)).filter((l) => wanted.has(l.id))
  const byId = new Map<number, ListingCardViewModel>()
  for (const doc of docs) {
    const card = mapListingCard(doc)
    if (card) byId.set(card.id, card)
  }
  const cards: ListingCardViewModel[] = []
  for (const id of ids) {
    const card = byId.get(id)
    if (card) cards.push(card)
  }
  return cards
}

/** 把「本页选择」与回捞到的卡片拼成列表结果，canonical 仍由完整 input 派生。 */
export function assembleListingSearchResult(
  page: ListingPageSelection,
  cards: readonly ListingCardViewModel[],
  input: ListingSearchInput,
): ListingSearchResult {
  return {
    docs: cards,
    pagination: page.pagination,
    canonical: buildCanonicalSearchParams(input).toString(),
    filteredByRentUnit: page.filteredByRentUnit,
  }
}

/**
 * 搜索房源：返回分页卡片列表与 canonical URL
 *
 * 步骤（OPT-068 起）：
 *   1. scanListings → 紧凑扫描行（有效供给谓词已在适配器内完成）
 *   2. selectListingPage → 内存里做区域 / 类型 / 价格过滤、价格排序预处理、
 *      稳定排序（listing_id 收束）、分页，得到本页 id
 *   3. hydrateListingCards → 只对本页 id 回捞 depth 2 并映射卡片
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
  const rows = await scanListings(input, ctx, adapter)
  const page = selectListingPage(rows, input)
  const cards = await hydrateListingCards(page.ids, ctx, adapter)
  return assembleListingSearchResult(page, cards, input)
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
 * 计算各筛选维度的候选值与命中数。
 *
 * 调用方必须传入**剥掉本维度之后**的集合（见 searchBuildingsFiltered）：如果在
 * 完整 applyBuildingFilters 之后算 facets，选中一个区域后其它区域会因为已被过滤掉
 * 而从筛选条里消失（自我擦除 bug）。
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
 * 楼盘列表筛选/排序/分页/分组（OPT-036 Task 2 + Task 12）。
 *
 * 步骤：searchBuildings 取全集 → 逐维度剥离后算 facets 与退路命中数 →
 * applyBuildingFilters → sortBuildings → partitionByStock → **合并成一条序列
 * （有在租在前）后再分页** → 当前页再分一次组交给视图。
 *
 * 分页作用于合并后的序列，不是每组各自分页（comp「分组不跨页拆分：有在租的排完
 * 才排暂无在租」）。两组各自分页会让第 2 页同时出现「有在租第 25–48 个」和
 * 「暂无在租第 25–48 个」，翻页语义变成两条互不相干的游标。
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

  // 逐维度剥离：每个维度算一次「不含这一条时还剩什么」。同一次结果同时供给
  // 两处用途——筛选候选的计数（districts/grades/metros）与空态②的退路命中数——
  // 因此只做一趟，不是六次筛选 + 三次 facet。全部在内存里对 ≤200 条做过滤，
  // 与「多发几次查询」不是一个量级的代价，所以无条件计算，不按空态与否分支。
  const omitted = new Map<BuildingSearchDimension, readonly BuildingSummaryViewModel[]>()
  for (const dimension of BUILDING_CLEARABLE_DIMENSIONS) {
    omitted.set(dimension, applyBuildingFilters(allDocs, omitBuildingSearchDimensions(input, [dimension])))
  }
  const hitsOf = (dimension: BuildingSearchDimension) => omitted.get(dimension)?.length ?? 0

  // 候选**清单**取自全集，计数取自剥离后的子集：两者分开是必要的。只用剥离后的
  // 子集当清单，会在「其余条件已经把结果筛空」时让候选整个消失——包括用户此刻选中
  // 的那一个（如 ?district=jingan&completedAfter=2020 一个都不剩时，筛选条里连
  // 「静安」都不见了，选中状态只活在地址栏里，用户看不见也单独清不掉）。
  // 用全集当清单则永远认得每个候选的名字，计数为 0 的非选中项由视图层按
  // 「不显示 0」丢弃，选中项保留。
  const allFacets = buildBuildingFacets(allDocs)
  const overlay = <T extends { count: number }>(
    universe: readonly T[],
    subset: readonly T[],
    keyOf: (entry: T) => string,
  ): T[] => {
    const counts = new Map(subset.map((entry) => [keyOf(entry), entry.count]))
    return universe.map((entry) => ({ ...entry, count: counts.get(keyOf(entry)) ?? 0 }))
  }
  const facetsOf = (dimension: 'district' | 'grade' | 'metro') =>
    buildBuildingFacets(omitted.get(dimension) ?? allDocs)
  const facets = {
    districts: overlay(allFacets.districts, facetsOf('district').districts, (d) => d.slug),
    grades: overlay(allFacets.grades, facetsOf('grade').grades, (g) => g.value),
    metros: overlay(allFacets.metros, facetsOf('metro').metros, (m) => m.slug),
  }
  const dimensionHits = {
    district: hitsOf('district'),
    grade: hitsOf('grade'),
    metro: hitsOf('metro'),
    leasableArea: hitsOf('leasableArea'),
    completedAfter: hitsOf('completedAfter'),
    onlyWithStock: hitsOf('onlyWithStock'),
  }

  const filtered = applyBuildingFilters(allDocs, input)
  const sorted = sortBuildings(filtered, input.sort)
  const { withStock, withoutStock } = partitionByStock(sorted)
  const merged = [...withStock, ...withoutStock]
  const { docs, totalDocs, totalPages } = paginate(merged, input.page, input.pageSize)
  return {
    docs,
    groups: partitionByStock(docs),
    totalDocs,
    withStockTotal: withStock.length,
    withoutStockTotal: withoutStock.length,
    unfilteredTotalDocs: allDocs.length,
    page: Math.max(1, input.page),
    totalPages,
    facets,
    dimensionHits,
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
    districtCardPoolLimit?: number
  }> = {},
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<HomepageData> {
  const featuredLimit = options.featuredLimit ?? 8
  // 楼盘过取（默认 30）以获得足够商圈代表封面，首页精选展示再截 8 张
  const buildingsFetchLimit = Math.max(options.featuredBuildingsLimit ?? 30, featuredLimit)
  const articlesLimit = options.latestArticlesLimit ?? 5
  // 商圈卡候选池（OPT-060）：视图层会先按精选区域重排、再截到 bento 的 5 个坑位，
  // 这里只限制池子上限，不是最终展示张数。不设上限时商圈一多首页 DTO 会被撑爆。
  // 只截卡片区，不影响 districts（首页搜索框的区域下拉仍列出全部前台可见商圈）。
  const districtCardPoolLimit = options.districtCardPoolLimit ?? DEFAULT_DISTRICT_CARD_POOL_LIMIT

  const [
    featuredListings,
    districts,
    businessAreas,
    featuredBuildings,
    latestArticles,
    allEffectiveRows,
    allEffectiveBuildings,
    cityCenter,
  ] = await Promise.all([
    adapter.findFeaturedListings(ctx, featuredLimit),
    adapter.findEffectiveDistricts(ctx),
    adapter.findEffectiveBusinessAreas(ctx),
    adapter.findFeaturedBuildings(ctx, buildingsFetchLimit),
    adapter.findLatestArticles(articlesLimit),
    // 一次全集**扫描**喂三个特性：stats.listings 计数、typeSummaries 聚合、nearbyListings。
    // OPT-068：口径与列表页一致（同 scanListings），但只取行不取整棵关系树——
    // 这条查询此前是首页冷路径最贵的一段，且每次发版缓存清零后必然重跑。
    scanListings(EMPTY_LISTING_INPUT, ctx, adapter),
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
    if (districtCards.length >= districtCardPoolLimit) break
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

  // 全集扫描行：喂 stats.listings / typeSummaries / nearbyListings 三个特性，
  // 与列表页共用同一个 scanListings 口径（OPT-068）。
  const stats: HomepageStats = {
    listings: allEffectiveRows.length,
    // 与楼盘列表页 searchBuildings 的 totalDocs = docs.length 同口径：mapBuildingSummary
    // 过滤后计数，不是原始 findEffectiveBuildings 返回长度。
    buildings: allEffectiveBuildings.filter((b) => mapBuildingSummary(b) !== null).length,
    // 与「全部 N 个商圈」链接口径一致：前台可见商圈总数，不受 districtCardPoolLimit 截断影响。
    businessAreas: businessAreas.length,
  }

  // typeSummaries 的封面走完整投影（含 variants/focal），不能复用 allCards 里
  // 的 card.coverImage——那是 mapListingCard 为房源列表页的 unstable_cache 全量
  // 数组缓存刻意剔掉 variants 后的收窄版（2MB 硬上限红线，见该函数注释），复用
  // 会让首页类型卡的 srcset 链路整条死掉。getHomepage 本身也经 unstable_cache
  // 缓存（见 cached-queries.ts 的 getCachedHomepage），但 typeSummaries 最多 5
  // 个条目、每个多带的 variants 约 300 字节，量级几 KB，远够不到上限，不构成
  // 体积风险，不必比照卡片链路收窄。
  // 按类型计数 + 每个类型挑一张封面来源（该类型里 id 最小的一条，确定性）。
  // OPT-068：计数在扫描行上做；封面需要完整投影（含 variants/focal），只对被选中的
  // 那 ≤4 条回捞——此前是对全集房源建 Map 再逐类型取一条，全集越大越贵。
  const typeCounts = new Map<string, number>()
  const typeCoverSourceId = new Map<string, number>()
  for (const row of allEffectiveRows) {
    const key = row.listingType
    if (!key) continue
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1)
    const current = typeCoverSourceId.get(key)
    if (current === undefined || row.id < current) typeCoverSourceId.set(key, row.id)
  }

  // 核心商圈附近房源：排除已在精选区展示的房源（避免首页同一张卡片重复出现），
  // 按到城市中心的直线距离升序，tie-break 用 id 保证跨请求稳定（此前用 stableSortKey，
  // 它由 id 派生，同序）。距离在扫描行上算，只对最终 5 条回捞卡片。
  const featuredSlugs = new Set(sorted.map((c) => c.slug))
  const nearbyRows = cityCenter == null
    ? []
    : allEffectiveRows
        .filter((row) => !featuredSlugs.has(row.slug) && row.coordinates != null)
        .map((row) => ({
          row,
          distanceKm: Math.round(haversineKm(cityCenter, row.coordinates!) * 10) / 10,
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm || a.row.id - b.row.id)
        .slice(0, 5)

  // 两处回捞合并成一次（类型封面 ≤4 条 + 附近房源 5 条），并保持各自的顺序。
  const coverIds = [...typeCoverSourceId.values()]
  const hydrateIds = [...new Set([...coverIds, ...nearbyRows.map((n) => n.row.id)])]
  const hydrateIdSet = new Set(hydrateIds)
  const hydrated = adapter.findEffectiveListingsByIds
    ? await adapter.findEffectiveListingsByIds(hydrateIds, ctx)
    : (await adapter.findEffectiveListings(EMPTY_LISTING_INPUT, ctx)).filter((l) => hydrateIdSet.has(l.id))
  const hydratedById = new Map(hydrated.map((doc) => [doc.id, doc] as const))

  const typeSummaries: Record<string, HomepageTypeSummary> = {}
  for (const [key, count] of typeCounts) {
    const sourceId = typeCoverSourceId.get(key)
    const raw = sourceId == null ? null : hydratedById.get(sourceId) ?? null
    typeSummaries[key] = {
      count,
      cover: raw ? mapListingCoverFull(raw) : null,
    }
  }

  const nearbyListings: NearbyListingViewModel[] = []
  for (const { row, distanceKm } of nearbyRows) {
    const raw = hydratedById.get(row.id)
    const card = raw ? mapListingCard(raw) : null
    if (card) nearbyListings.push({ ...card, distanceKm })
  }

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
 * 与 getHomepage 内 stats 字段同口径（OPT-068 起两边都走 scanListings /
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
      const [rows, buildings, areas] = await Promise.all([
        // OPT-068：跨城汇总只要三个数，走扫描而不是全量文档拉取。
        scanListings(EMPTY_LISTING_INPUT, ctx, adapter),
        adapter.findEffectiveBuildings(ctx),
        adapter.findEffectiveBusinessAreas(ctx),
      ])
      return {
        listings: rows.length,
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
 * 剥掉 `priceUnit` 时必须连带处理三件事，否则得到的是半剥离的错口径：
 *   1. `pricePeriod` / `priceBasis` 是 `priceUnit` 的派生投影，一起删；
 *   2. 价格排序（`price-asc`/`price-desc`）在缺 `priceUnit` 时不可比，
 *      与解析层 `normalizeSort` 同一口径降级为 `recommended`；
 *   3. 价格区间 `priceMin` / `priceMax` 同样跟着删——区间的量纲**就是**那个被剥掉的
 *      单位。留着它得到的是一个违反 `ListingSearchInput` 声明约束的半成品输入
 *      （区间无单位），而且语义上说不通：算「另有 N 套按元/月报价」时，用户那条
 *      3~6 元/㎡/天 的区间套到元/月的金额上恒为空，提示条会重新退化成 0。
 *      `supply-adapter#filterByPriceRange` 对缺单位的区间本就整段忽略，所以这一删
 *      不改变任何计数；它消除的是「缓存键（canonical 已抑制区间）与 input（还带着
 *      区间）不同构」这个静默错配。
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
    // 区间的量纲就是刚被剥掉的那个单位，跟着走（理由见上方注释第 3 条）。
    delete next.priceMin
    delete next.priceMax
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
  // OPT-068：与列表共用同一份扫描（同城同频道下区域 / 类型 / 价格的任意组合都
  // 命中同一条扫描缓存），聚合在 listing-scan.ts#computeFacets，与列表口径逐字段等价。
  const rows = await scanListings(facetInput, ctx, adapter)
  return computeFacets(applyMemoryFilters(rows, facetInput))
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

// OPT-068：`listingToCandidate` / `extractBuildingBusinessDistrictSlug` /
// `extractBuildingDistrictSlug` 随推荐改吃扫描行一并删除——候选现在由
// `listing-scan.ts#rowToCandidate` 产出，商圈 / 行政区按 **id** 匹配（行上就有），
// 不再需要从 depth 3 文档里刨 slug 再回头查一遍库。

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
 * OPT-068：候选不再为每个商圈 / 行政区各打一次全量查询，而是复用整城扫描
 * （`options.scan` 注入的是**已缓存**的扫描，见 cached-queries.ts），在行上按
 * 商圈 → 行政区 → 同楼盘的优先级挑候选。打分与理由码不变；获胜的 ≤6 条再回捞卡片。
 *
 * @param listingSlug - 当前详情页房源 slug
 * @param ctx - 搜索上下文（asOf、city）
 * @param options - 可选参数；`scan` 缺省用 `scanListings`
 * @param adapter - 供给适配器（可注入测试替身）
 */
export async function getDetailRecommendations(
  listingSlug: string,
  ctx: SearchContext,
  options: Readonly<{ limit?: number; scan?: ListingScanProvider }> = {},
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

  // 3. 候选房源：从整城扫描里按 商圈 → 行政区 → 同楼盘 的优先级挑
  //    （OPT-068 前是各打一次不分页 depth 2 全量查询，详情页冷开 3–4 秒的主因）
  const scan = options.scan ?? ((input, scanCtx) => scanListings(input, scanCtx, adapter))
  const rows = await scan(EMPTY_LISTING_INPUT, ctx)
  const businessDistrictId = context.buildingBusinessDistrictId
  const districtId = context.buildingDistrictId
  const currentBuildingId = toBuildingId(currentListing.building)

  let candidateRows: readonly ListingScanRow[]
  if (businessDistrictId != null) {
    candidateRows = rows.filter((row) => row.businessDistrictId === businessDistrictId)
  } else if (districtId != null) {
    candidateRows = rows.filter((row) => row.district?.id === districtId)
  } else if (currentBuildingId != null) {
    candidateRows = rows.filter((row) => row.buildingId === currentBuildingId)
  } else {
    return []
  }

  if (candidateRows.length === 0) return []

  // 4. 转为候选对象并打分（打分本身排除当前房源）
  const ranked = rankDetailRecommendations(candidateRows.map(rowToCandidate), context)

  // 5. 限制数量
  const limit = options.limit ?? 6
  const topResults = ranked.slice(0, limit)
  if (topResults.length === 0) return []

  // 6. 只对获胜的 ≤6 条回捞卡片
  const cards = await hydrateListingCards(topResults.map((r) => r.candidate.id), ctx, adapter)
  const cardMap = new Map(cards.map((card) => [card.id, card] as const))

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

/** 从 Listing.building（可能是 id 或已展开文档）取数字 id。 */
function toBuildingId(buildingRef: Listing['building']): number | null {
  if (typeof buildingRef === 'number') return buildingRef
  if (typeof buildingRef === 'object' && buildingRef !== null && typeof buildingRef.id === 'number') {
    return buildingRef.id
  }
  return null
}
