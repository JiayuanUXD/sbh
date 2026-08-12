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
        {
          id: 1,
          city: { id: 1, slug: 'hangzhou', name: 'Hangzhou', type: 'city' },
          serviceStatus: 'coming-soon',
          switcherVisible: true,
          sortOrder: 20,
          seoTitle: 'Hangzhou office leasing',
          seoDescription: 'A public city profile for Hangzhou office leasing and site selection.',
          featuredRegions: [],
        },
        {
          id: 2,
          city: { id: 2, slug: 'shanghai', name: 'Shanghai', type: 'city' },
          serviceStatus: 'live',
          switcherVisible: true,
          sortOrder: 10,
          seoTitle: 'Shanghai office leasing',
          seoDescription: 'A public city profile for Shanghai office leasing and site selection.',
          featuredRegions: [],
        },
        {
          id: 3,
          city: { id: 3, slug: 'nanjing', name: 'Nanjing', type: 'city' },
          serviceStatus: 'coming-soon',
          switcherVisible: false,
          sortOrder: 5,
          seoTitle: 'Nanjing office leasing',
          seoDescription: 'A public city profile for Nanjing office leasing and site selection.',
          featuredRegions: [],
        },
      ],
    })

    await expect(listPublicCityOptions()).resolves.toEqual([
      { slug: 'shanghai', name: 'Shanghai', serviceStatus: 'live', sortOrder: 10 },
      { slug: 'hangzhou', name: 'Hangzhou', serviceStatus: 'coming-soon', sortOrder: 20 },
    ])
  })
})
