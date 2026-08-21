import Link from 'next/link'
import React from 'react'
import { buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'

/**
 * OPT-036 结果工具条（计数 + 排序 + 视图切换）—— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「计数 + 排序」区块 + specRows
 * 「排序控件 / 视图切换 / 排序·筛选权重比」。
 *
 * 权重刻意不对等（实现中不可拉平）：
 *   筛选（FilterFormC / FilterPill / PriceUnitSegment）改变结果集，是 36 高
 *   实体 pill；排序只改变同一结果集内的顺序，影响小得多，因此是 13px 纯
 *   文本、当前项 `--accent-link`/500、无背景无边框、不占一行高度——这条视觉
 *   权重差是产品判断的直接落点，不是随手的字号选择。视图切换同理放在排序
 *   末尾、用分段小图标而非另一组 pill，避免和筛选的视觉语言混淆。
 *
 * 价格排序在缺 priceUnit 时的处置（Task 8 决策，理由见任务报告）：
 *   `domain/public-catalog/search-params.ts` 的 `normalizeSort` 会在解析层把
 *   `price-asc`/`price-desc` 静默降级为 `recommended`（缺 priceUnit 时价格
 *   不可比、不可排序）。本组件不接收 priceUnit，没有依据可以自行过滤——
 *   责任落在调用方：`sorts` 数组必须是调用方已经按 priceUnit 是否存在过滤
 *   过的可用项。原因：页面传入的 `activeSort` 来自同一份
 *   `parseListingSearchInput` 算出的、已被 `normalizeSort` 处理过的值；如果
 *   本组件仍渲染「价格 ↑/↓」而调用方传的是全量 `sorts`，用户点击后 URL 变了，
 *   但下一次渲染 `activeSort` 会被降级弹回 `recommended`——一个点了没反应
 *   （甚至弹回原状）的控件比它根本不出现更误导用户。因此：无 priceUnit 时，
 *   调用方（Task 11/12）必须把这两项从 `sorts` 里剔除，而不是传全量数组
 *   指望本组件兜底——本组件确实没有 priceUnit 可判断，硬做兜底只会是猜测。
 *
 * 切排序 / 切视图都会删 `page`：换了顺序或版式还停在旧页码是无意义的位置，
 * 与 FilterFormC / PriceUnitSegment 的既有约定一致。href 基元复用
 * `lib/frontend/listing-url.ts` 的 `cloneSearchParams`/`buildHref`，不再造
 * 第三份克隆-改参数-拼 href 的实现。
 *
 * 关于 `prefetch={false}`：**本组件刻意不加**（OPT-037 Task 11c 逐个判过）。三条件
 * 并列判据（①高基数 ②内容驱动 ③常驻渲染，完整表述见 `ui/Breadcrumb.tsx`）里只有
 * ③ 成立：排序项与视图项是**硬编码枚举**，条数不随内容增长，href 也不由任何 slug
 * 决定。别因为隔壁 `FilterFormC` / `FilterPill` 有就顺手加——那两个的理由是
 * 「筛选行 × 每行 5–10 个候选值 = 几十条」（OPT-026，见
 * tests/listings-query-prefetch-performance.test.ts），本组件是个位数。
 *
 * 已实测记录（`artifacts/verification/OPT-037/task11c-prefetch-before.json`）：本组件
 * 与 `PriceUnitSegment` 合计让 `/listings` 多出 4 条查询变体预取
 * （`?sort=newest` `?view=row` `?priceUnit=` ×3 中的可切项），`/buildings` 多出 4 条
 * （`?sort=` ×3 + `?onlyWithStock=1`）。**条数恒定**，且这些恰是用户下一步最可能点的
 * 控件——预取命中率高，不是净损失。要改也该拿命中率数据另开工作项，别当成本任务的
 * 顺手清理。
 */

export type ResultToolbarSort = Readonly<{ value: string; label: string }>

/**
 * 排序 href：与 canonical 同一口径——**默认排序不写入 URL**。
 *
 * 「默认值」由调用方给定（`defaultSort`），不在这里硬编码：本组件有两个消费者，
 * 房源页默认 `recommended`（`LISTING_DEFAULT_SORT`），楼盘页默认 `stock-desc`
 * （`BUILDING_DEFAULT_SORT`）。曾经写死 `recommended`，于是在楼盘页点已经选中的
 * 「在租最多」会拼出 `?sort=stock-desc`——渲染结果一模一样、却不是
 * `buildBuildingCanonicalParams` 会输出的那个 URL，无害但让这行注释成了假话
 * （OPT-036 终审 M3）。两个默认值都从域层常量取，不在调用点写字面量。
 */
function buildSortHref(
  basePath: string,
  currentParams: URLSearchParams,
  sortValue: string,
  defaultSort: string | undefined,
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  if (sortValue === defaultSort) sp.delete('sort')
  else sp.set('sort', sortValue)
  return buildHref(basePath, sp)
}

/** 视图切换 href：grid 是默认布局，同一口径下不写入 URL；row 显式写入。 */
function buildViewHref(
  basePath: string,
  currentParams: URLSearchParams,
  view: 'grid' | 'row',
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  if (view === 'grid') sp.delete('view')
  else sp.set('view', view)
  return buildHref(basePath, sp)
}

export default function ResultToolbar(props: Readonly<{
  rangeStart: number
  rangeEnd: number
  totalDocs: number
  /**
   * 计数文案名词——如「套」（房源列表）。必填、无默认值：与 FilterFormC 的
   * `countNoun` 同一约定，组件复用不等于文案复用，见该组件顶部注释。
   */
  noun: string
  /**
   * 「共 N {totalNoun}」里的量词，缺省时与 `noun` 相同。
   *
   * 加这个 prop 是为了让楼盘页读成 comp 稿的字面「显示第 1–24 个，共 68 个楼盘」
   * ——前半句的量词是「个」，后半句要把主语说全。房源页两处本来就是同一个「套」，
   * 因此**默认等于 `noun`**：这不是 `countNoun` 那类「给了默认值就会让文案悄悄
   * 磨成通用词」的情形（默认值不是一个通用词，而是调用方刚刚显式给过的那个词），
   * 两者的缺省处置标准不同。
   */
  totalNoun?: string
  sorts: ReadonlyArray<ResultToolbarSort>
  activeSort: string
  /**
   * 该页的默认排序值——canonical 不写入 URL 的那一个，见 `buildSortHref` 注释。
   * 缺省时退回 `sorts[0].value`（两页的默认排序恰好都排在第一位），但调用方应当
   * 显式传域层常量：靠「第一项就是默认」这条约定，重排选项顺序会静默改变 href 口径。
   */
  defaultSort?: string
  basePath: string
  currentParams: URLSearchParams
  /** 省略则不渲染视图切换（如移动端固定单列，没有版式可切）。 */
  view?: 'grid' | 'row'
}>): React.JSX.Element {
  const { rangeStart, rangeEnd, totalDocs, noun, totalNoun, sorts, activeSort, defaultSort, basePath, currentParams, view } = props
  const canonicalDefaultSort = defaultSort ?? sorts[0]?.value

  return (
    <div className="ls-toolbar">
      <span className="ls-toolbar__range">
        显示第 {rangeStart}–{rangeEnd} {noun}，共 {totalDocs} {totalNoun ?? noun}
      </span>
      <span className="ls-toolbar__right">
        <span className="ls-toolbar__sortlabel">排序</span>
        {sorts.map((sort) => {
          const isActive = sort.value === activeSort
          return (
            <Link
              key={sort.value}
              href={buildSortHref(basePath, currentParams, sort.value, canonicalDefaultSort)}
              aria-current={isActive ? 'true' : undefined}
              className={isActive ? 'ls-toolbar__sort ls-toolbar__sort--active' : 'ls-toolbar__sort'}
            >
              {sort.label}
            </Link>
          )
        })}
        {view ? (
          <>
            <span className="ls-toolbar__divider" aria-hidden="true" />
            <span className="ls-toolbar__viewseg">
              <Link
                href={buildViewHref(basePath, currentParams, 'grid')}
                title="卡片网格"
                aria-label="卡片网格"
                aria-current={view === 'grid' ? 'true' : undefined}
                className={
                  view === 'grid' ? 'ls-toolbar__viewbtn ls-toolbar__viewbtn--active' : 'ls-toolbar__viewbtn'
                }
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="5.4" height="5.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="8.1" y="0.5" width="5.4" height="5.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="0.5" y="8.1" width="5.4" height="5.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="8.1" y="8.1" width="5.4" height="5.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </Link>
              <Link
                href={buildViewHref(basePath, currentParams, 'row')}
                title="横向列表"
                aria-label="横向列表"
                aria-current={view === 'row' ? 'true' : undefined}
                className={
                  view === 'row' ? 'ls-toolbar__viewbtn ls-toolbar__viewbtn--active' : 'ls-toolbar__viewbtn'
                }
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="0.5" y="1" width="13" height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="0.5" y="8.6" width="13" height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </Link>
            </span>
          </>
        ) : null}
      </span>
    </div>
  )
}
