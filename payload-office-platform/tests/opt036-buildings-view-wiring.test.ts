/**
 * OPT-036 Task 12：楼盘列表编排层的接线守卫。
 *
 * 守卫落在**失效点那一层**（Task 11 的 I3 教训）：域层已经有
 * `opt036-building-search-result.test.ts` 锁住筛选/排序/分组/分页函数本身，但那些
 * 断言无法阻止有人把路由改回 `getCachedSearchBuildings()` 再在视图里 `.filter()`
 * ——那样域层测试照样全绿、typecheck 照样过、页面照样不报错，只是「分页作用于
 * 合并序列」「筛选下沉查询层」两条设计意图静默消失。因此本文件断言的是
 * **路由与编排层的调用行为与结构**：
 *
 *   1. 两个路由都把 URL 解析成 `BuildingSearchInput` 并调筛选版查询，
 *      **从不**调用未筛选的 `getCachedSearchBuildings`；
 *   2. 视图渲染的分组来自 `result.groups`（域层），不是自己对 `docs` 再分一次组；
 *   3. 视图不做分页：`docs`/`groups` 原样渲染，不切片；
 *   4. 筛选条底栏与空态②的「清除全部」是同一个 href；
 *   5. 移动筛选状态容器挂在结果区之外、不带 key；
 *   6. 各组件的计数名词是楼盘语境（不是房源的「套」）；
 *   7. 「仅看有在租」开关的 href 只切 onlyWithStock 并删 page，且把 paramKey 交给
 *      抽屉的「重置」（漏掉它 = 点了重置仍然只看有在租）。
 *
 * 不做渲染：直接调用组件拿 React 元素树即可，要断言的东西都在树上。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactElement } from 'react'

const getCachedSearchBuildingsFiltered = vi.fn()
const getCachedSearchBuildings = vi.fn()
const resolveCityContext = vi.fn()

vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedSearchBuildingsFiltered: (...args: unknown[]) => getCachedSearchBuildingsFiltered(...args),
  getCachedSearchBuildings: (...args: unknown[]) => getCachedSearchBuildings(...args),
}))
vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: (...args: unknown[]) => resolveCityContext(...args),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found')
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))

import CityBuildingsView from '@/components/frontend/city/CityBuildingsView'
import CityBuildingsPage from '@/app/(frontend)/[city]/buildings/page'
import LegacyBuildingsPage from '@/app/(frontend)/buildings/page'
import { parseBuildingSearchInput } from '@/domain/public-catalog'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'

const CITY = {
  id: 1,
  slug: 'shanghai',
  name: '上海',
  serviceStatus: 'live' as const,
} as unknown as Parameters<typeof CityBuildingsView>[0]['city']

const doc = (slug: string, listingCount?: number): BuildingSummaryViewModel =>
  ({
    id: 1,
    slug,
    name: slug,
    address: 'addr',
    citySlug: 'shanghai',
    cityName: '上海',
    ...(listingCount != null ? { listingCount } : {}),
  }) as BuildingSummaryViewModel

function buildResult(over: Partial<{
  docs: readonly BuildingSummaryViewModel[]
  withStock: readonly BuildingSummaryViewModel[]
  withoutStock: readonly BuildingSummaryViewModel[]
  totalDocs: number
  withStockTotal: number
  withoutStockTotal: number
  unfilteredTotalDocs: number
  page: number
  totalPages: number
}> = {}) {
  const withStock = over.withStock ?? []
  const withoutStock = over.withoutStock ?? []
  const totalDocs = over.totalDocs ?? withStock.length + withoutStock.length
  return {
    docs: over.docs ?? [...withStock, ...withoutStock],
    groups: { withStock, withoutStock },
    totalDocs,
    withStockTotal: over.withStockTotal ?? withStock.length,
    withoutStockTotal: over.withoutStockTotal ?? withoutStock.length,
    unfilteredTotalDocs: over.unfilteredTotalDocs ?? 99,
    page: over.page ?? 1,
    totalPages: over.totalPages ?? 1,
    facets: { districts: [], grades: [], metros: [] },
    dimensionHits: {
      district: 7,
      grade: 7,
      metro: 7,
      leasableArea: 7,
      completedAfter: 7,
      onlyWithStock: 7,
    },
  } as unknown as Parameters<typeof CityBuildingsView>[0]['result']
}

function renderView(
  query: string,
  result: Parameters<typeof CityBuildingsView>[0]['result'],
): ReactElement {
  return CityBuildingsView({
    city: CITY,
    result,
    input: parseBuildingSearchInput(new URLSearchParams(query)),
    basePath: '/shanghai/buildings',
    routeMode: 'prefixed',
  }) as ReactElement
}

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

function findAllByDisplayName(tree: ReactElement, name: string): Visited[] {
  return collect(tree).filter((v) => {
    const type = v.node.type as { name?: string; displayName?: string } | string
    return typeof type !== 'string' && (type.displayName === name || type.name === name)
  })
}

function findByDisplayName(tree: ReactElement, name: string): Visited | undefined {
  return findAllByDisplayName(tree, name)[0]
}

beforeEach(() => {
  getCachedSearchBuildingsFiltered.mockReset()
  getCachedSearchBuildings.mockReset()
  resolveCityContext.mockReset()
  getCachedSearchBuildingsFiltered.mockResolvedValue(buildResult())
  resolveCityContext.mockResolvedValue(CITY)
  process.env.MULTI_CITY_ROUTING_ENABLED = 'false'
})

describe('楼盘列表路由：解析成 BuildingSearchInput 并走筛选版查询', () => {
  it('前缀路由把 URL 解析成 input 交给 getCachedSearchBuildingsFiltered，不碰未筛选查询', async () => {
    await CityBuildingsPage({
      params: Promise.resolve({ city: 'shanghai' }),
      searchParams: Promise.resolve({ grade: 'grade-a', page: '2', sort: 'grade', onlyWithStock: '1' }),
    })
    expect(getCachedSearchBuildings).not.toHaveBeenCalled()
    expect(getCachedSearchBuildingsFiltered).toHaveBeenCalledTimes(1)
    const [citySlug, input] = getCachedSearchBuildingsFiltered.mock.calls[0]
    expect(citySlug).toBe('shanghai')
    // 解析后的结构化输入，而不是原始 searchParams 对象（视图不再自己过滤）
    expect(input).toMatchObject({ grade: ['grade-a'], page: 2, sort: 'grade', onlyWithStock: true, pageSize: 24 })
  })

  it('legacy /buildings 同一条链路（无城市前缀时不得退回旧的未筛选查询）', async () => {
    await LegacyBuildingsPage({ searchParams: Promise.resolve({ district: 'jingan' }) })
    expect(getCachedSearchBuildings).not.toHaveBeenCalled()
    expect(getCachedSearchBuildingsFiltered).toHaveBeenCalledTimes(1)
    expect(getCachedSearchBuildingsFiltered.mock.calls[0][1]).toMatchObject({ district: ['jingan'] })
  })

  it('未开城不查库', async () => {
    resolveCityContext.mockResolvedValue({ ...CITY, serviceStatus: 'coming-soon' })
    await CityBuildingsPage({
      params: Promise.resolve({ city: 'hangzhou' }),
      searchParams: Promise.resolve({}),
    })
    expect(getCachedSearchBuildingsFiltered).not.toHaveBeenCalled()
  })
})

describe('CityBuildingsView 编排层守卫', () => {
  it('分组来自域层的 result.groups，视图不自己按有无在租再分一次', () => {
    // 故意让 groups 与「按 listingCount 重新分组」的结果不一致：a 没有在租却被
    // 域层放进 withStock，b 有在租却在 withoutStock。视图若自作主张重新分组，
    // a 会跑到紧凑行、b 会跑到卡片网格，下面两条断言就会失败。
    const tree = renderView(
      '',
      buildResult({ withStock: [doc('a')], withoutStock: [doc('b', 9)] }),
    )
    const cards = findAllByDisplayName(tree, 'BuildingResultCard')
    const rows = findAllByDisplayName(tree, 'BuildingCompactRow')
    expect(cards.map((c) => (c.node.props as { building: { slug: string } }).building.slug)).toEqual(['a'])
    expect(rows.map((r) => (r.node.props as { building: { slug: string } }).building.slug)).toEqual(['b'])
  })

  it('视图不做分页：域层给几条就渲染几条（分页由查询层作用在合并序列上）', () => {
    const withStock = Array.from({ length: 20 }, (_, i) => doc(`s${i}`, 3))
    const withoutStock = Array.from({ length: 4 }, (_, i) => doc(`v${i}`))
    // 跨组边界的一页：24 条 = 20 有在租 + 4 暂无在租，总量 60 分 3 页
    const tree = renderView(
      '',
      buildResult({ withStock, withoutStock, totalDocs: 60, withStockTotal: 20, withoutStockTotal: 40, totalPages: 3 }),
    )
    expect(findAllByDisplayName(tree, 'BuildingResultCard')).toHaveLength(20)
    expect(findAllByDisplayName(tree, 'BuildingCompactRow')).toHaveLength(4)
    // 分组标题的计数是**全部页**的分组总量，不是这一页的条数
    const pager = findByDisplayName(tree, 'ListPager')
    expect((pager!.node.props as { totalPages: number }).totalPages).toBe(3)
  })

  it('筛选条底栏与空态②的「清除全部」是同一个 href（同名必须同义）', () => {
    const tree = renderView(
      '?district=jingan&grade=grade-a&completedAfter=2010&onlyWithStock=1',
      buildResult({ totalDocs: 0 }),
    )
    const filterForm = findByDisplayName(tree, 'FilterFormC')
    const emptyFiltered = findByDisplayName(tree, 'EmptyFiltered')
    expect(filterForm).toBeDefined()
    expect(emptyFiltered).toBeDefined()
    const fromFilterBar = (filterForm!.node.props as { clearAllHref: string }).clearAllHref
    const fromEmptyState = (emptyFiltered!.node.props as { clearAllHref: string }).clearAllHref
    expect(fromFilterBar).toBe(fromEmptyState)
    expect(fromFilterBar).toBe('/shanghai/buildings')
  })

  it('空态②逐条退路的命中数来自域层 dimensionHits，且只删自己那一个维度的键', () => {
    const tree = renderView('?district=jingan&grade=grade-a', buildResult({ totalDocs: 0 }))
    const empty = findByDisplayName(tree, 'EmptyFiltered')!
    const props = empty.node.props as {
      relaxations: readonly { label: string; hitCount: number; href: string }[]
      clearAllCount?: number
    }
    expect(props.relaxations.map((r) => r.hitCount)).toEqual([7, 7])
    expect(props.relaxations.map((r) => r.href)).toEqual([
      '/shanghai/buildings?grade=grade-a',
      '/shanghai/buildings?district=jingan',
    ])
    // 省略 clearAllCount 会静默退回不带数字的弱版本
    expect(props.clearAllCount).toBe(99)
  })

  it('空态①带上不叠加筛选时的总数与「提交需求」次要出口（省略会静默降级）', () => {
    const tree = renderView('', buildResult({ totalDocs: 0 }))
    const empty = findByDisplayName(tree, 'EmptyNoStock')!
    const props = empty.node.props as {
      unfilteredTotalCount?: number
      secondaryAction?: unknown
      totalNoun: string
    }
    expect(props.unfilteredTotalCount).toBe(99)
    expect(props.secondaryAction).toBeTruthy()
    expect(props.totalNoun).toBe('个楼盘')
  })

  it('计数名词是楼盘语境，不是房源的「套」', () => {
    const tree = renderView('', buildResult({ withStock: [doc('a', 2)] }))
    const nouns = [
      (findByDisplayName(tree, 'FilterFormC')!.node.props as { countNoun: string }).countNoun,
      (findByDisplayName(tree, 'MobileFilterShell')!.node.props as { countNoun: string }).countNoun,
      (findByDisplayName(tree, 'ResultToolbar')!.node.props as { totalNoun?: string }).totalNoun ?? '',
    ]
    expect(nouns).toEqual(['个楼盘', '个楼盘', '个楼盘'])
    for (const noun of nouns) expect(noun).not.toBe('套')
  })

  it('排序四项照 comp，且与解析层的 BuildingSort 白名单一致', () => {
    const tree = renderView('?sort=grade', buildResult({ withStock: [doc('a', 2)] }))
    const toolbar = findByDisplayName(tree, 'ResultToolbar')!
    const props = toolbar.node.props as { sorts: readonly { value: string }[]; activeSort: string }
    expect(props.sorts.map((s) => s.value)).toEqual(['stock-desc', 'area-desc', 'grade', 'completion-desc'])
    expect(props.activeSort).toBe('grade')
  })

  it('「仅看有在租」开关：只切 onlyWithStock、删 page，并把 paramKey 交给抽屉重置', () => {
    const off = findByDisplayName(renderView('?district=jingan&page=3', buildResult()), 'FilterFormC')!
    const on = findByDisplayName(
      renderView('?district=jingan&onlyWithStock=1', buildResult()),
      'FilterFormC',
    )!
    const sw = (v: typeof off) => (v.node.props as { switchRow: { href: string; active: boolean; paramKey: string } }).switchRow
    expect(sw(off).href).toBe('/shanghai/buildings?district=jingan&onlyWithStock=1')
    expect(sw(off).active).toBe(false)
    expect(sw(on).href).toBe('/shanghai/buildings?district=jingan')
    expect(sw(on).active).toBe(true)
    expect(sw(on).paramKey).toBe('onlyWithStock')
    // 抽屉拿到的是同一个开关（否则移动端少一个真实维度）
    const shell = findByDisplayName(renderView('', buildResult()), 'MobileFilterShell')!
    expect((shell.node.props as { switchRow?: unknown }).switchRow).toBeTruthy()
  })

  it('移动筛选状态容器挂在结果区之外且不带 key（「点选项抽屉仍开」的结构前提）', () => {
    const shell = findByDisplayName(renderView('', buildResult({ withStock: [doc('a', 1)] })), 'MobileFilterShell')
    expect(shell).toBeDefined()
    expect(shell!.node.key).toBeNull()
    expect(shell!.ancestorClassNames.join(' ')).not.toContain('ls-results')
  })
})
