import { afterEach, describe, expect, it, vi } from 'vitest'

const { findCityProfiles, stalePublicProfiles, unstableCache } = vi.hoisted(() => {
  const stalePublicProfiles: { enabled: boolean; value: readonly unknown[] } = {
    enabled: false,
    value: [],
  }
  return {
    findCityProfiles: vi.fn(),
    stalePublicProfiles,
    unstableCache: vi.fn((
      fn: (...args: unknown[]) => unknown,
      keyParts: readonly string[],
      _options: Readonly<{ revalidate?: number; tags?: readonly string[] }>,
    ) => {
      if (keyParts[0] !== 'public-city-profiles') return fn
      return (...args: unknown[]) =>
        stalePublicProfiles.enabled ? Promise.resolve(stalePublicProfiles.value) : fn(...args)
    }),
  }
})

vi.mock('next/cache', () => ({
  unstable_cache: unstableCache,
}))
vi.mock('react', () => ({
  cache: (fn: (...args: unknown[]) => unknown) => fn,
}))
vi.mock('payload', () => ({
  getPayload: async () => ({ find: findCityProfiles }),
}))
vi.mock('@/payload.config', () => ({ default: {} }))

import type { PublicCitySiteProfile } from '@/domain/city-site-profile/public-contract'
import {
  listPublicCityOptions,
  listPublicCityProfiles,
  livePlatformStatsSlugs,
  resolveCityContext,
} from '@/app/(frontend)/_lib/city-context'
import {
  createCityContextResolver,
  normalizeCitySlug,
} from '@/domain/city-site-profile/resolver'

function profile(overrides: Partial<PublicCitySiteProfile> = {}): PublicCitySiteProfile {
  return {
    cityId: 2,
    citySlug: 'hangzhou',
    cityName: 'Hangzhou',
    serviceStatus: 'coming-soon',
    switcherVisible: true,
    sortOrder: 20,
    avgResponseHours: null,
    seoTitle: 'Hangzhou office leasing',
    seoDescription: 'A public city profile for Hangzhou office leasing and site selection now.',
    hero: { eyebrow: '', heading: '', body: '', media: null },
    intro: { heading: '', body: '' },
    contact: { heading: '', body: '' },
    featuredRegions: [],
    ...overrides,
  }
}

function cityProfileDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    city: { id: 1, slug: 'shanghai', name: 'Shanghai', type: 'city', status: 'active' },
    serviceStatus: 'live',
    switcherVisible: true,
    sortOrder: 10,
    seoTitle: 'Shanghai office leasing',
    seoDescription: 'A public city profile for Shanghai office leasing and site selection now.',
    featuredRegions: [],
    ...overrides,
  }
}

function cityCacheFactoryCalls(slug: string): readonly unknown[][] {
  return unstableCache.mock.calls.filter((call) =>
    Array.isArray(call[1]) && call[1][0] === 'public-city-profile' && call[1][1] === slug,
  )
}

function cityProfileDocuments(prefix: string, count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1
    const slug = `${prefix}-${number}`
    const name = `${prefix} ${number}`
    return cityProfileDocument({
      id: 1000 + number,
      city: { id: 1000 + number, slug, name, type: 'city', status: 'active' },
      sortOrder: number,
      seoTitle: `${name} office leasing`,
      seoDescription: `${name} public office leasing and site selection profile with current service information.`,
    })
  })
}

afterEach(() => {
  stalePublicProfiles.enabled = false
  stalePublicProfiles.value = []
})

describe('city context resolver', () => {
  it('normalizes a valid city slug and rejects path-like input', () => {
    expect(normalizeCitySlug(' Hangzhou ')).toBe('hangzhou')
    expect(normalizeCitySlug('../news')).toBeNull()
    expect(normalizeCitySlug('hangzhou/news')).toBeNull()
    expect(normalizeCitySlug('')).toBeNull()
    expect(normalizeCitySlug('a'.repeat(65))).toBeNull()
  })

  it('configures list cache expiry and the city-profile category tag', () => {
    const listCacheCall = unstableCache.mock.calls.find((call) =>
      Array.isArray(call[1]) && call[1][0] === 'public-city-profiles',
    )

    expect(listCacheCall?.[2]).toEqual({
      revalidate: 300,
      tags: ['public:city-profiles'],
    })
  })

  it('fails closed for absent and disabled profiles', async () => {
    const lookup = vi.fn(async (slug: string) => {
      if (slug === 'hangzhou') return profile()
      return null
    })
    const resolver = createCityContextResolver(lookup)

    await expect(resolver('missing')).resolves.toBeNull()
    await expect(resolver('disabled-city')).resolves.toBeNull()
    await expect(resolver('hangzhou')).resolves.toEqual(
      expect.objectContaining({ slug: 'hangzhou', serviceStatus: 'coming-soon' }),
    )
    expect(lookup).toHaveBeenCalledTimes(3)
  })

  it('does not create a context when a lookup returns a mismatched profile slug', async () => {
    const resolver = createCityContextResolver(async () => profile({ citySlug: 'shanghai' }))

    await expect(resolver('hangzhou')).resolves.toBeNull()
  })

  it('fails closed when the profile lookup is unavailable', async () => {
    const resolver = createCityContextResolver(async () => {
      throw new Error('database unavailable')
    })

    await expect(resolver('hangzhou')).resolves.toBeNull()
  })

  it('returns visible city options in deterministic profile sort order', async () => {
    findCityProfiles.mockResolvedValueOnce({
      docs: [
        cityProfileDocument({
          id: 1,
          city: { id: 1, slug: 'hangzhou', name: 'Hangzhou', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          sortOrder: 20,
          seoTitle: 'Hangzhou office leasing',
          seoDescription: 'A public city profile for Hangzhou office leasing and site selection now.',
        }),
        cityProfileDocument(),
        cityProfileDocument({
          id: 3,
          city: { id: 3, slug: 'nanjing', name: 'Nanjing', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          switcherVisible: false,
          sortOrder: 5,
        }),
        cityProfileDocument({
          id: 4,
          city: { id: 4, slug: 'news', name: 'News', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          sortOrder: 30,
          seoTitle: 'News office leasing',
          seoDescription: 'A public city profile for News office leasing and site selection with verified local service details.',
        }),
      ],
    })

    await expect(listPublicCityOptions()).resolves.toEqual([
      { slug: 'shanghai', name: 'Shanghai', serviceStatus: 'live', sortOrder: 10 },
      { slug: 'hangzhou', name: 'Hangzhou', serviceStatus: 'coming-soon', sortOrder: 20 },
    ])
  })

  it('uses the short Chinese city display name while preserving approved SEO copy', async () => {
    findCityProfiles.mockResolvedValueOnce({
      docs: [
        cityProfileDocument({
          city: { id: 2, slug: 'hangzhou', name: '杭州市', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          sortOrder: 20,
          seoTitle: '杭州办公室租赁与写字楼选址',
          seoDescription: `商办租赁为您提供杭州办公室租赁、写字楼与共享办公选址服务，${'覆盖重点商务区域与楼宇信息并提供企业选址支持。'.repeat(2)}`,
        }),
      ],
    })

    await expect(listPublicCityOptions()).resolves.toEqual([
      { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon', sortOrder: 20 },
    ])
  })

  it('fails closed on non-canonical raw slugs and invalid city-aware SEO', async () => {
    findCityProfiles.mockResolvedValueOnce({
      docs: [
        cityProfileDocument(),
        cityProfileDocument({
          id: 2,
          city: { id: 2, slug: ' Hangzhou ', name: 'Hangzhou', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          sortOrder: 20,
          seoTitle: 'Hangzhou office leasing',
          seoDescription: 'A public city profile for Hangzhou office leasing and site selection now.',
        }),
        cityProfileDocument({
          id: 3,
          city: { id: 3, slug: 'nanjing', name: 'Nanjing', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          sortOrder: 30,
          seoTitle: 'Office leasing without the display city',
          seoDescription: 'A public city profile for office leasing without its current display city name.',
        }),
        cityProfileDocument({
          id: 4,
          city: { id: 4, slug: 'suzhou', name: 'Suzhou', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          sortOrder: 40,
          seoTitle: `Suzhou${'x'.repeat(60)}`,
          seoDescription: 'Suzhou is too short.',
        }),
      ],
    })

    await expect(listPublicCityOptions()).resolves.toEqual([
      { slug: 'shanghai', name: 'Shanghai', serviceStatus: 'live', sortOrder: 10 },
    ])
  })

  it('requires populated featured regions to be canonical, active, visible, and owned by the profile city', async () => {
    const validRegion = {
      id: 11,
      slug: 'pudong',
      name: 'Pudong',
      type: 'district',
      status: 'active',
      frontendVisible: true,
      city: { id: 1, slug: 'shanghai' },
    }
    findCityProfiles.mockResolvedValueOnce({
      docs: [
        cityProfileDocument({ featuredRegions: [validRegion] }),
        cityProfileDocument({
          id: 2,
          city: { id: 2, slug: 'hangzhou', name: 'Hangzhou', type: 'city', status: 'active' },
          seoTitle: 'Hangzhou office leasing',
          seoDescription: 'A public city profile for Hangzhou office leasing and site selection now.',
          featuredRegions: [{ ...validRegion, id: 12, city: { id: 2 }, status: 'disabled' }],
        }),
        cityProfileDocument({
          id: 3,
          city: { id: 3, slug: 'nanjing', name: 'Nanjing', type: 'city', status: 'active' },
          seoTitle: 'Nanjing office leasing',
          seoDescription: 'A public city profile for Nanjing office leasing and site selection now.',
          featuredRegions: [{ ...validRegion, id: 13, city: { id: 3 }, frontendVisible: false }],
        }),
        cityProfileDocument({
          id: 4,
          city: { id: 4, slug: 'suzhou', name: 'Suzhou', type: 'city', status: 'active' },
          seoTitle: 'Suzhou office leasing',
          seoDescription: 'A public city profile for Suzhou office leasing and site selection now.',
          featuredRegions: [{ ...validRegion, id: 14, city: { id: 99 } }],
        }),
        cityProfileDocument({
          id: 5,
          city: { id: 5, slug: 'ningbo', name: 'Ningbo', type: 'city', status: 'active' },
          seoTitle: 'Ningbo office leasing',
          seoDescription: 'A public city profile for Ningbo office leasing and site selection now.',
          featuredRegions: [{ ...validRegion, id: 15, slug: ' Pudong ', city: { id: 5 } }],
        }),
      ],
    })

    const profiles = await listPublicCityProfiles()

    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.featuredRegions).toEqual([
      { id: 11, slug: 'pudong', name: 'Pudong', type: 'district' },
    ])
    expect(findCityProfiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: 'city-site-profiles', depth: 2 }),
    )
  })

  it('excludes a profile whose populated city is disabled', async () => {
    findCityProfiles.mockResolvedValueOnce({
      docs: [
        cityProfileDocument(),
        cityProfileDocument({
          id: 2,
          city: { id: 2, slug: 'hangzhou', name: 'Hangzhou', type: 'city', status: 'disabled' },
          serviceStatus: 'coming-soon',
          sortOrder: 20,
        }),
      ],
    })

    await expect(listPublicCityOptions()).resolves.toEqual([
      { slug: 'shanghai', name: 'Shanghai', serviceStatus: 'live', sortOrder: 10 },
    ])
  })

  it('excludes malformed persisted values instead of exposing or crashing on them', async () => {
    findCityProfiles.mockResolvedValueOnce({
      docs: [
        cityProfileDocument(),
        cityProfileDocument({ id: 2, city: { id: 2, slug: 'undefined-order', name: 'Undefined', type: 'city', status: 'active' }, sortOrder: undefined }),
        cityProfileDocument({ id: 3, city: { id: 3, slug: 'nan-order', name: 'NaN', type: 'city', status: 'active' }, sortOrder: Number.NaN }),
        cityProfileDocument({ id: 4, city: { id: 4, slug: 'bad-hero', name: 'Hero', type: 'city', status: 'active' }, heroHeading: 42 }),
        cityProfileDocument({ id: 5, city: { id: 5, slug: 'bad-media', name: 'Media', type: 'city', status: 'active' }, heroMedia: { url: 'https://example.com/city.jpg', alt: 'City', width: Number.POSITIVE_INFINITY } }),
        cityProfileDocument({ id: 6, city: { id: 6, slug: 'bad-regions', name: 'Regions', type: 'city', status: 'active' }, featuredRegions: { id: 10 } }),
        cityProfileDocument({ id: 7, city: { id: 7, slug: 'bad-region-type', name: 'Region type', type: 'city', status: 'active' }, featuredRegions: [{ id: 10, slug: 'line-1', name: 'Line 1', type: 'metro_line' }] }),
        cityProfileDocument({ id: 8, city: { id: 8, slug: 'bad-region-id', name: 'Region id', type: 'city', status: 'active' }, featuredRegions: [{ id: Number.POSITIVE_INFINITY, slug: 'west-lake', name: 'West Lake', type: 'district' }] }),
        cityProfileDocument({ id: 9, city: { id: 9, slug: 'bad-region-slug', name: 'Region slug', type: 'city', status: 'active' }, featuredRegions: [{ id: 10, slug: '../west-lake', name: 'West Lake', type: 'district' }] }),
        cityProfileDocument({ id: 10, city: { id: 10, slug: 'bad-region-name', name: 'Region name', type: 'city', status: 'active' }, featuredRegions: [{ id: 10, slug: 'west-lake', name: 12, type: 'district' }] }),
      ],
    })

    await expect(listPublicCityOptions()).resolves.toEqual([
      { slug: 'shanghai', name: 'Shanghai', serviceStatus: 'live', sortOrder: 10 },
    ])
  })

  it('resolves a newly valid city through the exact lookup even when the cached list is stale', async () => {
    const hangzhou = cityProfileDocument({
      city: { id: 2, slug: 'hangzhou', name: 'Hangzhou', type: 'city', status: 'active' },
      serviceStatus: 'coming-soon',
      sortOrder: 20,
      seoTitle: 'Hangzhou office leasing',
      seoDescription: 'A public city profile for Hangzhou office leasing and site selection now.',
    })
    stalePublicProfiles.enabled = true
    stalePublicProfiles.value = []
    findCityProfiles.mockResolvedValue({ docs: [hangzhou] })

    await expect(resolveCityContext('hangzhou')).resolves.toMatchObject({ slug: 'hangzhou' })

    expect(findCityProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'city-site-profiles',
        limit: 1,
        where: { 'city.slug': { equals: 'hangzhou' } },
      }),
    )
  })

  it('performs an exact fail-closed lookup for an unknown valid slug', async () => {
    findCityProfiles.mockResolvedValue({ docs: [] })

    await expect(resolveCityContext('unknown-city')).resolves.toBeNull()

    expect(cityCacheFactoryCalls('unknown-city')).toHaveLength(1)
    expect(findCityProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'city-site-profiles',
        limit: 1,
        where: { 'city.slug': { equals: 'unknown-city' } },
      }),
    )
  })

  it('caps per-slug cache wrappers at 64 and evicts the least-recently-used entry', async () => {
    const documents = cityProfileDocuments('capacity-city', 65)
    findCityProfiles.mockResolvedValue({ docs: documents })

    for (let number = 1; number <= 65; number += 1) {
      await resolveCityContext(`capacity-city-${number}`)
    }
    await resolveCityContext('capacity-city-1')

    expect(cityCacheFactoryCalls('capacity-city-1')).toHaveLength(2)
    expect(cityCacheFactoryCalls('capacity-city-65')).toHaveLength(1)
  })

  it('refreshes LRU recency on a cache hit before evicting the next oldest entry', async () => {
    const documents = cityProfileDocuments('recency-city', 65)
    findCityProfiles.mockResolvedValue({ docs: documents })

    for (let number = 1; number <= 64; number += 1) {
      await resolveCityContext(`recency-city-${number}`)
    }
    await resolveCityContext('recency-city-1')
    expect(cityCacheFactoryCalls('recency-city-1')).toHaveLength(1)

    await resolveCityContext('recency-city-65')
    await resolveCityContext('recency-city-1')
    await resolveCityContext('recency-city-2')

    expect(cityCacheFactoryCalls('recency-city-1')).toHaveLength(1)
    expect(cityCacheFactoryCalls('recency-city-2')).toHaveLength(2)
  })

  it('configures a known per-city cache with expiry and both specific and category tags', async () => {
    const hangzhou = cityProfileDocument({
      city: { id: 2, slug: 'hangzhou', name: 'Hangzhou', type: 'city', status: 'active' },
      serviceStatus: 'coming-soon',
      sortOrder: 20,
      seoTitle: 'Hangzhou office leasing',
      seoDescription: 'A public city profile for Hangzhou office leasing and site selection now.',
    })
    findCityProfiles.mockResolvedValue({ docs: [hangzhou] })

    await expect(resolveCityContext('hangzhou')).resolves.toMatchObject({ slug: 'hangzhou' })

    const cityCacheCall = unstableCache.mock.calls.find((call) =>
      Array.isArray(call[1]) && call[1][0] === 'public-city-profile' && call[1][1] === 'hangzhou',
    )
    expect(cityCacheCall?.[2]).toEqual({
      revalidate: 300,
      tags: ['public:city-profile:hangzhou', 'public:city-profiles'],
    })
  })
})

/**
 * 回归（最终评审 F2）：根页 `/` 数据带的跨城汇总只吃「已开通 + slug 可公开路由」
 * 的城市。历史实现是 `profiles.filter((p) => p.serviceStatus === 'live')`，
 * 没有过 `isPublicCitySlug` 这道路由信任边界。
 */
describe('livePlatformStatsSlugs（根页平台 stats 城市清单）', () => {
  it('只保留 serviceStatus 为 live 的城市', () => {
    expect(
      livePlatformStatsSlugs([
        profile({ citySlug: 'shanghai', serviceStatus: 'live' }),
        profile({ citySlug: 'hangzhou', serviceStatus: 'coming-soon' }),
        profile({ citySlug: 'shenzhen', serviceStatus: 'live' }),
      ]),
    ).toEqual(['shanghai', 'shenzhen'])
  })

  it('剔除不可公开路由的 slug（保留根段 / 非规范形态），不让它们触发跨城查询', () => {
    expect(
      livePlatformStatsSlugs([
        profile({ citySlug: 'shanghai', serviceStatus: 'live' }),
        // 撞上保留根段：前台没有 /listings 城市页，供给点不进去
        profile({ citySlug: 'listings', serviceStatus: 'live' }),
        // 非规范 slug：同样不可路由
        profile({ citySlug: 'Bad_Slug', serviceStatus: 'live' }),
      ]),
    ).toEqual(['shanghai'])
  })

  it('不按 switcherVisible 过滤——那是切换器展示开关，不是开通状态', () => {
    expect(
      livePlatformStatsSlugs([
        profile({ citySlug: 'shanghai', serviceStatus: 'live', switcherVisible: false }),
      ]),
    ).toEqual(['shanghai'])
  })

  it('无 live 城市时返回空清单（getPlatformHomepageStats 据此走全零且零查询）', () => {
    expect(livePlatformStatsSlugs([profile({ serviceStatus: 'coming-soon' })])).toEqual([])
  })
})
