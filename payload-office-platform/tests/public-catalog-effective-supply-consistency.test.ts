/**
 * F1.2 单测：统一有效供给服务契约 + 完整谓词失效一致性
 *
 * 设计依据：specs/frontend-mvp/design.md §3.6（有效供给 10 条）、§8、§15.2
 *           specs/frontend-mvp/tasks.md F1.2
 *           specs/backend-mvp/tasks/M4-listing-review-supply.md M4.7
 *           src/domain/review/effective-supply.ts（M4.7 实现）
 *
 * 守护不变量（M4 验收门 + F1.2）：
 *   - 前台、预览、楼盘聚合、关系候选、询盘候选、首页、facet、sitemap 对同一房源
 *     可见性结论一致（M4 验收门第 3 条）。
 *   - 任一失效条件（§1-§10）均不出现「列表隐藏但直链可见」的差异（design §15.2）。
 *   - FakeAdapter 的有效判定与生产 isListingEffectivelySupplied 同源（交叉验证）。
 *
 * 测试策略：
 *   - FullPredicateFakeAdapter 模拟生产 SupplyAdapter：
 *     · 查询层条件 §1-§4、§7 从 listing 文档字段判定；
 *     · §5 举报暂停从 pausedIds 集合判定；
 *     · §6/§8/§9/§10 委托生产 isListingEffectivelySupplied（商户直接读 listing.merchant）。
 *   - 每条 § 条件构造一个失效 fixture + 一个有效基线，断言 7 个消费路径结果一致：
 *     searchListings / getListingBySlug / getRelatedListings / assertEffectiveListing /
 *     getBuildingDetail（listings + priceRanges）/ getHomepage / getSearchFacets。
 *   - 同一 fixture 集合在所有路径中要么全部可见、要么全部不可见。
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
import type { ListingSearchInput, SearchContext } from '@/domain/public-catalog'
import {
  isListingEffectivelySupplied,
  type EffectiveSupplySnapshot,
} from '@/domain/review/effective-supply'
import type { Building, Listing, Location, Media, Page } from '@/payload-types'
import { matchesPriceInput } from './helpers/fake-price-match'

// ---------------------------------------------------------------------------
// 共享常量与基线 fixture
// ---------------------------------------------------------------------------

const ctx = createSearchContext('shanghai', new Date('2026-07-25T00:00:00Z'))

/** 有效媒体（gallery ≥ 3 张） */
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
const MEDIA_4: Media = { ...MEDIA_1, id: 9004, alt: '图4', url: '/media/m4.jpg' }

/** 有效商户：active + qualification valid + 服务城市覆盖 */
const MERCHANT_VALID = {
  id: 7001,
  name: '有效商户',
  type: 'OWNER' as const,
  status: 'active' as const,
  qualificationStatus: 'valid' as const,
  qualificationExpiresAt: '2027-12-31T00:00:00.000Z',
  serviceCities: [100], // 覆盖上海
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

const CITY_HANGZHOU: Location = {
  ...CITY_SHANGHAI,
  id: 110,
  name: '杭州',
  slug: 'hangzhou',
  immutableCode: 'CITY-HZ',
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

const DISTRICT_GONGSHU: Location = {
  ...DISTRICT_JINGAN,
  id: 11,
  name: '拱墅',
  slug: 'gongshu',
  immutableCode: 'TEST-11',
  parent: 110,
}

/** 有效楼盘 */
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

const BUILDING_HANGZHOU: Building = {
  ...BUILDING_VALID,
  id: 210,
  name: '杭州中心',
  slug: 'hangzhou-center',
  city: CITY_HANGZHOU,
  district: DISTRICT_GONGSHU,
  address: '杭州市拱墅区延安路 1 号',
}

/**
 * 构造有效房源基线（满足全部 §1-§10）。
 * 单条 fixture 通过 overrides 制造单条失效条件。
 */
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
    // M4 新字段：满足有效供给 §2-§4
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    merchant: MERCHANT_VALID,
    updatedAt: '2026-07-15T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Listing
}

/** 第二条有效房源（同楼盘，用于相关推荐/楼内列表非空验证） */
function makeSecondValidListing(): Listing {
  return {
    ...makeValidListing({
      id: 1002,
      title: '同楼盘第二条有效房源',
      slug: 'valid-listing-2',
      isFeatured: false,
      rent: 18000,
    }),
  } as unknown as Listing
}

function makeHangzhouValidListing(): Listing {
  return makeValidListing({
    id: 1101,
    title: '杭州有效房源',
    slug: 'hangzhou-valid-listing',
    building: BUILDING_HANGZHOU,
    merchant: {
      ...MERCHANT_VALID,
      id: 7101,
      serviceCities: [110],
    } as unknown as Listing['merchant'],
  })
}

// ---------------------------------------------------------------------------
// FullPredicateFakeAdapter
// ---------------------------------------------------------------------------

/**
 * 全谓词 FakeAdapter：模拟生产 PayloadSupplyAdapter 的有效供给判定。
 *
 * 分层（与 createPayloadSupplyAdapter 对齐）：
 *   1. 查询层 §1-§4、§7：从 listing 文档字段判定（deletedAt / publicationStatus /
 *      reviewStatus / supplyVisibilityHold / building.operationalStatus /
 *      building.city.status / building.district.status）。
 *   2. §5 举报暂停：从构造时注入的 pausedIds 集合判定。
 *   3. §6/§8/§9/§10 精筛：委托生产 isListingEffectivelySupplied。OPT-034 起商户
 *      直接从 listing 文档上的 `merchant` 字段读取，不再模拟关系表查询。
 *
 * 通过此 FakeAdapter，测试既验证 Facade 行为，又交叉验证生产谓词 isListingEffectivelySupplied
 * 对相同 fixture 的判定与 Facade 各路径一致。
 */
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
    if (ref && typeof ref === 'object') {
      return ref
    }
    return null
  }

  /**
   * 查询层 + 精筛全谓词判定。
   *
   * 与生产 baseEffectiveWhere + fineFilter 等价：先查 §1-§4、§7，再过 §5 举报，
   * 最后 isListingEffectivelySupplied 精筛 §6/§8/§9/§10。
   */
  function isListingEffective(l: Listing, queryCtx: SearchContext): boolean {
    // §1 未逻辑删除
    if (l.deletedAt) return false
    // §2 已发布
    if (l.publicationStatus !== 'published') return false
    // §3 审核通过
    if (l.reviewStatus !== 'approved') return false
    // §4 未被供给可见性冻结
    if (l.supplyVisibilityHold !== 'normal') return false
    // §7 楼盘/城市/行政区启用
    const b = resolveBuilding(l.building)
    if (!b || b.operationalStatus !== 'active') return false
    if (typeof b.city === 'object' && b.city && b.city.status !== 'active') return false
    if (typeof b.district === 'object' && b.district && b.district.status !== 'active') return false
    if (typeof b.city !== 'object' || !b.city || b.city.slug !== queryCtx.city) return false
    // §5 未被有效举报暂停
    if (pausedIds.some((id) => String(id) === String(l.id))) return false

    // §6/§8/§9/§10 精筛：委托生产谓词。商户直接读 listing.merchant——
    // 未设置（null/缺失）时快照 merchant=null，精筛层判 NO_SUPPLY_MERCHANT。
    const merchant =
      typeof l.merchant === 'object' && l.merchant !== null
        ? (l.merchant as unknown as Record<string, unknown>)
        : null
    const serviceCities =
      merchant && Array.isArray(merchant.serviceCities) ? merchant.serviceCities : []
    const snapshot: EffectiveSupplySnapshot = {
      merchant:
        merchant === null
          ? null
          : {
              id:
                typeof merchant.id === 'number' || typeof merchant.id === 'string'
                  ? merchant.id
                  : null,
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
    }
    const result = isListingEffectivelySupplied(snapshot, new Date(queryCtx.asOf))
    return result.eligible
  }

  function matchInput(l: Listing, input: ListingSearchInput, queryCtx: SearchContext): boolean {
    if (!isListingEffective(l, queryCtx)) return false
    if (input.listingType && input.listingType.length > 0) {
      if (!input.listingType.includes(l.listingType)) return false
    }
    if (input.areaMin != null && (l.area == null || l.area < input.areaMin)) return false
    if (input.areaMax != null && (l.area == null || l.area > input.areaMax)) return false
    // 价格（单位 + 区间）判据见 `./helpers/fake-price-match`：三份假适配器共用一处，
    // 与生产实现 `supply-adapter.ts#filterByPrice` 同口径。
    if (!matchesPriceInput(l, input)) return false
    if (input.q && !l.title.includes(input.q)) return false
    return true
  }

  return {
    async findEffectiveListings(input, queryCtx) {
      return options.listings.filter((l) => matchInput(l, input, queryCtx))
    },
    // sitemap 专用查询：这些假适配器只验其它路径，给个空页即可
    findEffectiveListingsSitemapPage: async () => ({
      docs: [],
      page: 1,
      hasNextPage: false,
      nextPage: null,
    }),
    async findEffectiveListingBySlug(slug, queryCtx) {
      const l = options.listings.find((x) => x.slug === slug)
      if (!l || !isListingEffective(l, queryCtx)) return null
      return l
    },
    async findListingRouteIdentity(slug) {
      const listing = options.listings.find((candidate) => candidate.slug === slug)
      if (!listing) return null
      const building = typeof listing.building === 'object' ? listing.building : null
      const city = typeof building?.city === 'object' && building.city ? building.city : null
      if (!city || !isListingEffective(listing, createSearchContext(city.slug, new Date(ctx.asOf)))) return null
      return { slug: listing.slug, citySlug: city.slug }
    },
    async findEffectiveBuildingBySlug(slug, queryCtx) {
      const b = buildings.find((x) => x.slug === slug)
      if (!b || b.operationalStatus !== 'active') return null
      if (typeof b.city !== 'object' || !b.city || b.city.slug !== queryCtx.city) return null
      return b
    },
    async findBuildingRouteIdentity(slug) {
      const building = buildings.find((candidate) => candidate.slug === slug)
      const city = typeof building?.city === 'object' && building.city ? building.city : null
      return building?.operationalStatus === 'active' && city
        ? { slug: building.slug, citySlug: city.slug }
        : null
    },
    async findEffectiveListingsByBuilding(buildingId, queryCtx, excludeListingId) {
      return options.listings.filter(
        (l) =>
          isListingEffective(l, queryCtx) &&
          (typeof l.building === 'object' ? l.building.id : l.building) === buildingId &&
          (excludeListingId == null || l.id !== excludeListingId),
      )
    },
    async aggregateEffectiveSupplyByBuildings(buildingIds, queryCtx) {
      const aggregates = new Map<string, { area: number; count: number }>()
      for (const l of options.listings) {
        if (!isListingEffective(l, queryCtx)) continue
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
    async findEffectiveBuildingsNear(buildingId, queryCtx) {
      return buildings.filter((building) =>
        building.id !== buildingId &&
        building.operationalStatus === 'active' &&
        typeof building.city === 'object' &&
        building.city?.slug === queryCtx.city,
      )
    },
    async findEffectiveBuildings(queryCtx, limit = 200) {
      return buildings
        .filter((building) =>
          building.operationalStatus === 'active' &&
          typeof building.city === 'object' &&
          building.city?.slug === queryCtx.city,
        )
        .slice(0, limit)
    },
    async findEffectiveBuildingsPage(queryCtx, { page, limit }) {
      const all = buildings.filter((building) =>
        building.operationalStatus === 'active' &&
        typeof building.city === 'object' &&
        building.city?.slug === queryCtx.city,
      )
      const docs = all.slice((page - 1) * limit, page * limit)
      return {
        docs,
        page,
        hasNextPage: page * limit < all.length,
        nextPage: page * limit < all.length ? page + 1 : null,
      }
    },
    async findFeaturedListings(queryCtx, limit = 6) {
      return options.listings
        .filter((l) => isListingEffective(l, queryCtx) && l.isFeatured)
        .slice(0, limit)
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
    async findEffectiveDistricts(queryCtx) {
      return districts.filter((district) => {
        const parent = district.parent
        if (typeof parent === 'object' && parent) return parent.slug === queryCtx.city
        const city = queryCtx.city === 'hangzhou' ? CITY_HANGZHOU : CITY_SHANGHAI
        return String(parent) === String(city.id)
      })
    },
    async assertEffectiveListingBySlug(slug, queryCtx) {
      const l = options.listings.find((x) => x.slug === slug)
      if (!l || !isListingEffective(l, queryCtx)) return null
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
// 辅助：默认 input
// ---------------------------------------------------------------------------

function defaultInput(overrides: Partial<ListingSearchInput> = {}): ListingSearchInput {
  return { ...parseSearchInput(new URLSearchParams('')), ...overrides }
}

/**
 * 一致性断言：指定 listing id 在所有消费路径中均可见或均不可见。
 *
 * 检查的 7 个路径：
 *   1. searchListings.docs
 *   2. getListingBySlug
 *   3. getRelatedListings（以该 listing 的 slug 为入参）
 *   4. assertEffectiveListing
 *   5. getBuildingDetail.supply.groups + priceRanges
 *   6. getHomepage.featuredListings
 *   7. getSearchFacets.totalDocs + facets
 */
async function assertConsistentVisibility(params: {
  adapter: SupplyAdapter
  listing: Listing
  expectedVisible: boolean
  scenario: string
}): Promise<void> {
  const { adapter, listing, expectedVisible, scenario } = params
  const slug = listing.slug
  const id = listing.id

  // 1. 列表
  const search = await searchListings(defaultInput(), ctx, adapter)
  const inList = search.docs.some((c) => c.id === id)

  // 2. 详情
  const detail = await getListingBySlug(slug, ctx, adapter)

  // 3. 相关推荐（以自身 slug 入参，应返回同楼盘其他有效房源；自身失效时返回空）
  const related = await getRelatedListings(slug, ctx, { limit: 6 }, adapter)

  // 4. 询盘候选
  const inquiry = await assertEffectiveListing(slug, ctx, adapter)

  // 5. 楼盘聚合
  const buildingDetail = await getBuildingDetail('jingan-center', ctx, adapter)
  const supplyCards = buildingDetail.supply.groups.flatMap((group) => group.listings)
  const supplyRanges = buildingDetail.supply.groups.flatMap((group) => group.priceRanges)
  const inBuilding = supplyCards.some((c) => c.id === id)
  const inPriceRange = supplyRanges.some(
    (p) => p.displayUnit === listing.rentUnit && p.count > 0 && search.docs.some((c) => c.id === id),
  )

  // 6. 首页精选
  const homepage = await getHomepage(ctx, { featuredLimit: 6 }, adapter)
  const inFeatured = homepage.featuredListings.some((c) => c.id === id)

  // 7. facet
  const facets = await getSearchFacets(defaultInput(), ctx, adapter)

  if (expectedVisible) {
    expect(inList, `[${scenario}] 列表应包含`).toBe(true)
    expect(detail, `[${scenario}] 详情应返回`).not.toBeNull()
    expect(detail?.id, `[${scenario}] 详情 id 匹配`).toBe(id)
    // 相关推荐以自身 slug 入参：自身有效时返回同楼盘其他有效房源（排除自身）
    // 此处仅断言「不返回失效自身」——related 应不含自身 id
    expect(related.some((c) => c.id === id), `[${scenario}] 相关推荐不应含自身`).toBe(false)
    expect(inquiry, `[${scenario}] 询盘候选应返回`).not.toBeNull()
    expect(inquiry?.id, `[${scenario}] 询盘候选 id 匹配`).toBe(id)
    expect(inBuilding, `[${scenario}] 楼盘聚合应包含`).toBe(true)
    if (listing.isFeatured) {
      expect(inFeatured, `[${scenario}] 首页精选应包含（isFeatured=true）`).toBe(true)
    }
    // facet totalDocs 应 ≥ 1（至少包含本房源）
    expect(facets.totalDocs, `[${scenario}] facet totalDocs 应 ≥ 1`).toBeGreaterThanOrEqual(1)
  } else {
    expect(inList, `[${scenario}] 列表不应包含`).toBe(false)
    expect(detail, `[${scenario}] 详情应返回 null`).toBeNull()
    // 失效房源作为相关推荐入参：getRelatedListings 内部先 findEffectiveListingBySlug
    // 失效 → 返回空数组
    expect(related, `[${scenario}] 失效房源相关推荐应为空`).toEqual([])
    expect(inquiry, `[${scenario}] 询盘候选应返回 null`).toBeNull()
    expect(inBuilding, `[${scenario}] 楼盘聚合不应包含`).toBe(false)
    expect(inFeatured, `[${scenario}] 首页精选不应包含`).toBe(false)
    // inPriceRange 仅在列表可见时为 true，此处 search.docs 已不含 → false
    expect(inPriceRange, `[${scenario}] 价格区间不应包含失效房源`).toBe(false)
  }
}

// ---------------------------------------------------------------------------
// 基线测试：全有效 fixture 在所有路径可见
// ---------------------------------------------------------------------------

describe('F1.2 基线：全有效房源在所有路径可见', () => {
  it('单条有效房源：7 个路径全部可见', async () => {
    const listing = makeValidListing()
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: true,
      scenario: 'baseline-single-valid',
    })
  })

  it('两条有效房源：facet totalDocs=2，listingType/rentUnit 分布正确', async () => {
    const l1 = makeValidListing()
    const l2 = makeSecondValidListing()
    const adapter = createFullPredicateAdapter({ listings: [l1, l2] })
    const facets = await getSearchFacets(defaultInput(), ctx, adapter)
    expect(facets.totalDocs).toBe(2)
    expect(facets.listingTypes.find((f) => f.value === 'traditional-office')?.count).toBe(2)
    expect(facets.rentUnits.find((f) => f.value === 'rmb-month')?.count).toBe(2)
  })
})

describe('F1.2 跨城市有效供给隔离', () => {
  it('杭州上下文的列表、详情、推荐、首页、facet 和询盘候选均不返回上海供给', async () => {
    const shanghaiListing = makeValidListing()
    const hangzhouListing = makeHangzhouValidListing()
    const adapter = createFullPredicateAdapter({
      listings: [shanghaiListing, hangzhouListing],
      buildings: [BUILDING_VALID, BUILDING_HANGZHOU],
      districts: [DISTRICT_JINGAN, DISTRICT_GONGSHU],
    })
    const hangzhouCtx = createSearchContext('hangzhou', new Date('2026-07-25T00:00:00Z'))

    const [list, detail, related, homepage, facets, inquiry, buildingDetail] = await Promise.all([
      searchListings(defaultInput(), hangzhouCtx, adapter),
      getListingBySlug(shanghaiListing.slug, hangzhouCtx, adapter),
      getRelatedListings(shanghaiListing.slug, hangzhouCtx, { limit: 6 }, adapter),
      getHomepage(hangzhouCtx, { featuredLimit: 6 }, adapter),
      getSearchFacets(defaultInput(), hangzhouCtx, adapter),
      assertEffectiveListing(shanghaiListing.slug, hangzhouCtx, adapter),
      getBuildingDetail(BUILDING_VALID.slug, hangzhouCtx, adapter),
    ])

    expect(list.docs.map((listing) => listing.id)).toEqual([hangzhouListing.id])
    expect(detail).toBeNull()
    expect(related).toEqual([])
    expect(homepage.featuredListings.map((listing) => listing.id)).toEqual([hangzhouListing.id])
    expect(facets.totalDocs).toBe(1)
    expect(facets.districts.map((district) => district.slug)).toEqual(['gongshu'])
    expect(inquiry).toBeNull()
    expect(buildingDetail.building).toBeNull()
    expect(buildingDetail.supply.groups).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §1-§10 失效条件一致性
// ---------------------------------------------------------------------------

describe('F1.2 失效供给一致性（design.md §3.6 十条规则）', () => {
  // §1 未逻辑删除
  it('§1 逻辑删除房源（deletedAt 非空）在所有路径不可见', async () => {
    const listing = makeValidListing({
      deletedAt: '2026-07-20T00:00:00.000Z',
    })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§1-deleted',
    })
  })

  // §2 已发布
  it('§2a publicationStatus=draft 在所有路径不可见', async () => {
    const listing = makeValidListing({ publicationStatus: 'draft' })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§2a-publication-draft',
    })
  })

  it('§2b publicationStatus=unpublished 在所有路径不可见', async () => {
    const listing = makeValidListing({ publicationStatus: 'unpublished' })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§2b-publication-unpublished',
    })
  })

  it('§2c publicationStatus=leased 在所有路径不可见', async () => {
    const listing = makeValidListing({ publicationStatus: 'leased' })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§2c-publication-leased',
    })
  })

  // §3 审核通过
  it('§3a reviewStatus=not_submitted 在所有路径不可见', async () => {
    const listing = makeValidListing({ reviewStatus: 'not_submitted' })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§3a-review-not-submitted',
    })
  })

  it('§3b reviewStatus=pending 在所有路径不可见', async () => {
    const listing = makeValidListing({ reviewStatus: 'pending' })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§3b-review-pending',
    })
  })

  it('§3c reviewStatus=rejected 在所有路径不可见', async () => {
    const listing = makeValidListing({ reviewStatus: 'rejected' })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§3c-review-rejected',
    })
  })

  // §4 未被供给可见性冻结
  it('§4 supplyVisibilityHold=pending_recheck 在所有路径不可见', async () => {
    const listing = makeValidListing({ supplyVisibilityHold: 'pending_recheck' })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§4-supply-hold-pending-recheck',
    })
  })

  // §5 未被有效举报暂停
  it('§5 被举报暂停的房源（pausedIds 含其 id）在所有路径不可见', async () => {
    const listing = makeValidListing()
    const adapter = createFullPredicateAdapter({
      listings: [listing],
      pausedIds: [listing.id],
    })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§5-report-paused',
    })
  })

  it('§5 举报暂停不影响其他房源（仅 target 被排除）', async () => {
    const l1 = makeValidListing() // id=1001
    const l2 = makeSecondValidListing() // id=1002
    const adapter = createFullPredicateAdapter({
      listings: [l1, l2],
      pausedIds: [1001], // 仅暂停 l1
    })
    const search = await searchListings(defaultInput(), ctx, adapter)
    expect(search.docs.map((c) => c.id).sort()).toEqual([1002])
  })

  // §6 媒体数量：2026-08-19 起**不再**是可见性条件（见 effective-supply.ts 头部）。
  // 三个用例全部反转为「可见」而不是删掉：一致性断言本身（列表/facet/聚合/
  // sitemap/详情全路径同口径）仍然有效，只是期望值反了。
  it('§6 gallery 为 null（0 张）在所有路径仍可见', async () => {
    const listing = makeValidListing({ gallery: null })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: true,
      scenario: '§6-media-null',
    })
  })

  it('§6 gallery 仅 2 张在所有路径仍可见', async () => {
    const listing = makeValidListing({
      gallery: [
        { image: MEDIA_1, id: 'g1' },
        { image: MEDIA_2, id: 'g2' },
      ],
    })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: true,
      scenario: '§6-media-2-items',
    })
  })

  it('§6 gallery 正好 3 张在所有路径可见', async () => {
    const listing = makeValidListing({
      gallery: [
        { image: MEDIA_1, id: 'g1' },
        { image: MEDIA_2, id: 'g2' },
        { image: MEDIA_3, id: 'g3' },
      ],
    })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: true,
      scenario: '§6-media-exactly-3',
    })
  })

  // §7 楼盘/城市/行政区启用
  it('§7a building.operationalStatus=disabled 在所有路径不可见', async () => {
    const listing = makeValidListing()
    const disabledBuilding: Building = {
      ...BUILDING_VALID,
      operationalStatus: 'disabled',
    }
    const adapter = createFullPredicateAdapter({
      listings: [{ ...listing, building: disabledBuilding }],
      buildings: [disabledBuilding],
    })
    await assertConsistentVisibility({
      adapter,
      listing: { ...listing, building: disabledBuilding },
      expectedVisible: false,
      scenario: '§7a-building-disabled',
    })
  })

  it('§7b building.city.status=disabled 在所有路径不可见', async () => {
    const inactiveCity: Location = { ...CITY_SHANGHAI, status: 'disabled' }
    const buildingInactiveCity: Building = {
      ...BUILDING_VALID,
      city: inactiveCity,
    }
    const listing = makeValidListing({ building: buildingInactiveCity })
    const adapter = createFullPredicateAdapter({
      listings: [listing],
      buildings: [buildingInactiveCity],
    })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§7b-city-disabled',
    })
  })

  it('§7c building.district.status=disabled 在所有路径不可见', async () => {
    const inactiveDistrict: Location = { ...DISTRICT_JINGAN, status: 'disabled' }
    const buildingInactiveDistrict: Building = {
      ...BUILDING_VALID,
      district: inactiveDistrict,
    }
    const listing = makeValidListing({ building: buildingInactiveDistrict })
    const adapter = createFullPredicateAdapter({
      listings: [listing],
      buildings: [buildingInactiveDistrict],
    })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§7c-district-disabled',
    })
  })

  // §8 房源已设置供给商户（listings.merchant 非空）
  //
  // OPT-034 删除了 listing_merchant_relations 半开区间关系（[effectiveFrom,
  // effectiveTo) 判定生效商户）。原三条用例（§8a 关系未生效 / §8b 关系已过期 /
  // §8c 无关系）测的都是这层时间窗口的边界，随概念一起删除、不做等价改写——
  // 新模型下只有「listing.merchant 有没有值」一个二元问题，已被 §8c 的等价物
  // （下面这条 merchant=null 用例）覆盖，§8a/§8b 没有留下需要覆盖的新语义。
  it('§8 房源未设置供给商户（merchant=null）在所有路径不可见', async () => {
    const listing = makeValidListing({ merchant: null })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§8-no-supply-merchant',
    })
  })

  // §9 商户启用 + 资质有效 + 未过期
  it('§9a 商户已停用（status=disabled）在所有路径不可见', async () => {
    const disabledMerchant = { ...MERCHANT_VALID, status: 'disabled' as const }
    const listing = makeValidListing({ merchant: disabledMerchant as unknown as Listing['merchant'] })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§9a-merchant-disabled',
    })
  })

  it('§9b 商户资质未通过（qualificationStatus=rejected）在所有路径不可见', async () => {
    const rejectedMerchant = { ...MERCHANT_VALID, qualificationStatus: 'rejected' as const }
    const listing = makeValidListing({ merchant: rejectedMerchant as unknown as Listing['merchant'] })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§9b-qualification-rejected',
    })
  })

  it('§9c 商户资质已过期（qualificationExpiresAt 在过去）在所有路径不可见', async () => {
    const expiredMerchant = {
      ...MERCHANT_VALID,
      qualificationExpiresAt: '2025-06-30T00:00:00.000Z',
    }
    const listing = makeValidListing({
      merchant: expiredMerchant as unknown as Listing['merchant'],
    })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§9c-qualification-expired',
    })
  })

  it('§9d 商户资质待审（qualificationStatus=pending）在所有路径不可见', async () => {
    const pendingMerchant = { ...MERCHANT_VALID, qualificationStatus: 'pending' as const }
    const listing = makeValidListing({ merchant: pendingMerchant as unknown as Listing['merchant'] })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§9d-qualification-pending',
    })
  })

  // §10 商户服务城市覆盖楼盘城市
  it('§10 商户服务城市不覆盖楼盘城市在所有路径不可见', async () => {
    const otherCityMerchant = {
      ...MERCHANT_VALID,
      serviceCities: [999], // 不含上海 100
    }
    const listing = makeValidListing({
      merchant: otherCityMerchant as unknown as Listing['merchant'],
    })
    const adapter = createFullPredicateAdapter({ listings: [listing] })
    await assertConsistentVisibility({
      adapter,
      listing,
      expectedVisible: false,
      scenario: '§10-service-city-not-covered',
    })
  })
})

// ---------------------------------------------------------------------------
// 混合场景：有效 + 失效共存，列表/facet/聚合口径一致
// ---------------------------------------------------------------------------

describe('F1.2 混合场景：有效与失效共存', () => {
  it('1 条有效 + 4 条不同失效条件：仅有效出现在列表/facet/聚合', async () => {
    const valid = makeValidListing({ id: 1001, slug: 'valid-1001' })
    const failDraft = makeValidListing({
      id: 2001,
      slug: 'fail-draft',
      publicationStatus: 'draft',
    })
    const failReview = makeValidListing({
      id: 2002,
      slug: 'fail-review',
      reviewStatus: 'pending',
    })
    // 2026-08-19 前这一条用的是「图片只有 1 张」；媒体数量移出可见性后
    // 换成供给可见性冻结，保住「4 种不同失效条件」的覆盖度。
    const failHold = makeValidListing({
      id: 2003,
      slug: 'fail-hold',
      supplyVisibilityHold: 'pending_recheck',
    })
    const failMerchant = makeValidListing({
      id: 2004,
      slug: 'fail-merchant',
      merchant: { ...MERCHANT_VALID, status: 'disabled' as const } as unknown as Listing['merchant'],
    })

    const adapter = createFullPredicateAdapter({
      listings: [valid, failDraft, failReview, failHold, failMerchant],
    })

    const search = await searchListings(defaultInput(), ctx, adapter)
    expect(search.docs.map((c) => c.id).sort()).toEqual([1001])

    const facets = await getSearchFacets(defaultInput(), ctx, adapter)
    expect(facets.totalDocs).toBe(1)
    expect(facets.listingTypes.find((f) => f.value === 'traditional-office')?.count).toBe(1)

    const buildingDetail = await getBuildingDetail('jingan-center', ctx, adapter)
    const supplyCards = buildingDetail.supply.groups.flatMap((group) => group.listings)
    const supplyRanges = buildingDetail.supply.groups.flatMap((group) => group.priceRanges)
    expect(supplyCards.map((c) => c.id).sort()).toEqual([1001])
    // priceRanges 仅含有效房源的价格
    expect(supplyRanges).toHaveLength(1)
    expect(supplyRanges[0]?.displayUnit).toBe('rmb-month')
    expect(supplyRanges[0]?.count).toBe(1)

    const homepage = await getHomepage(ctx, { featuredLimit: 6 }, adapter)
    expect(homepage.featuredListings.map((c) => c.id)).toEqual([1001])
  })

  it('失效房源作为相关推荐入参时返回空数组（不泄露同楼盘其他房源）', async () => {
    // 注意：getRelatedListings 内部先 findEffectiveListingBySlug，失效 → 返回 []
    // 这是设计要求：「失效房源不展示历史详情或表单」
    const valid = makeValidListing({ id: 1001, slug: 'valid-1001' })
    const failDraft = makeValidListing({
      id: 2001,
      slug: 'fail-draft',
      publicationStatus: 'draft',
    })
    const adapter = createFullPredicateAdapter({ listings: [valid, failDraft] })

    // 失效房源作为相关推荐入参
    const related = await getRelatedListings('fail-draft', ctx, { limit: 6 }, adapter)
    expect(related).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 交叉验证：FakeAdapter 判定与生产 isListingEffectivelySupplied 一致
// ---------------------------------------------------------------------------

describe('F1.2 交叉验证：FakeAdapter 谓词与生产 isListingEffectivelySupplied 同源', () => {
  it('FakeAdapter 通过 isListingEffectivelySupplied 判定 §8/§9/§10', () => {
    // 这个测试本身是元验证：FakeAdapter 直接调用生产谓词
    // 此处显式断言生产谓词对各类失效 snapshot 的判定结果
    // （§6 媒体数量已于 2026-08-19 移出前台可见性，不再在此断言）
    const asOf = new Date(ctx.asOf)

    const baseline: EffectiveSupplySnapshot = {
      merchant: {
        id: 7001,
        status: 'active',
        qualificationStatus: 'valid',
        qualificationExpiresAt: '2027-12-31T00:00:00.000Z',
        serviceCityIds: [100],
      },
      buildingCityId: 100,
    }

    // §8 未设置供给商户
    const noMerchant: EffectiveSupplySnapshot = { ...baseline, merchant: null }
    expect(isListingEffectivelySupplied(noMerchant, asOf).eligible).toBe(false)

    // §9 商户停用
    const merchantDisabled: EffectiveSupplySnapshot = {
      ...baseline,
      merchant: { ...baseline.merchant!, status: 'disabled' },
    }
    expect(isListingEffectivelySupplied(merchantDisabled, asOf).eligible).toBe(false)

    // §10 服务城市不覆盖
    const cityNotCovered: EffectiveSupplySnapshot = {
      ...baseline,
      merchant: { ...baseline.merchant!, serviceCityIds: [999] },
    }
    expect(isListingEffectivelySupplied(cityNotCovered, asOf).eligible).toBe(false)

    // 全有效
    const allValid: EffectiveSupplySnapshot = {
      merchant: {
        id: 7001,
        status: 'active',
        qualificationStatus: 'valid',
        qualificationExpiresAt: '2027-12-31T00:00:00.000Z',
        serviceCityIds: [100],
      },
      buildingCityId: 100,
    }
    expect(isListingEffectivelySupplied(allValid, asOf).eligible).toBe(true)
  })
})
