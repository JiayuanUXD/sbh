/**
 * F7.6 生产等价数据差异验收
 *
 * 设计依据：specs/frontend-mvp/tasks/F7-acceptance.md F7.6
 *           specs/frontend-mvp/design.md §3.6（有效供给 10 条）、§7.4（稳定排序）、§9（缓存失效）、§15.2（一致性）
 *           specs/backend-mvp/tasks/M4-listing-review-supply.md M4.7
 *           src/domain/public-catalog/facade.ts
 *           src/domain/public-catalog/cache-invalidator.ts
 *           src/domain/review/effective-supply.ts
 *
 * F7.6 验收门：
 *   - 比较统一有效供给服务与所有公开消费者解析出的 Listing 集合（差异必须为 0）。
 *   - 验证缓存失效、时区边界、陈旧日期边界和稳定分页。
 *
 * 测试策略：
 *   1. 时区边界（Asia/Shanghai 自然日切换）：同一房源在 UTC+8 00:00 前后的可见性结论一致。
 *   2. 陈旧数据边界（30 天未维护）：公开供给谓词不含陈旧规则，updatedAt 陈旧不影响可见性
 *      （陈旧规则属于 M6.5 SLA 扫描，仅触发 listing.stale_maintenance 待办，不剔除公开供给）。
 *   3. 稳定分页：跨页排序稳定，同权重以 listing_id 升序收束。
 *   4. 缓存失效等价性：同一 fixture 多次查询、不同 ctx.asOf 解析得到一致的可见性集合。
 *   5. 多消费者路径数据等价：searchListings / getListingBySlug / getRelatedListings /
 *      assertEffectiveListing / getBuildingDetail / getHomepage / getSearchFacets
 *      对同一组房源的可见性集合完全一致（差异为 0）。
 */

import { describe, expect, it } from 'vitest'
import {
  assertEffectiveListing,
  createSearchContext,
  getBuildingDetail,
  getHomepage,
  getListingBySlug,
  getRelatedListings,
  getSearchFacets,
  parseSearchInput,
  searchListings,
  type SupplyAdapter,
} from '@/domain/public-catalog'
import type { ListingSearchInput } from '@/domain/public-catalog'
import {
  isListingEffectivelySupplied,
  type EffectiveSupplySnapshot,
} from '@/domain/review/effective-supply'
import type { ValidityPeriod } from '@/domain/shared/validity'
import type { Building, Listing, Location, Media, Page } from '@/payload-types'
import {
  computeAffectedTags,
  type TagInvalidator,
} from '@/domain/public-catalog/cache-invalidator'
import type { DomainEvent } from '@/domain/workflow/event-publisher'

// ---------------------------------------------------------------------------
// 共享常量与基线 fixture（与 public-catalog-effective-supply-consistency.test.ts 同源）
// ---------------------------------------------------------------------------

const MEDIA_1: Media = {
  id: 9001,
  alt: '图1',
  url: '/media/m1.jpg',
  filename: 'm1.jpg',
  mimeType: 'image/jpeg',
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  width: 1280,
  height: 960,
}
const MEDIA_2: Media = { ...MEDIA_1, id: 9002, alt: '图2', url: '/media/m2.jpg' }
const MEDIA_3: Media = { ...MEDIA_1, id: 9003, alt: '图3', url: '/media/m3.jpg' }

const MERCHANT_VALID = {
  id: 7001,
  name: '有效商户',
  type: 'OWNER' as const,
  status: 'active' as const,
  qualificationStatus: 'valid' as const,
  qualificationExpiresAt: '2027-12-31T00:00:00.000Z',
  serviceCities: [100],
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

const CITY_SHANGHAI: Location = {
  id: 100,
  name: '上海',
  slug: 'shanghai',
  type: 'city',
  immutableCode: 'CITY-SH',
  status: 'active',
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

const DISTRICT_JINGAN: Location = {
  id: 1,
  name: '静安',
  slug: 'jingan',
  type: 'district',
  immutableCode: 'TEST-1',
  status: 'active',
  parent: 100,
  updatedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

const BUILDING_VALID: Building = {
  id: 200,
  name: '静安中心',
  slug: 'jingan-center',
  status: 'published',
  operationalStatus: 'active',
  buildingType: 'office_building',
  grade: 'grade-a',
  verificationStatus: 'verified',
  city: CITY_SHANGHAI,
  district: DISTRICT_JINGAN,
  address: '上海市静安区南京西路 1788 号',
  coverImage: MEDIA_1,
  gallery: null,
  amenities: null,
  summary: '',
  description: null,
  updatedAt: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const RELATION_VALID: ValidityPeriod = {
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: null,
}

function makeValidListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 1001,
    title: '有效房源基线',
    slug: 'valid-listing',
    status: 'available',
    listingType: 'traditional-office',
    building: BUILDING_VALID,
    rent: 25000,
    rentUnit: 'rmb-month',
    area: 100,
    seats: 12,
    availableFrom: '2026-08-01',
    isFeatured: true,
    coverImage: MEDIA_1,
    gallery: [
      { image: MEDIA_1, id: 'g1' },
      { image: MEDIA_2, id: 'g2' },
      { image: MEDIA_3, id: 'g3' },
    ],
    highlights: [{ text: '落地窗', id: 'h1' }],
    description: null,
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    merchant: MERCHANT_VALID,
    updatedAt: '2026-07-15T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Listing
}

type ListingWithRelation = Listing & { _relationPeriod?: ValidityPeriod | null }

// ---------------------------------------------------------------------------
// 最小化全谓词 FakeAdapter（复用 F1.2 同源实现）
// ---------------------------------------------------------------------------

function createFullPredicateAdapter(options: {
  listings: readonly Listing[]
  buildings?: readonly Building[]
  districts?: readonly Location[]
  pausedIds?: ReadonlyArray<string | number>
}): SupplyAdapter {
  const buildings = options.buildings ?? [BUILDING_VALID]
  const districts = options.districts ?? [DISTRICT_JINGAN]
  const pausedIds = options.pausedIds ?? []

  function resolveBuilding(ref: Listing['building']): Building | null {
    if (typeof ref === 'number') {
      return buildings.find((b) => b.id === ref) ?? null
    }
    if (ref && typeof ref === 'object') return ref
    return null
  }

  /** 闭包内可变的 ctx.asOf；由调用方在 adapter.findXxx(ctx) 时注入 */
  let currentAsOf: Date = new Date('2026-07-25T00:00:00Z')

  function isListingEffective(l: Listing): boolean {
    if (l.deletedAt) return false
    if (l.publicationStatus !== 'published') return false
    if (l.reviewStatus !== 'approved') return false
    if (l.supplyVisibilityHold !== 'normal') return false
    const b = resolveBuilding(l.building)
    if (!b || b.operationalStatus !== 'active') return false
    if (typeof b.city === 'object' && b.city && b.city.status !== 'active') return false
    if (typeof b.district === 'object' && b.district && b.district.status !== 'active') return false
    if (pausedIds.some((id) => String(id) === String(l.id))) return false

    const withRel = l as ListingWithRelation
    const merchant =
      typeof l.merchant === 'object' && l.merchant !== null
        ? (l.merchant as unknown as Record<string, unknown>)
        : {}
    const serviceCities = Array.isArray(merchant.serviceCities) ? merchant.serviceCities : []
    const snapshot: EffectiveSupplySnapshot = {
      merchant: {
        status: merchant.status,
        qualificationStatus: merchant.qualificationStatus,
        qualificationExpiresAt: (merchant.qualificationExpiresAt ?? null) as
          | string
          | Date
          | null
          | undefined,
        serviceCityIds: serviceCities
          .map((c) => {
            if (typeof c === 'number' || typeof c === 'string') return c
            if (typeof c === 'object' && c !== null && 'id' in c) {
              const id = (c as { id: unknown }).id
              if (typeof id === 'number' || typeof id === 'string') return id
            }
            return null
          })
          .filter((id): id is number | string => id !== null),
      },
      buildingCityId: typeof b.city === 'object' && b.city ? b.city.id : null,
      relationPeriod:
        withRel._relationPeriod === undefined ? RELATION_VALID : withRel._relationPeriod,
    }
    return isListingEffectivelySupplied(snapshot, currentAsOf).eligible
  }

  function matchInput(l: Listing, input: ListingSearchInput): boolean {
    if (!isListingEffective(l)) return false
    if (input.listingType && input.listingType.length > 0) {
      if (!input.listingType.includes(l.listingType)) return false
    }
    if (input.areaMin != null && (l.area == null || l.area < input.areaMin)) return false
    if (input.areaMax != null && (l.area == null || l.area > input.areaMax)) return false
    if (input.priceMin != null && (l.rent == null || l.rent < input.priceMin)) return false
    if (input.priceMax != null && (l.rent == null || l.rent > input.priceMax)) return false
    if (input.priceUnit && l.rentUnit !== input.priceUnit) return false
    if (input.q && !l.title.includes(input.q)) return false
    return true
  }

  /** 从 SearchContext.asOf 注入当前判定时间点 */
  function syncAsOf(ctx: { asOf?: string }): void {
    if (ctx?.asOf) {
      const d = new Date(ctx.asOf)
      if (!Number.isNaN(d.getTime())) {
        currentAsOf = d
      }
    }
  }

  return {
    async findEffectiveListings(input, ctx) {
      syncAsOf(ctx)
      return options.listings.filter((l) => matchInput(l, input))
    },
    // sitemap 专用查询：这些假适配器只验其它路径，给个空页即可
    findEffectiveListingsSitemapPage: async () => ({
      docs: [],
      page: 1,
      hasNextPage: false,
      nextPage: null,
    }),
    async findEffectiveListingBySlug(slug, ctx) {
      syncAsOf(ctx)
      const l = options.listings.find((x) => x.slug === slug)
      if (!l || !isListingEffective(l)) return null
      return l
    },
    async findListingRouteIdentity(slug) {
      const listing = options.listings.find((candidate) => candidate.slug === slug)
      if (!listing || !isListingEffective(listing)) return null
      const building = resolveBuilding(listing.building)
      const city = typeof building?.city === 'object' && building.city ? building.city : null
      return city ? { slug: listing.slug, citySlug: city.slug } : null
    },
    async findEffectiveBuildingBySlug(slug, ctx) {
      syncAsOf(ctx)
      const b = buildings.find((x) => x.slug === slug)
      if (!b || b.operationalStatus !== 'active') return null
      return b
    },
    async findBuildingRouteIdentity(slug) {
      const building = buildings.find((candidate) => candidate.slug === slug)
      const city = typeof building?.city === 'object' && building.city ? building.city : null
      return building?.operationalStatus === 'active' && city
        ? { slug: building.slug, citySlug: city.slug }
        : null
    },
    async findEffectiveListingsByBuilding(buildingId, ctx, excludeListingId) {
      syncAsOf(ctx)
      return options.listings.filter(
        (l) =>
          isListingEffective(l) &&
          (typeof l.building === 'object' ? l.building.id : l.building) === buildingId &&
          (excludeListingId == null || l.id !== excludeListingId),
      )
    },
    async aggregateEffectiveSupplyByBuildings(buildingIds, ctx) {
      syncAsOf(ctx)
      const aggregates = new Map<string, { area: number; count: number }>()
      for (const l of options.listings) {
        if (!isListingEffective(l)) continue
        const bid = typeof l.building === 'object' ? l.building.id : l.building
        if (!buildingIds.some((id) => id === bid)) continue
        const area = typeof l.area === 'number' && Number.isFinite(l.area) ? l.area : 0
        const prev = aggregates.get(String(bid)) ?? { area: 0, count: 0 }
        aggregates.set(String(bid), { area: prev.area + (area > 0 ? area : 0), count: prev.count + 1 })
      }
      return aggregates
    },
    async findEffectiveBusinessAreas() {
      return []
    },
    async findEffectiveBuildingsNear(buildingId, ctx) {
      syncAsOf(ctx)
      return buildings.filter((building) => building.id !== buildingId && building.operationalStatus === 'active')
    },
    async findEffectiveBuildings(ctx, limit = 200) {
      syncAsOf(ctx)
      return buildings
        .filter((building) => building.operationalStatus === 'active')
        .slice(0, limit)
    },
    async findEffectiveBuildingsPage(ctx, { page, limit }) {
      syncAsOf(ctx)
      const all = buildings.filter((building) => building.operationalStatus === 'active')
      const docs = all.slice((page - 1) * limit, page * limit)
      return {
        docs,
        page,
        hasNextPage: page * limit < all.length,
        nextPage: page * limit < all.length ? page + 1 : null,
      }
    },
    async findFeaturedListings(ctx, limit = 6) {
      syncAsOf(ctx)
      return options.listings.filter((l) => isListingEffective(l) && l.isFeatured).slice(0, limit)
    },
    async findFeaturedBuildings() {
      return []
    },
    async findLatestArticles() {
      return []
    },
    async findPublishedArticles() {
      return { docs: [], totalDocs: 0 }
    },
    async findPublishedArticleBySlug() {
      return null
    },
    async findEffectiveDistricts(ctx) {
      syncAsOf(ctx)
      return districts
    },
    async assertEffectiveListingBySlug(slug, ctx) {
      syncAsOf(ctx)
      const l = options.listings.find((x) => x.slug === slug)
      if (!l || !isListingEffective(l)) return null
      return l
    },
    async findPublishedPageBySlug() {
      return null
    },
    async findPublishedPages() {
      return [] as readonly Page[]
    },
  }
}

// ---------------------------------------------------------------------------
// 1. 时区边界验收：Asia/Shanghai 自然日切换
// ---------------------------------------------------------------------------

describe('F7.6 时区边界：Asia/Shanghai 自然日切换', () => {
  /**
   * 关系区间 [start, end) 是 UTC ISO 字符串，跨时区时边界漂移。
   * SearchContext 固定时区 Asia/Shanghai，asOf 在自然日切换点附近
   * 不应导致可见性结论差异（design.md §3.1 / §15.2）。
   *
   * 边界用例：
   *   - 23:59:59 上海时间 → UTC 15:59:59 当日
   *   - 00:00:00 上海时间次日 → UTC 16:00:00 当日
   */

  it('上海时间 23:59:59 与 00:00:00 次日的可见性结论一致（关系在同一天）', async () => {
    // 关系区间：[2026-07-25 16:00 UTC, null) = 上海 2026-07-26 00:00 起生效
    const relationStart: ValidityPeriod = {
      startsAt: '2026-07-25T16:00:00.000Z', // 上海时间 2026-07-26 00:00:00
      endsAt: null,
    }
    const listing = makeValidListing()
    ;(listing as ListingWithRelation)._relationPeriod = relationStart

    // 上海时间 2026-07-25 23:59:59（关系未生效）→ 不可见
    const beforeMidnight = createSearchContext(
      'shanghai',
      new Date('2026-07-25T15:59:59.000Z'), // 上海 2026-07-25 23:59:59
    )
    // 上海时间 2026-07-26 00:00:00（关系生效）→ 可见
    const atMidnight = createSearchContext(
      'shanghai',
      new Date('2026-07-25T16:00:00.000Z'), // 上海 2026-07-26 00:00:00
    )

    const adapter = createFullPredicateAdapter({ listings: [listing] })

    const beforeSearch = await searchListings(parseSearchInput(new URLSearchParams('')), beforeMidnight, adapter)
    const atSearch = await searchListings(parseSearchInput(new URLSearchParams('')), atMidnight, adapter)

    // 边界切换前后，可见性结论与时间点预期一致
    expect(beforeSearch.docs.some((c) => c.id === listing.id)).toBe(false)
    expect(atSearch.docs.some((c) => c.id === listing.id)).toBe(true)

    // 同一时点多次查询结果稳定（不漂移）
    const atSearch2 = await searchListings(parseSearchInput(new URLSearchParams('')), atMidnight, adapter)
    expect(atSearch2.docs.some((c) => c.id === listing.id)).toBe(true)
  })

  it('关系已过期场景在上海时间自然日切换点附近结论一致', async () => {
    // 关系区间：[2026-01-01, 2026-07-25 16:00 UTC) = 上海 2026-07-26 00:00 过期
    const expiredRelation: ValidityPeriod = {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-07-25T16:00:00.000Z', // 上海 2026-07-26 00:00:00 过期
    }
    const listing = makeValidListing()
    ;(listing as ListingWithRelation)._relationPeriod = expiredRelation

    const beforeMidnight = createSearchContext(
      'shanghai',
      new Date('2026-07-25T15:59:59.000Z'), // 上海 2026-07-25 23:59:59（关系有效）
    )
    const atMidnight = createSearchContext(
      'shanghai',
      new Date('2026-07-25T16:00:00.000Z'), // 上海 2026-07-26 00:00:00（关系过期）
    )

    const adapter = createFullPredicateAdapter({ listings: [listing] })

    const beforeSearch = await searchListings(parseSearchInput(new URLSearchParams('')), beforeMidnight, adapter)
    const atSearch = await searchListings(parseSearchInput(new URLSearchParams('')), atMidnight, adapter)

    // 过期前可见，过期点不可见
    expect(beforeSearch.docs.some((c) => c.id === listing.id)).toBe(true)
    expect(atSearch.docs.some((c) => c.id === listing.id)).toBe(false)
  })

  it('商户资质在上海时间自然日切换点过期：边界点结论一致', async () => {
    // 商户资质 expiresAt = 2026-07-25T16:00:00Z（上海 2026-07-26 00:00:00）
    // isQualificationEffective 用 now <= exp 语义：到期时刻本身仍有效，超过才失效
    const expiringMerchant = {
      ...MERCHANT_VALID,
      qualificationExpiresAt: '2026-07-25T16:00:00.000Z',
    }
    const listing = makeValidListing({
      merchant: expiringMerchant as unknown as Listing['merchant'],
    })

    const beforeExpiry = createSearchContext(
      'shanghai',
      new Date('2026-07-25T15:59:59.000Z'), // 上海 23:59:59（资质仍有效）
    )
    const atExpiry = createSearchContext(
      'shanghai',
      new Date('2026-07-25T16:00:00.000Z'), // 上海 00:00:00（= exp，仍有效）
    )
    const afterExpiry = createSearchContext(
      'shanghai',
      new Date('2026-07-25T16:00:01.000Z'), // 上海 00:00:01（> exp，已失效）
    )

    const adapter = createFullPredicateAdapter({ listings: [listing] })

    const beforeSearch = await searchListings(parseSearchInput(new URLSearchParams('')), beforeExpiry, adapter)
    const atSearch = await searchListings(parseSearchInput(new URLSearchParams('')), atExpiry, adapter)
    const afterSearch = await searchListings(parseSearchInput(new URLSearchParams('')), afterExpiry, adapter)

    // 过期前可见，到期时刻仍可见（now <= exp），超过后不可见
    expect(beforeSearch.docs.some((c) => c.id === listing.id)).toBe(true)
    expect(atSearch.docs.some((c) => c.id === listing.id)).toBe(true)
    expect(afterSearch.docs.some((c) => c.id === listing.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. 陈旧数据边界：30 天未维护不影响公开供给可见性
// ---------------------------------------------------------------------------

describe('F7.6 陈旧数据边界：陈旧规则不剔除公开供给', () => {
  /**
   * design.md §3.6 有效供给 10 条不含"陈旧"规则；陈旧规则属于 M6.5 SLA 扫描，
   * 仅触发 listing.stale_maintenance 待办，通知维护人员处理，不影响公开供给可见性。
   *
   * 验收点：updatedAt 30+ 天前的房源在所有公开消费者路径中可见性结论一致。
   */

  it('updatedAt 60 天前的房源在所有路径仍可见（陈旧不剔除公开供给）', async () => {
    const listing = makeValidListing({
      updatedAt: '2026-05-01T00:00:00.000Z', // 60 天前
    })
    const adapter = createFullPredicateAdapter({ listings: [listing] })

    // 列表/详情/楼内/精选/facet 全部应可见
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))
    const search = await searchListings(parseSearchInput(new URLSearchParams('')), ctx, adapter)
    const detail = await getListingBySlug(listing.slug, ctx, adapter)
    const building = await getBuildingDetail('jingan-center', ctx, adapter)
    const homepage = await getHomepage(ctx, { featuredLimit: 6 }, adapter)
    const facets = await getSearchFacets(parseSearchInput(new URLSearchParams('')), ctx, adapter)
    const inquiry = await assertEffectiveListing(listing.slug, ctx, adapter)

    expect(search.docs.some((c) => c.id === listing.id)).toBe(true)
    expect(detail?.id).toBe(listing.id)
    expect(building.supply.groups.flatMap((group) => group.listings).some((c) => c.id === listing.id)).toBe(true)
    expect(homepage.featuredListings.some((c) => c.id === listing.id)).toBe(true)
    expect(facets.totalDocs).toBeGreaterThanOrEqual(1)
    expect(inquiry?.id).toBe(listing.id)
  })

  it('updatedAt 60 天前的房源与其他失效条件叠加时按失效条件判定', async () => {
    const staleButFailed = makeValidListing({
      updatedAt: '2026-05-01T00:00:00.000Z',
      publicationStatus: 'draft',
    })
    const adapter = createFullPredicateAdapter({ listings: [staleButFailed] })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    const search = await searchListings(parseSearchInput(new URLSearchParams('')), ctx, adapter)
    const detail = await getListingBySlug(staleButFailed.slug, ctx, adapter)

    expect(search.docs.some((c) => c.id === staleButFailed.id)).toBe(false)
    expect(detail).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. 稳定分页：跨页排序稳定，listing_id 升序收束
// ---------------------------------------------------------------------------

describe('F7.6 稳定分页：跨页排序稳定', () => {
  /**
   * design.md §7.4：所有排序方式以 listing_id 升序收束，保证跨页稳定。
   * 不依赖 Array.prototype.sort 的稳定性，通过显式收束字段保证。
   */

  function makeListings(count: number): Listing[] {
    return Array.from({ length: count }, (_, i) => {
      const id = 5000 + i
      // 同权重：所有字段相同，仅 id 不同
      return makeValidListing({
        id,
        slug: `stable-${id}`,
        title: `稳定房源 ${id}`,
        rent: 20000,
        isFeatured: false,
        updatedAt: '2026-07-15T00:00:00.000Z',
      })
    })
  }

  it('推荐排序：跨页 listing_id 严格升序', async () => {
    const listings = makeListings(60)
    const adapter = createFullPredicateAdapter({ listings: listings })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    // pageSize 固定 24，60 条共 3 页
    const page1 = await searchListings(
      { ...parseSearchInput(new URLSearchParams('')), page: 1 },
      ctx,
      adapter,
    )
    const page2 = await searchListings(
      { ...parseSearchInput(new URLSearchParams('')), page: 2 },
      ctx,
      adapter,
    )
    const page3 = await searchListings(
      { ...parseSearchInput(new URLSearchParams('')), page: 3 },
      ctx,
      adapter,
    )

    // 拼接所有页 ids
    const allIds = [
      ...page1.docs.map((c) => c.id),
      ...page2.docs.map((c) => c.id),
      ...page3.docs.map((c) => c.id),
    ]
    expect(allIds).toHaveLength(60)
    // 严格升序
    for (let i = 1; i < allIds.length; i++) {
      expect(allIds[i]).toBeGreaterThan(allIds[i - 1])
    }
    // 总数对齐
    expect(page1.pagination.totalDocs).toBe(60)
    expect(page3.pagination.totalPages).toBe(3)
  })

  it('最新排序：updatedAt 同值时仍以 listing_id 升序收束', async () => {
    const listings = makeListings(50)
    const adapter = createFullPredicateAdapter({ listings: listings })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    const page1 = await searchListings(
      { ...parseSearchInput(new URLSearchParams('sort=newest')), page: 1 },
      ctx,
      adapter,
    )
    const page2 = await searchListings(
      { ...parseSearchInput(new URLSearchParams('sort=newest')), page: 2 },
      ctx,
      adapter,
    )
    const page3 = await searchListings(
      { ...parseSearchInput(new URLSearchParams('sort=newest')), page: 3 },
      ctx,
      adapter,
    )

    const allIds = [
      ...page1.docs.map((c) => c.id),
      ...page2.docs.map((c) => c.id),
      ...page3.docs.map((c) => c.id),
    ]
    // 同 updatedAt → listing_id 升序
    for (let i = 1; i < allIds.length; i++) {
      expect(allIds[i]).toBeGreaterThan(allIds[i - 1])
    }
  })

  it('页码越界（page > totalPages）返回空文档但保留 totalDocs/totalPages', async () => {
    const listings = makeListings(10)
    const adapter = createFullPredicateAdapter({ listings: listings })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    const outOfRange = await searchListings(
      { ...parseSearchInput(new URLSearchParams('')), page: 100 },
      ctx,
      adapter,
    )
    expect(outOfRange.docs).toEqual([])
    expect(outOfRange.pagination.totalDocs).toBe(10)
    expect(outOfRange.pagination.totalPages).toBe(1)
    expect(outOfRange.pagination.page).toBe(100)
  })

  it('page < 1 自动回退为 1', async () => {
    const listings = makeListings(5)
    const adapter = createFullPredicateAdapter({ listings: listings })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    const search = await searchListings(
      { ...parseSearchInput(new URLSearchParams('')), page: -1 },
      ctx,
      adapter,
    )
    expect(search.pagination.page).toBe(1)
    expect(search.docs).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// 4. 多消费者路径数据等价：差异为 0
// ---------------------------------------------------------------------------

describe('F7.6 多消费者路径数据等价（差异必须为 0）', () => {
  /**
   * 统一有效供给服务返回的 Listing 集合，所有公开消费者解析出的集合必须完全一致。
   * 这是 M4 验收门第 3 条 + F7.6 验收要求。
   */

  it('1 条有效房源：7 个消费者路径全部返回相同集合', async () => {
    const listing = makeValidListing()
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    const search = await searchListings(parseSearchInput(new URLSearchParams('')), ctx, adapter)
    const detail = await getListingBySlug(listing.slug, ctx, adapter)
    const related = await getRelatedListings(listing.slug, ctx, { limit: 6 }, adapter)
    const inquiry = await assertEffectiveListing(listing.slug, ctx, adapter)
    const building = await getBuildingDetail('jingan-center', ctx, adapter)
    const homepage = await getHomepage(ctx, { featuredLimit: 6 }, adapter)
    const facets = await getSearchFacets(parseSearchInput(new URLSearchParams('')), ctx, adapter)

    // searchListings.docs 与所有路径返回的 listing id 集合一致
    const searchIds = search.docs.map((c) => c.id)
    expect(searchIds).toContain(listing.id)
    expect(detail?.id).toBe(listing.id)
    // related 排除自身
    expect(related.some((c) => c.id === listing.id)).toBe(false)
    expect(inquiry?.id).toBe(listing.id)
    expect(building.supply.groups.flatMap((group) => group.listings).map((c) => c.id)).toEqual(searchIds)
    expect(homepage.featuredListings.map((c) => c.id)).toEqual(searchIds)
    expect(facets.totalDocs).toBe(searchIds.length)
  })

  it('10 条有效房源：所有路径返回的 id 集合相同（排序后集合相等）', async () => {
    const listings = Array.from({ length: 10 }, (_, i) =>
      makeValidListing({
        id: 6000 + i,
        slug: `eq-${i}`,
        title: `等价房源 ${i}`,
        isFeatured: i < 3, // 前 3 条精选
      }),
    )
    const adapter = createFullPredicateAdapter({ listings: listings })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    const search = await searchListings(parseSearchInput(new URLSearchParams('')), ctx, adapter)
    const building = await getBuildingDetail('jingan-center', ctx, adapter)
    const homepage = await getHomepage(ctx, { featuredLimit: 6 }, adapter)
    const facets = await getSearchFacets(parseSearchInput(new URLSearchParams('')), ctx, adapter)

    // searchListings 与 buildingDetail 供给快照是同一集合（仅排序不同）
    const searchSet = [...search.docs.map((c) => c.id)].sort()
    const buildingSet = [...building.supply.groups.flatMap((group) => group.listings).map((c) => c.id)].sort()
    expect(buildingSet).toEqual(searchSet)

    // facets.totalDocs 等于有效房源数
    expect(facets.totalDocs).toBe(searchSet.length)

    // homepage 是 searchListings 中 isFeatured=true 的子集
    const homepageIds = new Set(homepage.featuredListings.map((c) => c.id))
    for (const id of homepageIds) {
      expect(searchSet).toContain(id)
    }
    expect(homepageIds.size).toBe(3) // 前 3 条精选
  })

  it('混合有效 + 失效房源：失效不在任何路径出现', async () => {
    const valid1 = makeValidListing({ id: 7001, slug: 'mix-valid-1' })
    const valid2 = makeValidListing({ id: 7002, slug: 'mix-valid-2', isFeatured: true })
    const failDraft = makeValidListing({ id: 7003, slug: 'mix-draft', publicationStatus: 'draft' })
    const failReview = makeValidListing({ id: 7004, slug: 'mix-review', reviewStatus: 'pending' })
    // 2026-08-19 前这一条用的是「图片只有 1 张」；媒体数量移出可见性后
    // 换成供给可见性冻结，保住混合场景的失效维度数量。
    const failHold = makeValidListing({
      id: 7005,
      slug: 'mix-hold',
      supplyVisibilityHold: 'pending_recheck',
    })

    const adapter = createFullPredicateAdapter({
      listings: [valid1, valid2, failDraft, failReview, failHold],
    })
    const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

    const search = await searchListings(parseSearchInput(new URLSearchParams('')), ctx, adapter)
    const building = await getBuildingDetail('jingan-center', ctx, adapter)
    const homepage = await getHomepage(ctx, { featuredLimit: 6 }, adapter)
    const facets = await getSearchFacets(parseSearchInput(new URLSearchParams('')), ctx, adapter)

    const validIds = [7001, 7002].sort()
    const failedIds = [7003, 7004, 7005]

    // searchListings.docs 仅含有效
    expect([...search.docs.map((c) => c.id)].sort()).toEqual(validIds)
    // buildingDetail 供给快照仅含有效
    expect([...building.supply.groups.flatMap((group) => group.listings).map((c) => c.id)].sort()).toEqual(validIds)
    // facets.totalDocs 等于有效数
    expect(facets.totalDocs).toBe(validIds.length)
    // 失效不在 homepage 中
    const homepageIds = homepage.featuredListings.map((c) => c.id)
    for (const failId of failedIds) {
      expect(homepageIds).not.toContain(failId)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. 缓存失效等价性：computeAffectedTags 覆盖与幂等
// ---------------------------------------------------------------------------

describe('F7.6 缓存失效等价性', () => {
  /**
   * 同一领域事件重复调用 computeAffectedTags 必须返回相同 tag 集合（去重后）。
   * revalidateTag 调用幂等：重复调用同一 tag 等同于一次失效。
   */

  /** 构造最小 DomainEvent */
  function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
    return {
      eventId: 'evt-test-001',
      eventType: 'listing.published',
      aggregateType: 'listing',
      aggregateId: '8001',
      aggregateVersion: 1,
      occurredAt: '2026-07-25T10:00:00.000Z',
      payload: {
        listingId: 8001,
        buildingId: 200,
        city: 'shanghai',
      },
      attemptCount: 0,
      processedAt: null,
      ...overrides,
    } as unknown as DomainEvent
  }

  it('同一事件多次计算返回相同 tag 集合（去重）', () => {
    const event = makeEvent()
    const tags1 = computeAffectedTags(event)
    const tags2 = computeAffectedTags(event)
    const tags3 = computeAffectedTags(event)

    expect(new Set(tags1)).toEqual(new Set(tags2))
    expect(new Set(tags2)).toEqual(new Set(tags3))
  })

  it('revalidateTag 重复调用：TagInvalidator 接收每个 tag 仅一次的等价行为', () => {
    const event = makeEvent()
    const tags = computeAffectedTags(event)

    // 模拟 TagInvalidator：记录每个 tag 被调用次数
    const callCounts = new Map<string, number>()
    const fakeInvalidator: TagInvalidator = {
      revalidateTag(tag: string) {
        const prev = callCounts.get(tag) ?? 0
        callCounts.set(tag, prev + 1)
      },
    }

    // 模拟消费器 handle 多次调用（重试场景）
    for (let i = 0; i < 3; i++) {
      for (const tag of tags) {
        fakeInvalidator.revalidateTag(tag)
      }
    }

    // 每个 tag 都被调用 3 次（幂等：重复失效不报错）
    for (const tag of tags) {
      expect(callCounts.get(tag)).toBe(3)
    }
    // sitemap 永远在失效集合
    expect(tags).toContain('public:sitemap')
    // listing + 城市类别 tag 都在
    expect(tags).toContain('public:listing:8001')
    expect(tags).toContain('public:listings:city:shanghai')
    // building + 城市类别 tag
    expect(tags).toContain('public:building:200')
    expect(tags).toContain('public:buildings:city:shanghai')
    // 城市 home + facets
    expect(tags).toContain('public:home:shanghai')
    expect(tags).toContain('public:facets:shanghai')
  })

  it('无 city 字段时执行全城市安全失效', () => {
    const event = makeEvent({
      payload: {
        listingId: 8002,
        buildingId: 201,
        // 无 city 字段
      },
    })
    const tags = computeAffectedTags(event)
    // 无法解析城市时使用供给类别 fallback，不猜测具体城市。
    expect(tags).toContain('public:sitemap')
    expect(tags).toContain('public:listings')
    expect(tags).toContain('public:buildings')
    expect(tags).not.toContain('public:home:shanghai')
  })

  it('举报暂停事件失效集合包含 listing + 类别 + sitemap', () => {
    const event = makeEvent({
      eventType: 'report.supply_paused',
      aggregateType: 'report',
      aggregateId: '9001',
      payload: {
        targetListingId: 8003,
        city: 'shanghai',
      },
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:8003')
    expect(tags).toContain('public:listings:city:shanghai')
    expect(tags).toContain('public:home:shanghai')
    expect(tags).toContain('public:facets:shanghai')
    expect(tags).toContain('public:sitemap')
  })
})
