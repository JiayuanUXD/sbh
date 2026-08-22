import { describe, expect, it } from 'vitest'
import {
  buildBuildingSupplyCanonicalSearchParams,
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
    floor: null,
    seats: null,
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

  it('价格区间随 priceUnit 一起被接受', () => {
    expect(parseBuildingSupplySearchParams({
      priceMin: '8',
      priceMax: '9',
      priceUnit: 'rmb-sqm-day',
    })).toEqual({ priceMin: 8, priceMax: 9, priceUnit: 'rmb-sqm-day' })
  })

  /**
   * 缺 priceUnit 的价格区间在解析层就丢掉：不可通约的计价单位之间比 amount 没有
   * 意义。域层 `matchesInput` 对同一条不变量另有守卫（那才是失效点上的守卫），
   * 这里保证 canonical 不会把一个注定不生效的参数继续挂在链接上。
   */
  it('缺 priceUnit 的价格区间整段丢弃，canonical 也不输出', () => {
    expect(parseBuildingSupplySearchParams({ priceMin: '8', priceMax: '9' })).toEqual({})
    expect(parseBuildingSupplySearchParams({ priceMin: '9', priceMax: '8', priceUnit: 'rmb-sqm-day' }))
      .toEqual({ priceUnit: 'rmb-sqm-day' })
    expect(
      buildBuildingSupplyCanonicalSearchParams({ priceMin: 8, priceMax: 9 }).toString(),
    ).toBe('')
    expect(
      buildBuildingSupplyCanonicalSearchParams({ priceMin: 8, priceMax: 9, priceUnit: 'rmb-sqm-day' }).toString(),
    ).toBe('priceMin=8&priceMax=9&priceUnit=rmb-sqm-day')
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
