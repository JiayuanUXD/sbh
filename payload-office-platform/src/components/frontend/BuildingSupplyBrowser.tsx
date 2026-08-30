'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type {
  BuildingSupplyGroup,
  BuildingSupplyGroupAvailability,
  BuildingSupplySnapshot,
  ListingCardViewModel,
} from '@/domain/public-catalog'
// 值导入必须走**叶子模块**，不能走 `@/domain/public-catalog` 桶文件：桶文件
// `export * from './facade'` 会把 `supply-adapter.ts`（import payload）拖进
// 客户端 bundle，Next 直接报 "You're importing a component that needs ..."。
// 类型导入随便走桶（`import type` 编译期即擦除），值导入只走叶子。
import { availabilityDay, isImmediatelyAvailable } from '@/domain/public-catalog/building-supply'
import ListingCard from '@/components/frontend/ListingCard'
import { DECORATION_STATUS_LABELS } from '@/domain/review/listing-fields'
import { formatAvailableDate, priceUnitLabel } from '@/lib/frontend/format'
import { buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'
import { estimateRowTotal, formatGroupTotal } from '@/components/frontend/building-detail/supply-summary'

/**
 * 楼盘详情供给密度表（OPT-037 Task 7，方案 A：分组切换 + 密度表）。
 *
 * 改造而非重写——这是唯一承载真实供给浏览行为的组件，行为丢失比版式偏差贵：
 *   - 移动端沿用既有 `ListingCard variant="building-supply"` 卡片（真实图片/
 *     亮点标签/点击埋点），comp 稿对应「移动供给行」是无图两行卡，但那是
 *     未经验证的新样式；`.building-supply-browser__table` 是否渲染与
 *     `[data-listing-card-variant="building-supply"]` 是否渲染已被
 *     `tests/e2e/detail-pages.spec.ts`「窄屏楼盘供给始终使用卡片」锁定为
 *     真实产品行为，本次不因为一份静态 comp 就推翻它；
 *   - `data-supply-as-of` / `data-detail-analytics-*` 埋点属性原样保留；
 *   - 「查看更多」的**原地展开**交互保留（而非改成导航到另一个页面）。
 *
 * 这次真正的改造，是把「组切换 / 筛选 / 排序」从纯客户端 state（旧版
 * `AREA_BUCKETS` / `PRICE_BUCKETS` 是 `useState`，刷新即丢、无法分享）纠正为
 * URL 驱动：`domain/public-catalog/building-supply.ts` 的 `buildBuildingSupplySnapshot`
 * 早就支持 `group` / `areaMin` / `areaMax` / `decorationStatus` / `availableBefore`
 * / `priceUnit` / `sort`，页面层 `parseBuildingSupplySearchParams` 也早就在解析
 * 这些 query，只是这个组件此前完全没读它们、自己另起一套内存态重新实现了一遍
 * 面积/价格分桶——两套判断逻辑并存但只有一套真正接到 URL。本次收敛为只用 URL
 * 那一套，删掉客户端重复实现。价格分桶随之**迁移**（而不是删除）为域层的
 * `priceMin` / `priceMax` + `priceUnit` 单位闸门，见下方 `PRICE_BUCKETS`。
 *
 * URL 参数与 `search-params.ts` 的 `parseBuildingSupplySearchParams` /
 * `buildBuildingSupplyCanonicalSearchParams` 同名，不新造第三套命名。
 * `currentSearch` 由页面层用 canonical 参数序列化后传入（而非反射原始
 * searchParams）——非法/过期参数不会被带着走一遍；`URLSearchParams` 实例本身
 * 不作为 prop 跨 Server→Client 边界传递（Next.js 只保证少数内置类型可安全
 * 序列化，自定义/内置的非 POJO 类不在保证范围内），改传字符串，组件内部
 * 自己 `new URLSearchParams(currentSearch)`。
 *
 * 「可入驻」判断（逐行徽标 / 「可即刻入驻 N」计数 / 「可即刻入驻」pill 过滤）
 * 三处共用域层导出的 `isImmediatelyAvailable` + `availabilityDay`，组件内不重写
 * 日期比较——曾经组件用 `Date.parse`、域层过滤用字符串比较，于是「恰好当天可
 * 入驻」的房源被计入 N 却被 pill 过滤掉。
 *
 * **本区所有导航 Link 都带 `scroll={false}`（终审 I4，实测后加的）。**
 * 改造成 URL 驱动之后，切组/筛选/排序都变成了真实导航，而 App Router 对「同
 * pathname、仅 searchParams 变化」的导航**同样会重置滚动位置**——不是推断，是
 * 1440×900 下量出来的：滚到供给区（`scrollY=968`、`#supply` 顶边距视口 45px）
 * 点一个面积桶或一个排序项，`scrollY` 直接归 0、`#supply` 掉到视口下方 1013px。
 * 用户每筛一次就被弹回页首、还得自己滚回来找结果，而改造前（纯客户端 state）
 * 筛选完全不动滚动条。证据脚本：`tests/e2e/supply-filter-scroll.spec.ts`。
 * 选 `scroll={false}` 而不是给 href 追加 `#supply`：前者原地不动，与改造前的
 * 行为逐字一致；后者会跳到区块顶部（仍是一次位移），还把锚点写进了可分享 URL
 * 与浏览历史，等于为了修滚动改变了 URL 契约。
 */

type BuildingSupplyBrowserProps = Readonly<{
  snapshot: BuildingSupplySnapshot
  /** Immutable public DTO ID used for anonymous analytics only. */
  buildingId?: number
  citySlug?: string
  /** 楼盘详情页自身路径（含 citySlug 段），组切换/筛选/排序 href 的落点。 */
  basePath: string
  /** canonical query string（不含 `?`），见文件头注释。 */
  currentSearch: string
}>

function isBuildingSupplyGroup(value: string | null): value is BuildingSupplyGroup {
  return value === 'lease' || value === 'sale' || value === 'coworking'
}

const GROUP_TAB_LABEL: Record<BuildingSupplyGroup, string> = {
  lease: '租赁',
  sale: '出售',
  coworking: '联合办公',
}

/**
 * 组聚合区文案口径：三组的「面积/工位」维度与「可入驻」量词各不相同。
 *
 * **出售组没有「可即刻」这一维（`immediate: null`）——不是漏填，是域层没有依据。**
 * `immediateAvailabilityCount` 数的是 `isImmediatelyAvailable`，而它对
 * `availableFrom == null` 一律判真（「未填 = 现房」是租赁语境的既有口径）；
 * `collections/Listings.ts` 的 `availableFrom` admin condition 是
 * `businessType !== 'sale'`，**出售房源该字段结构上恒为 null**。两者相乘的结果是
 * 「可即时过户 N」恒等于该组全部套数——对每一套在售房源做了一次它没有依据的产权
 * 承诺（能不能过户取决于抵押/查封/满几年，仓库里根本没有这些字段）。
 * 这与 `buildStatusCell` 对出售行状态列的诚实降级（改显装修状态）是同一条判据，
 * 只是当时只修了行徽标、漏了聚合格与 pill。
 * 本字段同时是「可即刻入驻」筛选 pill 的渲染开关（见下方 `immediateFilterLabel`）——
 * 一个数不成立时，基于它的筛选控件也必然是点了没反应的死控件，两者必须同源开关。
 * 将来若 `Listings` 真的补上产权/过户状态字段，这里换成那个维度，别把 availableFrom 接回来。
 */
const AGG_LABELS: Record<
  BuildingSupplyGroup,
  {
    price: string
    metric: string
    metricUnit: string
    /** 「可即刻」格与同名筛选 pill 的文案；null = 本组没有这一维，两者一起不渲染。 */
    immediate: string | null
    immediateUnit: string | null
    /** 「共 M ?」的量词——联合办公按空间数而非套数计。 */
    totalUnit: string
  }
> = {
  lease: {
    price: '单价区间', metric: '面积区间', metricUnit: '㎡',
    immediate: '可即刻入驻', immediateUnit: '套', totalUnit: '套',
  },
  sale: {
    price: '单价区间', metric: '面积区间', metricUnit: '㎡',
    immediate: null, immediateUnit: null, totalUnit: '套',
  },
  coworking: {
    price: '工位单价区间',
    metric: '可选工位',
    metricUnit: '个',
    immediate: '可即刻入驻',
    immediateUnit: '个空间',
    totalUnit: '个空间',
  },
}

/** 表头文案口径：租赁/出售按面积计，联合办公按工位计；月租与总价单位不同。 */
function columnLabels(group: BuildingSupplyGroup, unitLabel: string | null) {
  const priceLabel = unitLabel ? `单价 ${unitLabel}` : '单价'
  if (group === 'sale') {
    return { metric: '面积 ㎡', price: priceLabel, total: '总价 万元', status: '装修' }
  }
  if (group === 'coworking') {
    return { metric: '工位数', price: priceLabel, total: '月租 元/月', status: '可入驻' }
  }
  return { metric: '面积 ㎡', price: priceLabel, total: '月租 元/月', status: '可入驻' }
}

function formatRange(min: number, max: number): string {
  const fmt = (n: number) => n.toLocaleString('zh-CN')
  return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount)
    ? amount.toLocaleString('zh-CN')
    : amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type AggCell = { label: string; value: string; unit: string }

/**
 * 组聚合区取**未过滤**口径（`availableGroups` 而非当前结果集）。
 *
 * 它描述的是「这个组长什么样」——与组 tab 上的计数、footer 的「共 M 套」同源，
 * 也与 OPT-036 的 `getSearchFacetsIgnoring` 惯例同源：facet 计数不该被它自己
 * 那一维的筛选削掉，否则筛完之后聚合区会跟着结果集缩水，读起来像是楼盘突然
 * 只剩这么多供给。同时这也让「筛到空结果」时聚合区仍有内容可渲染。
 */
function buildAggregation(group: BuildingSupplyGroup, data: BuildingSupplyGroupAvailability): readonly AggCell[] {
  const labels = AGG_LABELS[group]
  const priceRanges = data.priceRanges
  const priceCell: AggCell =
    priceRanges.length === 0
      ? { label: labels.price, value: '—', unit: '' }
      : priceRanges.length === 1
        ? {
            label: labels.price,
            value: formatRange(priceRanges[0].min, priceRanges[0].max),
            unit: priceUnitLabel(priceRanges[0].displayUnit),
          }
        : { label: labels.price, value: '多种单位', unit: '' }
  const metricRange = group === 'coworking' ? data.seatRange : data.areaRange
  const metricCell: AggCell = metricRange
    ? { label: labels.metric, value: formatRange(metricRange.min, metricRange.max), unit: labels.metricUnit }
    : { label: labels.metric, value: '—', unit: '' }
  // 出售组没有「可即刻」这一维（见 AGG_LABELS 注释），整格不渲染——渲染成
  // 「—」是另一种撒谎（「有这个维度，只是这栋楼没有」），这里是压根没有维度。
  // 聚合区网格保持 `repeat(3, 1fr)` 不变：少一格时前两格仍钉在同样的 x 位置，
  // 切组时「单价区间 / 面积区间」不会横向跳动。
  if (labels.immediate == null) return [priceCell, metricCell]
  // 0 显示为「—」：本批口径是「缺失/无量不显示 0」，聚合区是画像不是计数器。
  const immediateCell: AggCell =
    data.immediateAvailabilityCount > 0
      ? {
          label: labels.immediate,
          value: String(data.immediateAvailabilityCount),
          unit: labels.immediateUnit ?? '',
        }
      : { label: labels.immediate, value: '—', unit: '' }
  return [priceCell, metricCell, immediateCell]
}

/** 面积筛选桶——沿用改造前 `AREA_BUCKETS` 的边界值（已用过、不重新拍脑袋），
 * 只是把命中判据从客户端 state 换成 `areaMin`/`areaMax` query。 */
const AREA_BUCKETS = [
  { key: 'all', label: '全部', min: undefined, max: undefined },
  { key: '0-100', label: '0–100 ㎡', min: 0, max: 100 },
  { key: '100-300', label: '100–300 ㎡', min: 100, max: 300 },
  { key: '300-500', label: '300–500 ㎡', min: 300, max: 500 },
  { key: '500-1000', label: '500–1000 ㎡', min: 500, max: 1000 },
  { key: '1000+', label: '1000 ㎡ 以上', min: 1000, max: undefined },
] as const satisfies ReadonlyArray<{ key: string; label: string; min?: number; max?: number }>

/**
 * 价格分桶的计价单位闸门。
 *
 * 8 / 9 / 10 这三个边界只对「元/㎡/天」有意义。元/月、元/㎡/天、元/工位/月
 * 三者不可通约，跨单位比价是本项目的硬禁区，因此每个非「全部」桶的 href 都会
 * 同时写入 `priceUnit=rmb-sqm-day`；域层 `matchesInput` 也只在有 priceUnit 时
 * 才让价格区间生效——守卫落在真正做数值比较的那一行，不是只落在这里的 href 上。
 * 其余单位的房源只在「全部」桶可见，与改造前一致。
 */
const PRICE_BUCKET_UNIT = 'rmb-sqm-day' as const

/**
 * 价格筛选桶——边界值 8 / 9 / 10 沿用改造前的 `PRICE_BUCKETS`，不重新拍脑袋。
 *
 * 区间为闭区间（min/max 均含），与同一行的面积桶同构（域层 `areaMin`/`areaMax`
 * 也是闭区间）。代价是相邻桶在边界值上重叠一个点（8.00 同属首桶与「8–9 元」）
 * ——这与面积桶既有的行为完全一致；让价格与面积在同一排控件里用两套区间语义，
 * 比这一个点的重叠更容易出错。
 *
 * 首尾两桶的标签因此写成「及以下」/「及以上」而不是「以下」/「以上」：区间既然
 * 是闭的，边界值就真的在桶里，标签得照实说。这是零成本消除口径不符，不是改行为
 * （min/max 一个没动）。中间三桶的「8–9 元」本身就读作闭区间，无需改写。
 */
const PRICE_BUCKETS = [
  { key: 'all', label: '全部', min: undefined, max: undefined },
  { key: 'u-8', label: '8 元及以下', min: undefined, max: 8 },
  { key: '8-9', label: '8–9 元', min: 8, max: 9 },
  { key: '9-10', label: '9–10 元', min: 9, max: 10 },
  { key: '10+', label: '10 元及以上', min: 10, max: undefined },
] as const satisfies ReadonlyArray<{ key: string; label: string; min?: number; max?: number }>

const DEFAULT_VISIBLE_TABLE = 8
const DEFAULT_VISIBLE_CARDS = 5

/** 供给行「可入驻/装修」列：出售没有真实的产权/租约状态字段（`Listings`
 * collection 只有「产权年限」，与 comp 的「可过户/带租约」不是一回事），
 * 诚实降级为展示装修状态；租赁/联合办公按 availableFrom 判断可即刻/具体日期。
 * 集中在这一个函数里，避免可入驻判断在多处分别实现；「是否可即刻」本身进一步
 * 下沉到域层的 `isImmediatelyAvailable`，与计数、pill 过滤同源。 */
function buildStatusCell(
  group: BuildingSupplyGroup,
  listing: ListingCardViewModel,
  asOf: string,
): { text: string; emphasized: boolean } {
  if (group === 'sale') {
    const label = listing.decorationStatus ? DECORATION_STATUS_LABELS[listing.decorationStatus] : null
    return { text: label ?? '—', emphasized: false }
  }
  if (isImmediatelyAvailable(listing, asOf)) return { text: '可即刻', emphasized: true }
  return { text: formatAvailableDate(listing.availableFrom), emphasized: false }
}

export default function BuildingSupplyBrowser({
  snapshot,
  buildingId,
  citySlug,
  basePath,
  currentSearch,
}: BuildingSupplyBrowserProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // 组切换/筛选/排序任一变化都应该重新展示默认条数——旧的「展开」态属于上一次
  // 结果集，带到新结果集里没有意义（甚至可能超出新结果集长度）。用 render 期间
  // 调整状态（React 官方推荐的「根据 prop 变化调整 state」写法），而不是在
  // effect 里调用 setState 触发二次渲染。
  const [prevSearch, setPrevSearch] = useState(currentSearch)
  if (currentSearch !== prevSearch) {
    setPrevSearch(currentSearch)
    setExpanded(false)
  }

  /**
   * 断点为什么在 JS 里（`AnchorNavBar.tsx` / `detail.css` 立的规则是「断点只有
   * CSS 知道，搬进 JS 会造第二个事实源」——本处是那条规则**明示的例外**，不是违规）：
   *
   * 判据是「同一份 DOM 显不显示」归 CSS，「渲染哪一份 DOM」才归 JS。窄屏卡片
   * （`ListingCard`）与宽屏表格是**结构完全不同的两份 DOM**，不是同一份的显隐：
   * 两份都渲染再用 media query 各藏一份，会让隐藏的那份仍进 DOM、进无障碍树、
   * 进点击埋点（`data-detail-analytics-*` 会重复一遍），卡片那份还会多发一轮
   * 图片请求。这类分叉 CSS 做不到，只能由 JS 选一份渲染。
   *
   * 代价与约束：767 这个值同时存在于本处与 CSS，**必须逐字保持一致**——改任一
   * 处都要同时改另一处（CSS 侧见 `styles.css` `.building-supply-browser__table`
   * 一带的 `@media (max-width: 767px)`）。首帧 `isMobile` 恒为 false（SSR 无
   * window），窄屏会先渲染表格再切成卡片，这是既有行为（Task 7「改造而非重写」
   * 刻意保留），不在本轮改动范围。
   */
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const syncViewport = () => setIsMobile(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const currentParams = useMemo(() => new URLSearchParams(currentSearch), [currentSearch])

  const availableGroups = snapshot.availableGroups.filter((g) => g.totalEffectiveListings > 0)

  if (availableGroups.length === 0) {
    return (
      <section className="building-supply-browser" aria-label="楼盘房源" data-supply-as-of={snapshot.asOf}>
        <p className="building-supply-browser__empty">当前暂无公开可选空间</p>
      </section>
    )
  }

  const requestedGroup = currentParams.get('group')
  const defaultGroupKey = availableGroups[0]!.key
  const activeGroupKey: BuildingSupplyGroup =
    isBuildingSupplyGroup(requestedGroup) && availableGroups.some((g) => g.key === requestedGroup)
      ? requestedGroup
      : defaultGroupKey

  /**
   * 切组 **清空全部筛选/排序**，而不是像 `hrefWithParam` 那样克隆当前参数。
   *
   * 两者语义不同不是笔误：面积桶 / 价格桶 / 排序都是「在当前组内挑」，跨组带过去
   * 未必成立——价格桶的边界只对元/㎡/天有意义（出售组是总价，量级差六个数量级），
   * 「面积区间」在联合办公组根本不是主维度（那里按工位数），`sort=price-asc` 在
   * 新组里也可能因为单位不唯一而被降级。带着上一个组的筛选切过去，用户会看到一个
   * 「点了组 tab 却几乎没有结果」的页面，而原因藏在两三个还亮着的 pill 里。
   * 组是这一屏的顶层维度，切它就是重新开始。
   */
  function hrefForGroup(key: BuildingSupplyGroup): string {
    const sp = new URLSearchParams()
    if (key !== defaultGroupKey) sp.set('group', key)
    return buildHref(basePath, sp)
  }

  function hrefWithParam(key: string, value: string | null): string {
    const sp = cloneSearchParams(currentParams)
    if (value == null) sp.delete(key)
    else sp.set(key, value)
    return buildHref(basePath, sp)
  }

  const activeAvailability = availableGroups.find((g) => g.key === activeGroupKey)!
  const activeGroupData = snapshot.groups.find((g) => g.key === activeGroupKey) ?? null
  const listings = activeGroupData?.listings ?? []

  /**
   * 「可即刻入驻」pill 的激活判据是「`availableBefore` 存在」，不是「它恰好等于
   * 今天」。曾经写成后者：分享出去的链接过一天再打开，pill 显示未激活、过滤却
   * 仍然生效，而且点它只会换成新日期、永远取消不掉。取消一律走 `delete`。
   */
  const asOfDay = availabilityDay(snapshot.asOf)
  const immediateActive = currentParams.has('availableBefore')
  const activeAreaMin = currentParams.get('areaMin')
  const activeAreaMax = currentParams.get('areaMax')
  const activeAreaBucketKey = AREA_BUCKETS.find((b) => {
    const wantMin = b.min != null ? String(b.min) : null
    const wantMax = b.max != null ? String(b.max) : null
    return wantMin === activeAreaMin && wantMax === activeAreaMax
  })?.key ?? 'all'

  const activePriceUnit = currentParams.get('priceUnit')
  const activePriceMin = currentParams.get('priceMin')
  const activePriceMax = currentParams.get('priceMax')
  const activePriceBucketKey =
    activePriceUnit === PRICE_BUCKET_UNIT
      ? PRICE_BUCKETS.find((b) => {
          const wantMin = b.min != null ? String(b.min) : null
          const wantMax = b.max != null ? String(b.max) : null
          return wantMin === activePriceMin && wantMax === activePriceMax
        })?.key ?? 'all'
      : 'all'

  /**
   * 价格桶只在「本组（未过滤口径）确实有元/㎡/天 房源」时才渲染整组；
   * 单个桶与该组价格区间无交集时不渲染（沿用旧版「0 命中的桶不渲染」）。
   *
   * 与旧版的差别写在明处：旧版按逐条房源真实计数，本版按未过滤的 `priceRanges`
   * （min/max）判交集——`availableGroups` 里没有 listings，而用**已过滤**的
   * listings 去算桶计数会得到「筛完之后其它桶消失」的口径分叉。交集判据永远不会
   * 藏起有命中的桶，最坏只是留下一个区间内恰好没有房源的空桶；而空桶现在也不再
   * 是死路（筛到空结果时控件仍在，见下方 panel 结构）。
   */
  const bucketUnitRange = activeAvailability.priceRanges.find((r) => r.displayUnit === PRICE_BUCKET_UNIT) ?? null
  const priceBuckets = bucketUnitRange
    ? PRICE_BUCKETS.filter(
        (b) =>
          b.key === 'all'
          || ((b.min ?? -Infinity) <= bucketUnitRange.max && (b.max ?? Infinity) >= bucketUnitRange.min),
      )
    : []

  const activeSort = currentParams.get('sort') ?? 'recommended'
  const priceUnits = Array.from(new Set(activeAvailability.priceRanges.map((r) => r.displayUnit)))
  const singleUnitLabel = priceUnits.length === 1 ? priceUnitLabel(priceUnits[0]!) : null
  // 单位唯一，或用户已经用价格桶把单位钉死——两种情况下按单价排序才是可比的。
  const canSortByPrice = priceUnits.length === 1 || activePriceUnit != null

  const sortOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'recommended', label: '推荐排序' },
    { value: 'area-asc', label: '面积从小到大' },
    { value: 'area-desc', label: '面积从大到小' },
    ...(canSortByPrice
      ? [
          { value: 'price-asc', label: '单价从低到高' },
          { value: 'price-desc', label: '单价从高到低' },
        ]
      : []),
  ]

  const cols = columnLabels(activeGroupKey, singleUnitLabel)
  const defaultVisible = isMobile ? DEFAULT_VISIBLE_CARDS : DEFAULT_VISIBLE_TABLE
  const visibleListings = expanded ? listings : listings.slice(0, defaultVisible)
  const hiddenCount = listings.length - visibleListings.length
  const totalUnit = AGG_LABELS[activeGroupKey].totalUnit
  // 「可即刻入驻」pill 与聚合区那一格同源开关（见 AGG_LABELS 注释）。
  const immediateFilterLabel = AGG_LABELS[activeGroupKey].immediate

  return (
    <section className="building-supply-browser" aria-label="楼盘房源" data-supply-as-of={snapshot.asOf}>
      <div className="building-supply-browser__tabs" role="group" aria-label="按业务组切换">
        {availableGroups.map((g) => {
          const isActive = g.key === activeGroupKey
          return (
            <Link
              key={g.key}
              href={hrefForGroup(g.key)}
              aria-current={isActive ? 'true' : undefined}
              className="building-supply-browser__tab"
              data-active={isActive || undefined}
              prefetch={false}
              scroll={false}
            >
              <span>{GROUP_TAB_LABEL[g.key]}</span>
              <span className="building-supply-browser__tab-count">{g.totalEffectiveListings}</span>
            </Link>
          )
        })}
      </div>

      <div className="building-supply-browser__panel">
        <div className="building-supply-browser__agg">
          {buildAggregation(activeGroupKey, activeAvailability).map((cell) => (
            <div key={cell.label} className="building-supply-browser__agg-item">
              <span className="building-supply-browser__agg-label">{cell.label}</span>
              <span className="building-supply-browser__agg-value-row">
                <span className="building-supply-browser__agg-value tabular">{cell.value}</span>
                {cell.unit && <span className="building-supply-browser__agg-unit">{cell.unit}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* 控件区在「筛到空结果」时同样渲染：改造前筛选行是常驻的，一旦跟着结果集
            消失，用户就没有任何入口取消刚刚点下的那个筛选，只能退回浏览器后退键。 */}
        <div className="building-supply-browser__controls">
          <div className="building-supply-browser__filter-group" role="group" aria-label="按面积筛选">
            <span className="building-supply-browser__filter-label">面积</span>
            {AREA_BUCKETS.map((bucket) => {
              const isActive = bucket.key === activeAreaBucketKey
              const sp = cloneSearchParams(currentParams)
              sp.delete('areaMin')
              sp.delete('areaMax')
              if (bucket.min != null) sp.set('areaMin', String(bucket.min))
              if (bucket.max != null) sp.set('areaMax', String(bucket.max))
              return (
                <Link
                  key={bucket.key}
                  href={buildHref(basePath, sp)}
                  className="building-supply-browser__filter"
                  data-active={isActive || undefined}
                  aria-current={isActive ? 'true' : undefined}
                  prefetch={false}
                  scroll={false}
                >
                  {bucket.label}
                </Link>
              )
            })}
          </div>
          {priceBuckets.length > 0 && (
            <div className="building-supply-browser__filter-group" role="group" aria-label="按价格筛选">
              <span className="building-supply-browser__filter-label">单价</span>
              {priceBuckets.map((bucket) => {
                const isActive = bucket.key === activePriceBucketKey
                const sp = cloneSearchParams(currentParams)
                sp.delete('priceMin')
                sp.delete('priceMax')
                sp.delete('priceUnit')
                if (bucket.key !== 'all') {
                  // priceUnit 与区间同进同出：本页只有价格桶会写 priceUnit，
                  // 「全部」把三个键一起删掉才是真正回到未筛选态。
                  sp.set('priceUnit', PRICE_BUCKET_UNIT)
                  if (bucket.min != null) sp.set('priceMin', String(bucket.min))
                  if (bucket.max != null) sp.set('priceMax', String(bucket.max))
                }
                return (
                  <Link
                    key={bucket.key}
                    href={buildHref(basePath, sp)}
                    className="building-supply-browser__filter"
                    data-active={isActive || undefined}
                    aria-current={isActive ? 'true' : undefined}
                    prefetch={false}
                    scroll={false}
                  >
                    {bucket.label}
                  </Link>
                )
              })}
            </div>
          )}
          {/* pill 与聚合区那一格同一个开关（`AGG_LABELS[...].immediate`）：出售组
              的「可即刻」数没有依据（见 AGG_LABELS 注释），基于它的筛选自然也是
              点了没反应的死控件——`availableFrom` 对出售恒为 null，`matchesInput`
              对全部出售卡片放行，结果集一条不变、计数一条不减，`aria-current`
              却亮起。两处共用一个判据，不许再分叉成两套条件。 */}
          {asOfDay != null && immediateFilterLabel != null && activeAvailability.immediateAvailabilityCount > 0 && (
            <Link
              href={hrefWithParam('availableBefore', immediateActive ? null : asOfDay)}
              className="building-supply-browser__filter"
              data-active={immediateActive || undefined}
              aria-current={immediateActive ? 'true' : undefined}
              prefetch={false}
              scroll={false}
            >
              {immediateFilterLabel}
            </Link>
          )}
          {/* 排序控件形态与房源列表页 `ResultToolbar` 完全一致（同一套
              `.ls-toolbar__sort*` 类）：排序只改变同一结果集内的顺序，视觉权重
              刻意低于会改变结果集的筛选 pill，见 ResultToolbar 顶部注释。这里
              复用 CSS 外壳而不是复用组件——ResultToolbar 还承担「显示第 x–y，
              共 N」的计数职责，本组件的计数在 footer 且量词按组不同。 */}
          <div className="building-supply-browser__sort" role="group" aria-label="排序">
            <span className="ls-toolbar__sortlabel">排序</span>
            {sortOptions.map((option) => {
              const isActive = option.value === activeSort
              return (
                <Link
                  key={option.value}
                  href={hrefWithParam('sort', option.value === 'recommended' ? null : option.value)}
                  className={isActive ? 'ls-toolbar__sort ls-toolbar__sort--active' : 'ls-toolbar__sort'}
                  aria-current={isActive ? 'true' : undefined}
                  prefetch={false}
                  scroll={false}
                >
                  {option.label}
                </Link>
              )
            })}
          </div>
        </div>
        {/* 读**当前组**的 `priceSortDegraded`，不读快照级 `validationErrors`：后者
            是「任一组降级」的汇总信号，拿它当组级提示就会在「本组单位唯一、只是
            这栋楼另有一个出售组」时说出「该组内房源计价单位不唯一」这句假话
            （见 contracts.ts 该字段注释）。 */}
        {activeGroupData?.priceSortDegraded && (
          <p className="building-supply-browser__notice">该组内房源计价单位不唯一，暂按推荐顺序排列</p>
        )}

        {listings.length === 0 ? (
          <p className="building-supply-browser__empty">当前筛选下暂无匹配空间</p>
        ) : isMobile ? (
          <div className="building-supply-browser__cards">
            {visibleListings.map((listing, index) => (
              <ListingCard
                key={`${activeGroupKey}:${listing.id}`}
                listing={listing}
                citySlug={citySlug}
                variant="building-supply"
                detailAnalytics={
                  buildingId
                    ? {
                        event: 'building_listing_click',
                        parentId: buildingId,
                        rank: index + 1,
                        section: 'supply',
                        supplyGroup: activeGroupKey,
                      }
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div className="building-supply-browser__table-wrap">
            <table className="building-supply-browser__table">
              <caption className="visually-hidden">{GROUP_TAB_LABEL[activeGroupKey]}房源列表</caption>
              {/* 百分比而非 px：comp 的 1fr/130/150/176/120/44 是 1180 容器
                  （面板内可用宽 1116）下的字面量，换算成同比例的百分比列宽
                  （styles.css .building-supply-browser__table 头部注释解释了
                  为什么不能用 px min-width/width 兜底窄容器）。 */}
              <colgroup>
                <col />
                <col style={{ width: '11.65%' }} />
                <col style={{ width: '13.44%' }} />
                <col style={{ width: '15.77%' }} />
                <col style={{ width: '10.75%' }} />
                <col style={{ width: '3.94%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">房源</th>
                  <th scope="col" className="building-supply-browser__table-num-head">{cols.metric}</th>
                  <th scope="col" className="building-supply-browser__table-num-head">{cols.price}</th>
                  <th scope="col" className="building-supply-browser__table-num-head">{cols.total}</th>
                  <th scope="col">{cols.status}</th>
                  <th scope="col"><span className="visually-hidden">详情</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleListings.map((listing, index) => {
                  const metricValue =
                    activeGroupKey === 'coworking'
                      ? listing.seats != null
                        ? listing.seats.toLocaleString('zh-CN')
                        : '—'
                      : listing.area != null
                        ? listing.area.toLocaleString('zh-CN')
                        : '—'
                  const singleUnit = singleUnitLabel != null
                  const priceCell = listing.price
                    ? singleUnit
                      ? formatAmount(listing.price.amount)
                      : listing.price.text
                    : '—'
                  const total = estimateRowTotal(listing.price, { area: listing.area, seats: listing.seats })
                  const totalCell = total != null ? formatGroupTotal(total, activeGroupKey) : '—'
                  const status = buildStatusCell(activeGroupKey, listing, snapshot.asOf)
                  // 出售组的「状态」列本身就是装修状态（见 buildStatusCell），
                  // 副行再写一遍就是同一事实占两个位置，副行只留楼层。
                  const sub = [
                    listing.floor ? `${listing.floor} 层` : null,
                    activeGroupKey === 'sale'
                      ? null
                      : listing.decorationStatus
                        ? DECORATION_STATUS_LABELS[listing.decorationStatus]
                        : null,
                  ]
                    .filter((part): part is string => Boolean(part))
                    .join(' · ')
                  const detailHref = `${citySlug ? `/${citySlug}` : ''}/listings/${encodeURIComponent(listing.slug)}`
                  // 埋点属性两个链接都要带：DetailClickAnalytics 走的是
                  // `event.target.closest('[data-detail-analytics-event]')`，属性只挂在
                  // 箭头上时点标题不会上报。**不能挂到 `<tr>` 上**——那样连选中单元格
                  // 文字都会命中 closest 而误报一次点击。一次点击只落在一个元素上，
                  // 两处都带不会重复上报。
                  const detailAnalyticsAttrs = {
                    'data-detail-analytics-event': buildingId ? 'building_listing_click' : undefined,
                    'data-analytics-parent-id': buildingId,
                    'data-analytics-listing-id': buildingId ? listing.id : undefined,
                    'data-analytics-supply-group': buildingId ? activeGroupKey : undefined,
                    'data-analytics-rank': buildingId ? index + 1 : undefined,
                    'data-analytics-section': buildingId ? 'supply' : undefined,
                  } as const
                  return (
                    <tr key={`${activeGroupKey}:${listing.id}`}>
                      <td>
                        {/* 标题即链接：原先整行只有最右侧那个 44px 箭头可点，用户
                            直觉上会去点标题却没反应（移动端卡片视图的标题本来就在
                            ListingCard 的整卡链接里，只有桌面密度表缺这一口）。 */}
                        <a
                          href={detailHref}
                          className="building-supply-browser__table-primary"
                          {...detailAnalyticsAttrs}
                        >
                          {listing.title}
                        </a>
                        {sub && <span className="building-supply-browser__table-sub">{sub}</span>}
                      </td>
                      <td className="tabular building-supply-browser__table-num">{metricValue}</td>
                      <td className="tabular building-supply-browser__table-num">{priceCell}</td>
                      <td className="tabular building-supply-browser__table-num building-supply-browser__table-total">
                        {totalCell}
                      </td>
                      <td>
                        <span
                          className="building-supply-browser__table-status"
                          data-emphasized={status.emphasized || undefined}
                        >
                          {status.text}
                        </span>
                      </td>
                      <td>
                        {/* 箭头与标题指向同一个详情页。标题上线后这里若仍暴露给
                            无障碍树，每行就会出现两条同目的地的链接，读屏要听两遍、
                            键盘要 Tab 两次。用 aria-hidden + tabIndex=-1 把它降级成
                            纯鼠标热区：视觉与点击照旧，可达性上只保留标题那一条。
                            （两者必须同时设：只设 aria-hidden 而元素仍可聚焦，本身
                            就是一条无障碍错误。） */}
                        <a
                          href={detailHref}
                          className="building-supply-browser__table-link"
                          aria-hidden="true"
                          tabIndex={-1}
                          {...detailAnalyticsAttrs}
                        >
                          <svg width="9" height="14" viewBox="0 0 10 16" aria-hidden="true">
                            <path
                              d="M2 1l6 7-6 7"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="building-supply-browser__footer">
          {hiddenCount > 0 && (
            <button type="button" className="building-supply-browser__more" onClick={() => setExpanded(true)}>
              展开其余 {hiddenCount} 套
            </button>
          )}
          {/* 「共 M」取未过滤口径（与组 tab 计数、聚合区同源）；「当前筛选 N 条」
              才是结果集口径，两者并列写清楚，不再混成一句。asOf 是数据诚实性
              元素（这份供给是哪一刻的快照），真渲染出来而不是只活在 data- 属性里。 */}
          <span className="building-supply-browser__footnote">
            共 <span className="tabular">{activeAvailability.totalEffectiveListings}</span> {totalUnit}
            {listings.length > 0 && <> · 当前筛选 <span className="tabular">{listings.length}</span> 条</>}
            {asOfDay != null && <> · 数据截至 <span className="tabular">{asOfDay}</span></>}
          </span>
        </div>
      </div>
    </section>
  )
}
