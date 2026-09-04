import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import BuildingCompactRow from '@/components/frontend/listing/BuildingCompactRow'
import ListClickAnalytics from '@/components/frontend/listing/ListClickAnalytics'
import ListSearchAnalytics from '@/components/frontend/listing/ListSearchAnalytics'
import BuildingResultCard from '@/components/frontend/listing/BuildingResultCard'
import EmptyFiltered, { type Relaxation } from '@/components/frontend/listing/EmptyFiltered'
import EmptyNoStock from '@/components/frontend/listing/EmptyNoStock'
import EmptyOutOfRange from '@/components/frontend/listing/EmptyOutOfRange'
import FilterFormC, { rowShowsActivePick, type FilterSwitch } from '@/components/frontend/listing/FilterFormC'
import ListPager from '@/components/frontend/listing/ListPager'
import { ListingNavigationProvider, PendingRegion } from '@/components/frontend/listing/ListingNavigation'
import MobileFilterShell from '@/components/frontend/listing/MobileFilterShell'
import ResultToolbar, { type ResultToolbarSort } from '@/components/frontend/listing/ResultToolbar'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import {
  BUILDING_CLEARABLE_DIMENSIONS,
  BUILDING_DEFAULT_SORT,
  buildBuildingCanonicalParams,
  type BuildingSearchInput,
} from '@/domain/public-catalog'
import type { getCachedSearchBuildingsFiltered } from '@/lib/frontend/cached-queries'
import { buildBuildingFilterRows } from '@/lib/frontend/building-filter-rows'
import { buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'

type BuildingsResult = Awaited<ReturnType<typeof getCachedSearchBuildingsFiltered>>

/**
 * OPT-036 楼盘列表页编排层。
 *
 * 设计依据：docs/SBH设计任务讨论/楼盘列表.dc.html。组合顺序照 comp：
 * 页头 → 筛选条 C（6 行，末行是「仅看有在租」开关 pill）→ 结果工具条 →
 * 有在租组（4 列卡片网格）→ 分组标题 → 暂无在租组（两列紧凑行）→ 分页。
 *
 * 本文件只做编排：把 DTO 投影成各组件的 props、构造 href、按条件选分支。
 * **不做任何筛选、排序、分页、分组**——那些全在 `searchBuildingsFiltered`
 * 里（旧版本在本组件内 `.filter().slice()`，于是「有在租在前」这条规则一旦
 * 在这里实现，就会和查询层的分页各算各的）。视觉规格在组件与 `styles/list.css`。
 *
 * ## 与房源列表页（CityListingsView）刻意相同 / 不同的地方
 *
 * 相同：URL 唯一事实源、`CHANNEL_COPY` 式集中文案表、clearAllHref 由本层算一次
 * 供多处共用、移动筛选状态容器挂在结果区之外。
 *
 * 不同：
 *   - **没有计价单位分段与被排除单位提示条**：楼盘本身没有报价（报价属于楼内
 *     各房源），这一页不存在「三种不可换算单位」的问题。
 *   - **没有视图切换（`?view=`）**：comp 楼盘稿里布局 B（横向行）是与卡片网格
 *     二选一的**结果布局**，而这一页的横向紧凑行已经被用作「暂无在租」组的降权
 *     表达（182 : 64 的高度反差就是降权本身）。再给用户一个把有在租组也切成
 *     横向行的开关，会让两组的高度反差消失、分组语义随之失效。
 *   - **多了「有在租 / 暂无在租」两组**，分页作用于合并后的序列。
 */

/**
 * 本页集中文案表（同 `CityListingsView.CHANNEL_COPY` 的角色）。
 *
 * 各组件的 `countNoun` / `totalNoun` / `subjectNoun` 一律从这里取值，调用点不写
 * 字面量——「套」是房源的量词，楼盘页必须是「个楼盘」（Task 6 控制器裁定）。
 */
const COPY = {
  /** 结果主语，用于空态②标题「当前筛选组合下没有符合条件的楼盘」。 */
  subject: '楼盘',
  /** 计数量词：「68 个楼盘符合条件」「查看 68 个楼盘」。 */
  countNoun: '个楼盘',
  /** 工具条前半句量词：「显示第 1–24 个」（后半句用 countNoun 把主语说全）。 */
  rangeNoun: '个',
  /** 空态①主按钮量词短语：「查看全部 1,206 个楼盘」。 */
  totalNoun: '个楼盘',
} as const

/**
 * 排序项（comp specRows「排序项」：在租最多（默认）· 在租面积 · 等级 · 竣工最新）。
 *
 * 四项全部恒定可用——与房源页价格排序不同，这里没有「缺某个前置条件就会被
 * `normalizeSort` 静默降级」的项，因此不需要按条件剔除（那条硬要求的目的是
 * 不渲染点了没反应的死控件，四项在任何 URL 下都真的会改变顺序）。
 */
const SORTS: readonly ResultToolbarSort[] = [
  { value: 'stock-desc', label: '在租最多' },
  { value: 'area-desc', label: '在租面积' },
  { value: 'grade', label: '等级' },
  { value: 'completion-desc', label: '竣工最新' },
]

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

export default function CityBuildingsView({ city, result, input, basePath, routeMode }: Readonly<{
  city: CityContext
  result: BuildingsResult
  /** 已解析的搜索输入（路由层 `parseBuildingSearchInput` 的产物），URL 的唯一事实源。 */
  input: BuildingSearchInput
  basePath: string
  routeMode: 'legacy' | 'prefixed'
}>) {
  const heading = routeMode === 'legacy' ? '找写字楼' : `${city.name}写字楼`
  const {
    groups,
    totalDocs,
    withStockTotal,
    withoutStockTotal,
    unfilteredTotalDocs,
    page,
    totalPages,
    facets,
    dimensionHits,
  } = result

  const { rows, dimensions } = buildBuildingFilterRows({ input, facets })
  const activeDimensions = dimensions.filter((d) => d.activeText != null)
  const hasActiveFilters = activeDimensions.length > 0

  // ── URL ─────────────────────────────────────────────────────────────────
  // 页内每一个 href 都从这一份 canonical 克隆而来，不存在只活在内存里的筛选态。
  const currentParams = buildBuildingCanonicalParams(input)

  const buildPageHref = (targetPage: number) => {
    const params = cloneSearchParams(currentParams)
    if (targetPage <= 1) params.delete('page')
    else params.set('page', String(targetPage))
    return buildHref(basePath, params)
  }

  // 「仅看有在租」开关：开→关 与 关→开 是同一个 href（切到另一个状态），
  // 与其它筛选项同一口径删 page。计数是「打开之后会剩多少个」，即 withStockTotal。
  const switchHref = (() => {
    const sp = cloneSearchParams(currentParams)
    sp.delete('page')
    if (input.onlyWithStock) sp.delete('onlyWithStock')
    else sp.set('onlyWithStock', '1')
    return buildHref(basePath, sp)
  })()
  const switchRow: FilterSwitch = {
    label: '在租状态',
    optionLabel: '仅看有在租',
    href: switchHref,
    active: input.onlyWithStock === true,
    paramKey: 'onlyWithStock',
    ...(withStockTotal > 0 ? { count: withStockTotal } : {}),
    // 分母是「不看这个开关时有多少个」（comp 抽屉字面「26 / 68 个」），因此取
    // dimensionHits.onlyWithStock 而不是 totalDocs——开关已经打开时 totalDocs
    // 就是分子本身，会印出「5 / 5 个」这种自证的废话。
    subLabel: `${withStockTotal} / ${dimensionHits.onlyWithStock} 个`,
  }

  // 「清除全部」只有一个口径，本层算一次、**三个出口共用**：筛选条底栏、空态②、
  // 移动抽屉的「重置」。这三处在用户眼里是同一件事，作用域一旦不同就是同名不同义
  // （房源页 Task 11 的 I2 是前两个，Task 12 审查的 I1 是第三个——抽屉原先按
  // rows.key 自己推导，一行一个键，漏掉了「在租面积」维度的 leasableAreaMax）。
  // 谁需要这个语义就传谁这个值，不要在消费者那一侧再推导一次。
  const clearAllHref = buildDropDimensionHref(
    basePath,
    currentParams,
    dimensions
      .filter((d) => BUILDING_CLEARABLE_DIMENSIONS.includes(d.dimension))
      .flatMap((d) => d.paramKeys),
  )

  // 生效了但没有任何一行能显示出来的条件（如只写了 `leasableAreaMax`——那一行
  // 建模的是下限）。不补这些 chip 的话，底栏会出现「清除全部」却看不到清的是
  // 什么；补上之后每一个生效条件都可见、可单独清除。
  // 逐**键**而不是逐维度：一个维度可能只有一半被行显示出来（在租面积行只建模
  // 下限），补 chip 时要只说也只清没被显示的那一半，否则会并排出现一个 chip
  // 和它的超集 chip。没有逐键文案时（单键维度）退回整个维度的文案与作用域。
  // 判据必须与 FilterFormC 渲染 chip 时用的**同一个**：`activeValue != null` 不够
  // ——数值型维度的解析层接受的取值域比预设档位宽（`?leasableAreaMin=750` 合法
  // 但不等于任何一档），那种值不会渲染出行 chip，却会被 `activeValue != null`
  // 误判成「已经显示了」而跳过补充 chip，三处一起把生效中的条件藏起来。
  const rowActiveKeys = new Set(rows.filter(rowShowsActivePick).map((row) => row.key))
  if (switchRow.active) rowActiveKeys.add(switchRow.paramKey)
  const extraPicks = activeDimensions.flatMap((d) => {
    const hidden = d.paramKeys.filter((key) => currentParams.has(key) && !rowActiveKeys.has(key))
    if (hidden.length === 0) return []
    if (d.paramTexts == null) {
      return [{
        key: d.dimension,
        label: `${d.label}：${d.activeText}`,
        href: buildDropDimensionHref(basePath, currentParams, d.paramKeys),
      }]
    }
    return hidden.map((key) => ({
      key,
      label: `${d.label}：${d.paramTexts?.[key] ?? d.activeText}`,
      href: buildDropDimensionHref(basePath, currentParams, [key]),
    }))
  })

  // ── 状态判定 ─────────────────────────────────────────────────────────────
  const isOutOfRange = page > totalPages && totalDocs > 0
  const isEmpty = totalDocs === 0
  // 有筛选 → 空态②（条件收得太紧，逐条给退路）；无筛选 → 空态①（这个城市还没有
  // 收录楼盘）。楼盘页六个维度全是收窄型，没有房源页那种「只挑了类目」的中间态。
  const showEmptyFiltered = isEmpty && hasActiveFilters
  const showEmptyNoStock = isEmpty && !hasActiveFilters

  const relaxations: readonly Relaxation[] = activeDimensions.map((d) => ({
    label: `取消「${d.label}：${d.activeText}」这一个条件`,
    hitCount: dimensionHits[d.dimension],
    href: buildDropDimensionHref(basePath, currentParams, d.paramKeys),
  }))

  const rangeStart = totalDocs > 0 ? (page - 1) * input.pageSize + 1 : 0
  const rangeEnd = Math.min(page * input.pageSize, totalDocs)
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined

  return (
    // OPT-068：与房源列表同一套导航反馈（被点项 spinner + 结果区压暗）。
    <ListingNavigationProvider>
    <div className="ls-page">
      {/* OPT-064 列表页埋点，两者都不渲染 UI（同 CityListingsView） */}
      <ListSearchAnalytics
        event="building_search"
        city={city.slug}
        stateKey={currentParams.toString()}
        resultCount={totalDocs}
        sort={input.sort}
        filterCompleteness={activeDimensions.length}
        pageIndex={page}
      />
      <ListClickAnalytics />
      <header className="ls-container ls-head">
        <h1 className="ls-head__title">{heading}</h1>
        <p className="ls-head__sub">
          收录 <span className="sf-num">{unfilteredTotalDocs}</span> {COPY.countNoun}
          {hasActiveFilters ? (
            <>
              {' '}· 当前筛选出 <span className="ls-head__sub-strong sf-num">{totalDocs}</span> 个
            </>
          ) : null}
          {withStockTotal > 0 ? (
            <>
              ，其中 <span className="sf-num">{withStockTotal}</span> 个现在有在租房源
            </>
          ) : null}
        </p>
      </header>

      <div className="ls-container ls-filterband">
        <FilterFormC
          rows={rows}
          basePath={basePath}
          currentParams={currentParams}
          totalCount={totalDocs}
          countNoun={COPY.countNoun}
          clearAllHref={clearAllHref}
          switchRow={switchRow}
          extraPicks={extraPicks}
        />
      </div>

      <PendingRegion className="ls-container ls-results">
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
            clearAllCount={unfilteredTotalDocs}
            subjectNoun={COPY.subject}
            countNoun={COPY.countNoun}
          />
        ) : showEmptyNoStock ? (
          <EmptyNoStock
            noun={routeMode === 'legacy' ? '写字楼' : `${city.name}写字楼`}
            totalNoun={COPY.totalNoun}
            countNoun={COPY.countNoun}
            basePath={basePath}
            // 这一态的触发条件是「没有任何筛选却零结果」，此时 unfilteredTotalDocs
            // 必然也是 0，主按钮不会渲染（见 EmptyNoStock 顶部注释）——仍然把这个
            // 数传下去：它是这一层唯一知道的事实，判断该不该渲染按钮是组件的事，
            // 不是编排层按当前分支「反正是 0」把它省掉。
            unfilteredTotalCount={unfilteredTotalDocs}
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
              noun={COPY.rangeNoun}
              totalNoun={COPY.countNoun}
              sorts={SORTS}
              activeSort={input.sort}
              // 本页默认是「在租最多」，不是房源页的 recommended——组件据此决定
              // 排序 href 要不要把 sort 写进 URL（终审 M3）。取域层常量而非字面量。
              defaultSort={BUILDING_DEFAULT_SORT}
              basePath={basePath}
              currentParams={currentParams}
            />

            {/* 有在租组：完整卡片网格。分组标题只在两组同时存在时才有意义——
                只有一组时它是一句废话，还会把「暂无在租」这个降权信号提前
                喊出来（comp 的分组标题成对出现）。 */}
            {groups.withStock.length > 0 ? (
              <>
                {groups.withoutStock.length > 0 ? (
                  <div className="bd-group">
                    <span className="bd-group__title">当前有在租</span>
                    <span className="bd-group__count sf-num">{withStockTotal} 个</span>
                  </div>
                ) : null}
                <div className="ls-grid">
                  {groups.withStock.map((building, index) => (
                    <BuildingResultCard
                      key={building.slug}
                      building={building}
                      citySlug={citySlug}
                      analytics={{
                        event: 'building_result_click',
                        city: building.citySlug,
                        rank: index + 1,
                        pageIndex: page,
                        section: 'grid',
                        buildingId: building.id,
                      }}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {/* 暂无在租组（方案 A：降权分组 + 换紧凑行）。楼盘本身是内容，不能像
                空货架那样隐藏；靠 182 : 64 的高度反差降权，不靠灰度（楼名仍是
                满墨 15/600，见 BuildingCompactRow.tsx）。 */}
            {groups.withoutStock.length > 0 ? (
              <section className="bd-vacant">
                <div className="bd-group bd-group--vacant">
                  <span className="bd-group__title">暂无在租</span>
                  <span className="bd-group__count sf-num">{withoutStockTotal} 个</span>
                  <span className="bd-group__desc">
                    楼还在，只是这一刻没有可租的房源——保留资料，换一种更省地方的排法；
                    这一组不参与「在租最多 / 在租面积」排序，恒排在有在租之后
                  </span>
                </div>
                <div className="bd-vacant__list">
                  {groups.withoutStock.map((building, index) => (
                    <BuildingCompactRow
                      key={building.slug}
                      building={building}
                      citySlug={citySlug}
                      analytics={{
                        event: 'building_result_click',
                        city: building.citySlug,
                        // rank 是**页内**连续序号，不是组内序号：无在租分组渲染在
                        // withStock 之后，从 1 重新起会让同一页出现重复 rank，
                        // 位置分析直接失真（Codex review P2）。
                        rank: groups.withStock.length + index + 1,
                        pageIndex: page,
                        section: 'row',
                        buildingId: building.id,
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        {!isOutOfRange && !isEmpty ? (
          <ListPager page={page} totalPages={totalPages} buildPageHref={buildPageHref} />
        ) : null}
      </PendingRegion>

      {/*
        移动筛选：状态容器挂在页面树的固定位置、不带 key、不在会重新 suspend 的
        Suspense 边界内——「点抽屉里的选项后抽屉仍开着、底栏计数刷新」这条设计
        意图靠的就是这个位置稳定（见 MobileFilterShell.tsx 顶部注释）。
      */}
      <MobileFilterShell
        rows={rows}
        basePath={basePath}
        currentQuery={currentParams.toString()}
        totalDocs={totalDocs}
        countNoun={COPY.countNoun}
        switchRow={switchRow}
        resetHref={clearAllHref}
      />
    </div>
    </ListingNavigationProvider>
  )
}
