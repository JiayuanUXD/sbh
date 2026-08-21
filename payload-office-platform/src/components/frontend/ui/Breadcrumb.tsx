import Link from 'next/link'
import React from 'react'

/**
 * 面包屑原语
 *
 * 设计依据：specs/frontend-mvp/design.md §14.2；FP-03 §4
 * 守护不变量：
 *   - 语义化 <nav aria-label="面包屑"> + <ol>；
 *   - 当前页用 aria-current="page"；
 *   - 分隔符对屏幕阅读器隐藏；
 *   - **链接保持默认预取（不加 `prefetch={false}`）**，见下方判据。
 *
 * 关于 `prefetch={false}`：本仓库的关停判据是**三个条件并列**——
 * ①高基数（一次渲染出大量互不相同的 URL）②内容驱动 ③常驻渲染。
 * 三条同时成立才关，缺一条就不关。面包屑②③成立，**①不成立**：
 *   - 楼盘详情页只产出 2 个链接（`/` 与 `/listings`），全站每页同样这两个；
 *   - 房源详情页产出 3 个，多出的那个是本房源所属楼盘（每页仅 1 条）；
 *   - Next 的路由缓存按 URL 去重，所以全站面包屑的预取成本几乎不随页面数增长。
 * 对照 `ListingCard`：列表页一屏就是几十个互不相同的 URL 同时进视口，那才是
 * 高基数。而「从详情页退回列表页 / 退回所属楼盘」恰是最高频的导航路径——
 * 给它加延迟换不来任何预取预算节省，是净损失。
 * （OPT-037 Task 11 曾一刀切加上，Task 11b 按此判据回退。**不要「为了统一」
 * 再加回来**——统一的是判据，不是取值。）
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
