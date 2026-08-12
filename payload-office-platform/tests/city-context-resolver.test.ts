import { describe, expect, it, vi } from 'vitest'

const { findCityProfiles } = vi.hoisted(() => ({
  findCityProfiles: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))
vi.mock('react', () => ({
  cache: (fn: (...args: unknown[]) => unknown) => fn,
}))
vi.mock('payload', () => ({
  getPayload: async () => ({ find: findCityProfiles }),
}))
vi.mock('@/payload.config', () => ({ default: {} }))

import type { PublicCitySiteProfile } from '@/domain/city-site-profile/public-contract'
import { listPublicCityOptions } from '@/app/(frontend)/_lib/city-context'
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
    seoTitle: 'Hangzhou office leasing',
    seoDescription: 'A public city profile for Hangzhou office leasing and site selection.',
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
    seoDescription: 'A public city profile for Shanghai office leasing and site selection.',
    featuredRegions: [],
    ...overrides,
  }
}

describe('city context resolver', () => {
  it('normalizes a valid city slug and rejects path-like input', () => {
    expect(normalizeCitySlug(' Hangzhou ')).toBe('hangzhou')
    expect(normalizeCitySlug('../news')).toBeNull()
    expect(normalizeCitySlug('hangzhou/news')).toBeNull()
    expect(normalizeCitySlug('')).toBeNull()
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
        }),
        cityProfileDocument(),
        cityProfileDocument({
          id: 3,
          city: { id: 3, slug: 'nanjing', name: 'Nanjing', type: 'city', status: 'active' },
          serviceStatus: 'coming-soon',
          switcherVisible: false,
          sortOrder: 5,
        }),
      ],
    })

    await expect(listPublicCityOptions()).resolves.toEqual([
      { slug: 'shanghai', name: 'Shanghai', serviceStatus: 'live', sortOrder: 10 },
      { slug: 'hangzhou', name: 'Hangzhou', serviceStatus: 'coming-soon', sortOrder: 20 },
    ])
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
})
