import Link from 'next/link'
import React from 'react'

/**
 * 面包屑原语
 *
 * 设计依据：specs/frontend-mvp/design.md §14.2；FP-03 §4
 * 守护不变量：
 *   - 语义化 <nav aria-label="面包屑"> + <ol>；
 *   - 当前页用 aria-current="page"；
 *   - 分隔符对屏幕阅读器隐藏。
 */

export type BreadcrumbItem = {
  label: string
  href?: string
}

type Props = {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumb({ items, className }: Props) {
  if (items.length === 0) return null
  return (
    <nav aria-label="面包屑" className={['breadcrumb', className ?? ''].filter(Boolean).join(' ')}>
      <ol>
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={i} className="breadcrumb__item">
              {item.href && !isLast ? (
                <Link href={item.href} className="breadcrumb__link">
                  {item.label}
                </Link>
              ) : (
                <span className="breadcrumb__current" aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span className="breadcrumb__separator" aria-hidden="true">
                  /
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
