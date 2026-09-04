import { NavLink } from '@/components/frontend/listing/ListingNavigation'
import React from 'react'

/**
 * OPT-036 分页 —— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「分页」区块 + specRows
 * 「分页」：页码 36×36 · 当前项底 `--ink` 文字白 · 每页 24 · 写入 `?page=`。
 *
 * 页码窗口策略（Task 8 自定，brief 要求写明规则）：
 *   `totalPages <= FULL_THRESHOLD`（7，与 comp 稿 7 页 fixture 全展开、无省略
 *   号一致）时平铺展示全部页码。超过阈值时改为「首尾常驻（1 与
 *   totalPages）+ 当前页左右各 1 个邻域 + 缺口处插入省略号」：
 *   `[1, page-1, page, page+1, totalPages]` 去重排序后，相邻页码间出现空隙
 *   （差值 > 1）就插入一个省略号。这保证无论 totalPages 多大，实际渲染的
 *   页码数量都有界——最多 5 个数字（首、邻域 3 个、尾）+ 至多 2 个省略号，
 *   不随 totalPages 线性增长（totalPages=99 时不会渲染出上百个页码）。
 *
 * 关于 `prefetch={false}`：**本组件刻意不加**（OPT-037 Task 11c 逐个判过）。
 * 关停判据是三条件并列——①高基数 ②内容驱动 ③常驻渲染，见 `ui/Breadcrumb.tsx`
 * 的完整表述。本组件 ③ 成立，①② 都不成立：
 *   - ①：上面那套窗口算法的全部意义就是**把链接数钉死在有界区间**（最多 5 个
 *     数字 + 2 个省略号 + 上/下一页），与结果集大小无关。这正是「高基数」的反面；
 *   - ②：href 是 `?page=N` 的查询变体，不由任何内容 slug 决定。
 * 也不要拿 `components/frontend/Pagination.tsx`「已经加了」当理由照抄——那份的
 * 注释写的是「避免预取越界页」，而本组件的 `buildPageWindow` 结构上就产不出越界
 * 页码，那条理由在这里根本不成立。**统一的是判据，不是取值。**
 */

const FULL_THRESHOLD = 7
const NEIGHBOR = 1

function buildPageWindow(page: number, totalPages: number): ReadonlyArray<number | 'ellipsis'> {
  if (totalPages <= FULL_THRESHOLD) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const core: number[] = []
  for (let p = Math.max(2, page - NEIGHBOR); p <= Math.min(totalPages - 1, page + NEIGHBOR); p++) {
    core.push(p)
  }
  const withEnds = Array.from(new Set([1, ...core, totalPages])).sort((a, b) => a - b)

  const result: (number | 'ellipsis')[] = []
  let prev: number | undefined
  for (const p of withEnds) {
    if (prev !== undefined && p - prev > 1) result.push('ellipsis')
    result.push(p)
    prev = p
  }
  return result
}

export default function ListPager(props: Readonly<{
  page: number
  totalPages: number
  buildPageHref: (page: number) => string
}>): React.JSX.Element | null {
  const { page, totalPages, buildPageHref } = props
  if (totalPages <= 1) return null

  const items = buildPageWindow(page, totalPages)
  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <nav className="ls-pager" aria-label="分页">
      <div className="ls-pager__row">
        {hasPrev ? (
          <NavLink href={buildPageHref(page - 1)} className="ls-pager__edge">上一页</NavLink>
        ) : (
          <span className="ls-pager__edge ls-pager__edge--disabled">上一页</span>
        )}
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className="ls-pager__ellipsis" aria-hidden="true">…</span>
          ) : item === page ? (
            <span key={item} className="ls-pager__item ls-pager__item--active" aria-current="page">
              {item}
            </span>
          ) : (
            <NavLink key={item} href={buildPageHref(item)} className="ls-pager__item">
              {item}
            </NavLink>
          ),
        )}
        {hasNext ? (
          <NavLink href={buildPageHref(page + 1)} className="ls-pager__edge">下一页</NavLink>
        ) : (
          <span className="ls-pager__edge ls-pager__edge--disabled">下一页</span>
        )}
      </div>
      <span className="ls-pager__hint">共 {totalPages} 页 · 页码写入 ?page=，可直接分享当前这一页结果</span>
    </nav>
  )
}
