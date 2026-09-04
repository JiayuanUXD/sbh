/**
 * OPT-036 终审 I2：同一次渲染里同 key 的 facet 查询必须合并成一次库查询。
 *
 * ## 被修的事实（不是推理，是读 Next 源码读出来的）
 *
 * `CityListingsView` 并发发出三次 `getCachedSearchFacetsIgnoring`，原注释声称
 * 「剥离后若得到同一份 input 会命中同一条缓存，不会各查一次库」。缓存键的推理
 * 对，结论错：`node_modules/next/dist/server/web/spec-extension/unstable-cache.js`
 * 里 `workStore.pendingRevalidates` 只守住「过期后台重算」与「写回」两条路径，
 * **未命中路径是无条件的**——三次并发的同 key miss 各跑一次回调。而回调是
 * `getSearchFacets` → `adapter.findEffectiveListings`：不分页、`depth: 2`、
 * 带商户关系水合，正是 OPT-031 认定的 sitemap 70 秒超时源头。
 *
 * 列表路由是 `force-dynamic`，且 `q` 是自由文本 → 缓存键空间无上界，冷未命中是
 * 常态而非罕见；一个 `?q=` 乱撞的爬虫会对共享 TencentDB 造成 4 倍放大。
 *
 * ## 本文件测什么
 *
 * **数真实调用次数，不靠推理断言**。计量点是域层的 `scanListings`（OPT-068 起
 * 列表与 facet 都建立在它之上；原计量点 `getSearchFacets` 已不再打库）——它与
 * `adapter.scanEffectiveListings` 是一比一，因此它的调用次数就是「打了几次库」。
 *
 * OPT-068 之后区域 / 类型 / 价格是内存维度、不进扫描键，所以「只叠了区域」的
 * 页面三份 facet 也只剩一次扫描；只有面积 / 商圈 / 地铁 / 关键词这类进 where 的
 * 维度才会分出第二次。下面的期望值按这个口径重写。
 *
 * `next/cache` 的 `unstable_cache` 在本文件里被替换成直通实现（永不存储），
 * 这是**冷路径的严格下界**：任何被数到的调用在生产上都真的会打库。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const facetCalls: string[] = []
const buildingSearchCalls: string[] = []

vi.mock('next/cache', () => ({
  // 直通：模拟「缓存里什么都没有」的冷路径。unstable_cache 真实实现的未命中
  // 分支同样是无条件执行回调，因此这个替身在放大问题上与真实行为等价。
  unstable_cache:
    (load: (...args: unknown[]) => unknown) =>
      async (...args: unknown[]) => load(...args),
}))

vi.mock('@/domain/public-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/public-catalog')>()
  return {
    ...actual,
    scanListings: vi.fn(async (input: unknown, ctx: { city: string; businessType?: string }) => {
      facetCalls.push(`${ctx.city}|${ctx.businessType ?? 'all'}|${actual.buildCanonicalSearchParams(input as never).toString()}`)
      return []
    }),
    searchBuildingsFiltered: vi.fn(async (input: unknown, ctx: { city: string }) => {
      buildingSearchCalls.push(`${ctx.city}|${actual.buildBuildingCanonicalParams(input as never).toString()}`)
      return {
        docs: [],
        groups: { withStock: [], withoutStock: [] },
        totalDocs: 0,
        withStockTotal: 0,
        withoutStockTotal: 0,
        unfilteredTotalDocs: 0,
        page: 1,
        totalPages: 1,
        facets: { districts: [], grades: [], metros: [] },
        dimensionHits: {
          district: 0, grade: 0, metro: 0, leasableArea: 0, completedAfter: 0, onlyWithStock: 0,
        },
      }
    }),
  }
})

import CityListingsView from '@/components/frontend/city/CityListingsView'
import { parseBuildingSearchInput, parseListingSearchInput } from '@/domain/public-catalog'
import {
  getCachedSearchBuildingsFiltered,
  getCachedSearchFacetsIgnoring,
} from '@/lib/frontend/cached-queries'

const CITY = {
  id: 1,
  slug: 'shanghai',
  name: '上海',
  serviceStatus: 'live' as const,
} as unknown as Parameters<typeof CityListingsView>[0]['city']

function buildResult(totalDocs: number) {
  return {
    docs: [],
    pagination: {
      page: 1,
      pageSize: 24 as const,
      totalDocs,
      totalPages: Math.max(1, Math.ceil(totalDocs / 24)),
      hasNextPage: false,
      hasPrevPage: false,
    },
    canonical: '',
    filteredByRentUnit: false,
  } as unknown as Parameters<typeof CityListingsView>[0]['result']
}

/** 真的把整页编排层跑一遍（含空态分支的退路 fan-out），返回打库次数。 */
async function renderPage(query: string, totalDocs: number): Promise<number> {
  facetCalls.length = 0
  await CityListingsView({
    city: CITY,
    result: buildResult(totalDocs),
    districts: [] as Parameters<typeof CityListingsView>[0]['districts'],
    input: parseListingSearchInput(new URLSearchParams(query)),
    basePath: '/shanghai/listings',
    routeMode: 'prefixed',
  })
  return facetCalls.length
}

beforeEach(() => {
  facetCalls.length = 0
  buildingSearchCalls.length = 0
})

describe('facet 冷路径查询放大（终审 I2）', () => {
  it('三次同 key 并发剥离查询只打一次库', async () => {
    const input = parseListingSearchInput(new URLSearchParams(''))
    await Promise.all([
      getCachedSearchFacetsIgnoring('shanghai', input, ['priceUnit']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['district']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['listingType']),
    ])
    expect(facetCalls).toHaveLength(1)
  })

  it('只叠了内存维度（区域）：三份剥离 facet 仍共用同一次扫描', async () => {
    // OPT-068：district 不进扫描键，剥不剥都落到同一份扫描输入 {}。
    const input = parseListingSearchInput(new URLSearchParams('?district=jingan'))
    await Promise.all([
      getCachedSearchFacetsIgnoring('shanghai', input, ['priceUnit']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['district']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['listingType']),
    ])
    expect(facetCalls).toHaveLength(1)
  })

  it('key 不同的照旧各查各的（不能为了去重把不同条件合并掉）', async () => {
    // 叠了 where 维度（面积）：剥 priceUnit / 剥 listingType 都还剩 {areaMin}（同 key），
    // 剥 area 剩 {}（另一个 key）→ 两条真实不同的扫描，必须都发出去。
    const input = parseListingSearchInput(new URLSearchParams('?areaMin=100'))
    await Promise.all([
      getCachedSearchFacetsIgnoring('shanghai', input, ['priceUnit']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['area']),
      getCachedSearchFacetsIgnoring('shanghai', input, ['listingType']),
    ])
    expect(facetCalls).toHaveLength(2)
    expect(new Set(facetCalls).size).toBe(2)
  })

  it('城市与频道进合并键：不同城市/频道不得互相顶替结果', async () => {
    const input = parseListingSearchInput(new URLSearchParams(''))
    await Promise.all([
      getCachedSearchFacetsIgnoring('shanghai', input, ['district'], 'lease'),
      getCachedSearchFacetsIgnoring('shanghai', input, ['district'], 'sale'),
      getCachedSearchFacetsIgnoring('hangzhou', input, ['district'], 'lease'),
    ])
    expect(facetCalls).toHaveLength(3)
  })

  it('合并只在「同时在飞」期间有效，不是一层进程内永久缓存', async () => {
    // 结算后必须摘掉：留着就等于在 unstable_cache 之外再造一层不受 revalidate /
    // tag 管辖、永不失效的缓存，改后台数据前台永远刷不出来。
    const input = parseListingSearchInput(new URLSearchParams(''))
    await getCachedSearchFacetsIgnoring('shanghai', input, ['district'])
    await getCachedSearchFacetsIgnoring('shanghai', input, ['district'])
    expect(facetCalls).toHaveLength(2)
  })
})

describe('列表页整页冷成本（终审 I2：数出来的，不是推出来的）', () => {
  it('无筛选页：三份 facet 合并成一次库查询', async () => {
    expect(await renderPage('', 24)).toBe(1)
  })

  it('爬虫式 ?q=<自由文本>：同样只放大到一次', async () => {
    expect(await renderPage('?q=随便什么词', 24)).toBe(1)
  })

  it('空态②（最坏路径）：退路 fan-out 与「清除全部」也走同一条合并', async () => {
    // 只有 q 一个条件且零结果：三份基础 facet 剥完都是 {q}（1 次），
    // 退路「取消关键词」与「清除全部」剥完都是 {}（1 次）。
    expect(await renderPage('?q=随便什么词', 0)).toBe(2)
  })

  it('空态①：剥掉全部条件 + 计价单位后仍是同一次扫描（类型是内存维度）', async () => {
    // 只挑了类目（类型），没有收窄条件 → 空态①。OPT-068 前这里是 2：三份基础
    // facet 的 {type} 一次、剥光后的 {} 一次；现在 type 不进扫描键，两者同键。
    expect(await renderPage('?type=coworking', 0)).toBe(1)
  })

  it('空态①叠 where 维度：基础三份与剥光后的总数各一次扫描', async () => {
    expect(await renderPage('?type=coworking&areaMin=100', 0)).toBe(2)
  })
})

describe('楼盘页：核对是否有同款放大', () => {
  it('整页只发一次筛选查询（没有 fan-out，本来就不放大）', async () => {
    const input = parseBuildingSearchInput(new URLSearchParams('?district=jingan'))
    await getCachedSearchBuildingsFiltered('shanghai', input)
    expect(buildingSearchCalls).toHaveLength(1)
  })

  it('并发同 key 也只打一次库（同一条合并，防并发穿透）', async () => {
    const input = parseBuildingSearchInput(new URLSearchParams('?district=jingan'))
    await Promise.all([
      getCachedSearchBuildingsFiltered('shanghai', input),
      getCachedSearchBuildingsFiltered('shanghai', input),
      getCachedSearchBuildingsFiltered('shanghai', input),
    ])
    expect(buildingSearchCalls).toHaveLength(1)
  })
})
