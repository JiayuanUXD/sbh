'use client'

import React, { forwardRef } from 'react'

/**
 * 移动筛选悬浮入口（MobileFilterTrigger）—— OPT-036 Task 10，client component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「移动 375 · 列表态」区块 +
 * specRows「移动筛选入口」：底部悬浮 pill 44 高，带条件数与实时结果数。
 *
 * 为什么必须同时带条件数与结果数：用户在打开抽屉前就该知道「我现在有几个
 * 条件、能得到多少套」——这是移动端把筛选完全收进抽屉（不像桌面形态 C 那样
 * 常驻可见）之后唯一的补偿信息，见 MobileFilterSheet.tsx 顶部「为什么是独立
 * UI」注释。`totalDocs` 由调用方（Task 11/12）每次筛选后随 Server Component
 * 重新渲染传入，天然是「实时」的——本组件不需要也不应该自己发请求或缓存旧值。
 *
 * `countNoun`：brief 给的接口只有 `activeCount / totalDocs / onOpen` 三项，
 * 没有计数名词。没有它，`{totalDocs} 套` 这句话只能硬编码「套」或写成不完整的
 * 纯数字——这正是本批次三次被否掉的「接口没给这个信息就把文案降级」之一
 * （brief 原话），因此在这里开宽接口，与桌面 `FilterFormC.countNoun` /
 * `ResultToolbar.noun` 同一约定：必填、无默认值，房源列表传「套」、楼盘列表
 * 传「个楼盘」。**Task 11/12 接线必须提供这个 prop。**
 *
 * 条件数为 0 时不显示徽标（不是显示「0」）——与 `MobileFilterSheet` 头部
 * 「已选 N 项」同一条「不显示 0」约束（brief Constraints）。
 *
 * `position: fixed` 常驻，不内置任何 `@media` 断点门槛：是否在当前视口下挂载/
 * 显示这个组件，由调用方按断点决定（本仓库既有断点惯例是 `max-width: 767px`，
 * 见 `list.css` 里各处 `@media (max-width: 767px)` 块）——本组件自己写死
 * `min-width: 768px { display:none }` 会导致 dev-story 预览页在桌面视口下
 * 模拟 375 容器演示移动态时整个不可见,拿不到真实渲染效果。
 *
 * ## 为什么是 `forwardRef`（code review 后加）
 *
 * `MobileFilterSheet` 的 `triggerRef` 是**必填**项（见该组件顶部注释「焦点
 * 管理」）：这个抽屉是移动专属组件，触摸是主要交互方式，而 iOS Safari 的
 * `<button>` 触摸激活本来就不会自动把焦点移上去（这不是「鼠标点击的边角
 * 情形」，是移动端主路径）,只靠组件内部 `document.activeElement` 捕获救不
 * 回来。调用方必须能拿到这个按钮的真实 DOM 节点传给 `MobileFilterSheet`，
 * 所以本组件用 `forwardRef` 暴露内部 `<button>`——不是可选的健壮性加固，是
 * 移动端可访问性路径能不能工作的前提。
 */
type MobileFilterTriggerProps = Readonly<{
  activeCount: number
  totalDocs: number
  countNoun: string
  onOpen: () => void
}>

const MobileFilterTrigger = forwardRef<HTMLButtonElement, MobileFilterTriggerProps>(
  function MobileFilterTrigger({ activeCount, totalDocs, countNoun, onOpen }, ref) {
    return (
      <div className="ls-mtrigger__dock">
        <button ref={ref} type="button" className="ls-mtrigger" onClick={onOpen}>
          <span>筛选</span>
          {activeCount > 0 ? <span className="ls-mtrigger__badge">{activeCount}</span> : null}
          <span className="ls-mtrigger__divider" aria-hidden="true" />
          <span className="ls-mtrigger__total">
            {totalDocs} {countNoun}
          </span>
        </button>
      </div>
    )
  },
)

export default MobileFilterTrigger
