import { beforeEach, describe, expect, it, vi } from 'vitest'

const sitemapState = vi.hoisted(() => ({
  getCachedPublishedArticles: vi.fn(),
  getCachedPublishedPages: vi.fn(),
  getCachedSearchBuildings: vi.fn(),
  getCachedSearchListings: vi.fn(),
  listPublicCityProfiles: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))

vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com', defaultCity: 'shanghai' },
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityProfiles: sitemapState.listPublicCityProfiles,
}))

vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedPublishedArticles: sitemapState.getCachedPublishedArticles,
  getCachedPublishedPages: sitemapState.getCachedPublishedPages,
  getCachedSearchBuildings: sitemapState.getCachedSearchBuildings,
  getCachedSearchListings: sitemapState.getCachedSearchListings,
}))

vi.mock('@/domain/public-catalog', () => ({
  SITEMAP_TAG: 'public:sitemap',
  parseSearchInput: () => ({ page: 1, pageSize: 24 }),
}))

import sitemap from '@/app/(frontend)/sitemap'

describe('city-aware public sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sitemapState.listPublicCityProfiles.mockResolvedValue([
      { citySlug: 'shanghai', serviceStatus: 'live' },
      { citySlug: 'suzhou', serviceStatus: 'live' },
      { citySlug: 'hangzhou', serviceStatus: 'coming-soon' },
    ])
    sitemapState.getCachedSearchListings.mockImplementation(async (city: string) => ({
      docs: [{
        id: city === 'shanghai' ? 101 : 201,
        slug: `${city}-listing`,
        updatedAt: '2026-08-13T00:00:00.000Z',
      }],
      pagination: { page: 1, totalPages: 1 },
    }))
    sitemapState.getCachedSearchBuildings.mockImplementation(async (city: string) => ({
      docs: [{
        id: city === 'shanghai' ? 301 : 401,
        slug: `${city}-building`,
        updatedAt: '2026-08-12T00:00:00.000Z',
      }],
    }))
    sitemapState.getCachedPublishedPages.mockResolvedValue([
      { id: 1, slug: 'home', updatedAt: '2026-08-10T00:00:00.000Z' },
      { id: 2, slug: 'privacy', updatedAt: '2026-08-10T00:00:00.000Z' },
    ])
    sitemapState.getCachedPublishedArticles.mockResolvedValue({
      docs: [{ id: 3, slug: 'market-update', publishedAt: '2026-08-11T00:00:00.000Z' }],
      page: 1,
      totalPages: 1,
    })
  })

  it('enumerates only live city roots and their own effective supply', async () => {
    const urls = (await sitemap()).map(({ url }) => url)

    expect(urls).toContain('https://example.com/shanghai')
    expect(urls).toContain('https://example.com/suzhou')
    expect(urls).not.toContain('https://example.com/hangzhou')
    expect(urls).toContain('https://example.com/shanghai/listings/shanghai-listing')
    expect(urls).toContain('https://example.com/suzhou/listings/suzhou-listing')
    expect(urls).not.toContain('https://example.com/shanghai/listings/suzhou-listing')
    expect(urls).not.toContain('https://example.com/suzhou/listings/shanghai-listing')
    expect(urls).toContain('https://example.com/shanghai/buildings/shanghai-building')
    expect(urls).toContain('https://example.com/suzhou/buildings/suzhou-building')
    expect(urls.every((url) => !url.includes('?'))).toBe(true)
    expect(sitemapState.listPublicCityProfiles).toHaveBeenCalledTimes(1)
  })

  it('preserves global content and includes city-partner exactly once', async () => {
    const urls = (await sitemap()).map(({ url }) => url)

    expect(urls).toContain('https://example.com/news')
    expect(urls).toContain('https://example.com/news/market-update')
    expect(urls).toContain('https://example.com/pages/privacy')
    expect(urls.filter((url) => url === 'https://example.com/city-partner')).toHaveLength(1)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('keeps static global routes when loading dynamic entries fails without logging secrets', async () => {
    const secretMarker = 'postgres://secret-user:secret-pass@db.example/sbh'
    sitemapState.listPublicCityProfiles.mockRejectedValueOnce(
      new Error(`Local API unavailable: ${secretMarker}`),
    )
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const urls = (await sitemap()).map(({ url }) => url)
      expect(urls).toEqual(expect.arrayContaining([
        'https://example.com/entrust',
        'https://example.com/publish',
        'https://example.com/news',
        'https://example.com/city-partner',
      ]))
      expect(errorLog).toHaveBeenCalledWith('[sitemap] dynamic_entries_unavailable')
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secretMarker)
    } finally {
      errorLog.mockRestore()
    }
  })
})
