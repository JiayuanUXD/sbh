/**
 * OPT-036 Task 11：房源列表编排层的接线守卫。
 *
 * 为什么需要这一份（审查指出的守卫层级问题）：`public-catalog-facade.test.ts`
 * 里那 7 条测试锁的是 `omitListingSearchDimensions` / `getSearchFacetsIgnoring`
 * **函数本身**——它们保证「剥离维度这件事一旦发生，算出来的数是对的」。但
 * **没有任何断言保证 `CityListingsView` 真的去调那个剥离版本**。有人把它「简化」
 * 回 `getCachedSearchFacets`，那 7 条测试照样全绿、typecheck 照样过、页面照样
 * 不报错——只是各维度候选计数重新算在筛选前（选中商圈后其余区计数全部塌成 0，
 * coworking 频道也会拿到未锁定类型的候选），级联与空态②的逐条退路一起失真。
 * 这正是它被列为 ★★ 硬要求的原因，守卫必须落在失效点这一层。
 *
 * 本文件因此断言的是**调用行为与结构**，不是渲染结果（页头文案一条例外，见下）：
 *   1. 编排层发出的剥离查询覆盖 district+businessArea / businessArea /
 *      listingType（coworking 频道锁定类型时跳过这一条）/ buildingForm；
 *   2. 编排层**从不**退回未剥离的 `getCachedSearchFacets`；
 *   3. 无 priceUnit 时价格排序两项不进 `ResultToolbar.sorts`（要求 2）；
 *   4. 「清除全部」两个控件共用同一个 href（要求 I2 的回归锁）；
 *   5. 移动筛选抽屉的状态容器挂在结果区**之外**、且不带 key（要求 6 的结构前提）。
 *
 * 基本不做渲染：`CityListingsView` 是 async Server Component，多数用例直接 await
 * 调用它拿到 React 元素树、断言树上的 props 即可。唯一例外是共享办公频道的页头
 * 文案用例（见下方 `OPT-103 共享办公频道` 块），它用 `renderToStaticMarkup` 把
 * 整棵树渲成 HTML 读 `<h1>` 实际文本——props 断不出「标题到底印成了什么字」。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const getCachedSearchFacetsIgnoring = vi.fn()
const getCachedSearchFacets = vi.fn()

vi.mock('@/lib/frontend/cached-queries', () => ({
  getCachedSearchFacetsIgnoring: (...args: unknown[]) => getCachedSearchFacetsIgnoring(...args),
  getCachedSearchFacets: (...args: unknown[]) => getCachedSearchFacets(...args),
}))
// OPT-103：新增的「页头文案」用例把整棵树交给 renderToStaticMarkup（要读 <h1>
// 实际渲出的文本），会真的执行 ListingNavigationProvider 里的 useRouter()——
// 不在 app router 里跑会抛 invariant，因此需要这个最小 stub。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

import CityListingsView from '@/components/frontend/city/CityListingsView'
import EmptyNoStock from '@/components/frontend/listing/EmptyNoStock'
import { countActivePicks, type ExtraPick, type FilterRow } from '@/components/frontend/listing/FilterFormC'
import MobileFilterShell from '@/components/frontend/listing/MobileFilterShell'
import ResultToolbar from '@/components/frontend/listing/ResultToolbar'
import { parseListingSearchInput } from '@/domain/public-catalog'
import type { ListingSearchInput } from '@/domain/public-catalog'
import { lockCoworkingInput } from '@/lib/frontend/coworking-channel'

const CITY = {
  id: 1,
  slug: 'shanghai',
  name: '上海',
  serviceStatus: 'live' as const,
} as unknown as Parameters<typeof CityListingsView>[0]['city']

function emptyFacets(totalDocs = 0) {
  return { districts: [], listingTypes: [], buildingForms: [], rentUnits: [], totalDocs }
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
  channel: 'lease' | 'sale' | 'coworking'
  totalDocs: number
  districts: readonly { slug: string; name: string }[]
  /** 调用方已锁定/改写过的 input（例如 coworking 频道路由层做的 lockCoworkingInput）；
   * 缺省时按 query 原样解析，与未加锁的频道行为一致。 */
  input: ListingSearchInput
}> = {}) {
  const input: ListingSearchInput = overrides.input ?? parseListingSearchInput(new URLSearchParams(query))
  return (await CityListingsView({
    city: CITY,
    result: buildResult(overrides.totalDocs ?? 0),
    districts: (overrides.districts ?? []) as Parameters<typeof CityListingsView>[0]['districts'],
    input,
    basePath: '/shanghai/listings',
    routeMode: 'prefixed',
    ...(overrides.channel ? { channel: overrides.channel } : {}),
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

/**
 * 把编排层实际传给 `MobileFilterShell` 的 props 真的渲染一遍，读出悬浮 pill 上的徽标数。
 *
 * 不能只断言 props：`activeCount` 是 shell **内部**算出来的，正是它曾经与抽屉头部
 * 「已选 N 项」分叉的地方（OPT-036 终审 I1）。只有把组件跑起来读渲染结果，才拿得到
 * 那个数——这与「prop 传了 ≠ 传下去的值可用」是同一条教训（Task 11 I3 / Task 12 I2）。
 * 徽标为 0 时按约定整个不渲染（MobileFilterTrigger：不显示 0），因此匹配不到即 0。
 */
function shellBadge(shell: Visited): number {
  const html = renderToStaticMarkup(
    createElement(MobileFilterShell, shell.node.props as Parameters<typeof MobileFilterShell>[0]),
  )
  const matched = /class="ls-mtrigger__badge">(\d+)</.exec(html)
  return matched ? Number(matched[1]) : 0
}

/** shell 收到的 rows，用于与抽屉共用的口径函数对账。 */
function shellRows(shell: Visited): Readonly<{ rows: readonly FilterRow[]; extraPicks?: readonly ExtraPick[] }> {
  return shell.node.props as Readonly<{ rows: readonly FilterRow[]; extraPicks?: readonly ExtraPick[] }>
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
  it('facet 全部走剥离版本：district(+businessArea) / businessArea / listingType', async () => {
    await renderView('')
    const dimensionSets = getCachedSearchFacetsIgnoring.mock.calls.map((call) => call[2] as string[])
    expect(dimensionSets).toEqual(
      expect.arrayContaining([
        // OPT-099：区域候选必须**连商圈一起剥**——只剥 district 的话，选了商圈之后
        // 其余区计数全为 0、位置行塌成只剩已选那一个区，用户再也切不走。
        ['district', 'businessArea'],
        // 商圈候选**只剥 businessArea**，district 留着，级联正是靠它成立。两者刻意不同。
        ['businessArea'],
        ['listingType'],
      ]),
    )
    // 守住「区域候选不再是只剥 district」：那是走查抓到的真实缺陷，回退就会复活。
    expect(dimensionSets).not.toContainEqual(['district'])
  })

  it('绝不退回未剥离的 getCachedSearchFacets（退回即让 district+businessArea / businessArea / listingType / buildingForm 四类候选计数失真）', async () => {
    await renderView('?priceUnit=rmb-sqm-day&district=jingan', { totalDocs: 3 })
    expect(getCachedSearchFacets).not.toHaveBeenCalled()
    const dimensionSets = getCachedSearchFacetsIgnoring.mock.calls.map((call) => call[2] as string[])
    expect(dimensionSets).toContainEqual(['district', 'businessArea'])
  })

  it('剥离查询把频道透传下去，出售频道不会拿到租赁口径的计数', async () => {
    await renderView('', { channel: 'sale' })
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

  // ── 终审 I1：悬浮 pill 徽标与抽屉「已选 N 项」必须同口径 ────────────────────
  // shell 曾用 `rows.reduce(row.activeValue != null)` 自己数一遍，与抽屉的
  // `visibleRows` + `findActiveOption` 双向分叉：判据更宽松、且不过滤零候选行。
  // 两个数字在 375 下同屏可见（抽屉打开时徽标仍在底栏），矛盾无处可藏。

  it('落在预设档位之外的数值条件：行内显示不出来，但经 extraPicks 进抽屉与徽标（?areaMin=750）', async () => {
    const tree = await renderView('?areaMin=750', { totalDocs: 3 })
    const shell = findByDisplayName(tree, 'MobileFilterShell')!
    const { rows, extraPicks } = shellRows(shell)
    // 前提：这一行确实没有能显示它的选项（否则这条测试没在测该测的东西）
    const areaRow = rows.find((row) => row.key === 'areaMin')!
    expect(areaRow.activeValue).toBe('750')
    expect(areaRow.options.some((option) => option.value === '750')).toBe(false)
    // 旧实现：徽标「1」而抽屉头部「已选 N 项」为空（分叉）；T17 之前修成两处都 0（一致但装瞎）；
    // 现在它经 extraPicks 在抽屉里可见可清，两处同为 1。
    expect(extraPicks?.map((p) => p.key)).toEqual(['areaMin'])
    expect(shellBadge(shell)).toBe(1)
  })

  it('缺 priceUnit 的价格区间不进徽标，因为它压根不再是一个生效条件（?priceMax=6）', async () => {
    // 这条用例原本锁的是「零候选行不计数」：`?priceMax=6` 没有 priceUnit → 价格行
    // 零档位、整行不渲染，却仍在收窄结果集。那个「看不见的生效条件」已经在解析层
    // 被堵掉（跨计价单位比 amount 无意义，见 search-params.ts 的闸门注释），所以
    // 现在正确的断言是：这个参数根本进不了 input，行上不会出现 activeValue。
    // `countActivePicks` 里 `options.length > 0` 那道结构性守卫改由
    // `tests/listing-price-unit-gate.test.ts` 直接单测覆盖。
    const tree = await renderView('?priceMax=6', { totalDocs: 3 })
    const shell = findByDisplayName(tree, 'MobileFilterShell')!
    const { rows } = shellRows(shell)
    const priceRow = rows.find((row) => row.key === 'priceMax')!
    expect(priceRow.activeValue).toBeUndefined()
    expect(priceRow.options).toHaveLength(0)
    expect(shellBadge(shell)).toBe(0)
    // 也不该从别的出口冒出来：既没有行 chip，也没有补充 chip
    const picks = (findByDisplayName(tree, 'FilterFormC')!.node.props as {
      extraPicks?: readonly { key: string }[]
    }).extraPicks
    expect(picks?.map((pick) => pick.key) ?? []).not.toContain('price')
  })

  it('T17：没有筛选行的关键词经 extraPicks 进抽屉与徽标（?q=整层 → 徽标 1）', async () => {
    const shell = findByDisplayName(await renderView('?q=整层', { totalDocs: 3 }), 'MobileFilterShell')!
    expect(shellRows(shell).extraPicks).toEqual([{ key: 'q', label: '关键词：整层', href: '/shanghai/listings' }])
    expect(shellBadge(shell)).toBe(1)
  })

  it('抽屉真能显示出来的条件仍然计数（?district=jingan → 徽标 1）', async () => {
    const tree = await renderView('?district=jingan', {
      totalDocs: 3,
      districts: [{ slug: 'jingan', name: '静安' }],
    })
    expect(shellBadge(findByDisplayName(tree, 'MobileFilterShell')!)).toBe(1)
  })

  it('徽标数恒等于抽屉头部所用的同一个口径函数（分叉即变红）', async () => {
    for (const query of ['', '?areaMin=750', '?priceMax=6', '?district=jingan&areaMin=100']) {
      const shell = findByDisplayName(
        await renderView(query, { totalDocs: 3, districts: [{ slug: 'jingan', name: '静安' }] }),
        'MobileFilterShell',
      )!
      const { rows, extraPicks } = shellRows(shell)
      expect(shellBadge(shell), query).toBe(countActivePicks(rows, extraPicks))
    }
  })

  it('默认排序不写进 URL：点已选中的「推荐」得到 canonical 地址（终审 M3）', async () => {
    const toolbar = findByDisplayName(await renderView('', { totalDocs: 3 }), 'ResultToolbar')!
    const props = toolbar.node.props as Parameters<typeof ResultToolbar>[0]
    expect(props.defaultSort).toBe('recommended')
    const html = renderToStaticMarkup(createElement(ResultToolbar, props))
    expect(html).toContain('href="/shanghai/listings"')
    expect(html).not.toContain('sort=recommended')
  })

  it('OPT-103：单位分段与被排除单位提示条不再渲染（带 priceUnit 的老链接也一样）', async () => {
    getCachedSearchFacetsIgnoring.mockResolvedValue({ districts: [], listingTypes: [], buildingForms: [], rentUnits: [{ value: 'rmb-sqm-day', count: 3 }, { value: 'rmb-month', count: 536 }], totalDocs: 3 })
    const tree = await renderView('?priceUnit=rmb-sqm-day', { totalDocs: 3 })
    expect(findByDisplayName(tree, 'PriceUnitSegment')).toBeUndefined()
    expect(findByDisplayName(tree, 'ExcludedUnitsBar')).toBeUndefined()
    expect(findByDisplayName(tree, 'FilterFormC')).toBeDefined()
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

  describe('OPT-103 共享办公频道', () => {
    const coworking = (query: string, totalDocs = 3) =>
      renderView(query, {
        channel: 'coworking',
        totalDocs,
        districts: [{ slug: 'jingan', name: '静安' }],
        // 路由层真实做的事：先解析、再 lockCoworkingInput 锁死类型（见
        // src/app/(frontend)/[city]/coworking/page.tsx）。不锁的话 input.listingType
        // 恒为 undefined，本 describe 块下面这些断言即使 CityListingsView 忘了排除
        // 「类型」这个锁定维度也照样绿——锁上才是在测真正会发生的输入。
        input: lockCoworkingInput(parseListingSearchInput(new URLSearchParams(query))),
      })

    it('类型行不渲染，页内 href 不带 type', async () => {
      const tree = await coworking('?district=jingan')
      const form = findByDisplayName(tree, 'FilterFormC')!.node.props as { rows: readonly FilterRow[]; currentParams: URLSearchParams; clearAllHref: string }
      expect(form.rows.map((r) => r.key)).not.toContain('type')
      expect(form.currentParams.has('type')).toBe(false)
      expect(form.clearAllHref).toBe('/shanghai/listings')
    })

    it('类型不补 chip、不进退路、不进已选计数', async () => {
      const tree = await coworking('?district=jingan', 0)
      const form = findByDisplayName(tree, 'FilterFormC')!.node.props as { extraPicks?: readonly { key: string }[] }
      expect(form.extraPicks?.map((p) => p.key) ?? []).not.toContain('listingType')
      const empty = findByDisplayName(tree, 'EmptyFiltered')!.node.props as { relaxations: readonly { label: string }[] }
      expect(empty.relaxations.map((r) => r.label)).toEqual(['取消「位置：静安」这一个条件'])
      const shell = findByDisplayName(tree, 'MobileFilterShell')!
      expect(shellBadge(shell)).toBe(1)
      // 每一次剥离查询收到的 input 都带着锁定的类型、且 omit 列表里没有 listingType
      // （锁定维度不该再被当成「可以剥掉再问」的候选维度）。
      for (const call of getCachedSearchFacetsIgnoring.mock.calls) {
        expect((call[1] as ListingSearchInput).listingType).toEqual(['coworking'])
        expect(call[2]).not.toContain('listingType')
      }
    })

    it('剥离查询不剥类型：空态①与「清除全部」的总数仍是共享办公口径', async () => {
      await coworking('', 0)
      for (const call of getCachedSearchFacetsIgnoring.mock.calls) {
        expect((call[1] as ListingSearchInput).listingType).toEqual(['coworking'])
        expect(call[2]).not.toContain('listingType')
        expect(call[3]).toBe('lease')
      }
    })

    it('页头文案：标题「上海共享办公」、副题主语「共享办公房源」', async () => {
      const html = renderToStaticMarkup(await coworking(''))
      expect(html).toContain('上海共享办公</h1>')
      expect(html).toContain('套共享办公房源')
    })
  })
})
