import { describe, expect, it } from 'vitest'
import { buildBuildingSupplySnapshot } from '@/domain/public-catalog/building-supply'
import { getBuildingDetail, getRelatedBuildings, type ListingCardViewModel } from '@/domain/public-catalog'
import { defaultSearchContext } from '@/domain/public-catalog'
import type { Building } from '@/payload-types'
import { BUILDING_JINGAN_CENTER, LISTING_MONTHLY_STANDARD } from '@/test/frontend/payload-documents'

const AS_OF = '2026-07-30T10:00:00.000Z'

function makeCard(overrides: Partial<ListingCardViewModel> = {}): ListingCardViewModel {
  return {
    id: 1,
    slug: 'listing-1',
    title: '测试房源',
    price: {
      amount: 8.5,
      businessType: 'lease',
      currency: 'CNY',
      period: 'day',
      basis: 'sqm',
      displayUnit: 'rmb-sqm-day',
      text: '8.5 元/㎡/天',
    },
    area: 100,
    businessType: 'lease',
    decorationStatus: 'fully_fitted',
    listingType: 'traditional-office',
    availableFrom: '2026-08-01',
    isFeatured: false,
    building: null,
    coverImage: null,
    highlights: [],
    stableSortKey: 'listing-1',
    ...overrides,
  }
}

describe('buildBuildingSupplySnapshot', () => {
  it('出租、出售和联合办公独立分组', () => {
    const snapshot = buildBuildingSupplySnapshot(
      [
        makeCard(),
        makeCard({
          id: 2,
          slug: 'sale',
          businessType: 'sale',
          price: {
            amount: 50000,
            businessType: 'sale',
            currency: 'CNY',
            period: 'one-time',
            basis: 'total',
            displayUnit: 'rmb-total',
            text: '50000 元',
          },
        }),
        makeCard({
          id: 3,
          slug: 'coworking',
          listingType: 'coworking',
          price: {
            amount: 2000,
            businessType: 'lease',
            currency: 'CNY',
            period: 'month',
            basis: 'seat',
            displayUnit: 'rmb-seat-month',
            text: '2000 元/工位/月',
          },
        }),
      ],
      { sort: 'recommended' },
      AS_OF,
    )

    expect(snapshot.groups.map((group) => group.key)).toEqual(['lease', 'sale', 'coworking'])
  })

  it('不同价格单位不合并且不共同排序', () => {
    const snapshot = buildBuildingSupplySnapshot(
      [
        makeCard({ id: 1, slug: 'monthly', price: {
          amount: 5000,
          businessType: 'lease',
          currency: 'CNY',
          period: 'month',
          basis: 'total',
          displayUnit: 'rmb-month',
          text: '5000 元/月',
        } }),
        makeCard({ id: 2, slug: 'sqm-day' }),
      ],
      { sort: 'price-asc' },
      AS_OF,
    )

    expect(snapshot.validationErrors).toContain('price_unit_required')
    expect(snapshot.groups[0]?.priceRanges).toHaveLength(2)
  })
})

describe('getRelatedBuildings', () => {
  it('周边楼盘只来自当前有效楼盘且排除自身', async () => {
    const current = {
      id: 1,
      slug: 'bund-soho',
      name: '外滩 SOHO',
      address: '中山东二路',
      operationalStatus: 'active',
    } as Building
    const nearby = {
      ...current,
      id: 2,
      slug: 'nearby-active-building',
      name: '周边有效楼盘',
    } as Building
    const adapter = {
      async findEffectiveBuildingBySlug() { return current },
      async findEffectiveBuildingsNear() { return [current, nearby] },
    }

    const result = await getRelatedBuildings(
      'bund-soho',
      defaultSearchContext(new Date(AS_OF)),
      { limit: 6 },
      adapter as never,
    )

    expect(result.map((item) => item.slug)).not.toContain('bund-soho')
    expect(result.map((item) => item.slug)).toEqual(['nearby-active-building'])
  })
})

describe('getBuildingDetail', () => {
  it('同一 asOf 下只读取一次楼内有效房源并复用其结果生成供给快照', async () => {
    let effectiveListingsByBuildingCalls = 0
    const seenAsOf: string[] = []
    const adapter = {
      async findEffectiveBuildingBySlug(_slug: string, ctx: { asOf: string }) {
        seenAsOf.push(ctx.asOf)
        return BUILDING_JINGAN_CENTER
      },
      async findEffectiveListingsByBuilding(_id: number, ctx: { asOf: string }) {
        effectiveListingsByBuildingCalls += 1
        seenAsOf.push(ctx.asOf)
        return [LISTING_MONTHLY_STANDARD]
      },
    }

    const result = await getBuildingDetail(
      'jingan-center',
      defaultSearchContext(new Date(AS_OF)),
      adapter as never,
    )

    expect(effectiveListingsByBuildingCalls).toBe(1)
    expect(seenAsOf).toEqual([AS_OF, AS_OF])
    expect(result.supply.totalEffectiveListings).toBe(1)
  })
})
