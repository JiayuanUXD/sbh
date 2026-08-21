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
 * ①高基数 ②内容驱动 ③常驻渲染。三条同时成立才关，缺一条就不关。
 *
 * ---------------------------------------------------------------------------
 * 判据①的精确表述（**本批在这一句上连错两次，改口径前先读完**）
 * ---------------------------------------------------------------------------
 * ①问的是**「这一页渲染出几条互不相同的 URL」**，
 * **不是「同一批 URL 在这一页里出现几次」**。
 *
 * 机制：Next 的路由缓存**按 URL 去重**——同一个 URL 被 N 个组件各渲染一次，
 * 也只产生 **1 次**预取。所以数①的正确姿势是：**先把 href 去重，再看去重后的条数**。
 * 数组件实例、数 `.map()` 的出现次数、把两个读同一份数据的组件相加，
 * 都会把量级算大，进而把「该不该关」判反。
 *
 * 两次真实误判（**同一个机制，两种不同表现**，OPT-037 Task 11c/11d 实测纠正）：
 *   - `BuildingSummaryCard`：它的 CTA 与同页面包屑末段是**同一个 URL**，
 *     一页去重后只有 1 条。当时误读成「这个 prop 失效了，要和列表页结果卡统一取值」，
 *     实际是①本来就不成立、根本不该加——**统一的是判据，不是取值**（11d 已撤回）。
 *   - `BuildingCardMini`：它与 `building-detail/NearbyBuildingsStrip` 读**同一份**
 *     `visibleRelatedBuildings`，曾被算成 6 + 6 = 12 条，去重后实际是 **6** 条
 *     （何况 strip 用的是原生 `<a>`，一条预取都不产生）。结论没变，量级错了一倍。
 *
 * 推论：凡是「为何不适用」的理由涉及去重的组件，一律**指回本处**，
 * 不要各写一份措辞——同义表述一多必然漂移。
 * ---------------------------------------------------------------------------
 *
 * 面包屑②③成立，**①不成立**：
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
