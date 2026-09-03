import Link from 'next/link'
import React from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/frontend/ui/icons'

/**
 * 语义化分页组件（F3.5）
 *
 * 设计依据：specs/frontend-mvp/design.md §7.4、§14.2
 *           Page PRD: FP-02 §6
 *
 * 守护不变量：
 *   - 使用 <nav aria-label="分页"> + 语义化 <a>（非按钮）；
 *   - 当前页用 aria-current="page"，禁用其链接；
 *   - 越界页（page > totalPages）不显示为可点击，仅显示当前/总数；
 *   - URL 切换通过 Link prefetch=false，避免预取越界页；
 *   - 移动端紧凑布局：仅显示上一页/下一页 + 当前页/总页数。
 */

type Props = {
  /** 当前页（已 clamp 到 [1, totalPages]） */
  page: number
  totalPages: number
  /** 总文档数（用于显示「共 N 套」） */
  totalDocs: number
  /** 构造某页的 URL（基于当前 canonical 派生） */
  buildPageHref: (page: number) => string
}

/** 紧凑页码序列：当前页 ±2，首尾固定，省略号占位 */
function buildPageSequence(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const seq: (number | 'ellipsis')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) seq.push('ellipsis')
  for (let i = start; i <= end; i++) seq.push(i)
  if (end < total - 1) seq.push('ellipsis')
  seq.push(total)
  return seq
}

export default function Pagination({ page, totalPages, totalDocs, buildPageHref }: Props) {
  if (totalPages <= 1) return null

  const sequence = buildPageSequence(page, totalPages)
  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <nav className="pager" aria-label="分页">
      <Link
        href={buildPageHref(Math.max(1, page - 1))}
        className={`pager__link ${!hasPrev ? 'pager__link--disabled' : ''}`}
        aria-disabled={!hasPrev}
        aria-label="上一页"
        prefetch={false}
      >
        <ChevronLeftIcon size={14} /> 上一页
      </Link>

      <ol className="pager__pages">
        {sequence.map((item, i) =>
          typeof item === 'number' ? (
            <li key={i}>
              {item === page ? (
                <span className="pager__current" aria-current="page">
                  {item}
                </span>
              ) : (
                <Link
                  href={buildPageHref(item)}
                  className="pager__link"
                  aria-label={`第 ${item} 页`}
                  prefetch={false}
                >
                  {item}
                </Link>
              )}
            </li>
          ) : (
            <li key={i} className="pager__ellipsis" aria-hidden="true">
              …
            </li>
          ),
        )}
      </ol>

      <Link
        href={buildPageHref(Math.min(totalPages, page + 1))}
        className={`pager__link ${!hasNext ? 'pager__link--disabled' : ''}`}
        aria-disabled={!hasNext}
        aria-label="下一页"
        prefetch={false}
      >
        下一页 <ChevronRightIcon size={14} />
      </Link>

      <span className="pager__count" aria-live="polite">
        共 {totalDocs} 套
      </span>
    </nav>
  )
}
