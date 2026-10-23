import { describe, expect, it } from 'vitest'

import { planFeaturedAreasBackfill, type FeaturedRegionRow } from '@/domain/geography/featured-areas-backfill'

const row = (overrides: Partial<FeaturedRegionRow> = {}): FeaturedRegionRow => ({
  profileCityId: 1,
  locationId: 10,
  type: 'business_area',
  status: 'active',
  frontendVisible: true,
  locationCityId: 1,
  ...overrides,
})

describe('planFeaturedAreasBackfill', () => {
  it('按原顺序给合格的商圈从 1 开始连续编号', () => {
    const plan = planFeaturedAreasBackfill([row({ locationId: 30 }), row({ locationId: 10 }), row({ locationId: 20 })])
    expect(plan.assignments).toEqual([
      { locationId: 30, featuredOrder: 1 },
      { locationId: 10, featuredOrder: 2 },
      { locationId: 20, featuredOrder: 3 },
    ])
    expect(plan.skipped).toEqual([])
  })

  it('行政区被放弃，且不占序号', () => {
    const plan = planFeaturedAreasBackfill([
      row({ locationId: 1, type: 'district' }),
      row({ locationId: 2 }),
    ])
    expect(plan.assignments).toEqual([{ locationId: 2, featuredOrder: 1 }])
    expect(plan.skipped).toEqual([{ locationId: 1, reason: 'not_business_area' }])
  })

  it('停用 / 前台不可见 / 跨城的商圈跳过并记录原因', () => {
    const plan = planFeaturedAreasBackfill([
      row({ locationId: 1, status: 'disabled' }),
      row({ locationId: 2, frontendVisible: false }),
      row({ locationId: 3, locationCityId: 9 }),
      row({ locationId: 4 }),
    ])
    expect(plan.assignments).toEqual([{ locationId: 4, featuredOrder: 1 }])
    expect(plan.skipped).toEqual([
      { locationId: 1, reason: 'inactive' },
      { locationId: 2, reason: 'not_visible' },
      { locationId: 3, reason: 'cross_city' },
    ])
  })

  it('各城独立编号，同一商圈重复出现只取第一次', () => {
    const plan = planFeaturedAreasBackfill([
      row({ profileCityId: 1, locationId: 1 }),
      row({ profileCityId: 2, locationId: 5, locationCityId: 2 }),
      row({ profileCityId: 1, locationId: 1 }),
      row({ profileCityId: 1, locationId: 2 }),
    ])
    expect(plan.assignments).toEqual([
      { locationId: 1, featuredOrder: 1 },
      { locationId: 5, featuredOrder: 1 },
      { locationId: 2, featuredOrder: 2 },
    ])
    expect(plan.skipped).toEqual([{ locationId: 1, reason: 'duplicate' }])
  })

  it('每城超过 12 个的部分跳过', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row({ locationId: 100 + i }))
    const plan = planFeaturedAreasBackfill(rows)
    expect(plan.assignments).toHaveLength(12)
    expect(plan.assignments[11]).toEqual({ locationId: 111, featuredOrder: 12 })
    expect(plan.skipped).toEqual([
      { locationId: 112, reason: 'over_limit' },
      { locationId: 113, reason: 'over_limit' },
    ])
  })
})
