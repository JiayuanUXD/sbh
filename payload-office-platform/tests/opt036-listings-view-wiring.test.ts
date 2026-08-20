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

async function renderView(query: string, overrides: Partial<{ businessType: 'lease' | 'sale'; totalDocs: number }> = {}) {
  const input: ListingSearchInput = parseListingSearchInput(new URLSearchParams(query))
  return (await CityListingsView({
    city: CITY,
    result: buildResult(overrides.totalDocs ?? 0),
    districts: [],
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
})
