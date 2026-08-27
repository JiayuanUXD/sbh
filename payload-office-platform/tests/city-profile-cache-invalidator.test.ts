import { describe, expect, it, vi } from 'vitest'

const { revalidateTag } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidateTag }))

import { IMMEDIATE_CACHE_EXPIRE_PROFILE } from '@/domain/public-catalog/cache-tags'
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
      'public:listings:city:hangzhou',
      'public:buildings:city:hangzhou',
      'public:facets:hangzhou',
      'public:sitemap',
    ])
  })

  it('uses conservative category tags when a location has no resolvable owning city', () => {
    expect(tagsForLocationVisibilityChange({ id: 303, city: 1 })).toEqual([
      'public:city-profiles',
      'public:listings',
      'public:buildings',
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

    expect(revalidateTag).toHaveBeenCalledWith('public:city-profile:hangzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
    expect(revalidateTag).toHaveBeenCalledWith('public:home:hangzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
    expect(revalidateTag).toHaveBeenCalledWith('public:city-profile:suzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
    expect(revalidateTag).toHaveBeenCalledWith('public:home:suzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
  })

  it('revalidates both old and new city supply caches when a Location is reassigned', async () => {
    revalidateTag.mockClear()
    const hook = Locations.hooks?.afterChange?.[0]
    if (!hook) throw new Error('location_after_change_hook_missing')

    await Reflect.apply(hook, undefined, [{
      doc: {
        id: 505,
        city: { id: 2, slug: 'suzhou' },
        frontendVisible: true,
        slug: 'industrial-park',
        status: 'active',
        type: 'district',
      },
      previousDoc: {
        id: 505,
        city: { id: 1, slug: 'hangzhou' },
        frontendVisible: true,
        slug: 'industrial-park',
        status: 'active',
        type: 'district',
      },
      req: {},
    }])

    for (const city of ['hangzhou', 'suzhou']) {
      expect(revalidateTag).toHaveBeenCalledWith(`public:home:${city}`, IMMEDIATE_CACHE_EXPIRE_PROFILE)
      expect(revalidateTag).toHaveBeenCalledWith(`public:listings:city:${city}`, IMMEDIATE_CACHE_EXPIRE_PROFILE)
      expect(revalidateTag).toHaveBeenCalledWith(`public:buildings:city:${city}`, IMMEDIATE_CACHE_EXPIRE_PROFILE)
      expect(revalidateTag).toHaveBeenCalledWith(`public:facets:${city}`, IMMEDIATE_CACHE_EXPIRE_PROFILE)
    }
  })

  it('adds category fallbacks when either side of a Location change has no resolvable city', async () => {
    revalidateTag.mockClear()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const hook = Locations.hooks?.afterChange?.[0]
    if (!hook) throw new Error('location_after_change_hook_missing')

    try {
      await Reflect.apply(hook, undefined, [{
        doc: {
          id: 506,
          city: { id: 2, slug: 'suzhou' },
          frontendVisible: true,
          slug: 'industrial-park',
          status: 'active',
          type: 'district',
        },
        previousDoc: {
          id: 506,
          city: 999,
          frontendVisible: true,
          slug: 'industrial-park',
          status: 'active',
          type: 'district',
        },
        req: {},
      }])

      expect(revalidateTag).toHaveBeenCalledWith('public:home:suzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
      expect(revalidateTag).toHaveBeenCalledWith('public:listings', IMMEDIATE_CACHE_EXPIRE_PROFILE)
      expect(revalidateTag).toHaveBeenCalledWith('public:buildings', IMMEDIATE_CACHE_EXPIRE_PROFILE)
      expect(revalidateTag).toHaveBeenCalledWith('public:sitemap', IMMEDIATE_CACHE_EXPIRE_PROFILE)
    } finally {
      consoleError.mockRestore()
    }
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

    expect(revalidateTag).toHaveBeenCalledWith('public:city-profile:hangzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
    expect(revalidateTag).toHaveBeenCalledWith('public:facets:hangzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
    expect(revalidateTag).toHaveBeenCalledWith('public:sitemap', IMMEDIATE_CACHE_EXPIRE_PROFILE)
  })

  // --- OPT-060：商圈封面变更也要打失效标签 --------------------------------

  // 除 coverImage 外所有字段保持一致——若顺手改了 name/status，PUBLIC_LOCATION_FIELDS
  // 里原有的字段就会替它打上标签，这三条就全变成恒真了。
  const AREA_BASE = {
    id: 707,
    city: { id: 1, slug: 'hangzhou' },
    frontendVisible: true,
    slug: 'wulin',
    status: 'active',
    type: 'business_area',
  } as const

  async function fireLocationChange(doc: unknown, previousDoc: unknown) {
    const hook = Locations.hooks?.afterChange?.[0]
    if (!hook) throw new Error('location_after_change_hook_missing')
    await Reflect.apply(hook, undefined, [{ doc, previousDoc, req: {} }])
  }

  it('只改 coverImage 也会打失效标签（此前不会，运营改了封面前台不更新）', async () => {
    revalidateTag.mockClear()
    await fireLocationChange({ ...AREA_BASE, coverImage: 92 }, { ...AREA_BASE, coverImage: 91 })
    expect(revalidateTag).toHaveBeenCalledWith('public:home:hangzhou', IMMEDIATE_CACHE_EXPIRE_PROFILE)
  })

  it('coverImage 未变时不打标签（门禁没有被改成恒真）', async () => {
    revalidateTag.mockClear()
    // description 不在 PUBLIC_LOCATION_FIELDS 里，改它不该惊动缓存
    await fireLocationChange(
      { ...AREA_BASE, coverImage: 91, description: '改后' },
      { ...AREA_BASE, coverImage: 91, description: '改前' },
    )
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('coverImage 从裸 id 变成展开对象、但指向同一张图 → 不打标签', async () => {
    revalidateTag.mockClear()
    // 这条锁的是 relationshipId 比较分支：直接 Object.is 会把同一张图判成变了，
    // 于是每次保存都白打一轮失效标签。
    await fireLocationChange(
      { ...AREA_BASE, coverImage: { id: 91, url: '/media/a.jpg' } },
      { ...AREA_BASE, coverImage: 91 },
    )
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
