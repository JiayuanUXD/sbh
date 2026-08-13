import { describe, expect, it } from 'vitest'
import {
  buildBuildingSupplySnapshot,
  parseBuildingSupplySearchParams,
  type ListingCardViewModel,
} from '@/domain/public-catalog'

function makeCard(overrides: Partial<ListingCardViewModel> = {}): ListingCardViewModel {
  return {
    id: 1,
    slug: 'listing-1',
    title: '测试房源',
    price: null,
    area: 100,
    businessType: 'lease',
    decorationStatus: 'fully_fitted',
    listingType: 'traditional-office',
    availableFrom: null,
    isFeatured: false,
    building: null,
    coverImage: null,
    highlights: [],
    stableSortKey: 'listing-1',
    ...overrides,
    citySlug: overrides.citySlug ?? 'shanghai',
    cityName: overrides.cityName ?? '上海市',
  }
}

describe('parseBuildingSupplySearchParams', () => {
  it('只接受单值、白名单且范围有效的 URL 参数', () => {
    expect(parseBuildingSupplySearchParams({
      group: 'lease',
      areaMin: '80',
      areaMax: '120',
      decorationStatus: 'fully_fitted',
      availableBefore: '2026-09-01',
      priceUnit: 'rmb-sqm-day',
      sort: 'price-asc',
    })).toEqual({
      group: 'lease',
      areaMin: 80,
      areaMax: 120,
      decorationStatus: 'fully_fitted',
      availableBefore: '2026-09-01',
      priceUnit: 'rmb-sqm-day',
      sort: 'price-asc',
    })
  })

  it('安全丢弃 unknown、多值、非有限、负数、反转范围和非法枚举', () => {
    expect(parseBuildingSupplySearchParams({
      group: ['lease', 'sale'],
      areaMin: '-1',
      areaMax: 'Infinity',
      decorationStatus: 'script',
      availableBefore: '2026-02-30',
      priceUnit: 'invalid-unit',
      sort: 'rent-asc',
    })).toEqual({})

    expect(parseBuildingSupplySearchParams({ areaMin: '121', areaMax: '120' })).toEqual({})
    expect(parseBuildingSupplySearchParams(new URLSearchParams('group=lease&group=sale'))).toEqual({})
    expect(parseBuildingSupplySearchParams(null)).toEqual({})
  })

  it('解析出的 URL 输入实际改变快照分组与面积排序，同时保留面议卡片', () => {
    const cards = [
      makeCard({ id: 1, slug: 'lease-large', area: 200 }),
      makeCard({ id: 2, slug: 'lease-request', area: 80, price: null }),
      makeCard({ id: 3, slug: 'sale', businessType: 'sale', area: 120 }),
    ]
    const input = parseBuildingSupplySearchParams({ group: 'lease', sort: 'area-asc' })
    const snapshot = buildBuildingSupplySnapshot(cards, input, '2026-07-30T00:00:00.000Z')

    expect(snapshot.groups.map((group) => group.key)).toEqual(['lease'])
    expect(snapshot.groups[0]?.listings.map((card) => card.slug)).toEqual([
      'lease-request',
      'lease-large',
    ])
  })
})
