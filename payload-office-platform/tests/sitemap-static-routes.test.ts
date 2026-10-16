import { beforeEach, describe, expect, it, vi } from 'vitest'

const sitemapState = vi.hoisted(() => ({
  getCachedAreaLandingIndex: vi.fn(async () => []),
  getCachedPublishedArticles: vi.fn(),
  getCachedPublishedPages: vi.fn(),
  getCachedSitemapBuildingsPage: vi.fn(),
  getCachedSearchListings: vi.fn(),
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

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityProfiles: sitemapState.listPublicCityProfiles,
}))

vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedAreaLandingIndex: sitemapState.getCachedAreaLandingIndex,
  getCachedPublishedArticles: sitemapState.getCachedPublishedArticles,
  getCachedPublishedPages: sitemapState.getCachedPublishedPages,
  getCachedSitemapBuildingsPage: sitemapState.getCachedSitemapBuildingsPage,
  getCachedSearchListings: sitemapState.getCachedSearchListings,
  getCachedSitemapListingsPage: sitemapState.getCachedSitemapListingsPage,
}))

vi.mock('@/domain/public-catalog', () => ({
  SITEMAP_TAG: 'public:sitemap',
  parseSearchInput: () => ({ page: 1, pageSize: 24 }),
  createSearchContext: (city: string) => ({ city }),
  searchListingsSitemapPage: sitemapState.getEffectiveSale,
}))

import { getEntitySitemap, getSitemapManifest, getStaticSitemap, sitemapXml } from '@/app/(frontend)/_lib/sitemap-shards'
import { GET as getIndex } from '@/app/(frontend)/sitemap.xml/route'
import { GET as getShard } from '@/app/(frontend)/sitemaps/[city]/[kind]/[page]/route'

describe('city-aware sharded public sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MULTI_CITY_ROUTING_ENABLED = 'true'
    sitemapState.getEffectiveSale.mockImplementation(async ({ city }: { city: string }) => ({
      docs: city === 'shanghai' ? [{ slug: 'sale-office' }] : [], hasNextPage: false, nextPage: null,
    }))
    sitemapState.listPublicCityProfiles.mockResolvedValue([
      { citySlug: 'shanghai', serviceStatus: 'live' },
      { citySlug: 'suzhou', serviceStatus: 'live' },
      { citySlug: 'hangzhou', serviceStatus: 'coming-soon' },
    ])
    sitemapState.getCachedSitemapListingsPage.mockImplementation(async (city: string, page: number) => ({
      docs: [{ slug: `${city}-listing-${page}`, updatedAt: '2026-08-13T00:00:00.000Z', businessType: city === 'shanghai' ? 'sale' : 'lease' }],
      hasNextPage: false, nextPage: null, page,
    }))
    sitemapState.getCachedSitemapBuildingsPage.mockImplementation(async (city: string, page: number) => ({
      docs: [{ slug: `${city}-building-${page}` }], hasNextPage: false, nextPage: null, page,
    }))
    sitemapState.getCachedPublishedPages.mockResolvedValue([
      { slug: 'home', updatedAt: '2026-08-10T00:00:00.000Z' },
      { slug: 'privacy', updatedAt: '2026-08-10T00:00:00.000Z' },
    ])
    sitemapState.getCachedPublishedArticles.mockResolvedValue({
      docs: [{ slug: 'market-update', publishedAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' }], totalDocs: 1, totalPages: 1,
    })
  })

  it('keeps /sitemap.xml as an index for static and live-city entity shards', async () => {
    const response = await getIndex()
    const xml = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')
    expect(xml).toContain('<sitemapindex')
    expect(xml).toContain('https://example.com/sitemaps/static.xml')
    expect(xml).toContain('/sitemaps/shanghai/listings/1.xml')
    expect(xml).toContain('/sitemaps/suzhou/buildings/1.xml')
    expect(xml).not.toContain('hangzhou')
  })

  it('indexes all 60,000 listings using bounded shards instead of truncating at 5,000', async () => {
    sitemapState.listPublicCityProfiles.mockResolvedValue([{ citySlug: 'shanghai', serviceStatus: 'live' }])
    sitemapState.getCachedSitemapListingsPage.mockImplementation(async (_city: string, page: number) => ({
      docs: Array.from({ length: 500 }, (_, index) => ({
        slug: `listing-${(page - 1) * 500 + index + 1}`, businessType: 'lease',
      })),
      hasNextPage: page < 120, nextPage: page < 120 ? page + 1 : null, page,
      totalPages: 120,
    }))
    const cities = await getSitemapManifest()
    expect(cities[0].listingPages).toHaveLength(120)
    expect(sitemapState.getCachedSitemapListingsPage).toHaveBeenCalledTimes(1)
    const lastShard = await getEntitySitemap('shanghai', 'listings', 120)
    expect(lastShard).toHaveLength(500)
    expect(lastShard?.at(-1)?.url).toBe('https://example.com/shanghai/listings/listing-60000')
    expect(sitemapXml(lastShard!)).not.toContain('<sitemapindex')
  })

  it('follows building pages even when a filtered page is empty', async () => {
    sitemapState.getCachedSitemapBuildingsPage.mockImplementation(async (_city: string, page: number) => ({
      docs: page === 2 ? [] : [{ slug: `building-${page}` }],
      hasNextPage: page < 3, nextPage: page < 3 ? page + 1 : null, page,
    }))
    const cities = await getSitemapManifest()
    expect(cities[0].buildingPages).toEqual([1, 3])
    expect(cities[1].buildingPages).toEqual([1, 3])
  })

  it('serves a valid empty shard when every candidate on a page fails eligibility', async () => {
    sitemapState.getCachedSitemapListingsPage.mockResolvedValue({
      docs: [], totalPages: 2, hasNextPage: false, nextPage: null, page: 2,
    })
    const response = await getShard(new Request('https://example.com'), {
      params: Promise.resolve({ city: 'shanghai', kind: 'listings', page: '2.xml' }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<urlset')
    expect(await getEntitySitemap('shanghai', 'listings', 3)).toBeNull()
  })

  it('uses real lastmod and escapes slug characters in XML', async () => {
    sitemapState.getCachedSitemapListingsPage.mockResolvedValue({
      docs: [{ slug: 'office&a', updatedAt: '2026-08-13T00:00:00.000Z' }],
      hasNextPage: false, nextPage: null, page: 1,
    })
    const xml = sitemapXml((await getEntitySitemap('shanghai', 'listings', 1))!)
    expect(xml).toContain('office&amp;a')
    expect(xml).toContain('<lastmod>2026-08-13T00:00:00.000Z</lastmod>')
  })

  it('preserves content and sale channel indexability in the static shard', async () => {
    const urls = (await getStaticSitemap()).map(({ url }) => url)
    expect(urls).toContain('https://example.com/shanghai/sale')
    expect(urls).not.toContain('https://example.com/suzhou/sale')
    expect(urls).toContain('https://example.com/news/market-update')
    expect(urls.filter((url) => url === 'https://example.com/pages/privacy')).toHaveLength(1)
    expect(urls.filter((url) => url === 'https://example.com/city-partner')).toHaveLength(1)
    expect(urls).not.toContain('https://example.com/pages/home')
  })

  it('静态页与城市频道页不写请求时刻当 lastmod；/news 用最新资讯的发布时间', async () => {
    const entries = await getStaticSitemap()
    const byUrl = new Map(entries.map((entry) => [entry.url, entry]))
    for (const url of [
      'https://example.com/entrust',
      'https://example.com/publish',
      'https://example.com/city-partner',
      'https://example.com/pages/privacy',
      'https://example.com/shanghai',
      'https://example.com/shanghai/listings',
      'https://example.com/shanghai/buildings',
      'https://example.com/shanghai/coworking',
      'https://example.com/shanghai/sale',
    ]) {
      expect(byUrl.has(url), url).toBe(true)
      expect(byUrl.get(url)?.lastModified, url).toBeUndefined()
    }
    // 资讯 lastmod 用真实修改时间（updatedAt），不是发布时间；/news 取所有资讯里最晚的
    expect(byUrl.get('https://example.com/news/market-update')?.lastModified).toEqual(new Date('2026-09-02T00:00:00.000Z'))
    expect(byUrl.get('https://example.com/news')?.lastModified).toEqual(new Date('2026-09-02T00:00:00.000Z'))
  })

  it('资讯缺 updatedAt 时退回发布时间，两者都没有就不写 lastmod', async () => {
    sitemapState.getCachedPublishedArticles.mockResolvedValue({
      docs: [
        { slug: 'only-published', publishedAt: '2026-08-11T00:00:00.000Z', updatedAt: null },
        { slug: 'no-time', publishedAt: null, updatedAt: null },
      ],
      totalDocs: 2, totalPages: 1,
    })
    const byUrl = new Map((await getStaticSitemap()).map((entry) => [entry.url, entry]))
    expect(byUrl.get('https://example.com/news/only-published')?.lastModified).toEqual(new Date('2026-08-11T00:00:00.000Z'))
    expect(byUrl.get('https://example.com/news/no-time')?.lastModified).toBeUndefined()
  })

  it('没有任何已发布资讯时 /news 不进 sitemap', async () => {
    sitemapState.getCachedPublishedArticles.mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 1 })
    const urls = (await getStaticSitemap()).map(({ url }) => url)
    expect(urls).not.toContain('https://example.com/news')
    expect(urls.some((url) => url.startsWith('https://example.com/news/'))).toBe(false)
  })

  it('uses only default-city legacy canonical paths when routing is off', async () => {
    process.env.MULTI_CITY_ROUTING_ENABLED = 'false'
    expect((await getSitemapManifest()).map((city) => city.citySlug)).toEqual(['shanghai'])
    expect((await getEntitySitemap('shanghai', 'listings', 1))?.[0].url).toBe('https://example.com/listings/shanghai-listing-1')
    expect(await getEntitySitemap('suzhou', 'listings', 1)).toBeNull()
  })

  it('rejects invalid shard paths and coming-soon cities', async () => {
    for (const params of [
      { city: 'shanghai', kind: 'other', page: '1.xml' },
      { city: 'shanghai', kind: 'listings', page: '0.xml' },
      { city: 'hangzhou', kind: 'listings', page: '1.xml' },
      { city: 'shanghai', kind: 'listings', page: '501.xml' },
    ]) {
      expect((await getShard(new Request('https://example.com'), { params: Promise.resolve(params) })).status).toBe(404)
    }
  })

  it('fails closed on repeated pagination instead of silently publishing a partial index', async () => {
    sitemapState.getCachedSitemapListingsPage.mockResolvedValue({
      docs: [], hasNextPage: true, nextPage: 1, page: 1,
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect((await getIndex()).status).toBe(503)
      expect(errorLog).toHaveBeenCalledWith('[sitemap] dynamic_entries_unavailable')
    } finally { errorLog.mockRestore() }
  })

  it('returns 503 without logging database secrets on loader failure', async () => {
    const secret = 'postgres://secret-user:secret-pass@db.example/sbh'
    sitemapState.listPublicCityProfiles.mockRejectedValueOnce(new Error(secret))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect((await getIndex()).status).toBe(503)
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret)
    } finally { errorLog.mockRestore() }
  })
})
