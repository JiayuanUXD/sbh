/**
 * OPT-036 Task 11：房源列表编排层的接线守卫。
 *
 * 为什么需要这一份（审查指出的守卫层级问题）：`public-catalog-facade.test.ts`
 * 里那 7 条测试锁的是 `omitListingSearchDimensions` / `getSearchFacetsIgnoring`
 * **函数本身**——它们保证「剥离维度这件事一旦发生，算出来的数是对的」。但
 * **没有任何断言保证 `CityListingsView` 真的去调那个剥离版本**。有人把它「简化」
 * 回 `getCachedSearchFacets`，那 7 条测试照样全绿、typecheck 照样过、页面照样
 * 不报错——只是各单位计数重新恒为 0，`ExcludedUnitsBar` 重新 `return null`，
 * 「另有 N 套按 X 报价，因单位不可换算未计入本结果集」那条诚实提示重新静默消失。
 * 这正是它被列为 ★★ 硬要求的原因，守卫必须落在失效点这一层。
 *
 * 本文件因此断言的是**调用行为与结构**，不是渲染结果：
 *   1. 编排层发出三次剥离查询，剥的维度分别是 priceUnit / district / listingType；
 *   2. 编排层**从不**退回未剥离的 `getCachedSearchFacets`；
 *   3. 无 priceUnit 时价格排序两项不进 `ResultToolbar.sorts`（要求 2）；
 *   4. 「清除全部」两个控件共用同一个 href（要求 I2 的回归锁）；
 *   5. 移动筛选抽屉的状态容器挂在结果区**之外**、且不带 key（要求 6 的结构前提）。
 *
 * 不做渲染：`CityListingsView` 是 async Server Component，`renderToStaticMarkup`
 * 渲染不了；直接 await 调用它拿到 React 元素树即可，本文件要断言的东西都在树上。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ReactElement } from 'react'

const getCachedSearchFacetsIgnoring = vi.fn()
const getCachedSearchFacets = vi.fn()

vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedSearchFacetsIgnoring: (...args: unknown[]) => getCachedSearchFacetsIgnoring(...args),
  getCachedSearchFacets: (...args: unknown[]) => getCachedSearchFacets(...args),
}))

import CityListingsView from '@/components/frontend/city/CityListingsView'
import EmptyNoStock from '@/components/frontend/listing/EmptyNoStock'
import { parseListingSearchInput } from '@/domain/public-catalog'
import type { ListingSearchInput } from '@/domain/public-catalog'

const CITY = {
  id: 1,
  slug: 'shanghai',
  name: '上海',
  serviceStatus: 'live' as const,
} as unknown as Parameters<typeof CityListingsView>[0]['city']

function emptyFacets(totalDocs = 0) {
  return { districts: [], listingTypes: [], rentUnits: [], totalDocs }
}

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

async function renderView(query: string, overrides: Partial<{
  businessType: 'lease' | 'sale'
  totalDocs: number
  districts: readonly { slug: string; name: string }[]
}> = {}) {
  const input: ListingSearchInput = parseListingSearchInput(new URLSearchParams(query))
  return (await CityListingsView({
    city: CITY,
    result: buildResult(overrides.totalDocs ?? 0),
    districts: (overrides.districts ?? []) as Parameters<typeof CityListingsView>[0]['districts'],
    input,
    basePath: '/shanghai/listings',
    routeMode: 'prefixed',
    ...(overrides.businessType ? { businessType: overrides.businessType } : {}),
  })) as ReactElement
}

/** 深度遍历元素树，收集节点及其祖先链上的 className，供结构断言使用。 */
type Visited = Readonly<{ node: ReactElement; ancestorClassNames: readonly string[] }>

function walk(node: unknown, ancestors: readonly string[], out: Visited[]): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, ancestors, out)
    return
  }
  if (node == null || typeof node !== 'object') return
  const element = node as ReactElement & { props?: Record<string, unknown> }
  if (!('type' in element)) return
  out.push({ node: element, ancestorClassNames: ancestors })
  const className = typeof element.props?.className === 'string' ? element.props.className : null
  const nextAncestors = className ? [...ancestors, className] : ancestors
  walk(element.props?.children, nextAncestors, out)
}

function collect(tree: ReactElement): Visited[] {
  const out: Visited[] = []
  walk(tree, [], out)
  return out
}

/** 用编排层实际传下去的 props 把 EmptyNoStock 跑一遍，数主按钮个数（只看 props 证明不了「值可用」）。 */
function countPrimaryButtons(empty: Visited): number {
  const rendered = EmptyNoStock(empty.node.props as Parameters<typeof EmptyNoStock>[0]) as ReactElement
  return collect(rendered).filter((v) => {
    const cls = (v.node.props as { className?: string } | undefined)?.className
    return typeof cls === 'string' && cls.includes('ls-empty__btn--primary')
  }).length
}

function findByDisplayName(tree: ReactElement, name: string): Visited | undefined {
  return collect(tree).find((v) => {
    const type = v.node.type as { name?: string; displayName?: string } | string
    return typeof type !== 'string' && (type.displayName === name || type.name === name)
  })
}

beforeEach(() => {
  getCachedSearchFacetsIgnoring.mockReset()
  getCachedSearchFacets.mockReset()
  getCachedSearchFacetsIgnoring.mockResolvedValue(emptyFacets(0))
  getCachedSearchFacets.mockResolvedValue(emptyFacets(0))
})

describe('CityListingsView 接线守卫（要求 2 / 3 / 6 + 清除全部同口径）', () => {
  it('三份 facet 全部走剥离版本，剥的维度分别是 priceUnit / district / listingType', async () => {
    await renderView('')
    const dimensionSets = getCachedSearchFacetsIgnoring.mock.calls.map((call) => call[2] as string[])
    expect(dimensionSets).toEqual(
      expect.arrayContaining([['priceUnit'], ['district'], ['listingType']]),
    )
  })

  it('绝不退回未剥离的 getCachedSearchFacets（退回即让单位提示条静默消失）', async () => {
    await renderView('?priceUnit=rmb-sqm-day&district=jingan', { totalDocs: 3 })
    expect(getCachedSearchFacets).not.toHaveBeenCalled()
    const dimensionSets = getCachedSearchFacetsIgnoring.mock.calls.map((call) => call[2] as string[])
    expect(dimensionSets).toContainEqual(['priceUnit'])
  })

  it('剥离查询把频道透传下去，出售频道不会拿到租赁口径的计数', async () => {
    await renderView('', { businessType: 'sale' })
    for (const call of getCachedSearchFacetsIgnoring.mock.calls) {
      expect(call[0]).toBe('shanghai')
      expect(call[3]).toBe('sale')
    }
  })

  it('无 priceUnit 时价格排序两项不进 sorts；有 priceUnit 时进', async () => {
    const without = findByDisplayName(await renderView('', { totalDocs: 3 }), 'ResultToolbar')
    const withUnit = findByDisplayName(
      await renderView('?priceUnit=rmb-sqm-day', { totalDocs: 3 }),
      'ResultToolbar',
    )
    const values = (v: Visited | undefined) =>
      ((v?.node.props as { sorts?: { value: string }[] } | undefined)?.sorts ?? []).map((s) => s.value)
    expect(values(without)).toEqual(['recommended', 'newest'])
    expect(values(withUnit)).toEqual(['recommended', 'newest', 'price-asc', 'price-desc'])
  })

  it('筛选条底栏与空态②的「清除全部」是同一个 href（同名必须同义）', async () => {
    // 叠加了收窄条件且零结果 → 两个控件同屏可见
    const tree = await renderView('?district=jingan&q=整层&areaMin=2000', { totalDocs: 0 })
    const filterForm = findByDisplayName(tree, 'FilterFormC')
    const emptyFiltered = findByDisplayName(tree, 'EmptyFiltered')
    expect(filterForm).toBeDefined()
    expect(emptyFiltered).toBeDefined()
    const fromFilterBar = (filterForm!.node.props as { clearAllHref: string }).clearAllHref
    const fromEmptyState = (emptyFiltered!.node.props as { clearAllHref: string }).clearAllHref
    expect(fromFilterBar).toBe(fromEmptyState)
    // 且真的清干净：4 行筛选之外的 q 也必须被删掉（这正是旧实现漏掉的那一类）
    expect(fromFilterBar).not.toContain('q=')
    expect(fromFilterBar).not.toContain('district=')
    expect(fromFilterBar).not.toContain('areaMin=')
  })

  it('移动筛选状态容器挂在结果区之外且不带 key（「点选项抽屉仍开」的结构前提）', async () => {
    const shell = findByDisplayName(await renderView('', { totalDocs: 3 }), 'MobileFilterShell')
    expect(shell).toBeDefined()
    // key 随 searchParams 变化会让 React 卸载重建，open 被重置为 false
    expect(shell!.node.key).toBeNull()
    // 结果区在空/非空之间整块替换；容器若挂在里面会跟着一起被换掉
    expect(shell!.ancestorClassNames.join(' ')).not.toContain('ls-results')
  })

  it('列表与出售路由上没有 loading.tsx（Suspense 重挂会重置抽屉 open 状态）', () => {
    const appDir = path.resolve(__dirname, '..', 'src', 'app', '(frontend)')
    const routes = ['[city]/listings', 'listings', '[city]/sale', 'sale', '[city]', '']
    for (const route of routes) {
      const file = path.join(appDir, route, 'loading.tsx')
      expect(existsSync(file), `${file} 存在会让抽屉每次导航都被重挂`).toBe(false)
    }
  })

  // ── Task 12 修复轮镜像过来的守卫（原先只落在楼盘页，房源页没有网）──────────
  // 房源页与楼盘页共用 FilterFormC / MobileFilterShell / EmptyFiltered 这套组件，
  // 同一类回归（三个「清除全部」漂移、生效条件看不见）在这一页同样会发生。

  it('三个「清除全部 / 重置」出口共用同一个 href（抽屉不得自己推导作用域）', async () => {
    // 本页的漂移空间更大：筛选条只有 4 行，而 URL 上真正生效的维度有 8 个。
    const tree = await renderView('?district=jingan&q=整层&areaMin=2000', { totalDocs: 0 })
    const fromFilterBar = (findByDisplayName(tree, 'FilterFormC')!.node.props as { clearAllHref: string }).clearAllHref
    const fromEmptyState = (findByDisplayName(tree, 'EmptyFiltered')!.node.props as { clearAllHref: string }).clearAllHref
    const fromSheet = (findByDisplayName(tree, 'MobileFilterShell')!.node.props as { resetHref: string }).resetHref
    expect(fromEmptyState).toBe(fromFilterBar)
    expect(fromSheet).toBe(fromFilterBar)
    expect(fromFilterBar).toBe('/shanghai/listings')
  })

  it('没有筛选行能显示的条件补成可清除 chip（关键词 / 面积上限）', async () => {
    const picks = async (query: string) =>
      ((findByDisplayName(await renderView(query, { totalDocs: 3 }), 'FilterFormC')!.node.props as {
        extraPicks?: readonly { key: string; label: string; href: string }[]
      }).extraPicks ?? [])

    // 关键词整个维度没有行，只能靠补充 chip 才看得见
    expect(await picks('?q=整层')).toEqual([
      { key: 'q', label: '关键词：整层', href: '/shanghai/listings' },
    ])
    // 面积维度占两个键、行只建模下限：补的 chip 只说也只清上限那一半
    expect(await picks('?areaMin=100&areaMax=500')).toEqual([
      { key: 'areaMax', label: '面积：500 ㎡以下', href: '/shanghai/listings?areaMin=100' },
    ])
  })

  it('落在预设档位之外的数值条件同样可见（面积下限 750 不等于任何一档）', async () => {
    const props = (findByDisplayName(await renderView('?areaMin=750', { totalDocs: 3 }), 'FilterFormC')!.node.props as {
      rows: readonly { key: string; activeValue?: string; options: readonly { value: string }[] }[]
      extraPicks?: readonly { key: string; label: string }[]
    })
    const areaRow = props.rows.find((r) => r.key === 'areaMin')!
    expect(areaRow.activeValue).toBe('750')
    expect(areaRow.options.some((o) => o.value === '750')).toBe(false)
    expect(props.extraPicks?.map((p) => p.key)).toEqual(['areaMin'])
  })

  it('行能显示的条件不重复补 chip', async () => {
    const picks = (findByDisplayName(
      await renderView('?district=jingan', { totalDocs: 3, districts: [{ slug: 'jingan', name: '静安' }] }),
      'FilterFormC',
    )!.node.props as { extraPicks?: readonly unknown[] }).extraPicks
    expect(picks).toEqual([])
  })

  it('计价单位不补 chip：它已被分段控件完整显示，补了等于凭空造「清除单位」入口', async () => {
    const picks = (findByDisplayName(
      await renderView('?priceUnit=rmb-sqm-day&priceMax=8', { totalDocs: 3 }),
      'FilterFormC',
    )!.node.props as { extraPicks?: readonly { key: string }[] }).extraPicks
    expect(picks?.map((p) => p.key) ?? []).not.toContain('priceUnit')
  })

  it('空态①：总数为 0 时不摆指回本页的死按钮，总数 >0 时仍给主按钮', async () => {
    // 本页的空态①可以由「类目型」条件造成（只挑了共享工位 → 0 套，全城仍有 1,893 套），
    // 与楼盘页「结构性恒为 0」不同——两条分支都要有网。
    getCachedSearchFacetsIgnoring.mockResolvedValue(emptyFacets(0))
    const zero = findByDisplayName(await renderView('?type=coworking', { totalDocs: 0 }), 'EmptyNoStock')!
    expect(countPrimaryButtons(zero)).toBe(0)

    getCachedSearchFacetsIgnoring.mockResolvedValue(emptyFacets(1893))
    const some = findByDisplayName(await renderView('?type=coworking', { totalDocs: 0 }), 'EmptyNoStock')!
    expect((some.node.props as { unfilteredTotalCount?: number }).unfilteredTotalCount).toBe(1893)
    expect(countPrimaryButtons(some)).toBe(1)
  })
})
