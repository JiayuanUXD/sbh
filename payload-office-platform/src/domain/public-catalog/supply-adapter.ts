/**
 * 公开目录查询供给适配器（Supply Adapter）
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§8、§17
 *
 * 职责：
 *   - 定义 Facade 与"统一有效供给服务"之间的契约接口；
 *   - 提供过渡实现（基于 Payload Local API + 现有 `status=available` + `building.operationalStatus=active` 谓词）；
 *   - M4.7 完成后只需替换默认实现，Facade 与 DTO 不变。
 *
 * 守护不变量（FRONTEND_AGENT.md §6.1）：
 *   - 适配器是 Facade 唯一的数据入口，禁止在 Facade 内部直接拼 Payload where；
 *   - 过渡实现仅用于开发/预览，不得作为生产公开页面的有效供给真源；
 *   - M4.7 完成后所有调用方迁移到 `PayloadSupplyAdapter` 的新版本（消费服务输出），
 *     `TransitionalPayloadSupplyAdapter` 与旧 `status=available` 谓词将被删除（F1.6）。
 *
 * 注意：
 *   - 当前接口返回 `Listing` / `Building` / `Location` 原始 Payload 文档；
 *   - Facade 在拿到文档后立即通过 mapper 投影为 DTO，组件不消费原始文档；
 *   - M4.7 完成后接口签名可保持不变，仅替换内部实现（服务返回的也是已过滤的文档）。
 */

import type { Where } from 'payload'
import type { Building, Listing, Location, Page } from '@/payload-types'
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

  /** 首页精选有效房源（按 isFeatured + lastEffectiveMaintainedAt desc） */
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
 * Facade 接受工厂函数（懒构造）或实例；
 * 默认使用 `createTransitionalPayloadAdapter()`。
 */
export type SupplyAdapterFactory = () => SupplyAdapter

/**
 * 默认适配器实例（懒单例）
 *
 * M4.7 完成前使用 TransitionalPayloadSupplyAdapter；
 * 之后切换为 PayloadSupplyAdapter（消费服务输出）。
 *
 * 测试与页面可通过参数注入替换实现。
 */
let defaultAdapter: SupplyAdapter | null = null
let defaultFactory: SupplyAdapterFactory | null = null

export function setDefaultSupplyAdapterFactory(factory: SupplyAdapterFactory | null): void {
  defaultFactory = factory
  defaultAdapter = null
}

export function getDefaultSupplyAdapter(): SupplyAdapter {
  if (!defaultAdapter) {
    defaultAdapter = defaultFactory
      ? defaultFactory()
      : createTransitionalPayloadAdapter()
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
// 过渡实现：基于 Payload Local API + 旧 status=available 谓词
// ---------------------------------------------------------------------------

/**
 * 过渡实现：基于 Payload Local API + 旧 `status=available` + `building.operationalStatus=active` 谓词
 *
 * ⚠️ 注意（design.md §8、FRONTEND_AGENT.md §6.1）：
 *   - 此实现仅满足契约骨架与开发环境预览；
 *   - 不覆盖审核、举报、媒体完整、商户关系/资格/服务城市、可用性和陈旧等完整谓词；
 *   - M4.7 完成后必须删除此实现并切换到真实服务适配器，不得作为生产降级。
 */
export function createTransitionalPayloadAdapter(): SupplyAdapter {
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

  return {
    async findEffectiveListings(input, ctx) {
      const payload = await getPayload()

      // 解析 district → building IDs
      let buildingIds: number[] | undefined
      if (input.district && input.district.length > 0) {
        const resolved = await resolveBuildingIdsByDistrict(input.district)
        if (!resolved || resolved.length === 0) return []
        buildingIds = resolved
      }

      // 过渡谓词：旧 status=available + building.operationalStatus=active
      // ⚠️ 待 M4.7 完成后删除（F1.6）
      const where: Record<string, unknown> = {
        status: { equals: 'available' },
        'building.operationalStatus': { equals: 'active' },
        deletedAt: { exists: false },
      }

      // 上下文中的 city 当前仅作为约束记录；实际 city 过滤由 building.city.slug 完成
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

      // 取分页页内全部数据（按 input.pageSize 上限），交由 Facade 在内存中稳定排序与分页。
      // 过渡实现假定结果集可控；M4.7 后由服务端做条件投影。
      const limit = Math.min(input.pageSize * 5, 200)
      const result = await payload.find({
        collection: 'listings',
        where: where as Where,
        limit,
        pagination: false,
        depth: 2, // building + district + coverImage
      })
      return result.docs as readonly Listing[]
    },

    async findEffectiveListingBySlug(slug) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'listings',
        where: {
          slug: { equals: slug },
          status: { equals: 'available' },
          'building.operationalStatus': { equals: 'active' },
          deletedAt: { exists: false },
        },
        limit: 1,
        depth: 3, // building + gallery + amenities
      })
      return (result.docs[0] as Listing | undefined) ?? null
    },

    async findEffectiveBuildingBySlug(slug) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'buildings',
        where: {
          slug: { equals: slug },
          operationalStatus: { equals: 'active' },
        },
        limit: 1,
        depth: 2,
      })
      return (result.docs[0] as Building | undefined) ?? null
    },

    async findEffectiveListingsByBuilding(buildingId, _ctx, excludeListingId) {
      const payload = await getPayload()
      const where: Record<string, unknown> = {
        building: { equals: buildingId },
        status: { equals: 'available' },
        'building.operationalStatus': { equals: 'active' },
        deletedAt: { exists: false },
      }
      if (excludeListingId != null) {
        where.id = { not_equals: excludeListingId }
      }
      const result = await payload.find({
        collection: 'listings',
        where: where as Where,
        limit: 24,
        pagination: false,
        depth: 2,
      })
      return result.docs as readonly Listing[]
    },

    async findFeaturedListings(_ctx, limit = 6) {
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'listings',
        where: {
          status: { equals: 'available' },
          isFeatured: { equals: true },
          'building.operationalStatus': { equals: 'active' },
          deletedAt: { exists: false },
        },
        limit,
        depth: 2,
        sort: '-updatedAt',
      })
      return result.docs as readonly Listing[]
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

    async assertEffectiveListingBySlug(slug) {
      // 过渡实现：等价于 findEffectiveListingBySlug，仅做存在性校验
      // M4.7 完成后这里应调用 assertEffectiveListing 服务方法（含完整谓词）
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'listings',
        where: {
          slug: { equals: slug },
          status: { equals: 'available' },
          'building.operationalStatus': { equals: 'active' },
          deletedAt: { exists: false },
        },
        limit: 1,
        depth: 0,
      })
      return (result.docs[0] as Listing | undefined) ?? null
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

    async findPublishedPages(_ctx, limit = 1000) {
      // F6.4：sitemap 用，仅返回已发布且未删除的页面
      const payload = await getPayload()
      const result = await payload.find({
        collection: 'pages',
        where: {
          status: { equals: 'published' },
          deletedAt: { exists: false },
        },
        limit,
        depth: 0, // sitemap 只需 slug + updatedAt
        sort: '-updatedAt',
      })
      return result.docs as readonly Page[]
    },
  }
}
