import { describe, expect, it } from 'vitest'

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
})
