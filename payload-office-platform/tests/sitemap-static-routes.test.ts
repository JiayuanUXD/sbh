import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findEffectiveListings, getPayload, listPublishedPages } = vi.hoisted(() => ({
  findEffectiveListings: vi.fn(),
  getPayload: vi.fn(),
  listPublishedPages: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))

vi.mock('payload', () => ({ getPayload }))
vi.mock('@/payload.config', () => ({ default: {} }))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com' },
}))
vi.mock('@/domain/supply/public-building', () => ({
  getPublicBuildingWhere: () => ({}),
}))
vi.mock('@/domain/public-catalog', () => ({
  SITEMAP_TAG: 'public:sitemap',
  defaultSearchContext: () => ({}),
  getDefaultSupplyAdapter: () => ({ findEffectiveListings }),
  listPublishedPages,
  parseSearchInput: () => ({}),
}))

import sitemap from '@/app/(frontend)/sitemap'

describe('public sitemap static conversion routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findEffectiveListings.mockResolvedValue([])
    listPublishedPages.mockResolvedValue([])
    getPayload.mockResolvedValue({
      find: vi.fn().mockResolvedValue({
        docs: [],
        hasNextPage: false,
        nextPage: null,
      }),
    })
  })

  it('publishes /entrust and /publish exactly once with canonical metadata', async () => {
    const entries = await sitemap()

    expect(entries.filter(({ url }) => url === 'https://example.com/entrust')).toEqual([
      {
        url: 'https://example.com/entrust',
        lastModified: expect.any(Date),
        changeFrequency: 'monthly',
        priority: 0.7,
      },
    ])
    expect(entries.filter(({ url }) => url === 'https://example.com/publish')).toEqual([
      {
        url: 'https://example.com/publish',
        lastModified: expect.any(Date),
        changeFrequency: 'monthly',
        priority: 0.7,
      },
    ])

    const urls = entries.map(({ url }) => url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('keeps static routes when loading dynamic Local API entries fails', async () => {
    const secretMarker = 'postgres://secret-user:secret-pass@db.example/sbh'
    getPayload.mockRejectedValueOnce(new Error(`Local API unavailable: ${secretMarker}`))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(sitemap()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ url: 'https://example.com/entrust' }),
          expect.objectContaining({ url: 'https://example.com/publish' }),
        ]),
      )
      expect(errorLog).toHaveBeenCalledWith('[sitemap] dynamic_entries_unavailable')
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secretMarker)
    } finally {
      errorLog.mockRestore()
    }
  })
})
