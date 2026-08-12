import { describe, expect, it, vi } from 'vitest'

const { revalidateTag } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidateTag }))

import { CitySiteProfiles } from '@/collections/CitySiteProfiles'
import { Locations } from '@/collections/Locations'
import {
  cityProfileTag,
  tagsForLocationVisibilityChange,
  tagsForProfileChange,
} from '@/domain/city-site-profile/cache-invalidator'

describe('city profile cache invalidator', () => {
  it('builds a city-profile cache tag from the city slug', () => {
    expect(cityProfileTag('hangzhou')).toBe('public:city-profile:hangzhou')
  })

  it('invalidates the profile, profile list, city home, and sitemap after a profile change', () => {
    expect(
      tagsForProfileChange({ id: 101, city: { id: 1, slug: 'hangzhou' } }),
    ).toEqual([
      'public:city-profile:hangzhou',
      'public:city-profiles',
      'public:home:hangzhou',
      'public:sitemap',
    ])
  })

  it('invalidates the owning city profile, home, facets, and sitemap after a visible location change', () => {
    expect(
      tagsForLocationVisibilityChange({ id: 202, city: { id: 1, slug: 'hangzhou' } }),
    ).toEqual([
      'public:city-profile:hangzhou',
      'public:city-profiles',
      'public:home:hangzhou',
      'public:facets:hangzhou',
      'public:sitemap',
    ])
  })

  it('uses conservative category tags when a location has no resolvable owning city', () => {
    expect(tagsForLocationVisibilityChange({ id: 303, city: 1 })).toEqual([
      'public:city-profiles',
      'public:home:all',
      'public:facets:all',
      'public:sitemap',
    ])
  })

  it('revalidates both old and new city caches when a profile is reassigned', async () => {
    revalidateTag.mockClear()
    const hook = CitySiteProfiles.hooks?.afterChange?.[0]
    if (!hook) throw new Error('city_profile_after_change_hook_missing')

    await Reflect.apply(hook, undefined, [{
      doc: { id: 404, city: { id: 2, slug: 'suzhou' } },
      previousDoc: { id: 404, city: { id: 1, slug: 'hangzhou' } },
      req: {},
    }])

    expect(revalidateTag).toHaveBeenCalledWith('public:city-profile:hangzhou', 'max')
    expect(revalidateTag).toHaveBeenCalledWith('public:home:hangzhou', 'max')
    expect(revalidateTag).toHaveBeenCalledWith('public:city-profile:suzhou', 'max')
    expect(revalidateTag).toHaveBeenCalledWith('public:home:suzhou', 'max')
  })

  it('invalidates the owning city caches after a Location is deleted', async () => {
    revalidateTag.mockClear()
    const hook = Locations.hooks?.afterDelete?.[0]
    if (!hook) throw new Error('location_after_delete_hook_missing')

    await Reflect.apply(hook, undefined, [{
      doc: {
        id: 505,
        city: { id: 1, slug: 'hangzhou' },
        frontendVisible: true,
        slug: 'west-lake',
        status: 'active',
        type: 'district',
      },
      req: {},
    }])

    expect(revalidateTag).toHaveBeenCalledWith('public:city-profile:hangzhou', 'max')
    expect(revalidateTag).toHaveBeenCalledWith('public:facets:hangzhou', 'max')
    expect(revalidateTag).toHaveBeenCalledWith('public:sitemap', 'max')
  })
})
