import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import * as publicCatalog from '@/domain/public-catalog'
import type { DistrictViewModel, SearchContext, SupplyAdapter } from '@/domain/public-catalog'
import { defaultSearchContext } from '@/domain/public-catalog'
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
      defaultSearchContext(new Date('2026-07-25T00:00:00.000Z')),
      adapter,
    )

    expect(findEffectiveDistricts).toHaveBeenCalledOnce()
    expect(result).toEqual([{ id: 1, slug: 'jingan', name: '静安' }])
  })
})

describe('OPT-026 route cache and prefetch contracts', () => {
  it('routes canonical searches through tagged caches without loading the homepage', async () => {
    const [page, cachedQueries] = await Promise.all([
      readFile(resolve(ROOT, 'src/app/(frontend)/listings/page.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/lib/frontend/cached-queries.ts'), 'utf8'),
    ])

    expect(page).toContain('getCachedSearchListings(canonical, input)')
    expect(page).toContain('getCachedListingDistrictOptions()')
    expect(page).not.toContain('getHomepage(')
    expect(cachedQueries).toMatch(
      /export const getCachedSearchListings = unstable_cache\([\s\S]*?revalidate:\s*300[\s\S]*?\n\)/,
    )
  })

  it('disables automatic prefetch for high-cardinality listing links', async () => {
    const [categoryTiles, districtCards, siteNav, filterBar] = await Promise.all([
      readFile(resolve(ROOT, 'src/components/frontend/CategoryTiles.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/DistrictCards.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/SiteNav.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/FilterBar.tsx'), 'utf8'),
    ])

    expect(categoryTiles).toContain(
      "prefetch={t.href.startsWith('/listings') ? false : undefined}",
    )
    expect(districtCards).toMatch(
      /href=\{`\/listings\?businessArea=\$\{district\.slug\}`\}[\s\S]*?prefetch=\{false\}/,
    )
    expect(siteNav).toContain(
      "prefetch={item.href.startsWith('/listings') ? false : undefined}",
    )
    expect(filterBar).toContain('prefetch={false}')
  })
})
