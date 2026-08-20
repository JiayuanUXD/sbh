import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import EmptyFiltered, { type Relaxation } from '@/components/frontend/listing/EmptyFiltered'
import EmptyNoStock from '@/components/frontend/listing/EmptyNoStock'
import EmptyOutOfRange from '@/components/frontend/listing/EmptyOutOfRange'
import ExcludedUnitsBar, { type ExcludedUnitOption } from '@/components/frontend/listing/ExcludedUnitsBar'
import FilterFormC from '@/components/frontend/listing/FilterFormC'
import ListingResultCard from '@/components/frontend/listing/ListingResultCard'
import ListingResultRow from '@/components/frontend/listing/ListingResultRow'
import ListPager from '@/components/frontend/listing/ListPager'
import MobileFilterShell from '@/components/frontend/listing/MobileFilterShell'
import PriceUnitSegment, { type PriceUnitOption } from '@/components/frontend/listing/PriceUnitSegment'
import ResultToolbar, { type ResultToolbarSort } from '@/components/frontend/listing/ResultToolbar'
import {
  buildCanonicalSearchParams,
  type ListingSearchDimension,
  type ListingSearchInput,
  type PriceDisplayUnit,
} from '@/domain/public-catalog'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import {
  getCachedSearchFacetsIgnoring,
  type getCachedListingDistrictOptions,
  type getCachedSearchListings,
} from '@/lib/frontend/cached-queries'
import { priceUnitLabel } from '@/lib/frontend/format'
import {
  LISTING_CLEARABLE_DIMENSIONS,
  buildListingFilterRows,
  type ListingFilterDimensionSpec,
} from '@/lib/frontend/listing-filter-rows'
import { buildHref, cloneSearchParams, type ListingViewMode } from '@/lib/frontend/listing-url'

type ListingResult = Awaited<ReturnType<typeof getCachedSearchListings>>
type Districts = Awaited<ReturnType<typeof getCachedListingDistrictOptions>>

/**
 * OPT-036 房源列表页编排层。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html。组合顺序照 comp：
 * 页头 → 单位分段 → 筛选条 C → 结果工具条 → 结果网格 → 被排除单位提示条 → 分页；
 * 三种空态按条件替换结果区（不是叠加在结果之上）。
 *
 * 本文件只做编排：把 DTO 投影成各组件的 props、构造 href、按条件选分支。
 * 所有视觉规格在组件与 `styles/list.css` 里，所有查询在 `lib/frontend/cached-queries`
 * 与域层 facade 里；这里既不写样式也不拼 Payload `where`。
 *
 * ## 为什么是 async Server Component
 *
 * 页面上有三类数字**路由层拿不到**：各计价单位的套数、各筛选候选的套数、空态②
 * 逐条退路的命中数。它们都必须与列表同一口径（同一 asOf、同一有效供给谓词），
 * 且租/售两个频道共四个路由入口（`/[city]/listings`、`/listings`、`/[city]/sale`、
 * `/sale`）。在四个路由里各抄一份取数逻辑必然漂移，因此取数收在这一层，路由只
 * 负责解析 URL 与解析城市。props 签名保持不变，只新增了一个可选的 `view`
 * ——理由见下方该 prop 的注释。
 *
 * ## URL 是唯一事实源
 *
 * 筛选 / 排序 / 分页 / 计价单位 / 版式全部反映在地址栏，任意一页都能直接分享。
 * 所有子组件的 href 都从同一份 `currentParams` 克隆而来（`buildCanonicalSearchParams`
 * 的输出 + `view`），不存在只活在内存里的筛选态。
 */

/**
 * 租售频道共用的文案。
 *
 * 组件复用不等于文案复用：同一套栅格里,「在租房源」「统一租金单位」「扩大价格范围」
 * 放到出售页就是错的语境。集中成表而不是散在 JSX 里,新增交易类型时只补一行。
 * 各组件的 `countNoun` / `noun` / `totalNoun` 一律从这张表取值，调用点不写字面量
 * （见 FilterFormC.tsx、ResultToolbar.tsx、MobileFilterTrigger.tsx 的同名 prop 注释）。
 */
const CHANNEL_COPY = {
  lease: {
    noun: '在租房源',
    /** 计数量词，用于「N 套符合条件」「显示第 1–24 套」「查看 N 套」。 */
    countNoun: '套',
    /** EmptyNoStock 主按钮的量词短语：「查看全部 N 套在租房源」。 */
    totalNoun: '套在租房源',
    unitNote: '已按统一租金单位显示',
    unitRowLabel: '租金单位',
    unitDimensionLabel: '租金单位',
    priceRowLabel: '租金上限',
    /** 空态②退路文案里的价格维度名（覆盖 priceMin+priceMax，不只是上限）。 */
    priceDimensionLabel: '租金',
  },
  sale: {
    noun: '出售房源',
    countNoun: '套',
    totalNoun: '套出售房源',
    unitNote: '已按统一计价单位显示',
    unitRowLabel: '计价单位',
    unitDimensionLabel: '计价单位',
    priceRowLabel: '总价上限',
    priceDimensionLabel: '总价',
  },
} as const satisfies Record<'lease' | 'sale', Readonly<Record<string, string>>>

/**
 * 计价单位在分段控件里的固定顺序。
 *
 * 不按套数排序：同一个城市今天元/月最多、明天元/㎡/天最多，分段项就会左右横跳，
 * 用户上一次点的位置这一次不在那里。顺序固定 = 位置可记忆。
 */
const PRICE_UNIT_ORDER: readonly PriceDisplayUnit[] = [
  'rmb-sqm-day',
  'rmb-sqm-month',
  'rmb-sqm-year',
  'rmb-sqm-total',
  'rmb-month',
  'rmb-day',
  'rmb-year',
  'rmb-total',
  'rmb-seat-day',
  'rmb-seat-month',
  'rmb-seat-year',
  'rmb-seat-total',
]

const BASE_SORTS: readonly ResultToolbarSort[] = [
  { value: 'recommended', label: '推荐' },
  { value: 'newest', label: '最新' },
]

/**
 * 价格排序两项：**只有选定计价单位时才提供**。
 *
 * `normalizeSort`（domain/public-catalog/search-params.ts）在缺 `priceUnit` 时会
 * 把 `price-asc`/`price-desc` 静默降级为 `recommended`——跨单位价格不可比。若这里
 * 无条件把两项交给 `ResultToolbar`，用户点下去 URL 变了、结果与高亮却弹回原状，
 * 成了「点了没反应」的死控件，比没有这个控件更糟（Task 8 顶部注释的原话）。
 * 责任在调用方而不是组件：组件不接收 `priceUnit`，没有依据自行过滤。
 */
const PRICE_SORTS: readonly ResultToolbarSort[] = [
  { value: 'price-asc', label: '价格 ↑' },
  { value: 'price-desc', label: '价格 ↓' },
]

/** facet 的数组结果转成 Map，供筛选行按 key 取计数。 */
function toCountMap(entries: readonly Readonly<{ value?: string; slug?: string; count: number }>[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const entry of entries) {
    const key = entry.value ?? entry.slug
    if (key) map.set(key, entry.count)
  }
  return map
}

/** 「去掉这一个条件」的 href：删该维度占用的全部 URL 键 + 删 page，其余原样保留。 */
function buildDropDimensionHref(
  basePath: string,
  currentParams: URLSearchParams,
  paramKeys: readonly string[],
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  for (const key of paramKeys) sp.delete(key)
  return buildHref(basePath, sp)
}

export default async function CityListingsView({
  city,
  result,
  districts,
  input,
  basePath,
  routeMode,
  businessType = 'lease',
  view = 'grid',
}: Readonly<{
  city: CityContext
  result: ListingResult
  districts: Districts
  input: ListingSearchInput
  basePath: string
  routeMode: 'legacy' | 'prefixed'
  /** 当前频道；决定文案语境。缺省为租赁,保持既有调用零改动。 */
  businessType?: 'lease' | 'sale'
  /**
   * 结果区版式（`?view=grid|row`）。
   *
   * 由路由层用 `parseListingViewMode` 从原始 searchParams 解析后传入，**刻意不进
   * `ListingSearchInput`、也不进 canonical**：它只改渲染方式不改结果集，两个仅
   * `view` 不同的 URL 对搜索引擎是同一个页面（控制器裁定，OPT-036 Task 8）。
   * 地址栏仍然保留它，分享出去的链接不丢版式态——本组件把它带进 `currentParams`，
   * 于是筛选/排序/翻页的每一个 href 都会携带当前版式。
   */
  view?: ListingViewMode
}>) {
  const copy = CHANNEL_COPY[businessType]
  const heading = routeMode === 'legacy' ? copy.noun : `${city.name}${copy.noun}`
  const { docs, pagination } = result
  const { page, totalPages, totalDocs } = pagination
  const activeUnit = input.priceUnit

  // ── 取数 ────────────────────────────────────────────────────────────────
  // 三份 facet 各自剥掉一个维度后再统计（见 omitListingSearchDimensions 注释）：
  //   - 剥 priceUnit：算「另有多少套按别的单位报价」。用现成的 getSearchFacets
  //     会因为它保留 priceUnit 而让其余单位计数恒为 0，提示条静默消失。
  //   - 剥 district / listingType：算各候选自己的套数。不剥的话选中静安以后
  //     其余区计数全为 0（Task 2「facets 算在筛选前」同型问题）。
  // 三者剥离后若得到同一份 input（用户没叠加对应筛选时的常见情形），
  // getCachedSearchFacetsIgnoring 会命中同一条缓存，不会各查一次库。
  const [unitFacets, districtFacets, typeFacets] = await Promise.all([
    getCachedSearchFacetsIgnoring(city.slug, input, ['priceUnit'], businessType),
    getCachedSearchFacetsIgnoring(city.slug, input, ['district'], businessType),
    getCachedSearchFacetsIgnoring(city.slug, input, ['listingType'], businessType),
  ])

  const unitCounts = toCountMap(unitFacets.rentUnits)
  const units: readonly PriceUnitOption[] = PRICE_UNIT_ORDER.filter(
    (unit) => unit === activeUnit || (unitCounts.get(unit) ?? 0) > 0,
  ).map((unit) => ({ value: unit, label: priceUnitLabel(unit), count: unitCounts.get(unit) ?? 0 }))

  const excludedUnits: readonly ExcludedUnitOption[] = activeUnit
    ? units.filter((unit) => unit.value !== activeUnit)
    : []

  const { rows, dimensions } = buildListingFilterRows({
    input,
    districts,
    districtCounts: toCountMap(districtFacets.districts),
    typeCounts: toCountMap(typeFacets.listingTypes),
    priceRowLabel: copy.priceRowLabel,
    priceDimensionLabel: copy.priceDimensionLabel,
  })

  // 计价单位也是一个「可以被单独放宽」的条件，因此进退路清单；但它不进
  // 「清除全部条件」——comp 稿页头按钮的语义是「清掉我叠加的条件，仍然看这一
  // 类价格」（字面「清除全部条件 · 1,893 套」，1,893 正是某一个单位下的总数）。
  const unitDimension: ListingFilterDimensionSpec = {
    dimension: 'priceUnit',
    label: copy.unitDimensionLabel,
    // `rentUnit` 同 price 维度里的 rentMin/rentMax：解析层仍接受的旧名，但
    // canonical 不输出，因此当前调用链下删不到东西。保留它描述的是「这个维度
    // 占用哪些 URL 键」，理由见 listing-filter-rows.ts 里 price 维度的注释。
    paramKeys: ['priceUnit', 'rentUnit'],
    activeText: activeUnit ? priceUnitLabel(activeUnit) : null,
  }
  const allDimensions: readonly ListingFilterDimensionSpec[] = [...dimensions, unitDimension]
  const activeDimensions = allDimensions.filter((d) => d.activeText != null)

  // ── URL ─────────────────────────────────────────────────────────────────
  // canonical 之外再挂 view：canonical 不含 view（SEO 上两者是同一页面），
  // 但地址栏与页内每一个 href 都要带着它，否则一点筛选就把版式态丢了。
  const currentParams = buildCanonicalSearchParams(input)
  if (view === 'row') currentParams.set('view', 'row')

  const buildPageHref = (targetPage: number) => {
    const params = cloneSearchParams(currentParams)
    if (targetPage <= 1) params.delete('page')
    else params.set('page', String(targetPage))
    return buildHref(basePath, params)
  }

  // ── 状态判定 ─────────────────────────────────────────────────────────────
  const isOutOfRange = page > totalPages && totalDocs > 0
  const isEmpty = totalDocs === 0
  // 「类目型」条件（类型 / 计价单位）与「收窄型」条件（区域/价格/面积/关键词…）
  // 区别对待：只挑了类目却一套都没有，用户没有做错任何事——那是空态①「这一类
  // 还没有收录」，逐条放宽在这里无从谈起；只要叠加了任何一个收窄条件，就是
  // 空态②「条件收得太紧」，必须逐条给出放宽后的真实命中数。
  const narrowingDimensions = activeDimensions.filter(
    (d) => d.dimension !== 'listingType' && d.dimension !== 'priceUnit',
  )
  const showEmptyFiltered = isEmpty && narrowingDimensions.length > 0
  const showEmptyNoStock = isEmpty && !showEmptyFiltered

  // 空态①的标题名词必须说出「哪一类还没有」，否则「上海在租房源还在收录中」会在
  // 页面上其它地方明明写着共 10 套时自相矛盾（comp 稿字面：「上海的共享工位房源
  // 还在收录中」）。这一态只可能由类目型条件（类型 / 计价单位）造成，把它们拼进
  // 名词即可，不需要再拼收窄条件。
  const activeTypeLabel = activeDimensions.find((d) => d.dimension === 'listingType')?.activeText
  const noStockNoun = [
    activeUnit ? `按${priceUnitLabel(activeUnit)}报价的` : '',
    routeMode === 'legacy' ? '' : `${city.name}`,
    activeTypeLabel ?? '',
    copy.noun,
  ].join('')

  // 页头「共 N 套」与单位分段上的「元/㎡/天 M」可以合法地不相等（实测 4 vs 3）：
  // 前者数的是命中的房源，后者数的是**有报价**的房源——价格面议的那几套属于这个
  // 单位的结果集，却没有价格可计入单位计数。两个数字都诚实，但同屏摆着又不解释，
  // 读者只会当成 bug。因此选定单位时把差额说出来，而不是把其中一个数悄悄改掉去
  // 迁就另一个（那才是真的在撒谎）。
  const pricedInActiveUnit = activeUnit ? (unitCounts.get(activeUnit) ?? 0) : 0
  const unpricedCount = activeUnit ? Math.max(0, totalDocs - pricedInActiveUnit) : 0

  const rangeStart = totalDocs > 0 ? (page - 1) * input.pageSize + 1 : 0
  const rangeEnd = Math.min(page * input.pageSize, totalDocs)

  const sorts: readonly ResultToolbarSort[] = activeUnit ? [...BASE_SORTS, ...PRICE_SORTS] : BASE_SORTS

  // 空态②：逐条退路（只在真的空且有收窄条件时才查，正常路径零额外开销）。
  let relaxations: readonly Relaxation[] = []
  let clearAllCount: number | undefined
  if (showEmptyFiltered) {
    const [hits, clearAll] = await Promise.all([
      Promise.all(
        activeDimensions.map((d) =>
          getCachedSearchFacetsIgnoring(city.slug, input, [d.dimension], businessType),
        ),
      ),
      getCachedSearchFacetsIgnoring(city.slug, input, LISTING_CLEARABLE_DIMENSIONS, businessType),
    ])
    relaxations = activeDimensions.map((d, index) => ({
      label: `取消「${d.label}：${d.activeText}」这一个条件`,
      hitCount: hits[index].totalDocs,
      href: buildDropDimensionHref(basePath, currentParams, d.paramKeys),
    }))
    clearAllCount = clearAll.totalDocs
  }

  // 空态①：主按钮要的是「不叠加这一类限制的完整结果集」总数，因此连计价单位
  // 一起剥掉——这一态的出口就是「先看看这个城市/频道到底有什么」。
  const noStockTotal = showEmptyNoStock
    ? (await getCachedSearchFacetsIgnoring(
        city.slug,
        input,
        [...LISTING_CLEARABLE_DIMENSIONS, 'priceUnit'] as readonly ListingSearchDimension[],
        businessType,
      )).totalDocs
    : 0

  // 「清除全部条件」只有一个口径，两个控件共用同一个 href：筛选条底栏那个与空态②
  // 里那个在同一屏上同时可见、文案同样是「清除全部」，作用域一旦不同就是同名不同义
  // （用户点了其中一个仍停在零结果页，还看不出为什么）。因此编排层——唯一知道完整
  // 维度清单的那一层——算一次，两处都用它，`FilterFormC` 不再从它收到的 rows 去猜。
  // 保留 priceUnit：comp 稿按钮字面「清除全部条件 · 1,893 套」，1,893 正是某一个
  // 计价单位下的总数；换单位由分段控件与提示条负责，不归「清除条件」管。
  const clearAllHref = buildDropDimensionHref(
    basePath,
    currentParams,
    allDimensions
      .filter((d) => LISTING_CLEARABLE_DIMENSIONS.includes(d.dimension))
      .flatMap((d) => d.paramKeys),
  )

  const citySlug = routeMode === 'prefixed' ? city.slug : undefined

  return (
    <div className="ls-page">
      <header className="ls-container ls-head">
        <h1 className="ls-head__title">{heading}</h1>
        <p className="ls-head__sub">
          共 <span className="sf-num">{totalDocs}</span>{' '}
          {activeUnit ? (
            <>
              {copy.countNoun}按 <span className="ls-head__sub-strong">{priceUnitLabel(activeUnit)}</span> 报价
              {unpricedCount > 0 ? (
                <>
                  ，其中 <span className="sf-num">{unpricedCount}</span> {copy.countNoun}价格面议、未计入上方单位计数
                </>
              ) : null}{' '}
              · {copy.unitNote}
            </>
          ) : (
            <>{copy.countNoun}{copy.noun}</>
          )}
        </p>
      </header>

      <div className="ls-container ls-unitband">
        <PriceUnitSegment
          units={units}
          activeUnit={activeUnit}
          basePath={basePath}
          currentParams={currentParams}
          label={copy.unitRowLabel}
        />
      </div>

      <div className="ls-container ls-filterband">
        <FilterFormC
          rows={rows}
          basePath={basePath}
          currentParams={currentParams}
          totalCount={totalDocs}
          countNoun={copy.countNoun}
          clearAllHref={clearAllHref}
        />
      </div>

      <div className="ls-container ls-results">
        {isOutOfRange ? (
          <EmptyOutOfRange
            page={page}
            totalPages={totalPages}
            lastPageHref={buildPageHref(totalPages)}
            firstPageHref={buildPageHref(1)}
          />
        ) : showEmptyFiltered ? (
          <EmptyFiltered
            relaxations={relaxations}
            clearAllHref={clearAllHref}
            clearAllCount={clearAllCount}
            subjectNoun={copy.noun}
            countNoun={copy.countNoun}
          />
        ) : showEmptyNoStock ? (
          <EmptyNoStock
            noun={noStockNoun}
            totalNoun={copy.totalNoun}
            basePath={basePath}
            unfilteredTotalCount={noStockTotal}
            secondaryAction={
              <InquiryModal pageType="search" triggerLabel="提交需求" triggerVariant="primary" />
            }
          />
        ) : (
          <>
            <ResultToolbar
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              totalDocs={totalDocs}
              noun={copy.countNoun}
              sorts={sorts}
              activeSort={input.sort ?? 'recommended'}
              basePath={basePath}
              currentParams={currentParams}
              view={view}
            />
            {view === 'row' ? (
              <div className="ls-rowlist">
                {docs.map((listing) => (
                  <ListingResultRow key={listing.slug} listing={listing} citySlug={citySlug} />
                ))}
              </div>
            ) : (
              <div className="ls-grid">
                {docs.map((listing) => (
                  <ListingResultCard key={listing.slug} listing={listing} citySlug={citySlug} />
                ))}
              </div>
            )}
          </>
        )}

        {excludedUnits.length > 0 ? (
          <ExcludedUnitsBar excluded={excludedUnits} basePath={basePath} currentParams={currentParams} />
        ) : null}

        {!isOutOfRange && !isEmpty ? (
          <ListPager page={page} totalPages={totalPages} buildPageHref={buildPageHref} />
        ) : null}
      </div>

      {/*
        移动筛选：状态容器挂在页面树的固定位置、不带 key、不在会重新 suspend 的
        Suspense 边界内——「点抽屉里的选项后抽屉仍开着、底栏计数刷新」这条设计
        意图靠的就是这个位置稳定（见 MobileFilterShell.tsx 顶部注释）。
        它是 position:fixed 的移动专属控件，桌面断点由 list.css 隐藏。
      */}
      <MobileFilterShell
        rows={rows}
        basePath={basePath}
        currentQuery={currentParams.toString()}
        totalDocs={totalDocs}
        countNoun={copy.countNoun}
      />
    </div>
  )
}
