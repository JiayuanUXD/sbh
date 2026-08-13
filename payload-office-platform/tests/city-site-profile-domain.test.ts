import { describe, expect, it } from 'vitest'

import { CITY_SERVICE_STATUSES } from '@/domain/city-site-profile/schema'
import { protectCitySiteProfile } from '@/domain/city-site-profile/profile-protect'

type LocationNode = {
  id: number
  name: string
  type: 'city' | 'district' | 'business_area' | 'metro_line'
  status: 'active' | 'disabled'
  frontendVisible: boolean
  city?: number
}

const LOCATIONS: readonly LocationNode[] = [
  { id: 1, name: '杭州', type: 'city', status: 'active', frontendVisible: true },
  { id: 2, name: '西湖区', type: 'district', status: 'active', frontendVisible: true, city: 1 },
  { id: 3, name: '黄龙商圈', type: 'business_area', status: 'active', frontendVisible: true, city: 1 },
  { id: 4, name: '上城区', type: 'district', status: 'active', frontendVisible: false, city: 1 },
  { id: 5, name: '北京', type: 'city', status: 'active', frontendVisible: true },
  { id: 6, name: '朝阳区', type: 'district', status: 'active', frontendVisible: true, city: 5 },
  { id: 7, name: '1号线', type: 'metro_line', status: 'active', frontendVisible: true, city: 1 },
  { id: 8, name: '杭州市', type: 'city', status: 'active', frontendVisible: true },
  { id: 9, name: '拱墅区', type: 'district', status: 'active', frontendVisible: true, city: 8 },
]

function makeHookArgs(
  data: Record<string, unknown>,
  options: { operation?: 'create' | 'update'; originalDoc?: Record<string, unknown> } = {},
) {
  const locationById = new Map(LOCATIONS.map((location) => [location.id, location]))
  return {
    operation: options.operation ?? 'create',
    data,
    originalDoc: options.originalDoc,
    req: {
      payload: {
        findByID: async ({ id }: { id: number }) => {
          const location = locationById.get(id)
          if (!location) throw new Error('not found')
          return location
        },
      },
    },
  } as never
}

function validInput(cityName = '杭州'): Record<string, unknown> {
  return {
    city: 1,
    serviceStatus: 'coming-soon',
    switcherVisible: true,
    sortOrder: 10,
    seoTitle: `${cityName}写字楼租赁与选址服务`,
    seoDescription: `${cityName}${'写字楼租赁与企业选址服务，覆盖热门商圈、办公楼宇和真实房源，提供专业顾问支持，帮助团队快速找到合适办公空间。'.repeat(2)}`,
    featuredRegions: [2, 3],
  }
}

describe('city-site-profile contract', () => {
  it('only exposes the supported city service statuses', () => {
    expect(CITY_SERVICE_STATUSES).toEqual(['live', 'coming-soon'])
  })

  it('accepts a valid coming-soon profile', async () => {
    const profile = await protectCitySiteProfile(makeHookArgs(validInput('杭州')))
    expect(profile).toMatchObject({ serviceStatus: 'coming-soon' })
  })

  it('uses the deterministic short display name for a city name ending in 市', async () => {
    const profile = await protectCitySiteProfile(
      makeHookArgs({
        ...validInput('杭州'),
        city: 8,
        featuredRegions: [9],
      }),
    )

    expect(profile).toMatchObject({ city: 8, serviceStatus: 'coming-soon' })
  })

  it('accepts a partial update using the persisted profile for validation', async () => {
    const patch = { switcherVisible: false }
    const profile = await protectCitySiteProfile(
      makeHookArgs(patch, {
        operation: 'update',
        originalDoc: { id: 101, ...validInput('杭州') },
      }),
    )
    expect(profile).toEqual(patch)
  })

  it('rejects a profile whose city relation is not a city', async () => {
    await expect(
      protectCitySiteProfile(makeHookArgs({ ...validInput('杭州'), city: 2 })),
    ).rejects.toThrow('city_profile_city_invalid')
  })

  it('rejects a title that omits the selected city name', async () => {
    await expect(
      protectCitySiteProfile(
        makeHookArgs({ ...validInput('杭州'), seoTitle: '写字楼租赁与企业选址服务' }),
      ),
    ).rejects.toThrow('seo_title_city_required')
  })

  it('rejects a title over 60 characters', async () => {
    await expect(
      protectCitySiteProfile(makeHookArgs({ ...validInput('杭州'), seoTitle: `杭州${'写'.repeat(60)}` })),
    ).rejects.toThrow('seo_title_length_invalid')
  })

  it('rejects a description outside 70 to 160 characters or without the city name', async () => {
    await expect(
      protectCitySiteProfile(makeHookArgs({ ...validInput('杭州'), seoDescription: '杭州写字楼' })),
    ).rejects.toThrow('seo_description_length_invalid')
    await expect(
      protectCitySiteProfile(
        makeHookArgs({ ...validInput('杭州'), seoDescription: '专业写字楼租赁与企业选址服务，覆盖热门商圈、办公楼宇和真实房源，提供顾问支持，帮助团队快速找到合适办公空间。'.repeat(2) }),
      ),
    ).rejects.toThrow('seo_description_city_required')
  })

  it('rejects a featured region from another city', async () => {
    await expect(
      protectCitySiteProfile(makeHookArgs({ ...validInput('杭州'), featuredRegions: [2, 6] })),
    ).rejects.toThrow('featured_region_city_mismatch')
  })

  it('rejects featured regions that are hidden or not district or business area', async () => {
    await expect(
      protectCitySiteProfile(makeHookArgs({ ...validInput('杭州'), featuredRegions: [2, 4] })),
    ).rejects.toThrow('featured_region_invalid')
    await expect(
      protectCitySiteProfile(makeHookArgs({ ...validInput('杭州'), featuredRegions: [2, 7] })),
    ).rejects.toThrow('featured_region_invalid')
  })

})
