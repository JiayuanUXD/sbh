/**
 * OPT-036 Task 12：楼盘列表编排层的接线守卫。
 *
 * 守卫落在**失效点那一层**（Task 11 的 I3 教训）：域层已经有
 * `opt036-building-search-result.test.ts` 锁住筛选/排序/分组/分页函数本身，但那些
 * 断言无法阻止有人把路由改回未筛选查询再在视图里 `.filter()`——那样域层测试
 * 照样全绿、typecheck 照样过、页面照样不报错，只是「分页作用于合并序列」
 * 「筛选下沉查询层」两条设计意图静默消失。因此本文件断言的是
 * **路由与编排层的调用行为与结构**：
 *
 *   1. 两个路由都把 URL 解析成 `BuildingSearchInput` 并调筛选版查询
 *      `getCachedSearchBuildingsFiltered`（未筛选版 `getCachedSearchBuildings`
 *      已在 OPT-036 Task 13 从 cached-queries.ts 删除——这一条现在由
 *      「导入不存在的符号会编译失败」保证，比运行时 mock 断言更强，
 *      故不再需要 `expect(...).not.toHaveBeenCalled()` 这道守卫）；
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
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const getCachedSearchBuildingsFiltered = vi.fn()
const resolveCityContext = vi.fn()

vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedSearchBuildingsFiltered: (...args: unknown[]) => getCachedSearchBuildingsFiltered(...args),
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
import EmptyNoStock from '@/components/frontend/listing/EmptyNoStock'
import { countActivePicks, type FilterRow, type FilterSwitch } from '@/components/frontend/listing/FilterFormC'
import MobileFilterShell from '@/components/frontend/listing/MobileFilterShell'
import ResultToolbar from '@/components/frontend/listing/ResultToolbar'
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
  facets: { districts: { slug: string; name: string; count: number }[]; grades: { value: string; count: number }[]; metros: { slug: string; name: string; count: number }[] }
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
    // 默认给一份非空 facets：真实域层的候选**清单**取自全集，选中的区永远在里面
    // （见 facade 的 overlay 注释）。空 facets 是域层给不出的状态，拿它当夹具会
    // 让「行能显示这个条件」的分支测不到。
    facets: over.facets ?? {
      districts: [{ slug: 'jingan', name: '静安区', count: 2 }],
      grades: [{ value: 'grade-a', count: 3 }],
      metros: [],
    },
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

/**
 * 把编排层实际传给 `MobileFilterShell` 的 props 真的渲染一遍，读出悬浮 pill 的徽标数。
 * `activeCount` 是 shell 内部算的（曾与抽屉头部「已选 N 项」分叉，OPT-036 终审 I1），
 * 只断言 props 拿不到它。徽标为 0 时整个不渲染，因此匹配不到即 0。
 */
function shellBadge(shell: Visited): number {
  const html = renderToStaticMarkup(
    createElement(MobileFilterShell, shell.node.props as Parameters<typeof MobileFilterShell>[0]),
  )
  const matched = /class="ls-mtrigger__badge">(\d+)</.exec(html)
  return matched ? Number(matched[1]) : 0
}

function shellRows(shell: Visited): Readonly<{ rows: readonly FilterRow[]; switchRow?: FilterSwitch }> {
  return shell.node.props as Readonly<{ rows: readonly FilterRow[]; switchRow?: FilterSwitch }>
}

/** 用编排层实际传下去的 props 把 EmptyNoStock 跑一遍，数主按钮个数。 */
function countPrimaryButtons(empty: Visited): number {
  const rendered = EmptyNoStock(empty.node.props as Parameters<typeof EmptyNoStock>[0]) as ReactElement
  return collect(rendered).filter((v) => {
    const cls = (v.node.props as { className?: string } | undefined)?.className
    return typeof cls === 'string' && cls.includes('ls-empty__btn--primary')
  }).length
}

beforeEach(() => {
  getCachedSearchBuildingsFiltered.mockReset()
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
    expect(getCachedSearchBuildingsFiltered).toHaveBeenCalledTimes(1)
    const [citySlug, input] = getCachedSearchBuildingsFiltered.mock.calls[0]
    expect(citySlug).toBe('shanghai')
    // 解析后的结构化输入，而不是原始 searchParams 对象（视图不再自己过滤）
    expect(input).toMatchObject({ grade: ['grade-a'], page: 2, sort: 'grade', onlyWithStock: true, pageSize: 24 })
  })

  it('legacy /buildings 同一条链路（无城市前缀时不得退回旧的未筛选查询）', async () => {
    await LegacyBuildingsPage({ searchParams: Promise.resolve({ district: 'jingan' }) })
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

  it('三个「清除全部 / 重置」出口共用同一个 href，且真的清得掉 leasableAreaMax', () => {
    // 「在租面积」一个维度占两个 URL 键，而筛选行只建模下限——抽屉原先按 rows.key
    // 自己推导，于是桌面清得掉 leasableAreaMax、抽屉清不掉（Task 12 审查 I1）。
    const tree = renderView('?leasableAreaMin=500&leasableAreaMax=2000&onlyWithStock=1', buildResult({ totalDocs: 0 }))
    const fromFilterBar = (findByDisplayName(tree, 'FilterFormC')!.node.props as { clearAllHref: string }).clearAllHref
    const fromEmptyState = (findByDisplayName(tree, 'EmptyFiltered')!.node.props as { clearAllHref: string }).clearAllHref
    const fromSheet = (findByDisplayName(tree, 'MobileFilterShell')!.node.props as { resetHref: string }).resetHref
    expect(fromEmptyState).toBe(fromFilterBar)
    expect(fromSheet).toBe(fromFilterBar)
    expect(fromFilterBar).toBe('/shanghai/buildings')
  })

  it('没有筛选行能显示的条件（只写了 leasableAreaMax）仍然渲染成可清除 chip', () => {
    // 这类条件会让底栏出现「清除全部」，用户却看不到清的是什么。
    const tree = renderView('?leasableAreaMax=2000', buildResult({ withStock: [doc('a', 2)] }))
    const picks = (findByDisplayName(tree, 'FilterFormC')!.node.props as {
      extraPicks?: readonly { key: string; label: string; href: string }[]
    }).extraPicks
    expect(picks).toEqual([
      { key: 'leasableAreaMax', label: '在租面积：2,000 ㎡以下', href: '/shanghai/buildings' },
    ])

    // 一半可见一半不可见时，补出来的 chip 只说也只清不可见的那一半——
    // 不能拿整个维度的文案去补，否则会并排出现一个 chip 和它的超集 chip。
    const halfHidden = (findByDisplayName(
      renderView('?leasableAreaMin=500&leasableAreaMax=2000', buildResult({ withStock: [doc('a', 2)] })),
      'FilterFormC',
    )!.node.props as { extraPicks?: readonly { label: string; href: string }[] }).extraPicks
    expect(halfHidden).toEqual([
      { key: 'leasableAreaMax', label: '在租面积：2,000 ㎡以下', href: '/shanghai/buildings?leasableAreaMin=500' },
    ])
    // 有行能显示的条件不重复出 chip（那一行自己已经有 chip 了）
    const covered = (findByDisplayName(renderView('?district=jingan', buildResult()), 'FilterFormC')!.node.props as {
      extraPicks?: readonly unknown[]
    }).extraPicks
    expect(covered).toEqual([])

    // 反过来：候选清单里没有这个区（陈旧链接 / 别的城市的 slug）时行显示不出来，
    // 补充 chip 必须顶上——否则又是一个看不见的生效条件。
    const stale = (findByDisplayName(
      renderView('?district=not-in-this-city', buildResult()),
      'FilterFormC',
    )!.node.props as { extraPicks?: readonly { key: string }[] }).extraPicks
    expect(stale?.map((p) => p.key)).toEqual(['district'])
  })

  it('落在预设档位之外的数值条件同样可见（否则三处一起把它藏起来）', () => {
    // `leasableAreaMin=750` 是解析层收下、真的收窄结果集、却不等于任何一个预设档位
    // 的值（档位是 500/1000/2000/5000）。FilterFormC 只在 activeValue 命中某个 option
    // 时才出 chip，所以行 chip 不会有；补 chip 的覆盖判据若只看 `activeValue != null`，
    // 就会认为「这一行已经显示了」而跳过——于是筛选条、chip、底栏三处一起把一个
    // 正在生效的条件藏起来，底栏还写着「未选的行保持『全部』」。
    const props = (findByDisplayName(
      renderView('?leasableAreaMin=750', buildResult({ withStock: [doc('a', 2)] })),
      'FilterFormC',
    )!.node.props as {
      rows: readonly { key: string; activeValue?: string; options: readonly { value: string }[] }[]
      extraPicks?: readonly { key: string; label: string; href: string }[]
    })
    // 前提：这一行确实没有能显示它的选项（否则这条测试就没在测该测的东西）
    const areaRow = props.rows.find((r) => r.key === 'leasableAreaMin')!
    expect(areaRow.activeValue).toBe('750')
    expect(areaRow.options.some((o) => o.value === '750')).toBe(false)
    expect(props.extraPicks).toEqual([
      { key: 'leasableAreaMin', label: '在租面积：750 ㎡以上', href: '/shanghai/buildings' },
    ])
  })

  it('落在预设之外的竣工年代（单键维度）走整维度回退分支，同样可见', () => {
    const picks = (findByDisplayName(
      renderView('?completedAfter=2013', buildResult({ withStock: [doc('a', 2)] })),
      'FilterFormC',
    )!.node.props as { extraPicks?: readonly { key: string; label: string; href: string }[] }).extraPicks
    expect(picks).toEqual([
      { key: 'completedAfter', label: '竣工年代：2013 年后', href: '/shanghai/buildings' },
    ])
  })

  it('分组标题成对出现：只有一组时不渲染，跨组边界的一页两个都在', () => {
    const titlesOf = (tree: ReactElement) =>
      collect(tree)
        .filter((v) => (v.node.props as { className?: string } | undefined)?.className === 'bd-group__title')
        .map((v) => (v.node.props as { children?: unknown }).children)

    // 只有有在租：不渲染「当前有在租」标题（只有一组时它是废话）
    expect(titlesOf(renderView('', buildResult({ withStock: [doc('a', 2)] })))).toEqual([])
    // 只有暂无在租（如翻到最后一页）：只有「暂无在租」那个标题
    expect(titlesOf(renderView('', buildResult({ withoutStock: [doc('v')] })))).toEqual(['暂无在租'])
    // 跨组边界的一页：两个标题都在，顺序是先有在租
    expect(
      titlesOf(renderView('', buildResult({ withStock: [doc('a', 2)], withoutStock: [doc('v')] }))),
    ).toEqual(['当前有在租', '暂无在租'])
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

  it('空态①在域层真能产生的状态下不摆死按钮，只留「提交需求」这一个真出口', () => {
    // 夹具必须是**域层产生得出来**的状态：空态①的触发条件是「零筛选却零结果」，
    // 那时 unfilteredTotalDocs === totalDocs === 0 是结构性恒等。
    // 原先这条用 totalDocs:0 + unfilteredTotalDocs:99 的组合，域层永远给不出，
    // 于是「prop 传了」通过、而「传下去的值可用」从来没被验证（Task 11 I3 同型）。
    const tree = renderView('', buildResult({ totalDocs: 0, unfilteredTotalDocs: 0 }))
    const empty = findByDisplayName(tree, 'EmptyNoStock')!
    const props = empty.node.props as {
      unfilteredTotalCount?: number
      secondaryAction?: unknown
      totalNoun: string
      countNoun: string
    }
    expect(props.unfilteredTotalCount).toBe(0)
    expect(props.secondaryAction).toBeTruthy()
    expect(props.totalNoun).toBe('个楼盘')
    // 正文量词也必须是楼盘语境（原先硬编码「还没有一套上架」）
    expect(props.countNoun).toBe('个楼盘')
    // 计数为 0 → 主按钮整个不渲染（渲染出来就是指回本页的死控件）。
    // 必须真的把组件跑一遍：编排层的树里 <EmptyNoStock> 还没展开，
    // 只断言 props 就又回到「传了 ≠ 可用」那个坑里。
    expect(countPrimaryButtons(empty)).toBe(0)
  })

  it('空态①在总数 >0 的频道语境下仍然给主按钮（不要一刀切砍掉）', () => {
    // 楼盘页到不了这个状态，但组件是两页共用的：房源页的空态①可以由「类目型」
    // 条件造成（只挑了共享工位 → 0 套，而全城 1,893 套仍在）。这条锁住那条分支
    // 没有被「楼盘页反正恒为 0」的修法误伤。
    const tree = renderView('', buildResult({ totalDocs: 0, unfilteredTotalDocs: 1893 }))
    const empty = findByDisplayName(tree, 'EmptyNoStock')!
    expect((empty.node.props as { unfilteredTotalCount?: number }).unfilteredTotalCount).toBe(1893)
    expect(countPrimaryButtons(empty)).toBe(1)
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

  it('默认排序是「在租最多」且不写进 URL（终审 M3：口径不能照抄房源页）', () => {
    const toolbar = findByDisplayName(renderView('', buildResult({ withStock: [doc('a', 2)] })), 'ResultToolbar')!
    const props = toolbar.node.props as Parameters<typeof ResultToolbar>[0]
    // 本页默认不是 recommended：组件曾硬编码它，于是点已选中的「在租最多」
    // 会拼出非 canonical 的 ?sort=stock-desc（渲染一样，但地址不是 canonical）。
    expect(props.defaultSort).toBe('stock-desc')
    const html = renderToStaticMarkup(createElement(ResultToolbar, props))
    expect(html).toContain('href="/shanghai/buildings"')
    expect(html).not.toContain('sort=stock-desc')
    // 其余三项照旧写进 URL
    expect(html).toContain('sort=area-desc')
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

  // ── 终审 I1：悬浮 pill 徽标与抽屉「已选 N 项」必须同口径 ────────────────────
  // shell 曾用 `rows.reduce(row.activeValue != null)` 自己数一遍，比抽屉的
  // `visibleRows` + `findActiveOption` 宽松。本页的可达触发形状是「偏离预设档位的
  // 数值维度」：`?leasableAreaMin=750` 在 375 下会让底栏徽标写 1、抽屉头部空着。
  // （「零候选行」那一种形状本页构造不出来——楼盘五行里，面积/竣工是静态档位，
  //  区域/等级/地铁的选中项由 keepOption 保留——已在房源页守卫覆盖。）

  it('落在预设档位之外的数值条件不进徽标（?leasableAreaMin=750）', () => {
    const shell = findByDisplayName(
      renderView('?leasableAreaMin=750', buildResult({ withStock: [doc('a', 2)] })),
      'MobileFilterShell',
    )!
    const areaRow = shellRows(shell).rows.find((row) => row.key === 'leasableAreaMin')!
    expect(areaRow.activeValue).toBe('750')
    expect(areaRow.options.some((option) => option.value === '750')).toBe(false)
    expect(shellBadge(shell)).toBe(0)
  })

  it('开关与能显示的行照常计数（开关 1 项 + 偏离档位的面积仍是 0 项）', () => {
    const onlySwitch = findByDisplayName(
      renderView('?onlyWithStock=1&leasableAreaMin=750', buildResult({ withStock: [doc('a', 2)] })),
      'MobileFilterShell',
    )!
    expect(shellBadge(onlySwitch)).toBe(1)

    const rowAndSwitch = findByDisplayName(
      renderView('?onlyWithStock=1&district=jingan', buildResult({ withStock: [doc('a', 2)] })),
      'MobileFilterShell',
    )!
    expect(shellBadge(rowAndSwitch)).toBe(2)
  })

  it('徽标数恒等于抽屉头部所用的同一个口径函数（分叉即变红）', () => {
    for (const query of ['', '?leasableAreaMin=750', '?district=jingan', '?onlyWithStock=1&grade=grade-a']) {
      const shell = findByDisplayName(
        renderView(query, buildResult({ withStock: [doc('a', 2)] })),
        'MobileFilterShell',
      )!
      const { rows, switchRow } = shellRows(shell)
      expect(shellBadge(shell), query).toBe(countActivePicks(rows, switchRow))
    }
  })

  it('移动筛选状态容器挂在结果区之外且不带 key（「点选项抽屉仍开」的结构前提）', () => {
    const shell = findByDisplayName(renderView('', buildResult({ withStock: [doc('a', 1)] })), 'MobileFilterShell')
    expect(shell).toBeDefined()
    expect(shell!.node.key).toBeNull()
    expect(shell!.ancestorClassNames.join(' ')).not.toContain('ls-results')
  })
})
