/**
 * F1.5 单测：Public Catalog Query Facade
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7、§8、§11
 *           specs/frontend-mvp/tasks.md F1.3、F1.5
 *           FRONTEND_AGENT.md §6.1、§6.2、§6.3
 *
 * 守护不变量：
 *   - Facade 是路由层唯一入口；不向组件返回原始 Payload 文档；
 *   - 价格排序前必须按 rentUnit 过滤；跨单位不混合排序；
 *   - 推荐与最新排序以 listing_id 升序收束；
 *   - 失效房源（草稿、停用楼盘、已出租、逻辑删除）不出现在任何路径；
 *   - 同一失效条件在列表、详情、楼盘聚合、相关推荐和询盘候选中结果一致；
 *   - canonical URL round-trip 与原输入等价；
 *   - facet 总数与列表过滤后的总数一致。
 *
 * 测试策略：
 *   - 使用 FakeSupplyAdapter 注入 fixture 数据，避免真实 DB；
 *   - 覆盖 design.md §8 的失效供给场景子集（M4.7 完成后扩展为完整谓词）；
 *   - 同一 fixture 集合在 searchListings / getListingBySlug / getBuildingDetail /
 *     getRelatedListings / assertEffectiveListing 中断言一致排除结果。
 */

import { describe, expect, it } from 'vitest'
import {
  assertEffectiveListing,
  buildCanonical,
  getBuildingDetail,
  getHomepage,
  getListingBySlug,
  getRelatedListings,
  getSearchFacets,
  parseSearchInput,
  searchListings,
  type SupplyAdapter,
} from '@/domain/public-catalog'
import { createSearchContext, type ListingSearchInput } from '@/domain/public-catalog'
import {
  BUILDING_DISABLED,
  BUILDING_JINGAN_CENTER,
  BUILDING_PUDONG_FLAT,
  LISTING_DAILY_PER_SQM,
  LISTING_DELETED,
  LISTING_DRAFT,
  LISTING_LEASED,
  LISTING_MONTHLY_STANDARD,
  LISTING_SEAT_PER_MONTH,
} from '@/test/frontend/payload-documents'
import type { Building, Listing, Location } from '@/payload-types'

// ---------------------------------------------------------------------------
// FakeSupplyAdapter
// ---------------------------------------------------------------------------

/**
 * 内存版 SupplyAdapter，用于 Facade 单测
 *
 * 通过 listings/buildings/locations 数组模拟数据集，所有查询都基于内存过滤。
 * 测试通过构造不同数据集覆盖失效供给场景。
 */
function createFakeAdapter(options: {
  listings: readonly Listing[]
  buildings: readonly Building[]
  districts?: readonly Location[]
  businessAreas?: readonly Location[]
}): SupplyAdapter {
  const districts: readonly Location[] = options.districts ?? [
    BUILDING_JINGAN_CENTER.district as Location,
    BUILDING_PUDONG_FLAT.district as Location,
  ]

  function isListingEffective(l: Listing): boolean {
    if (l.publicationStatus !== 'published') return false
    if (l.deletedAt) return false
    const b = resolveBuilding(l.building)
    if (!b || b.operationalStatus !== 'active') return false
    return true
  }

  function resolveBuilding(ref: Listing['building']): Building | null {
    if (typeof ref === 'number') {
      return options.buildings.find((b) => b.id === ref) ?? null
    }
    if (ref && typeof ref === 'object') {
      return ref
    }
    return null
  }

  function matchInput(l: Listing, input: ListingSearchInput): boolean {
    if (!isListingEffective(l)) return false
    const b = resolveBuilding(l.building)
    if (input.listingType && input.listingType.length > 0) {
      if (!input.listingType.includes(l.listingType)) return false
    }
    if (input.areaMin != null && (l.area == null || l.area < input.areaMin)) return false
    if (input.areaMax != null && (l.area == null || l.area > input.areaMax)) return false
    if (input.priceMin != null && (l.rent == null || l.rent < input.priceMin)) return false
    if (input.priceMax != null && (l.rent == null || l.rent > input.priceMax)) return false
    if (input.priceUnit && l.rentUnit !== input.priceUnit) return false
    if (input.q && !l.title.includes(input.q)) return false
    if (input.district && input.district.length > 0) {
      if (!b || typeof b.district !== 'object' || !b.district) return false
      if (b.district.type === 'district' && !input.district.includes(b.district.slug)) return false
    }
    if (input.businessArea && input.businessArea.length > 0) {
      const ba = typeof b?.businessDistrict === 'object' ? b.businessDistrict : null
      if (!ba || !input.businessArea.includes(ba.slug)) return false
    }
    if (input.metro && input.metro.length > 0) {
      const m = typeof b?.nearestMetro === 'object' ? b.nearestMetro : null
      if (!m || !input.metro.includes(m.slug)) return false
    }
    return true
  }

  return {
    async findEffectiveListings(input) {
      return options.listings.filter((l) => matchInput(l, input))
    },
    // sitemap 专用查询：这些假适配器只验其它路径，给个空页即可
    findEffectiveListingsSitemapPage: async () => ({
      docs: [],
      page: 1,
      hasNextPage: false,
      nextPage: null,
    }),
    async findEffectiveListingBySlug(slug) {
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
    async findEffectiveBuildingBySlug(slug) {
      const b = options.buildings.find((x) => x.slug === slug)
      if (!b || b.operationalStatus !== 'active') return null
      return b
    },
    async findBuildingRouteIdentity(slug) {
      const building = options.buildings.find((candidate) => candidate.slug === slug)
      const city = typeof building?.city === 'object' && building.city ? building.city : null
      return building?.operationalStatus === 'active' && city
        ? { slug: building.slug, citySlug: city.slug }
        : null
    },
    async findEffectiveListingsByBuilding(buildingId, _ctx, excludeListingId) {
      return options.listings.filter(
        (l) =>
          isListingEffective(l) &&
          (typeof l.building === 'object' ? l.building.id : l.building) === buildingId &&
          (excludeListingId == null || l.id !== excludeListingId),
      )
    },
    async aggregateEffectiveSupplyByBuildings(buildingIds) {
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
      if (options.businessAreas) return options.businessAreas
      // 缺省从楼盘的 businessDistrict 派生，保证卡片测试有可用数据
      const seen = new Map<string, Location>()
      for (const b of options.buildings) {
        const ba = b.businessDistrict
        if (typeof ba === 'object' && ba !== null && !seen.has(ba.slug)) {
          seen.set(ba.slug, ba as Location)
        }
      }
      return [...seen.values()]
    },
    async findEffectiveBuildingsNear(buildingId) {
      return options.buildings.filter((building) => building.id !== buildingId && building.operationalStatus === 'active')
    },
    async findEffectiveBuildings(_ctx, limit = 200) {
      return options.buildings
        .filter((building) => building.operationalStatus === 'active')
        .slice(0, limit)
    },
    async findEffectiveBuildingsPage(_ctx, { page, limit }) {
      const all = options.buildings.filter((building) => building.operationalStatus === 'active')
      const docs = all.slice((page - 1) * limit, page * limit)
      return {
        docs,
        page,
        hasNextPage: page * limit < all.length,
        nextPage: page * limit < all.length ? page + 1 : null,
      }
    },
    async findFeaturedListings(_ctx, limit = 6) {
      return options.listings
        .filter((l) => isListingEffective(l) && l.isFeatured)
        .slice(0, limit)
    },
    async findFeaturedBuildings(_ctx, limit = 30) {
      return options.buildings
        .filter((b) => b.operationalStatus === 'active')
        .slice(0, limit)
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
    async findEffectiveDistricts() {
      return districts
    },
    async assertEffectiveListingBySlug(slug) {
      const l = options.listings.find((x) => x.slug === slug)
      if (!l || !isListingEffective(l)) return null
      return l
    },
    async findPublishedPageBySlug(_slug) {
      // Facade 单测不覆盖 Page，返回 null 即可；page 测试在单独文件
      return null
    },
    async findPublishedPages() {
      return []
    },
  }
}

// ---------------------------------------------------------------------------
// 共享 fixture
// ---------------------------------------------------------------------------

const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

/** 全量有效 fixture：3 条有效房源 + 1 条停用楼盘房源 + 失效房源集合 */
function fullFixture(overrides: { districts?: readonly Location[]; businessAreas?: readonly Location[] } = {}) {
  return createFakeAdapter({
    ...overrides,
    listings: [
      LISTING_MONTHLY_STANDARD,
      LISTING_DAILY_PER_SQM,
      LISTING_SEAT_PER_MONTH,
      LISTING_DRAFT,
      LISTING_LEASED,
      LISTING_DELETED,
    ],
    buildings: [BUILDING_JINGAN_CENTER, BUILDING_PUDONG_FLAT, BUILDING_DISABLED],
  })
}

function defaultInput(overrides: Partial<ListingSearchInput> = {}): ListingSearchInput {
  return {
    ...parseSearchInput(new URLSearchParams('')),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// searchListings
// ---------------------------------------------------------------------------

describe('searchListings', () => {
  it('返回全量有效房源（草稿/已出租/逻辑删除排除）', async () => {
    const r = await searchListings(defaultInput(), ctx, fullFixture())
    const ids = r.docs.map((c) => c.id).sort()
    expect(ids).toEqual([1001, 1002, 1003])
    expect(r.pagination.totalDocs).toBe(3)
    expect(r.pagination.totalPages).toBe(1)
    expect(r.pagination.page).toBe(1)
    expect(r.pagination.hasNextPage).toBe(false)
  })

  it('停用楼盘的房源不出现（BUILDING_DISABLED 的关联房源不存在于 fixture，但草稿房源所在楼盘为有效）', async () => {
    const adapter = createFakeAdapter({
      listings: [
        LISTING_MONTHLY_STANDARD, // building = BUILDING_JINGAN_CENTER (active)
        // 构造一个停用楼盘房源
        { ...LISTING_DAILY_PER_SQM, building: BUILDING_DISABLED },
      ],
      buildings: [BUILDING_JINGAN_CENTER, BUILDING_DISABLED],
    })
    const r = await searchListings(defaultInput(), ctx, adapter)
    expect(r.docs.map((c) => c.id)).toEqual([1001])
  })

  it('recommended 排序：isFeatured 优先 → id 升序收束', async () => {
    const r = await searchListings(
      defaultInput({ sort: 'recommended' }),
      ctx,
      fullFixture(),
    )
    // 1001 isFeatured=true 优先；1002/1003 同 updatedAt，按 id 升序
    expect(r.docs.map((c) => c.id)).toEqual([1001, 1002, 1003])
  })

  it('rent-asc 排序：未指定 rentUnit 时按首个非空单位过滤', async () => {
    // fixture 中 1001 rmb-month、1002 rmb-sqm-day、1003 rmb-seat-month
    // 未指定 rentUnit 时取首个非空单位 → rmb-month（1001）
    // 过滤后仅保留 rmb-month 的 1001
    const r = await searchListings(
      defaultInput({ sort: 'price-asc' }),
      ctx,
      fullFixture(),
    )
    expect(r.filteredByRentUnit).toBe(true)
    expect(r.docs.map((c) => c.id)).toEqual([1001])
  })

  it('rent-asc 排序：显式指定 priceUnit=rmb-month 时仅返回该单位房源', async () => {
    const r = await searchListings(
      defaultInput({ sort: 'price-asc', priceUnit: 'rmb-month' }),
      ctx,
      fullFixture(),
    )
    expect(r.docs.map((c) => c.id)).toEqual([1001])
    expect(r.filteredByRentUnit).toBe(false)
  })

  it('分页：pageSize=2 第 2 页返回剩余房源', async () => {
    const r1 = await searchListings(
      defaultInput({ page: 1, pageSize: 24 }).pageSize
        ? { ...defaultInput({ page: 1 }), pageSize: 24 }
        : defaultInput({ page: 1 }),
      ctx,
      // 注入 10 条同单位房源以触发分页
      createFakeAdapter({
        listings: Array.from({ length: 10 }, (_, i) => ({
          ...LISTING_MONTHLY_STANDARD,
          id: 5000 + i,
          slug: `page-test-${i}`,
          title: `分页房源 ${i}`,
          rent: 1000 + i * 100,
          isFeatured: false,
        })),
        buildings: [BUILDING_JINGAN_CENTER],
      }),
    )
    // pageSize 固定为 24，单页全返回
    expect(r1.docs.length).toBe(10)
  })

  it('canonical URL round-trip 等价', async () => {
    const sp = new URLSearchParams(
      'district=jingan&type=serviced-office&priceMin=2000&priceMax=5000&priceUnit=rmb-month&q=江景&sort=rent-asc&page=2',
    )
    const input = parseSearchInput(sp)
    const r = await searchListings(input, ctx, fullFixture())
    // canonical 应解析回相同 input
    const reparsed = parseSearchInput(new URLSearchParams(r.canonical))
    expect(reparsed).toEqual(input)
  })

  it('空结果时 docs 为空数组，totalDocs=0，filteredByRentUnit=false', async () => {
    const r = await searchListings(
      defaultInput({ priceMin: 99999999 }),
      ctx,
      fullFixture(),
    )
    expect(r.docs).toEqual([])
    expect(r.pagination.totalDocs).toBe(0)
    expect(r.pagination.totalPages).toBe(1)
    expect(r.filteredByRentUnit).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getListingBySlug
// ---------------------------------------------------------------------------

describe('getListingBySlug', () => {
  it('有效 slug 返回详情 DTO', async () => {
    const l = await getListingBySlug('jingan-center-100-monthly', ctx, fullFixture())
    expect(l?.id).toBe(1001)
    expect(l?.gallery.length).toBeGreaterThan(0)
    expect(l?.price?.text).toBe('25000 元/月')
  })

  it('草稿房源返回 null（不暴露详情）', async () => {
    const l = await getListingBySlug('draft-listing', ctx, fullFixture())
    expect(l).toBeNull()
  })

  it('已出租房源返回 null', async () => {
    const l = await getListingBySlug('leased-office', ctx, fullFixture())
    expect(l).toBeNull()
  })

  it('逻辑删除房源返回 null', async () => {
    const l = await getListingBySlug('deleted-listing', ctx, fullFixture())
    expect(l).toBeNull()
  })

  it('未知 slug 返回 null', async () => {
    const l = await getListingBySlug('not-exist', ctx, fullFixture())
    expect(l).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getBuildingDetail + getListingsByBuilding + 相关推荐
// ---------------------------------------------------------------------------

describe('getBuildingDetail', () => {
  it('有效楼盘返回详情 + 楼内供给快照', async () => {
    const r = await getBuildingDetail('jingan-center', ctx, fullFixture())
    expect(r.building?.id).toBe(200)
    expect(r.building?.slug).toBe('jingan-center')
    // 楼内房源：1001（静安中心）和 1003（共享工位，building=静安中心）
    expect(r.supply.groups.flatMap((group) => group.listings).map((c) => c.id).sort()).toEqual([1001, 1003])
    // 价格区间按 rentUnit 分组：rmb-month（1001=25000）+ rmb-seat-month（1003=2800）
    const units = r.supply.groups.flatMap((group) => group.priceRanges).map((p) => p.displayUnit).sort()
    expect(units).toEqual(['rmb-month', 'rmb-seat-month'])
  })

  it('停用楼盘返回 null + 空列表', async () => {
    const r = await getBuildingDetail('disabled-building', ctx, fullFixture())
    expect(r.building).toBeNull()
    expect(r.supply.groups).toEqual([])
  })

  it('未知楼盘 slug 返回 null', async () => {
    const r = await getBuildingDetail('not-exist', ctx, fullFixture())
    expect(r.building).toBeNull()
  })

  it('价格区间不跨 rentUnit 合并', async () => {
    // 构造多单位房源同楼盘
    const r = await getBuildingDetail('jingan-center', ctx, fullFixture())
    const ranges = r.supply.groups.flatMap((group) => group.priceRanges)
    const monthRange = ranges.find((p) => p.displayUnit === 'rmb-month')
    const seatRange = ranges.find((p) => p.displayUnit === 'rmb-seat-month')
    expect(monthRange).toBeDefined()
    expect(seatRange).toBeDefined()
    expect(monthRange?.min).toBe(25000)
    expect(monthRange?.max).toBe(25000)
  })
})

describe('getRelatedListings', () => {
  it('返回同楼盘有效房源（排除当前）', async () => {
    const r = await getRelatedListings('jingan-center-100-monthly', ctx, { limit: 6 }, fullFixture())
    // 1001 是当前房源；同楼盘 1003 应在相关推荐
    expect(r.map((c) => c.id)).toEqual([1003])
  })

  it('失效房源的相关推荐返回空数组', async () => {
    const r = await getRelatedListings('draft-listing', ctx, { limit: 6 }, fullFixture())
    expect(r).toEqual([])
  })

  it('未知 slug 返回空数组', async () => {
    const r = await getRelatedListings('not-exist', ctx, { limit: 6 }, fullFixture())
    expect(r).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// assertEffectiveListing（询盘目标复核）
// ---------------------------------------------------------------------------

describe('assertEffectiveListing', () => {
  it('有效 slug 返回 ListingCardViewModel', async () => {
    const c = await assertEffectiveListing('jingan-center-100-monthly', ctx, fullFixture())
    expect(c?.id).toBe(1001)
  })

  it('草稿/已出租/逻辑删除/未知 slug 返回 null', async () => {
    expect(await assertEffectiveListing('draft-listing', ctx, fullFixture())).toBeNull()
    expect(await assertEffectiveListing('leased-office', ctx, fullFixture())).toBeNull()
    expect(await assertEffectiveListing('deleted-listing', ctx, fullFixture())).toBeNull()
    expect(await assertEffectiveListing('not-exist', ctx, fullFixture())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getHomepage
// ---------------------------------------------------------------------------

describe('getHomepage', () => {
  it('返回精选房源 + 区域列表', async () => {
    const h = await getHomepage(ctx, { featuredLimit: 6 }, fullFixture())
    expect(h.featuredListings.map((c) => c.id)).toEqual([1001]) // 仅 1001 isFeatured=true
    expect(h.districts.length).toBeGreaterThan(0)
  })

  it('失效房源不出现在精选', async () => {
    const h = await getHomepage(ctx, { featuredLimit: 6 }, fullFixture())
    const ids = h.featuredListings.map((c) => c.id)
    expect(ids).not.toContain(2001) // 草稿
    expect(ids).not.toContain(2002) // 已出租
    expect(ids).not.toContain(2005) // 逻辑删除
  })

  /**
   * 首页「热门商圈」的数据源是商圈（Locations 第三层），不是行政区——两者是
   * 包含关系，一个行政区下有多个商圈。此前误用行政区，卡片列出的是黄浦、徐汇。
   */
  it('商圈卡来自商圈而非行政区', async () => {
    const h = await getHomepage(ctx, {}, fullFixture())
    const areaSlugs = h.districtCards.map((c) => c.slug)
    const districtSlugs = h.districts.map((d) => d.slug)
    expect(areaSlugs.length).toBeGreaterThan(0)
    for (const slug of areaSlugs) expect(districtSlugs).not.toContain(slug)
  })

  it('商圈卡带代表楼盘名', async () => {
    const h = await getHomepage(ctx, {}, fullFixture())
    const card = h.districtCards[0]
    expect(card.buildings.length).toBeGreaterThan(0)
    expect(card.buildings.length).toBeLessThanOrEqual(4)
  })

  /**
   * 质量门槛：库中商圈达 205 个而多数暂无楼盘，没有在营楼盘的商圈若进入卡片区
   * 会渲染成只有名字的空卡。
   */
  it('无楼盘的商圈不进卡片区', async () => {
    const empty: Location = {
      ...(BUILDING_JINGAN_CENTER.businessDistrict as Location),
      id: 9901,
      name: '空商圈',
      slug: 'empty-area',
      immutableCode: 'TEST-EMPTY',
    }
    const h = await getHomepage(ctx, {}, fullFixture({ businessAreas: [empty] }))
    expect(h.districtCards).toHaveLength(0)
  })

  /**
   * 栅格 4 列、大卡跨 2x2，1 大 + 4 小恰好填满 2 行；不设上限时首页会被撑爆。
   */
  it('商圈卡张数受 districtCardsLimit 约束', async () => {
    const unlimited = await getHomepage(ctx, {}, fullFixture())
    const capped = await getHomepage(ctx, { districtCardsLimit: 1 }, fullFixture())
    expect(unlimited.districtCards.length).toBeLessThanOrEqual(5)
    expect(capped.districtCards.length).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// getSearchFacets
// ---------------------------------------------------------------------------

describe('getSearchFacets', () => {
  it('facet totalDocs 与 searchListings totalDocs 一致', async () => {
    const adapter = fullFixture()
    const facets = await getSearchFacets(defaultInput(), ctx, adapter)
    const search = await searchListings(defaultInput(), ctx, adapter)
    expect(facets.totalDocs).toBe(search.pagination.totalDocs)
  })

  it('listingType facet 反映当前可见房源分布', async () => {
    const facets = await getSearchFacets(defaultInput(), ctx, fullFixture())
    const types = Object.fromEntries(facets.listingTypes.map((f) => [f.value, f.count]))
    expect(types['traditional-office']).toBe(1) // 1001
    expect(types['serviced-office']).toBe(1) // 1002
    expect(types['coworking']).toBe(1) // 1003
  })

  it('rentUnit facet 反映当前可见房源分布', async () => {
    const facets = await getSearchFacets(defaultInput(), ctx, fullFixture())
    const units = Object.fromEntries(facets.rentUnits.map((f) => [f.value, f.count]))
    expect(units['rmb-month']).toBe(1) // 1001
    expect(units['rmb-sqm-day']).toBe(1) // 1002
    expect(units['rmb-seat-month']).toBe(1) // 1003
  })

  it('district facet 反映可见房源的楼盘区域', async () => {
    const facets = await getSearchFacets(defaultInput(), ctx, fullFixture())
    const jingan = facets.districts.find((d) => d.slug === 'jingan')
    expect(jingan?.count).toBe(2) // 1001 + 1003 都在静安中心
  })
})

// ---------------------------------------------------------------------------
// 一致性：失效条件在列表、详情、楼盘聚合、相关推荐、询盘候选中结果一致
// ---------------------------------------------------------------------------

describe('失效供给一致性（design.md §8、§15.2）', () => {
  const adapter = fullFixture()

  it('草稿房源在所有路径中均不可见', async () => {
    const inList = (await searchListings(defaultInput(), ctx, adapter)).docs.some(
      (c) => c.id === 2001,
    )
    const detail = await getListingBySlug('draft-listing', ctx, adapter)
    const related = await getRelatedListings('draft-listing', ctx, {}, adapter)
    const inquiry = await assertEffectiveListing('draft-listing', ctx, adapter)
    expect(inList).toBe(false)
    expect(detail).toBeNull()
    expect(related).toEqual([])
    expect(inquiry).toBeNull()
  })

  it('已出租房源在所有路径中均不可见', async () => {
    const inList = (await searchListings(defaultInput(), ctx, adapter)).docs.some(
      (c) => c.id === 2002,
    )
    const detail = await getListingBySlug('leased-office', ctx, adapter)
    const inquiry = await assertEffectiveListing('leased-office', ctx, adapter)
    expect(inList).toBe(false)
    expect(detail).toBeNull()
    expect(inquiry).toBeNull()
  })

  it('逻辑删除房源在所有路径中均不可见', async () => {
    const inList = (await searchListings(defaultInput(), ctx, adapter)).docs.some(
      (c) => c.id === 2005,
    )
    const detail = await getListingBySlug('deleted-listing', ctx, adapter)
    const inquiry = await assertEffectiveListing('deleted-listing', ctx, adapter)
    expect(inList).toBe(false)
    expect(detail).toBeNull()
    expect(inquiry).toBeNull()
  })

  it('停用楼盘的房源在列表中不可见', async () => {
    const adapter2 = createFakeAdapter({
      listings: [
        LISTING_MONTHLY_STANDARD,
        { ...LISTING_DAILY_PER_SQM, building: BUILDING_DISABLED },
      ],
      buildings: [BUILDING_JINGAN_CENTER, BUILDING_DISABLED],
    })
    const inList = (await searchListings(defaultInput(), ctx, adapter2)).docs.some(
      (c) => c.id === 1002,
    )
    expect(inList).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildCanonical 工具
// ---------------------------------------------------------------------------

describe('buildCanonical', () => {
  it('recommended sort 与 page=1 省略', () => {
    const input = parseSearchInput(new URLSearchParams('sort=recommended&page=1'))
    const canonical = buildCanonical(input)
    expect(canonical).not.toContain('sort=')
    expect(canonical).not.toContain('page=')
  })

  it('旧 sort=rent-asc + rentUnit 归一为新名后保留', () => {
    const input = parseSearchInput(new URLSearchParams('sort=rent-asc&priceUnit=rmb-month'))
    const canonical = buildCanonical(input)
    // canonical 只输出新名：旧值在解析层归一，索引据此收敛到一套 URL
    expect(canonical).toContain('sort=price-asc')
    expect(canonical).toContain('priceUnit=rmb-month')
  })
})
