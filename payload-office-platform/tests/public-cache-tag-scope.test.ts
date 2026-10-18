/**
 * OPT-111：公开缓存条目的 tag 作用域。
 *
 * 守护的事实：一次失效只该清掉**声明了依赖**的条目。此前每个供给 / 资讯 / 内容页
 * 条目都挂 `SITEMAP_TAG`，而所有失效集合都发送它——于是保存上海的一条房源，
 * 杭州的全部缓存、资讯与内容页一起硬过期。
 *
 * `SITEMAP_TAG` 仍必须挂在站点地图的两条聚合条目上：Next 16 嵌套 `unstable_cache`
 * 不把内层 tag 传给外层（`unstable-cache.js` 的 `case 'unstable-cache'` 分支只置
 * `isNestedUnstableCache`），清单条目只能靠这条 tag 被供给变化清掉。
 *
 * 做法：mock `unstable_cache` 记下每次登记的 keyParts 与 tags，回调不执行。
 * 按城市惰性建立的条目要调用一次对应的 getCached* 才会登记；调用本身因回调
 * 返回 undefined 而在后续处理里失败，这里只关心登记，失败一律吞掉。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

type Registration = { keyParts: readonly string[]; tags: readonly string[] }

const captured = vi.hoisted(() => [] as Registration[])

vi.mock('next/cache', () => ({
  unstable_cache: (
    _load: unknown,
    keyParts: readonly string[] = [],
    options: Readonly<{ tags?: readonly string[] }> = {},
  ) => {
    captured.push({ keyParts: [...keyParts], tags: [...(options.tags ?? [])] })
    return async () => undefined
  },
  revalidateTag: vi.fn(),
}))

// 本文件只观察真实缓存包装器的登记，不执行站点地图回调。
// 隔离回调专用的路由依赖，避免无关模块图初始化占用 beforeAll 的行为测试时限。
vi.mock('@/app/(frontend)/_lib/city-context', () => ({ listPublicCityProfiles: vi.fn() }))
vi.mock('@/app/(frontend)/_lib/sitemap', () => ({ globalStaticUrls: vi.fn() }))

import {
  ARTICLES_CATEGORY_TAG,
  SITEMAP_TAG,
  cityLevelSafeInvalidationTags,
} from '@/domain/public-catalog'
import type { BuildingSearchInput, ListingSearchInput } from '@/domain/public-catalog'
import * as cached from '@/lib/frontend/cached-queries'

const CITIES = ['shanghai', 'hangzhou'] as const

const LISTING_INPUT: ListingSearchInput = { page: 1, pageSize: 24, sort: 'recommended' }
const BUILDING_INPUT: BuildingSearchInput = { page: 1, pageSize: 24, sort: 'stock-desc' }

/** 触发每个按城市惰性建立的缓存条目登记；结果与错误都不关心。 */
async function registerCityEntries(city: string): Promise<void> {
  const calls: Array<() => unknown> = [
    () => cached.getCachedHomepage(city),
    () => cached.getCachedPlatformStats([city]),
    () => cached.getCachedListingBySlug(city, 'probe'),
    () => cached.getCachedRelatedListings(city, 'probe'),
    () => cached.getCachedDetailRecommendations(city, 'probe'),
    () => cached.getCachedRelatedBuildings(city, 'probe'),
    () => cached.getCachedSearchBuildingsFiltered(city, BUILDING_INPUT),
    () => cached.getCachedSitemapBuildingsPage(city, 1, 500),
    () => cached.getCachedSitemapListingsPage(city, 1, 500),
    () => cached.getCachedBuildingDetail(city, 'probe'),
    () => cached.getCachedBuildingBySlug(city, 'probe'),
    () => cached.getCachedListingScanSnapshot(city, LISTING_INPUT),
    () => cached.getCachedListingCardsByIds(city, [1]),
    () => cached.getCachedSearchListings(city, '', LISTING_INPUT),
    () => cached.getCachedListingDistrictOptions(city),
    () => cached.getCachedSearchFacets(city, '', LISTING_INPUT),
    () => cached.getCachedSearchFacetsIgnoring(city, LISTING_INPUT, ['district']),
  ]
  await Promise.allSettled(calls.map(async (call) => call()))
}

describe('公开缓存条目的 tag 作用域（OPT-111）', () => {
  beforeAll(async () => {
    // 站点地图两条聚合条目在模块顶层登记
    await import('@/app/(frontend)/_lib/sitemap-shards')
    for (const city of CITIES) await registerCityEntries(city)
  })

  it('登记到了两城的供给条目（前提：夹具真的产出了被测对象）', () => {
    for (const city of CITIES) {
      expect(captured.filter((e) => e.keyParts.includes(city)).length).toBeGreaterThan(10)
    }
  })

  it('非站点地图条目都不挂 SITEMAP_TAG', () => {
    const offenders = captured.filter(
      (e) => !e.keyParts[0]?.startsWith('public-sitemap-') && e.tags.includes(SITEMAP_TAG),
    )
    expect(offenders.map((e) => e.keyParts.join('|'))).toEqual([])
  })

  it('站点地图清单与出售存在性条目仍挂 SITEMAP_TAG', () => {
    for (const key of ['public-sitemap-manifest-v1', 'public-sitemap-sale-exists-v1']) {
      expect(captured.find((e) => e.keyParts[0] === key)?.tags).toContain(SITEMAP_TAG)
    }
  })

  it('失效上海不波及杭州的任何供给条目', () => {
    const fired = new Set(cityLevelSafeInvalidationTags('shanghai'))
    const hit = captured.filter(
      (e) => e.keyParts.includes('hangzhou') && e.tags.some((t) => fired.has(t)),
    )
    expect(hit.map((e) => e.keyParts.join('|'))).toEqual([])
  })

  it('资讯失效只波及声明了资讯依赖的条目', () => {
    const fired = new Set<string>([ARTICLES_CATEGORY_TAG, SITEMAP_TAG])
    const hit = captured.filter(
      (e) => !e.keyParts[0]?.startsWith('public-sitemap-')
        && !e.tags.includes(ARTICLES_CATEGORY_TAG)
        && e.tags.some((t) => fired.has(t)),
    )
    expect(hit.map((e) => e.keyParts.join('|'))).toEqual([])
  })
})
