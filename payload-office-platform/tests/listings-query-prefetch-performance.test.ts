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
    // 高基数链接的职责现分别由桌面 FilterFormC.tsx 的行内选项 <Link> 与移动端
    // FilterPill.tsx（MobileFilterSheet 渲染每个筛选行选项时唯一使用的原语）
    // 承接，断言跟着换成这两个入口，保持「高基数房源筛选链接禁用自动预取」
    // 这条设计意图不丢。
    //
    // 只读 FilterPill.tsx、不额外读 MobileFilterSheet.tsx 是刻意的：抽屉里的
    // 筛选行选项（区域/类型/面积/价格……）全部通过 <FilterPill> 渲染，没有
    // 自己内联任何 <Link>；MobileFilterSheet.tsx 里另外两处 <Link>（头部/底栏
    // 各一个「重置」）指向同一个固定 href，不是高基数场景，因此不需要也不
    // 会出现 prefetch={false} 字样——若真去读该文件断言这个字符串，断言会
    // 因为字符串根本不在那份源码里而失去意义。FilterPill.tsx 是唯一的真源，
    // 守住它就守住了移动端这条链路（首次遗漏正是因为守卫当初没覆盖到它）。
    const [homeTypeCards, homeDistrictBento, siteNav, filterFormC, filterPill] = await Promise.all([
      readFile(resolve(ROOT, 'src/components/frontend/home/HomeTypeCards.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/home/HomeDistrictBento.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/SiteNav.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/listing/FilterFormC.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/listing/FilterPill.tsx'), 'utf8'),
    ])

    // OPT-053：跳转目标改由槽位查 SLOT_TARGETS，不再是数组项自带的 t.href
    // （运营可配文案与顺序，但绝不可配 href——那是死链工厂）。prefetch 契约不变。
    expect(homeTypeCards).toContain("href={`${prefix}${target.href}`} prefetch={false}")
    expect(homeDistrictBento).toContain('/listings?district=${encodeURIComponent(card.slug)}')
    expect(homeDistrictBento).toContain('prefetch={false}')
    expect(siteNav).toContain(
      "prefetch={item.href.startsWith('/listings') ? false : undefined}",
    )
    expect(filterFormC).toContain('prefetch={false}')
    expect(filterPill).toContain('prefetch={false}')
  })
})
