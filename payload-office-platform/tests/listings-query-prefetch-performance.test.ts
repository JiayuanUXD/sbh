import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(loader: T) => loader,
}))

import * as publicCatalog from '@/domain/public-catalog'
import type { DistrictViewModel, SearchContext, SupplyAdapter } from '@/domain/public-catalog'
import { createSearchContext } from '@/domain/public-catalog'
import { buildListingSearchSourceCacheKey } from '@/lib/frontend/cached-queries'
import { DISTRICT_JINGAN } from '@/test/frontend/payload-documents'

const ROOT = process.cwd()

type ListingDistrictOptionsQuery = (
  ctx: SearchContext,
  adapter?: SupplyAdapter,
) => Promise<readonly DistrictViewModel[]>

function isListingDistrictOptionsQuery(value: unknown): value is ListingDistrictOptionsQuery {
  return typeof value === 'function'
}

describe('OPT-026 lightweight listing district options', () => {
  it('only asks the adapter for effective districts and maps public fields', async () => {
    const candidate: unknown = Reflect.get(publicCatalog, 'getListingDistrictOptions')
    expect(isListingDistrictOptionsQuery(candidate)).toBe(true)
    if (!isListingDistrictOptionsQuery(candidate)) return

    const findEffectiveDistricts = vi.fn(async () => [DISTRICT_JINGAN])
    const adapter = new Proxy({} as SupplyAdapter, {
      get(_target, property) {
        if (property === 'findEffectiveDistricts') return findEffectiveDistricts
        throw new Error(`unexpected adapter access: ${String(property)}`)
      },
    })

    const result = await candidate(
      createSearchContext('shanghai', new Date('2026-07-25T00:00:00.000Z')),
      adapter,
    )

    expect(findEffectiveDistricts).toHaveBeenCalledOnce()
    expect(result).toEqual([{ id: 1, slug: 'jingan', name: '静安' }])
  })
})

describe('OPT-026 route cache and prefetch contracts', () => {
  it('shares the expensive listing search source cache across pages of the same query', () => {
    const base = publicCatalog.parseSearchInput(
      new URLSearchParams('type=traditional-office&sort=newest&page=1'),
    )

    const firstPageKey = buildListingSearchSourceCacheKey(base)
    const secondPageKey = buildListingSearchSourceCacheKey({ ...base, page: 2 })
    const differentSortKey = buildListingSearchSourceCacheKey({ ...base, sort: 'price-asc' })
    const differentFilterKey = buildListingSearchSourceCacheKey({
      ...base,
      listingType: ['serviced-office'],
    })

    expect(secondPageKey).toBe(firstPageKey)
    expect(firstPageKey).not.toContain('page=1')
    expect(differentSortKey).not.toBe(firstPageKey)
    expect(differentFilterKey).not.toBe(firstPageKey)
  })

  it('routes canonical searches through tagged caches without loading the homepage', async () => {
    const [page, cachedQueries] = await Promise.all([
      readFile(resolve(ROOT, 'src/app/(frontend)/listings/page.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/lib/frontend/cached-queries.ts'), 'utf8'),
    ])

    expect(page).toContain('getCachedSearchListings(city.slug, canonical, input)')
    expect(page).toContain('getCachedListingDistrictOptions(city.slug)')
    expect(page).not.toContain('getHomepage(')
    expect(cachedQueries).toContain('getCachedListingSearchSourceByCity = memoizeByCity(')
    expect(cachedQueries).toContain('revalidate: 300')
  })

  it('disables automatic prefetch for high-cardinality listing links', async () => {
    // FilterBar.tsx（本用例原先读取的文件）已在 OPT-036 Task 13 删除；筛选条
    // 高基数链接的职责现由 FilterFormC.tsx 的行内选项 <Link> 承接，断言跟着
    // 换成同一个入口，保持「高基数房源筛选链接禁用自动预取」这条设计意图不丢。
    const [homeTypeCards, homeDistrictBento, siteNav, filterFormC] = await Promise.all([
      readFile(resolve(ROOT, 'src/components/frontend/home/HomeTypeCards.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/home/HomeDistrictBento.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/SiteNav.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/listing/FilterFormC.tsx'), 'utf8'),
    ])

    expect(homeTypeCards).toContain("href={`${prefix}${t.href}`} prefetch={false}")
    expect(homeDistrictBento).toContain('/listings?district=${encodeURIComponent(card.slug)}')
    expect(homeDistrictBento).toContain('prefetch={false}')
    expect(siteNav).toContain(
      "prefetch={item.href.startsWith('/listings') ? false : undefined}",
    )
    expect(filterFormC).toContain('prefetch={false}')
  })
})
