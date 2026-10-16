import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AreaLandingEntry } from '@/domain/public-catalog/area-landing-facade'

const state = vi.hoisted(() => ({
  getCachedAreaLandingIndex: vi.fn(),
  getCachedPublishedArticles: vi.fn(),
  getCachedPublishedPages: vi.fn(),
  getCachedSitemapBuildingsPage: vi.fn(),
  getCachedSitemapListingsPage: vi.fn(),
  listPublicCityProfiles: vi.fn(),
  getEffectiveSale: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com', defaultCity: 'shanghai' },
  getMultiCityRoutingEnabled: () => process.env.MULTI_CITY_ROUTING_ENABLED === 'true',
}))
vi.mock('@/app/(frontend)/_lib/city-context', () => ({ listPublicCityProfiles: state.listPublicCityProfiles }))
vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedAreaLandingIndex: state.getCachedAreaLandingIndex,
  getCachedPublishedArticles: state.getCachedPublishedArticles,
  getCachedPublishedPages: state.getCachedPublishedPages,
  getCachedSitemapBuildingsPage: state.getCachedSitemapBuildingsPage,
  getCachedSitemapListingsPage: state.getCachedSitemapListingsPage,
}))
vi.mock('@/domain/public-catalog', () => ({
  SITEMAP_TAG: 'public:sitemap',
  createSearchContext: (city: string) => ({ city }),
  searchListingsSitemapPage: state.getEffectiveSale,
}))

import { getStaticSitemap } from '@/app/(frontend)/_lib/sitemap-shards'

function entry(overrides: Partial<AreaLandingEntry>): AreaLandingEntry {
  return {
    kind: 'district', id: 1, slug: 'xuhui', name: '徐汇区', parentSlug: null, parentName: null, listingCount: 100, buildingCount: 10,
    priceSampleCount: 100, priceMin: 1, priceP25: 2, priceMedian: 3, priceP75: 4, priceMax: 5, otherUnitCount: 0, areaMedian: 100,
    lastUpdatedAt: '2026-10-15T08:00:00.000Z', description: null, indexable: true, ...overrides,
  }
}

describe('sitemap：区域 / 商圈落地页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    state.getEffectiveSale.mockResolvedValue({ docs: [], hasNextPage: false, nextPage: null })
    state.listPublicCityProfiles.mockResolvedValue([{ citySlug: 'shanghai', serviceStatus: 'live' }])
    state.getCachedSitemapListingsPage.mockResolvedValue({ docs: [], hasNextPage: false, nextPage: null, page: 1 })
    state.getCachedSitemapBuildingsPage.mockResolvedValue({ docs: [], hasNextPage: false, nextPage: null, page: 1 })
    state.getCachedPublishedPages.mockResolvedValue([])
    state.getCachedPublishedArticles.mockResolvedValue({ docs: [], totalPages: 1 })
    state.getCachedAreaLandingIndex.mockResolvedValue([
      entry({ slug: 'xuhui' }),
      entry({ kind: 'business_area', id: 2, slug: 'caohejing', name: '漕河泾', parentSlug: 'xuhui', lastUpdatedAt: '2026-10-14T00:00:00.000Z' }),
      entry({ slug: 'thin-district', indexable: false, listingCount: 3 }),
      entry({ kind: 'business_area', id: 3, slug: 'no-time', lastUpdatedAt: null }),
    ])
  })

  it('只收达到收录门槛的页面，薄页不进 sitemap', async () => {
    const urls = (await getStaticSitemap()).map((item) => item.url)
    expect(urls).toContain('https://example.com/shanghai/area/xuhui')
    expect(urls).toContain('https://example.com/shanghai/area/caohejing')
    expect(urls).not.toContain('https://example.com/shanghai/area/thin-district')
  })

  it('lastmod 取该区域有效房源的真实最近更新时间；取不到就不写，不用请求时刻', async () => {
    const entries = await getStaticSitemap()
    const byUrl = new Map(entries.map((item) => [item.url, item]))
    expect(byUrl.get('https://example.com/shanghai/area/xuhui')?.lastModified).toEqual(new Date('2026-10-15T08:00:00.000Z'))
    expect(byUrl.get('https://example.com/shanghai/area/caohejing')?.lastModified).toEqual(new Date('2026-10-14T00:00:00.000Z'))
    expect(byUrl.get('https://example.com/shanghai/area/no-time')).toBeDefined()
    expect(byUrl.get('https://example.com/shanghai/area/no-time')?.lastModified).toBeUndefined()
  })

  it('多城路由开关关闭时整体不输出（前缀路径此时是 noindex）', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'false'
    const urls = (await getStaticSitemap()).map((item) => item.url)
    expect(urls.some((url) => url.includes('/area/'))).toBe(false)
    expect(state.getCachedAreaLandingIndex).not.toHaveBeenCalled()
  })

  it('只为已开通城市生成（coming-soon 城市根本不在 manifest 里）', async () => {
    state.listPublicCityProfiles.mockResolvedValue([
      { citySlug: 'shanghai', serviceStatus: 'live' },
      { citySlug: 'hangzhou', serviceStatus: 'coming-soon' },
    ])
    await getStaticSitemap()
    expect(state.getCachedAreaLandingIndex).toHaveBeenCalledTimes(1)
    expect(state.getCachedAreaLandingIndex).toHaveBeenCalledWith('shanghai')
  })

  it('行政区权重高于商圈', async () => {
    const entries = await getStaticSitemap()
    const district = entries.find((item) => item.url.endsWith('/area/xuhui'))
    const area = entries.find((item) => item.url.endsWith('/area/caohejing'))
    expect(district!.priority).toBeGreaterThan(area!.priority!)
  })
})
