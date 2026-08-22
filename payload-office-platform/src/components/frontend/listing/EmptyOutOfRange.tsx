import Link from 'next/link'
import React from 'react'

/**
 * OPT-036 空态 ③ · 页码越界 —— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「三种空态 · ③ 页码越界 · 是
 * 链接问题，不是货的问题」区块 + specRows「空态 ③（越界）」：不显示「没有结果」·
 * 直接给最后一页与第 1 页两个出口。
 *
 * 与①②刻意不同的含义（brief 强调）：这一态其实**有**结果，只是请求的页码
 * 超出了范围（分享的链接过期、手改了 URL 的 page 参数等）。因此本组件通篇
 * 不得出现"没有结果""没有符合条件的房源"一类措辞——那是在对一个明明有货
 * 的结果集撒谎。文案只讲"页码不存在"这一件事，然后直接给两个出口，不需要
 * 像②那样逐条给退路（页码不是筛选条件，没有"放宽"的概念）。
 *
 * `page`/`totalPages` 只用于渲染文案数字，不做校验或钳制——页码是否真的越界
 * （`page > totalPages`）由调用方在决定渲染这个组件之前判断好，`lastPageHref`/
 * `firstPageHref` 也由调用方按当前 URL 构造（与 ListPager 的 `buildPageHref`
 * 同一职责划分：本组件不持有分页 href 逻辑）。
 */
export default function EmptyOutOfRange(props: Readonly<{
  page: number
  totalPages: number
  lastPageHref: string
  firstPageHref: string
}>): React.JSX.Element {
  const { page, totalPages, lastPageHref, firstPageHref } = props

  return (
    <div className="ls-emptyrange">
      <span className="ls-emptyrange__intro">
        <span className="ls-emptyrange__title">这套筛选只有 {totalPages} 页，第 {page} 页不存在</span>
        <span className="ls-emptyrange__desc">条件和排序都还在，只是页码超出了范围。</span>
        <span className="ls-emptyrange__badge">
          page={page} → 已改写为 page={totalPages}
        </span>
      </span>
      <span className="ls-emptyrange__actions">
        <Link href={lastPageHref} className="ls-empty__btn ls-empty__btn--primary">
          去最后一页（第 {totalPages} 页）
        </Link>
        <Link href={firstPageHref} className="ls-empty__btn ls-empty__btn--secondary">回第 1 页</Link>
      </span>
    </div>
  )
}
