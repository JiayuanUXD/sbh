import { describe, expect, it } from 'vitest'

import {
  buildCityPath,
  getCityPageType,
  legacyCanonicalPath,
  prefixedCanonicalPath,
  switchCityUrl,
} from '@/lib/frontend/city-routes'

/**
 * OPT-119：区域 / 商圈落地页 `/{city}/area/{slug}` 的路由契约。
 * 行政区与商圈共用一个路由（locations.slug 全局唯一），所以页面类型只有一个。
 */
describe('area landing route classification', () => {
  it.each([
    ['/shanghai/area/xuhui', 'area-detail'],
    ['/shanghai/area/shanghai-hongqiao-shangwuqu', 'area-detail'],
    ['/shanghai/area', 'unknown'],
    ['/shanghai/area/xuhui/extra', 'unknown'],
    // 无前缀形态不存在：`area` 会被当成城市段，第二段不是任何已知资源
    ['/area/xuhui', 'unknown'],
  ] as const)('classifies %s as %s', (pathname, expected) => {
    expect(getCityPageType(pathname)).toBe(expected)
  })

  it('rejects encoded aliases of the area token', () => {
    expect(getCityPageType('/shanghai/%61rea/xuhui')).toBe('unknown')
  })

  it('keeps one-layer percent encoding of the slug canonical', () => {
    expect(prefixedCanonicalPath('/shanghai/area/%E5%BE%90%E6%B1%87', 'shanghai')).toBe(
      '/shanghai/area/%E5%BE%90%E6%B1%87',
    )
  })

  it('has no legacy (unprefixed) form', () => {
    expect(legacyCanonicalPath('/shanghai/area/xuhui')).toBeNull()
  })

  it('re-prefixes a detail slug like the other city-scoped details', () => {
    expect(prefixedCanonicalPath('/shanghai/area/xuhui', 'shanghai')).toBe('/shanghai/area/xuhui')
  })

  it('falls back to the city buildings channel for the city switcher destination map', () => {
    expect(buildCityPath('hangzhou', 'area-detail')).toBe('/hangzhou/buildings')
  })

  it('does not carry a city-specific area slug across cities', () => {
    // 区域 slug 属于来源城市，换城市时落到目标城市首页，而不是一个必然 404 的 /hangzhou/area/xuhui
    expect(switchCityUrl('/shanghai/area/xuhui', 'hangzhou')).toBe('/hangzhou')
  })
})

describe('area landing page type in city analytics', () => {
  it('lets the city switcher events carry area-detail as page_type', async () => {
    const { buildCityAnalyticsPayload } = await import('@/lib/frontend/analytics/landing')
    expect(
      buildCityAnalyticsPayload('city_switcher_opened', { city: 'shanghai', status: 'live', page_type: 'area-detail' }),
    ).toEqual({ city: 'shanghai', status: 'live', page_type: 'area-detail' })
  })
})
