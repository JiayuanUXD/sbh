/**
 * OPT-068 facade：列表与 facet 建立在一次扫描之上。
 *
 * 两类适配器都要能工作：
 *   - 只有 `findEffectiveListings` 的既有 fake（十几个测试文件都是这种）——facade 把
 *     完整 input 交给它，再把结果投影成扫描行；
 *   - 实现了 `scanEffectiveListings` / `findEffectiveListingsByIds` 的生产适配器——
 *     列表页只扫描一次、只回捞本页 id，`findEffectiveListings` 一次都不该被调用。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createSearchContext,
  getSearchFacets,
  hydrateListingCards,
  parseListingSearchInput,
  rowsFromListings,
  searchListings,
  type ListingSearchInput,
  type SupplyAdapter,
} from '@/domain/public-catalog'
import {
  AS_OF_ISO,
  LISTING_DAILY_PER_SQM,
  LISTING_MONTHLY_STANDARD,
  LISTING_SEAT_PER_MONTH,
} from '@/test/frontend/payload-documents'
import type { Listing } from '@/payload-types'

const DOCS: readonly Listing[] = [LISTING_MONTHLY_STANDARD, LISTING_DAILY_PER_SQM, LISTING_SEAT_PER_MONTH]
const ctx = createSearchContext('shanghai', new Date(AS_OF_ISO))
const parse = (q: string) => parseListingSearchInput(new URLSearchParams(q))

function districtSlugOf(doc: Listing): string | null {
  const building = doc.building
  if (typeof building !== 'object' || building === null) return null
  const district = building.district
  return typeof district === 'object' && district !== null ? district.slug : null
}

/** 既有 fake 的形状：自己按 input 过滤（这里只做区域，够验证「完整 input 交给 fake」）。 */
function legacyAdapter(): SupplyAdapter & { calls: ListingSearchInput[] } {
  const calls: ListingSearchInput[] = []
  const fake = {
    calls,
    async findEffectiveListings(input: ListingSearchInput) {
      calls.push(input)
      return DOCS.filter((doc) => !input.district || input.district.includes(districtSlugOf(doc) ?? ''))
    },
  }
  return fake as unknown as SupplyAdapter & { calls: ListingSearchInput[] }
}

function scanningAdapter() {
  const scan = vi.fn(async (input: ListingSearchInput) => {
    expect(input.district).toBeUndefined()
    expect(input.listingType).toBeUndefined()
    return rowsFromListings(DOCS)
  })
  const byIds = vi.fn(async (ids: readonly number[]) =>
    // 故意乱序返回：facade 必须按 ids 顺序重排
    DOCS.filter((doc) => ids.includes(doc.id)).reverse(),
  )
  const legacy = vi.fn(async () => {
    throw new Error('生产路径不该再调用 findEffectiveListings')
  })
  const adapter = {
    scanEffectiveListings: scan,
    findEffectiveListingsByIds: byIds,
    findEffectiveListings: legacy,
  } as unknown as SupplyAdapter
  return { adapter, scan, byIds, legacy }
}

describe('OPT-068 facade：只有 findEffectiveListings 的既有 fake', () => {
  it('searchListings：完整 input 交给 fake，结果按推荐序（精选优先）分页，canonical 保留筛选', async () => {
    const adapter = legacyAdapter()
    const result = await searchListings(parse(''), ctx, adapter)
    expect(adapter.calls[0].district).toBeUndefined()
    // 1001 精选在前；其余按 updatedAt desc → id asc
    expect(result.docs.map((d) => d.id)).toEqual([1001, 1002, 1003])
    expect(result.pagination.totalDocs).toBe(3)
    expect(result.filteredByRentUnit).toBe(false)

    // 1002 的楼盘夹具 district 只是 id（depth 0 模拟），既不被 fake 也不被行上的区域过滤选中
    const jingan = await searchListings(parse('district=jingan'), ctx, adapter)
    // 扫描那次调用拿到完整 input（含 district）；随后的回捞调用用的是空 input
    expect(adapter.calls.map((c) => c.district)).toEqual([undefined, undefined, ['jingan'], undefined])
    expect(jingan.docs.map((d) => d.id)).toEqual([1001, 1003])
    expect(jingan.canonical).toContain('district=jingan')
  })

  it('getSearchFacets：区域 / 类型 / 单位计数与 totalDocs 同口径', async () => {
    const facets = await getSearchFacets(parse(''), ctx, legacyAdapter())
    expect(facets.totalDocs).toBe(3)
    // 1002 的楼盘 district 未展开（只是 id）→ 不进区域计数，与旧 getSearchFacets 一致
    expect(facets.districts.map((d) => [d.slug, d.count])).toEqual([['jingan', 2]])
    expect(facets.listingTypes.map((t) => [t.value, t.count])).toEqual([
      ['traditional-office', 1],
      ['serviced-office', 1],
      ['coworking', 1],
    ])
    expect(facets.rentUnits.map((u) => u.value).sort()).toEqual(['rmb-month', 'rmb-seat-month', 'rmb-sqm-day'])
  })

  it('价格区间在内存里生效：选单位给区间只留该单位且落在区间内的房源', async () => {
    const result = await searchListings(parse('priceUnit=rmb-sqm-day&priceMax=9'), ctx, legacyAdapter())
    expect(result.docs.map((d) => d.id)).toEqual([1002])
  })
})

describe('OPT-068 facade：实现了扫描的适配器', () => {
  it('列表页只扫描一次（扫描输入剥掉内存维度）、只回捞本页 id，且按 id 顺序返回', async () => {
    const { adapter, scan, byIds, legacy } = scanningAdapter()
    const result = await searchListings(parse('district=jingan&type=coworking'), ctx, adapter)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(byIds).toHaveBeenCalledWith([1003], ctx)
    expect(result.docs.map((d) => d.id)).toEqual([1003])
    expect(result.pagination.totalDocs).toBe(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('facet 与列表共用扫描，不调用 findEffectiveListings', async () => {
    const { adapter, scan, legacy } = scanningAdapter()
    const facets = await getSearchFacets(parse('district=jingan'), ctx, adapter)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(facets.totalDocs).toBe(2)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('hydrateListingCards：按 ids 顺序返回，回捞不到的 id 静默跳过', async () => {
    const { adapter } = scanningAdapter()
    const cards = await hydrateListingCards([1003, 999, 1001], ctx, adapter)
    expect(cards.map((c) => c.id)).toEqual([1003, 1001])
    expect(await hydrateListingCards([], ctx, adapter)).toEqual([])
  })
})
