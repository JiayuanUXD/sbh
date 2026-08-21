'use client'

import React, { useMemo, useRef, useState } from 'react'
import { countActivePicks, type FilterRow, type FilterSwitch } from './FilterFormC'
import MobileFilterSheet from './MobileFilterSheet'
import MobileFilterTrigger from './MobileFilterTrigger'

/**
 * 移动筛选抽屉与悬浮入口的**状态容器**（OPT-036 Task 11 接线层）。
 *
 * 为什么必须单独存在这一层，而不是让 `CityListingsView` 直接渲染两个组件：
 * `MobileFilterTrigger` / `MobileFilterSheet` 的开合是真实 `useState`，而
 * `CityListingsView` 是 Server Component，不能持有 state；同时两者必须共享
 * 同一个 `open` 与同一个触发按钮 `ref`（`MobileFilterSheet.triggerRef` 必填，
 * 见该组件顶部「焦点管理」注释：iOS Safari 触摸激活 `<button>` 不会自动移动
 * 焦点，这是移动端主路径而非边角情形）。
 *
 * ## 「点选项抽屉仍开着」这条不变量落在这里（Task 10 ★ 硬要求 6）
 *
 * 抽屉里的筛选项是导航 `<Link>`：点击立即改 URL、删 `page`，但**不调用
 * `onClose`**——comp 允许一次勾选多个分组再统一看结果。这条设计意图能否成立，
 * 取决于本组件在路由变化前后是不是**同一个 React 实例、挂在树里同一个位置**：
 *
 *   - `CityListingsView` 渲染它时**不能带随 `searchParams` 变化的 `key`**；
 *   - 它**不能被套进会因 `searchParams` 变化而重新 suspend 的 `<Suspense>`**
 *     边界里（`(frontend)/layout.tsx` 目前只在 `AnalyticsInit` 外面有一个
 *     Suspense，列表页链路上没有 `loading.tsx`，因此这条当前成立）。
 *
 * 两者任一被破坏，React 都会卸载再重建本组件，`open` 被重置为初始值 `false`，
 * 表现为「每选一个条件抽屉就关一次」——不会报错，只在真机上体验极差。
 * 根节点上的 `data-mobile-filter-shell` 就是给端到端验证用的稳定锚点：导航
 * 前后应当是同一个 DOM 节点实例（卸载后立刻用相同 props 重挂，视觉上与「没关」
 * 一模一样，只看「抽屉还在屏幕上」测不出这个 bug）。
 *
 * ## 为什么 `currentQuery` 是字符串而不是 `URLSearchParams`
 *
 * 两个子组件的 `currentParams` 形参类型是 `URLSearchParams`，但本组件是
 * 跨 RSC 边界的 client 组件——`URLSearchParams` 不是可序列化的普通对象，
 * 从 Server Component 直接传会在渲染时抛错。因此接线层传规范化后的查询串，
 * 由本组件在客户端还原成 `URLSearchParams`。`useMemo` 只为避免每次渲染重建，
 * 与状态无关。
 */
export default function MobileFilterShell(props: Readonly<{
  rows: readonly FilterRow[]
  basePath: string
  /** 规范化查询串（`URLSearchParams.toString()` 的结果），见上方序列化说明。 */
  currentQuery: string
  totalDocs: number
  /** 计数名词，从调用方的 `CHANNEL_COPY` 取值（租「套」/售「套」/楼盘「个楼盘」）。 */
  countNoun: string
  /** 开关型筛选行（楼盘页「仅看有在租」），原样透传给抽屉；省略则抽屉不渲染这一段。 */
  switchRow?: FilterSwitch
  /**
   * 抽屉两个「重置」的目标地址，原样透传。**必须与编排层交给
   * `FilterFormC.clearAllHref` / `EmptyFiltered.clearAllHref` 的是同一个值**
   * ——三个出口同义就必须同址，理由见 `MobileFilterSheet.resetHref` 注释。
   */
  resetHref: string
}>): React.JSX.Element {
  const { rows, basePath, currentQuery, totalDocs, countNoun, switchRow, resetHref } = props
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const currentParams = useMemo(() => new URLSearchParams(currentQuery), [currentQuery])
  // 徽标数与抽屉头部的「已选 N 项」共用 `countActivePicks` 这一个口径，不在这里
  // 自己数一遍。曾经这里写的是 `activeValue != null` 逐行累加，与抽屉的判据分叉在
  // 两个方向上（少了 `visibleRows` 过滤、且用了更宽松的判据），于是 375 下
  // `?areaMin=750`（楼盘页 `?leasableAreaMin=750`）会出现底栏徽标写 1、抽屉头部
  // 的「已选 N 项」却是空的——正是本注释上一版警告过的那种自相矛盾，只不过发生在
  // 行判据而不是开关上（OPT-036 终审 I1）。开关本身仍然算一个条件，由该函数负责。
  const activeCount = countActivePicks(rows, switchRow)

  return (
    <div className="ls-mobilefilter" data-mobile-filter-shell data-open={open ? 'true' : 'false'}>
      <MobileFilterTrigger
        ref={triggerRef}
        activeCount={activeCount}
        totalDocs={totalDocs}
        countNoun={countNoun}
        onOpen={() => setOpen(true)}
      />
      <MobileFilterSheet
        rows={rows}
        open={open}
        onClose={() => setOpen(false)}
        basePath={basePath}
        currentParams={currentParams}
        totalDocs={totalDocs}
        countNoun={countNoun}
        triggerRef={triggerRef}
        resetHref={resetHref}
        {...(switchRow ? { switchRow } : {})}
      />
    </div>
  )
}
