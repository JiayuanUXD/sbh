/**
 * 公开目录查询供给适配器（Supply Adapter）
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§8、§17；specs/backend-mvp M4.7
 *
 * 职责：
 *   - 定义 Facade 与"统一有效供给服务"之间的契约接口；
 *   - 提供生产实现 `createPayloadSupplyAdapter()`：查询层用 `getEffectiveSupplyWhere`
 *     粗筛 + `getPausedListingIds` 排除举报暂停，取候选后逐条 `resolveEffectiveSupply`
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

import type { Where } from 'payload'
import type { Building, Listing, Location, Page } from '@/payload-types'
import {
  getEffectiveSupplyWhere,
  getPausedListingIds,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'
import { resolveEffectiveSupply } from '@/domain/review/effective-supply-snapshot'
import type { SearchContext, ListingSearchInput } from './types'

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

  /** 按 slug 返回有效楼盘；停用、不存在返回 null */
  findEffectiveBuildingBySlug(slug: string, ctx: SearchContext): Promise<Building | null>

  /** 楼盘内有效房源（用于楼内列表、聚合和相关推荐） */
  findEffectiveListingsByBuilding(
    buildingId: number | string,
    ctx: SearchContext,
    excludeListingId?: number | string,
  ): Promise<readonly Listing[]>

  /** 当前楼盘周边的有效公开楼盘（排除自身，稳定收束）。 */
  findEffectiveBuildingsNear(
    buildingId: number | string,
    ctx: SearchContext,
    limit: number,
  ): Promise<readonly Building[]>

  /** 首页精选有效房源（按 isFeatured + updatedAt desc） */
  findFeaturedListings(ctx: SearchContext, limit?: number): Promise<readonly Listing[]>

  /** 当前城市的有效行政区列表（用于 facet 和筛选器） */
  findEffectiveDistricts(ctx: SearchContext): Promise<readonly Location[]>

  /** 按 listing slug 复核有效性（用于询盘目标校验）；不抛错，失效返回 null */
  assertEffectiveListingBySlug(slug: string, ctx: SearchContext): Promise<Listing | null>

  /**
   * 按 slug 返回已发布的公开页面；草稿、删除或不存在返回 null
   *
   * F6.1：只读取 status=published 的页面，草稿/删除/不存在返回 null。
   * 用于内容页路由 /pages/[slug] 与首页 slug='home' 渲染。
   */
  findPublishedPageBySlug(slug: string, ctx: SearchContext): Promise<Page | null>

  /**
   * 返回所有已发布的公开页面（用于 sitemap）
   *
   * F6.4：仅返回 status=published 且未逻辑删除的页面，按 updatedAt 倒序。
   * limit 用于规模拆分；MVP 单文件 sitemap，默认 1000。
   */
  findPublishedPages(ctx: SearchContext, limit?: number): Promise<readonly Page[]>
}

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
 * 逐条 `resolveEffectiveSupply` 精筛，与发布 endpoint、C 端口径完全一致。
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
      if (!result.hasNextPage || result.nextPage == null) return docs
      return readPage(result.nextPage, docs)
    }
    return readPage(1, [])
  }

  function publicBuildingWhere(): Record<string, unknown> {
    return {
      operationalStatus: { equals: 'active' },
      status: { equals: 'published' },
      deletedAt: { exists: false },
    }
  }

  function isPublicBuilding(building: Building | null | undefined): building is Building {
    return Boolean(
      building &&
      building.operationalStatus === 'active' &&
      building.status === 'published' &&
      !building.deletedAt,
    )
  }

  function relationId(value: unknown): number | string | null {
    if (typeof value === 'number' || typeof value === 'string') return value
    if (value && typeof value === 'object' && 'id' in value) {
      const id = (value as { id?: unknown }).id
      if (typeof id === 'number' || typeof id === 'string') return id
    }
    return null
  }

  function normalizeNearbyBuildingLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 0
    return Math.max(0, Math.floor(limit))
  }

  async function resolveBuildingIdsByDistrict(
    districtSlugs: readonly string[],
  ): Promise<number[] | undefined> {
    if (districtSlugs.length === 0) return undefined
    const payload = await getPayload()
    const result = await payload.find({
      collection: 'buildings',
      where: { 'district.slug': { in: [...districtSlugs] } },
      limit: 200,
      pagination: false,
    })
    return result.docs.map((d) => d.id)
  }

  /**
   * 有效供给 where 片段（查询层粗筛）+ 举报暂停排除。
   * 与 method-specific 约束合并后作为 payload.find 的 where。
   */
  async function baseEffectiveWhere(ctx: SearchContext): Promise<Record<string, unknown>> {
    const payload = await getPayload()
    const asOf = new Date(ctx.asOf)
    const where: Record<string, unknown> = { ...getEffectiveSupplyWhere(asOf) }
    // §5 举报暂停：查 listing-reports 拿到被暂停的 listing IDs，not_in 排除
    const pausedIds = await getPausedListingIds(payload as unknown as PayloadQueryPort)
    if (pausedIds.length > 0) {
      where.id = { not_in: pausedIds }
    }
    return where
  }

  /**
   * 对候选文档逐条跑精筛（媒体 §6 / 关系 §8 / 商户 §9-§10），保留 eligible。
   * 文档需 depth≥1 已展开 building / merchant。
   */
  async function fineFilter(
    docs: readonly Record<string, unknown>[],
    asOf: Date,
  ): Promise<Listing[]> {
    const payload = await getPayload()
    const kept: Listing[] = []
    for (const doc of docs) {
      const supply = await resolveEffectiveSupply(
        payload as unknown as PayloadQueryPort,
        doc,
        asOf,
      )
      if (supply.eligible) kept.push(doc as unknown as Listing)
    }
    return kept
  }

  return {
    async findEffectiveListings(input, ctx) {
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf)

      // 解析 district → building IDs
      let buildingIds: number[] | undefined
      if (input.district && input.district.length > 0) {
        const resolved = await resolveBuildingIdsByDistrict(input.district)
        if (!resolved || resolved.length === 0) return []
        buildingIds = resolved
      }

      const where = await baseEffectiveWhere(ctx)

      // 上下文中的 city：由 building.city.slug 过滤
      if (ctx.city) {
        where['building.city.slug'] = { equals: ctx.city }
      }
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
      const docs = await findAllListings(where as Where, 2)
      return fineFilter(docs as unknown as Record<string, unknown>[], asOf)
    },

    async findEffectiveListingBySlug(slug, ctx) {
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf)
      const where = await baseEffectiveWhere(ctx)
      where.slug = { equals: slug }
      const result = await payload.find({
        collection: 'listings',
        where: where as Where,
        limit: 1,
        depth: 3, // building + gallery + amenities + merchant
      })
      const kept = await fineFilter(result.docs as unknown as Record<string, unknown>[], asOf)
      return kept[0] ?? null
    },

    async findEffectiveBuildingBySlug(slug) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'buildings',
        where: {
          ...publicBuildingWhere(),
          slug: { equals: slug },
        },
        limit: 1,
        depth: 2,
      })
      return (result.docs[0] as Building | undefined) ?? null
    },

    async findEffectiveListingsByBuilding(buildingId, ctx, excludeListingId) {
      const payload = await getPayload()
      const asOf = new Date(ctx.asOf)
      const where = await baseEffectiveWhere(ctx)
      where.building = { equals: buildingId }
      const docs = await findAllListings(where as Where, 2)
      let kept = await fineFilter(docs as unknown as Record<string, unknown>[], asOf)
      // 排除自身（在内存中过滤，避免与 pausedIds 的 not_in 冲突）
      if (excludeListingId != null) {
        kept = kept.filter((d) => String(d.id) !== String(excludeListingId))
      }
      return kept
    },

    async findEffectiveBuildingsNear(buildingId, _ctx, limit) {
      const normalizedLimit = normalizeNearbyBuildingLimit(limit)
      if (normalizedLimit === 0) return []
      const payload = await getPayload()
      const current = await payload.findByID({
        collection: 'buildings',
        id: buildingId,
        depth: 1,
      }) as Building
      if (!isPublicBuilding(current)) return []

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
        where: { ...publicBuildingWhere(), ...locality } as unknown as Where,
        depth: 1,
        // Payload pagination:false returns the complete locality-bounded result;
        // do not add a limit before distance ranking.
        pagination: false,
        sort: 'id',
      })
      return rankRelatedBuildingsByProximity(
        current,
        (result.docs as Building[]).filter((building) => isPublicBuilding(building)),
        normalizedLimit,
      )
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
      const kept = await fineFilter(result.docs as unknown as Record<string, unknown>[], asOf)
      return kept.slice(0, limit)
    },

    async findEffectiveDistricts(ctx) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'locations',
        where: {
          type: { equals: 'district' },
          status: { equals: 'active' },
          ...(ctx.city ? { 'parent.slug': { equals: ctx.city } } : {}),
        },
        limit: 100,
        sort: 'sortOrder',
      })
      return result.docs as readonly Location[]
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

    async findPublishedPages(_ctx, limit) {
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
