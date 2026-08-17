/**
 * 公开目录查询供给适配器（Supply Adapter）
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§8、§17；specs/backend-mvp M4.7
 *
 * 职责：
 *   - 定义 Facade 与"统一有效供给服务"之间的契约接口；
 *   - 提供生产实现 `createPayloadSupplyAdapter()`：查询层用 `getEffectiveSupplyWhere`
 *     粗筛 + `getPausedListingIds` 排除举报暂停，取候选后批量 `resolveEffectiveSupplies`
 *     精筛（媒体 §6 / 关系 §8 / 商户 §9-§10），保证前台、预览、楼盘聚合、Dashboard
 *     对同一房源可见性结论一致（M4 验收门）。
 *
 * 守护不变量（FRONTEND_AGENT.md §6.1）：
 *   - 适配器是 Facade 唯一的数据入口，禁止在 Facade 内部直接拼 Payload where；
 *   - 有效供给判定统一走 `@/domain/review/effective-supply` 谓词，绝不内联旧
 *     `status=available` 口径（F1.6：过渡适配器已删除）。
 *
 * 注意：
 *   - 接口返回 `Listing` / `Building` / `Location` 原始 Payload 文档；
 *   - Facade 在拿到文档后立即通过 mapper 投影为 DTO，组件不消费原始文档；
 *   - 精筛在适配器内部完成，Facade 只负责内存排序与分页。
 *
 * MVP 计数口径：列表 / 楼内房源取候选（limit 上限 500）后精筛数长度，
 *   与前台 / 详情完全一致；超过 500 的极端场景会封顶，属后续优化点。
 */

import type { PopulateType, Where } from 'payload'
import type { Building, Listing, Location, Page, Article } from '@/payload-types'
import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
} from '@/domain/review/effective-supply'
import { createEffectiveSupplyPayloadPort } from '@/domain/review/effective-supply-payload-port'
import {
  resolveEffectiveSupplies,
  toId,
} from '@/domain/review/effective-supply-snapshot'
import {
  getPublicBuildingWhere,
  isPublicBuilding,
} from '@/domain/supply/public-building'
import { createSearchContext, type SearchContext, type ListingSearchInput } from './types'
import type { PublicRouteIdentity } from './contracts'
import { mapBuildingCity } from './mappers'

/**
 * 公开目录供给适配器契约
 *
 * 所有方法都接受 SearchContext，确保子查询在同一 asOf / 时区 / 渠道下解析。
 * 返回的文档视为"已过有效供给谓词"；任何失效场景返回空数组或 null，不抛错。
 */
export interface SupplyAdapter {
  /** 按搜索条件返回有效房源文档（已过谓词，未排序、未分页） */
  findEffectiveListings(input: ListingSearchInput, ctx: SearchContext): Promise<readonly Listing[]>

  /** 按 slug 返回单个有效房源；不存在或失效返回 null */
  findEffectiveListingBySlug(slug: string, ctx: SearchContext): Promise<Listing | null>

  /** Cityless legacy-route exception; returns no display or inventory data. */
  findListingRouteIdentity(slug: string): Promise<PublicRouteIdentity | null>

  /** 按 slug 返回有效楼盘；停用、不存在返回 null */
  findEffectiveBuildingBySlug(slug: string, ctx: SearchContext): Promise<Building | null>

  /** Cityless legacy-route exception; returns no display or inventory data. */
  findBuildingRouteIdentity(slug: string): Promise<PublicRouteIdentity | null>

  /** 楼盘内有效房源（用于楼内列表、聚合和相关推荐） */
  findEffectiveListingsByBuilding(
    buildingId: number | string,
    ctx: SearchContext,
    excludeListingId?: number | string,
  ): Promise<readonly Listing[]>

  /**
   * 批量聚合多个楼盘的在租面积（楼盘卡片「在租 xxx ㎡」用）。
   *
   * 返回 Map<楼盘 id, 面积合计>；无有效房源的楼盘不出现在 Map 中，调用方据此
   * 判定「暂无在租」。
   *
   * 与 findEffectiveListingsByBuilding 的区别：本方法只求一个数，不需要把房源
   * 文档取出来。实现走 SQL 聚合，口径与逐条精筛一致（见实现处的规则对照与
   * scripts/verify-leasable-area-parity.ts 的全量比对）。
   */
  sumEffectiveLeasableAreaByBuildings(
    buildingIds: readonly (number | string)[],
    ctx: SearchContext,
  ): Promise<ReadonlyMap<string, number>>

  /** 当前楼盘周边的有效公开楼盘（排除自身，稳定收束）。 */
  findEffectiveBuildingsNear(
    buildingId: number | string,
    ctx: SearchContext,
    limit: number,
  ): Promise<readonly Building[]>

  /** 返回所有有效公开楼盘（用于楼盘列表页，按 updatedAt 倒序） */
  findEffectiveBuildings(ctx: SearchContext, limit?: number): Promise<readonly Building[]>

  /** 返回一页有效公开楼盘（用于 sitemap 等有界全量枚举）。 */
  findEffectiveBuildingsPage(
    ctx: SearchContext,
    options: Readonly<{ page: number; limit: number }>,
  ): Promise<EffectiveBuildingPage>

  /** 首页精选有效房源（按 isFeatured + updatedAt desc） */
  findFeaturedListings(ctx: SearchContext, limit?: number): Promise<readonly Listing[]>

  /** 当前城市的有效行政区列表（用于 facet 和筛选器） */
  findEffectiveDistricts(ctx: SearchContext): Promise<readonly Location[]>

  /**
   * 当前城市的前台可见商圈（用于首页「热门商圈」）。
   *
   * 商圈是 Locations 的第三层（城市 > 行政区 > 商圈），与行政区是包含关系而非
   * 同一层——首页此前误用行政区，导致「热门商圈」列出的是黄浦、徐汇这类行政区。
   * 库中商圈达 205 个且多数暂无楼盘，故一律要求 frontendVisible=true，由运营
   * 按需放出。
   */
  findEffectiveBusinessAreas(ctx: SearchContext): Promise<readonly Location[]>

  /** 按 listing slug 复核有效性（用于询盘目标校验）；不抛错，失效返回 null */
  assertEffectiveListingBySlug(slug: string, ctx: SearchContext): Promise<Listing | null>

  /**
   * 按 slug 返回全站已发布公开页面；草稿、删除或不存在返回 null
   *
   * F6.1：只读取 status=published 的页面，草稿/删除/不存在返回 null。
   * 用于内容页路由 /pages/[slug] 与首页 slug='home' 渲染。
   */
  findPublishedPageBySlug(slug: string): Promise<Page | null>

  /**
   * 返回全站所有已发布公开页面（用于 sitemap）
   *
   * F6.4：仅返回 status=published 且未逻辑删除的页面，按 updatedAt 倒序。
   * limit 用于规模拆分；MVP 单文件 sitemap，默认 1000。
   */
  findPublishedPages(limit?: number): Promise<readonly Page[]>

  /**
   * 首页精选楼盘（用于「精选楼盘」分区）
   *
   * 仅返回有封面的公开楼盘（公开判定走 `getPublicBuildingWhere`）。
   * 排序：recommendedOrder 升序在前（PG ASC 默认 NULLS LAST，未设置的排后），
   * updatedAt 倒序兜底，保证既有运营手填权重、又有近更新自然顺序。
   * depth=2 以便 coverImage / district 在 mapper 一次填充到位。
   */
  findFeaturedBuildings(ctx: SearchContext, limit?: number): Promise<readonly Building[]>

  /**
   * 全站首页资讯（用于「资讯中心」分区）
   *
   * 仅返回 status=published 且未逻辑删除的资讯，按 publishedAt 倒序。
   * depth=2 以便 coverImage 填充为 Media。草稿、未来发布、删除均不返回。
   */
  findLatestArticles(limit?: number): Promise<readonly Article[]>

  /**
   * 全站资讯列表（用于 /news 列表页，分页）
   *
   * 仅返回 status=published 且未逻辑删除的资讯，按 publishedAt 倒序。
   * page 从 1 起，pageSize 控制每页条数；depth=2 填充 coverImage。
   */
  findPublishedArticles(
    options: Readonly<{ page?: number; pageSize?: number }>,
  ): Promise<{ docs: readonly Article[]; totalDocs: number }>

  /**
   * 按 slug 返回全站已发布资讯（用于 /news/[slug] 详情页）
   *
   * 仅 status=published 且未逻辑删除；depth=3 以便关联楼盘/区域填充。
   * 草稿、删除、不存在返回 null。
   */
  findPublishedArticleBySlug(slug: string): Promise<Article | null>
}

export type EffectiveBuildingPage = Readonly<{
  docs: readonly Building[]
  page: number
  hasNextPage: boolean
  nextPage: number | null
}>

/**
 * 适配器调用上下文：包含 search 输入与 SearchContext
 *
 * Facade 内部使用，将 input + ctx 一并传给 adapter。
 */
export type AdapterCallContext = {
  input: ListingSearchInput
  ctx: SearchContext
}

/**
 * 适配器工厂类型
 *
 * Facade 接受工厂函数（懒构造）或实例；默认使用 `createPayloadSupplyAdapter()`。
 */
export type SupplyAdapterFactory = () => SupplyAdapter

/**
 * 默认适配器实例（懒单例）
 *
 * 生产路径使用 PayloadSupplyAdapter（消费统一有效供给服务输出）。
 * 测试与页面可通过 setDefaultSupplyAdapterFactory 注入替换实现。
 */
let defaultAdapter: SupplyAdapter | null = null
let defaultFactory: SupplyAdapterFactory | null = null

export function setDefaultSupplyAdapterFactory(factory: SupplyAdapterFactory | null): void {
  defaultFactory = factory
  defaultAdapter = null
}

export function getDefaultSupplyAdapter(): SupplyAdapter {
  if (!defaultAdapter) {
    defaultAdapter = defaultFactory ? defaultFactory() : createPayloadSupplyAdapter()
  }
  return defaultAdapter
}

/**
 * 测试 / 预览用：重置默认适配器缓存
 *
 * 生产路径不应调用。
 */
export function __resetDefaultSupplyAdapterForTest(): void {
  defaultAdapter = null
}

// ---------------------------------------------------------------------------
// 生产实现：统一有效供给谓词 + 逐条精筛
// ---------------------------------------------------------------------------

const QUERY_PAGE_SIZE = 200
export const PUBLIC_CATALOG_CANDIDATE_LIMIT = 1_000
const RELATED_BUILDING_CANDIDATE_LIMIT = 500

const ROUTE_CITY_POPULATE = {
  locations: { name: true, slug: true, type: true, status: true },
} satisfies PopulateType

const LISTING_ROUTE_IDENTITY_POPULATE = {
  buildings: { city: true },
  ...ROUTE_CITY_POPULATE,
} satisfies PopulateType

type ListingRouteProjection = Readonly<{
  slug: string
  building: Record<string, unknown>
}>

type BuildingRouteProjection = Readonly<{
  slug: string
  city: Record<string, unknown>
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readListingRouteProjection(value: unknown): ListingRouteProjection | null {
  if (!isRecord(value) || typeof value.slug !== 'string' || !isRecord(value.building)) {
    return null
  }
  return { slug: value.slug, building: value.building }
}

function readBuildingRouteProjection(value: unknown): BuildingRouteProjection | null {
  if (!isRecord(value) || typeof value.slug !== 'string' || !isRecord(value.city)) {
    return null
  }
  return { slug: value.slug, city: value.city }
}

function proximitySquared(a: Building, b: Building): number | null {
  if (
    typeof a.latitude !== 'number' ||
    typeof a.longitude !== 'number' ||
    typeof b.latitude !== 'number' ||
    typeof b.longitude !== 'number'
  ) return null
  const latitude = a.latitude - b.latitude
  const longitude = a.longitude - b.longitude
  return latitude * latitude + longitude * longitude
}

/** Rank the complete locality-bounded candidate set before applying a limit. */
export function rankRelatedBuildingsByProximity(
  current: Building,
  candidates: readonly Building[],
  limit: number,
): Building[] {
  return candidates
    .filter((building) => String(building.id) !== String(current.id))
    .sort((a, b) => {
      const pa = proximitySquared(current, a)
      const pb = proximitySquared(current, b)
      if (pa != null && pb != null && pa !== pb) return pa - pb
      if (pa != null && pb == null) return -1
      if (pa == null && pb != null) return 1
      return a.id - b.id
    })
    .slice(0, limit)
}

/**
 * 生产供给适配器：查询层 `getEffectiveSupplyWhere` 粗筛 + 举报暂停排除 +
 * 批量 `resolveEffectiveSupplies` 精筛，与发布 endpoint、C 端口径完全一致。
 */
export function createPayloadSupplyAdapter(): SupplyAdapter {
  // 懒加载 payload，避免在模块顶层触发配置初始化
  let payloadCache: Awaited<ReturnType<typeof import('payload')['getPayload']>> | null = null

  async function getPayload() {
    if (!payloadCache) {
      const { getPayload } = await import('payload')
      const config = (await import('@/payload.config')).default
      payloadCache = await getPayload({ config })
    }
    return payloadCache
  }

  /** 单一 Payload 查询端口边界，供统一有效供给服务复用。 */
  async function getPayloadQueryPort() {
    return createEffectiveSupplyPayloadPort(await getPayload())
  }

  async function findAllListings(
    where: Where,
    depth: number,
    sort = 'id',
  ): Promise<Listing[]> {
    const payload = await getPayload()
    async function readPage(page: number, docs: Listing[]): Promise<Listing[]> {
      const result = await payload.find({
        collection: 'listings',
        where,
        depth,
        sort,
        limit: QUERY_PAGE_SIZE,
        page,
      })
      docs.push(...(result.docs as Listing[]))
      if (docs.length >= PUBLIC_CATALOG_CANDIDATE_LIMIT) {
        return docs.slice(0, PUBLIC_CATALOG_CANDIDATE_LIMIT)
      }
      if (!result.hasNextPage || result.nextPage == null) return docs
      return readPage(result.nextPage, docs)
    }
    return readPage(1, [])
  }

  function relationId(value: unknown): number | string | null {
    if (typeof value === 'number' || typeof value === 'string') return value
    if (value && typeof value === 'object' && 'id' in value) {
      const id = (value as { id?: unknown }).id
      if (typeof id === 'number' || typeof id === 'string') return id
    }
    return null
  }

  function relationSlug(value: unknown): string | null {
    if (value && typeof value === 'object' && 'slug' in value) {
      const slug = (value as { slug?: unknown }).slug
      if (typeof slug === 'string') return slug
    }
    return null
  }

  function normalizeNearbyBuildingLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 0
    return Math.max(0, Math.floor(limit))
  }

  async function findPublicBuildingsPage(
    ctx: SearchContext,
    options: Readonly<{ page: number; limit: number }>,
    stablePagination: boolean,
  ): Promise<EffectiveBuildingPage> {
    const payload = await getPayload()
    const page = Math.max(1, Math.floor(options.page))
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit)))
    const result = await payload.find({
      collection: 'buildings',
      where: {
        ...getPublicBuildingWhere(),
        'city.slug': { equals: ctx.city },
      } as unknown as Where,
      depth: 2,
      limit,
      page,
      sort: stablePagination ? ['-updatedAt', 'id'] : '-updatedAt',
    })
    return {
      docs: (result.docs as Building[]).filter((building) => isPublicBuilding(building)),
      page,
      hasNextPage: result.hasNextPage,
      nextPage: result.nextPage ?? null,
    }
  }

  async function resolveBuildingIdsByDistrict(
    districtSlugs: readonly string[],
    ctx: SearchContext,
  ): Promise<number[] | undefined> {
    if (districtSlugs.length === 0) return undefined
    const payload = await getPayload()
    const result = await payload.find({
      collection: 'buildings',
      where: {
        'city.slug': { equals: ctx.city },
        'district.slug': { in: [...districtSlugs] },
      },
      limit: PUBLIC_CATALOG_CANDIDATE_LIMIT,
    })
    return result.docs.map((d) => d.id)
  }

  /**
   * 有效供给 where 片段（查询层粗筛）+ 举报暂停排除。
   * 与 method-specific 约束合并后作为 payload.find 的 where。
   */
  async function baseEffectiveWhereWithoutCity(
    asOf: Date,
    businessType?: SearchContext['businessType'],
  ): Promise<Where> {
    const payload = await getPayloadQueryPort()
    const where: Where = {
      ...getEffectiveSupplyWhere(asOf, businessType ? { businessType } : undefined),
    }
    // §5 举报暂停：查 listing-reports 拿到被暂停的 listing IDs，not_in 排除
    const pausedIds = await getPausedListingIds(payload)
    if (pausedIds.length > 0) {
      where.id = { not_in: pausedIds }
    }
    return where
  }

  // ctx.businessType 在此生效：所有绑定城市的公开查询（列表、精选、推荐、在租面积
  // 聚合）都经过这里。不经过它的只有 findListingRouteIdentity —— 详情页直链必须能
  // 访问任何有效房源，租售都要，故那里刻意不过滤。
  async function baseEffectiveWhere(ctx: SearchContext): Promise<Where> {
    return {
      ...await baseEffectiveWhereWithoutCity(new Date(ctx.asOf), ctx.businessType),
      'building.city.slug': { equals: ctx.city },
    }
  }

  /**
   * 批量解析候选的关系与有效供给，保留 eligible 文档，避免关系查询 N+1。
   * 文档需 depth≥1 已展开 building / merchant。
   */
  async function fineFilter(
    docs: readonly Record<string, unknown>[],
    asOf: Date,
  ): Promise<Listing[]> {
    const payload = await getPayloadQueryPort()
    const supplies = await resolveEffectiveSupplies(payload, docs, asOf)
    const kept: Listing[] = []
    for (const doc of docs) {
      const listingId = toId(doc.id)
      const supply = listingId === null ? null : supplies.get(String(listingId)) ?? null
      if (supply?.eligible) kept.push(doc as unknown as Listing)
    }
    return kept
  }

  async function findEffectiveListingBySlugInCity(
    slug: string,
    ctx: SearchContext,
  ): Promise<Listing | null> {
    const payload = await getPayload()
    const asOf = new Date(ctx.asOf)
    const where = await baseEffectiveWhere(ctx)
    where.slug = { equals: slug }
    const result = await payload.find({
      collection: 'listings',
      where,
      limit: 1,
      depth: 3,
    })
    const kept = await fineFilter(result.docs as unknown as Record<string, unknown>[], asOf)
    return kept[0] ?? null
  }

  return {
    async findEffectiveListings(input, ctx) {
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf)

      // 解析 district → building IDs
      let buildingIds: number[] | undefined
      if (input.district && input.district.length > 0) {
        const resolved = await resolveBuildingIdsByDistrict(input.district, ctx)
        if (!resolved || resolved.length === 0) return []
        buildingIds = resolved
      }

      const where = await baseEffectiveWhere(ctx)

      if (input.listingType && input.listingType.length > 0) {
        where.listingType = { in: [...input.listingType] }
      }
      if (input.businessArea && input.businessArea.length > 0) {
        where['building.businessDistrict.slug'] = { in: [...input.businessArea] }
      }
      if (input.metro && input.metro.length > 0) {
        where['building.nearestMetro.slug'] = { in: [...input.metro] }
      }
      if (input.areaMin != null || input.areaMax != null) {
        const areaWhere: Record<string, number> = {}
        if (input.areaMin != null) areaWhere.greater_than_equal = input.areaMin
        if (input.areaMax != null) areaWhere.less_than_equal = input.areaMax
        where.area = areaWhere
      }
      if (input.rentMin != null || input.rentMax != null) {
        const rentWhere: Record<string, number> = {}
        if (input.rentMin != null) rentWhere.greater_than_equal = input.rentMin
        if (input.rentMax != null) rentWhere.less_than_equal = input.rentMax
        where.rent = rentWhere
      }
      if (input.rentUnit) {
        where.rentUnit = { equals: input.rentUnit }
      }
      if (input.availableBefore) {
        // availableFrom 为空或早于等于 availableBefore
        where.or = [
          { availableFrom: { exists: false } },
          { availableFrom: { less_than_equal: input.availableBefore } },
        ]
      }
      if (input.q) {
        where.title = { contains: input.q }
      }
      if (buildingIds) {
        where.building = { in: buildingIds }
      }

      // Read every coarse candidate in stable ID order. The Facade performs the
      // requested global sort and pagination only after the fine filter.
      const docs = await findAllListings(where, 2)
      return fineFilter(docs as unknown as Record<string, unknown>[], asOf)
    },

    async findEffectiveListingBySlug(slug, ctx) {
      return findEffectiveListingBySlugInCity(slug, ctx)
    },

    async findListingRouteIdentity(slug) {
      const payload = await getPayload()
      const asOf = new Date()
      const where = await baseEffectiveWhereWithoutCity(asOf)
      where.slug = { equals: slug }
      const result = await payload.find({
        collection: 'listings',
        where,
        limit: 1,
        depth: 2,
        select: { slug: true, building: true },
        populate: LISTING_ROUTE_IDENTITY_POPULATE,
      })
      const candidate = readListingRouteProjection(result.docs[0])
      if (!candidate) return null
      const candidateCity = mapBuildingCity(candidate.building)
      if (!candidateCity) return null

      const effective = await findEffectiveListingBySlugInCity(
        candidate.slug,
        createSearchContext(candidateCity.citySlug, asOf),
      )
      if (!effective) return null
      const effectiveCity = mapBuildingCity(effective.building)
      if (!effectiveCity || effectiveCity.citySlug !== candidateCity.citySlug) return null
      return { slug: effective.slug, citySlug: effectiveCity.citySlug }
    },

    async findEffectiveBuildingBySlug(slug, ctx) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'buildings',
        where: {
          ...getPublicBuildingWhere(),
          'city.slug': { equals: ctx.city },
          slug: { equals: slug },
        },
        limit: 1,
        depth: 2,
      })
      return (result.docs[0] as Building | undefined) ?? null
    },

    async findBuildingRouteIdentity(slug) {
      const payload = await getPayload()
      const where: Where = {
        ...getPublicBuildingWhere(),
        slug: { equals: slug },
      }
      const result = await payload.find({
        collection: 'buildings',
        where,
        limit: 1,
        depth: 1,
        select: { slug: true, city: true },
        populate: ROUTE_CITY_POPULATE,
      })
      const building = readBuildingRouteProjection(result.docs[0])
      if (!building) return null
      const city = mapBuildingCity(building)
      return city ? { slug: building.slug, citySlug: city.citySlug } : null
    },

    async findEffectiveListingsByBuilding(buildingId, ctx, excludeListingId) {
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf)
      const numericBuildingId = Number(buildingId)
      if (!Number.isSafeInteger(numericBuildingId)) return []
      const excludedListingId = excludeListingId == null ? null : Number(excludeListingId)
      if (excludeListingId != null && !Number.isSafeInteger(excludedListingId)) return []

      // Keep the effective-supply predicate in SQL for this detail-page path.
      // Payload's nested relationship where can be very slow in local dev when
      // combined with a direct building filter; IDs first keeps rendering fast.
      const sql = `
WITH active_rel AS (
  SELECT r.listing_id, r.merchant_id,
         COUNT(*) OVER (PARTITION BY r.listing_id) AS rel_count
  FROM listing_merchant_relations r
  WHERE r.effective_from <= $1
    AND (r.effective_to IS NULL OR r.effective_to > $1)
),
media AS (
  SELECT _parent_id AS listing_id, COUNT(*) AS n
  FROM listings_gallery GROUP BY _parent_id
)
SELECT l.id
FROM listings l
JOIN buildings  b    ON b.id = l.building_id
JOIN locations  city ON city.id = b.city_id
JOIN locations  dist ON dist.id = b.district_id
JOIN active_rel ar   ON ar.listing_id = l.id AND ar.rel_count = 1
JOIN merchants  m    ON m.id = ar.merchant_id
JOIN media      g    ON g.listing_id = l.id
WHERE l.building_id = $2
  AND ($3::int IS NULL OR l.id <> $3::int)
  AND l.deleted_at IS NULL
  AND l.publication_status = 'published'
  AND l.review_status = 'approved'
  AND l.supply_visibility_hold = 'normal'
  AND g.n >= 3
  AND b.status = 'published'
  AND b.operational_status = 'active'
  AND b.deleted_at IS NULL
  AND city.status = 'active'
  AND city.slug = $4
  AND dist.status = 'active'
  AND m.status = 'active'
  AND m.qualification_status = 'valid'
  AND (m.qualification_expires_at IS NULL OR m.qualification_expires_at >= $1)
  AND EXISTS (
    SELECT 1 FROM merchants_rels mr
    WHERE mr.parent_id = m.id AND mr.path = 'serviceCities' AND mr.locations_id = b.city_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM listing_reports rep
    WHERE rep.target_listing_id = l.id AND rep.supply_paused = true
  )
ORDER BY l.id
LIMIT ${PUBLIC_CATALOG_CANDIDATE_LIMIT}
`
      const pool = (payload.db as unknown as {
        pool: { query: (text: string, values: unknown[]) => Promise<{ rows: Array<{ id: number }> }> }
      }).pool
      const idResult = await pool.query(sql, [
        asOf.toISOString(),
        numericBuildingId,
        excludedListingId,
        ctx.city,
      ])
      const ids = idResult.rows.map((row) => row.id)
      if (ids.length === 0) return []

      const result = await payload.find({
        collection: 'listings',
        where: { id: { in: ids } } as Where,
        depth: 2,
        sort: 'id',
        limit: ids.length,
      })
      const byId = new Map((result.docs as Listing[]).map((doc) => [String(doc.id), doc]))
      const kept: Listing[] = []
      for (const id of ids) {
        const doc = byId.get(String(id))
        if (doc) kept.push(doc)
      }
      return kept
    },

    async sumEffectiveLeasableAreaByBuildings(buildingIds, ctx) {
      const sums = new Map<string, number>()
      if (buildingIds.length === 0) return sums
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf).toISOString()

      // 每个 WHERE 子句对应一条有效供给规则，与 getEffectiveSupplyWhere +
      // isListingEffectivelySupplied 的逐条精筛一一对应：
      //   l.deleted_at / publication_status / review_status / supply_visibility_hold
      //                                            → getEffectiveSupplyWhere
      //   b.* / city.status / dist.status          → getListingPublicBuildingWhere
      //   g.n >= 3                                 → §6 有效媒体 ≥ 3
      //   ar.rel_count = 1 + 区间覆盖 asOf         → §8 恰好一条生效商户关系
      //   m.status / qualification_*               → §9 商户启用 + 资质有效
      //   merchants_rels serviceCities = b.city_id → §10 服务城市覆盖楼盘城市
      //   listing_reports.supply_paused            → §5 举报暂停排除
      // 口径一致性由 scripts/verify-leasable-area-parity.ts 对全部楼盘做
      // 「SQL vs 逐条精筛」全量比对守护，改动规则时必须重跑。
      const sql = `
WITH active_rel AS (
  SELECT r.listing_id, r.merchant_id,
         COUNT(*) OVER (PARTITION BY r.listing_id) AS rel_count
  FROM listing_merchant_relations r
  WHERE r.effective_from <= $1
    AND (r.effective_to IS NULL OR r.effective_to > $1)
),
media AS (
  SELECT _parent_id AS listing_id, COUNT(*) AS n
  FROM listings_gallery GROUP BY _parent_id
)
SELECT l.building_id AS bid, SUM(l.area)::float8 AS total
FROM listings l
JOIN buildings  b    ON b.id = l.building_id
JOIN locations  city ON city.id = b.city_id
JOIN locations  dist ON dist.id = b.district_id
JOIN active_rel ar   ON ar.listing_id = l.id AND ar.rel_count = 1
JOIN merchants  m    ON m.id = ar.merchant_id
JOIN media      g    ON g.listing_id = l.id
WHERE l.building_id = ANY($2)
  AND l.deleted_at IS NULL
  AND l.publication_status = 'published'
  AND l.review_status = 'approved'
  AND l.supply_visibility_hold = 'normal'
  AND g.n >= 3
  AND b.status = 'published'
  AND b.operational_status = 'active'
  AND b.deleted_at IS NULL
  AND city.status = 'active'
  AND city.slug = $3
  AND dist.status = 'active'
  -- 租售维度：$4 为 NULL 时不过滤（保持改造前口径），否则只算该类型。
  -- 楼盘卡片的「在租 X ㎡」必须传 'lease'，否则一套待售整层会被算进在租面积。
  AND ($4::text IS NULL OR l.business_type = $4::text)
  AND m.status = 'active'
  AND m.qualification_status = 'valid'
  AND (m.qualification_expires_at IS NULL OR m.qualification_expires_at >= $1)
  AND EXISTS (
    SELECT 1 FROM merchants_rels mr
    WHERE mr.parent_id = m.id AND mr.path = 'serviceCities' AND mr.locations_id = b.city_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM listing_reports rep
    WHERE rep.target_listing_id = l.id AND rep.supply_paused = true
  )
GROUP BY l.building_id
`
      const pool = (payload.db as unknown as {
        pool: { query: (text: string, values: unknown[]) => Promise<{ rows: Array<{ bid: number; total: number }> }> }
      }).pool
      const result = await pool.query(sql, [
        asOf,
        buildingIds.map((id) => Number(id)),
        ctx.city,
        ctx.businessType ?? null,
      ])

      for (const row of result.rows) {
        const total = Number(row.total)
        if (!Number.isFinite(total) || total <= 0) continue
        // numeric 逐条相加会积累出 160846.65999999997 这类尾数，收敛到 2 位小数
        sums.set(String(row.bid), Math.round(total * 100) / 100)
      }
      return sums
    },

    async findEffectiveBuildingsNear(buildingId, ctx, limit) {
      const normalizedLimit = normalizeNearbyBuildingLimit(limit)
      if (normalizedLimit === 0) return []
      const payload = await getPayload()
      const current = await payload.findByID({
        collection: 'buildings',
        id: buildingId,
        depth: 1,
      }) as Building
      if (!isPublicBuilding(current)) return []
      if (relationSlug(current.city) !== ctx.city) return []

      // Prefer the more precise business district; an administrative district
      // is the documented fallback when the former is absent.
      const businessDistrictId = relationId(current.businessDistrict)
      const districtId = relationId(current.district)
      const locality = businessDistrictId != null
        ? { businessDistrict: { equals: businessDistrictId } }
        : districtId != null
          ? { district: { equals: districtId } }
          : null
      if (!locality) return []

      const result = await payload.find({
        collection: 'buildings',
        where: {
          ...getPublicBuildingWhere(),
          'city.slug': { equals: ctx.city },
          ...locality,
        } as unknown as Where,
        depth: 1,
        limit: RELATED_BUILDING_CANDIDATE_LIMIT,
        sort: 'id',
      })
      return rankRelatedBuildingsByProximity(
        current,
        (result.docs as Building[]).filter((building) => isPublicBuilding(building)),
        normalizedLimit,
      )
    },

    async findEffectiveBuildings(ctx, limit = 200) {
      return (await findPublicBuildingsPage(ctx, { page: 1, limit }, false)).docs
    },

    async findEffectiveBuildingsPage(ctx, options) {
      return findPublicBuildingsPage(ctx, options, true)
    },

    async findFeaturedBuildings(ctx, limit = 8) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'buildings',
        where: {
          ...getPublicBuildingWhere(),
          'city.slug': { equals: ctx.city },
        } as unknown as Where,
        depth: 2, // coverImage + district 一次填充；缺封面楼盘由卡片降级占位
        limit: Math.min(Math.max(limit, 1), 50),
        sort: ['recommendedOrder', '-updatedAt'],
      })
      return (result.docs as Building[]).filter((building) => isPublicBuilding(building))
    },

    async findFeaturedListings(ctx, limit = 6) {
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf)
      const where = await baseEffectiveWhere(ctx)
      where.isFeatured = { equals: true }
      const result = await payload.find({
        collection: 'listings',
        where: where as Where,
        limit: Math.max(limit * 5, limit),
        depth: 2,
        sort: '-updatedAt',
      })
      let kept = await fineFilter(result.docs as unknown as Record<string, unknown>[], asOf)
      // 回填：精选不足 limit 时，用非精选的有效房源补足（按 updatedAt 倒序），
      // 保证首页「推荐房源」两行布局在精选数据稀缺时仍能填满，不出现稀疏单行。
      if (kept.length < limit) {
        const excludeIds = kept.map((l) => l.id)
        const fallbackWhere = await baseEffectiveWhere(ctx)
        if (excludeIds.length) fallbackWhere.id = { not_in: excludeIds }
        const more = await payload.find({
          collection: 'listings',
          where: fallbackWhere as Where,
          limit: (limit - kept.length) * 3,
          depth: 2,
          sort: '-updatedAt',
        })
        const moreKept = await fineFilter(
          more.docs as unknown as Record<string, unknown>[],
          asOf,
        )
        kept = [...kept, ...moreKept].slice(0, limit)
      }
      return kept
    },

    async findEffectiveDistricts(ctx) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'locations',
        where: {
          type: { equals: 'district' },
          status: { equals: 'active' },
          // Locations 的「前台可见」开关此前只被后台地区树用来画标记，C 端查询
          // 没读过它——运营勾掉不生效。接上后运营即可控制哪些商圈进入 C 端。
          // location-protect 保证停用节点会被强制取消勾选，故与 status 不冲突。
          frontendVisible: { equals: true },
          'parent.slug': { equals: ctx.city },
        },
        limit: 100,
        sort: 'sortOrder',
      })
      return result.docs as readonly Location[]
    },

    async findEffectiveBusinessAreas(ctx) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'locations',
        where: {
          type: { equals: 'business_area' },
          status: { equals: 'active' },
          frontendVisible: { equals: true },
          // 商圈的 parent 是行政区，城市在再上一层，故按祖父的 slug 过滤
          'parent.parent.slug': { equals: ctx.city },
        },
        limit: 200,
        sort: 'sortOrder',
        depth: 1, // coverImage 一次填充；缺封面的商圈由 facade 回退到楼盘封面
      })
      return result.docs as readonly Location[]
    },

    async findLatestArticles(limit = 5) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'articles',
        where: {
          status: { equals: 'published' },
          deletedAt: { exists: false }, // articles 启用 trash，排除逻辑删除
        },
        depth: 2, // coverImage 填充为 Media
        limit: Math.min(Math.max(limit, 1), 50),
        sort: '-publishedAt',
      })
      return result.docs as readonly Article[]
    },

    async findPublishedArticles(options = {}) {
      const payload = await getPayload()
      const page = Math.max(options.page ?? 1, 1)
      const pageSize = Math.min(Math.max(options.pageSize ?? 12, 1), 48)
      const result = await payload.find({
        collection: 'articles',
        where: {
          status: { equals: 'published' },
          deletedAt: { exists: false },
        },
        depth: 2, // coverImage 填充为 Media
        limit: pageSize,
        page,
        sort: '-publishedAt',
      })
      return { docs: result.docs as readonly Article[], totalDocs: result.totalDocs }
    },

    async findPublishedArticleBySlug(slug) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'articles',
        where: {
          slug: { equals: slug },
          status: { equals: 'published' },
          deletedAt: { exists: false },
        },
        depth: 3, // 关联楼盘/区域填充
        limit: 1,
      })
      return (result.docs[0] as Article | undefined) ?? null
    },

    async assertEffectiveListingBySlug(slug, ctx) {
      // 与 findEffectiveListingBySlug 同口径（含完整精筛），用于询盘目标校验
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf)
      const where = await baseEffectiveWhere(ctx)
      where.slug = { equals: slug }
      const result = await payload.find({
        collection: 'listings',
        where: where as Where,
        limit: 1,
        depth: 2, // 精筛需要 building + merchant + gallery
      })
      const kept = await fineFilter(result.docs as unknown as Record<string, unknown>[], asOf)
      return kept[0] ?? null
    },

    async findPublishedPageBySlug(slug) {
      // F6.1：只读取 status=published 且未逻辑删除的页面
      // Pages collection 启用 trash，删除的文档 deletedAt 非空，需排除
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'pages',
        where: {
          slug: { equals: slug },
          status: { equals: 'published' },
          deletedAt: { exists: false },
        },
        limit: 1,
        depth: 2, // hero.image 填充为 Media
      })
      return (result.docs[0] as Page | undefined) ?? null
    },

    async findPublishedPages(limit) {
      // F6.4：sitemap 用，仅返回已发布且未删除的页面
      const payload = await getPayload()
      const requestedLimit = limit ?? Number.POSITIVE_INFINITY
      async function readPage(page: number, docs: Page[]): Promise<Page[]> {
        const result = await payload.find({
          collection: 'pages',
          where: {
            status: { equals: 'published' },
            deletedAt: { exists: false },
          },
          limit: Math.min(QUERY_PAGE_SIZE, requestedLimit - docs.length),
          page,
          depth: 0,
          sort: '-updatedAt',
        })
        docs.push(...(result.docs as Page[]))
        if (docs.length >= requestedLimit || !result.hasNextPage || result.nextPage == null) {
          return docs
        }
        return readPage(result.nextPage, docs)
      }
      return readPage(1, [])
    },
  }
}
