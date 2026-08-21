'use client'

import type { ReactNode } from 'react'
import { useAnchorVisibility } from '@/lib/frontend/use-anchor-visibility'

/**
 * 吸附询价条（OPT-037 Task 4）
 *
 * 设计依据：房源详情.dc.html specRows「吸附询价条」——sticky top 44 · 高 56 ·
 * 决策卡离屏后接管。CSS 实现用 `position:fixed`（非字面的 sticky）——见
 * detail.css `.dt-sticky-bar` 注释：本条整体挂载/卸载（不是常驻元素靠
 * CSS 显隐），挂载时必然已经越过吸附阈值，视觉上与"已吸附"的 sticky
 * 状态一致，但 fixed 不占文档流，避免了 sticky 挂载瞬间把下方内容顶下去
 * 56px、依赖浏览器 scroll anchoring 补偿的隐患（Playwright 实测发现）。
 *
 * 为什么「接管」必须靠 JS，纯 CSS 做不到：
 *   本条件在真实页面里位于文档流很靠上的位置（紧跟全局导航之后，早于核心区）。
 *   如果无条件渲染 `position:sticky; top:44`，页面刚加载、决策卡还完整可见时，
 *   它的静态位置本来就贴着 44 这条线——会立刻"粘住"，与决策卡同屏重叠，
 *   而不是等决策卡离屏才接手。守护"只能有一个在起作用"这条不变量，
 *   必须知道决策卡当前是否在视口内，而"当前是否在视口内"只有运行时能回答。
 *
 * 机制：用 IntersectionObserver 观察 `anchorSelector`（默认决策卡容器
 * `.dt-decision`），只有该锚点与视口零相交（真正离屏，不是仅仅滚出了它自己
 * 的 sticky 粘附区间）时才渲染本条。决策卡在粘附区间内是 sticky 顶住的，
 * 一直与视口相交；区间结束后它转入普通文档流继续上滚，仍然可见，直到自己的
 * 包围盒完全越过视口顶端——那一刻 isIntersecting 才变 false，吸附条同一帧
 * 挂载。两者的显示条件互斥（决策卡可见 ⇔ 吸附条隐藏），不存在"两者都可见"
 * 的重叠，也不存在中间的空窗（IntersectionObserver 的 0 阈值是同一次相交
 * 状态翻转触发，不是分两步）。
 *
 * 与 DetailMobileBarPrice（移动端底部栏价格）的分工，不合并：
 *   两者都是"避免同一价格信息重复出现在视口"的 IntersectionObserver 模式，
 *   但服务的是完全不同的两个物理机制——DetailMobileBarPrice 的宿主
 *   `.detail__mobile-bar` 是移动端固定在视口底部、贯穿全程常驻的操作栏，
 *   只是价格文字的显隐随 `.detail__rent` 滚出与否切换；本组件是桌面端
 *   顶部吸附栏，栏本身的挂载/卸载（不是栏内某个文字的显隐）由决策卡的
 *   sticky 释放点决定，且只在桌面宽度渲染（`@media (max-width:1023px)`
 *   直接 `display:none`，移动端继续用 `.detail__mobile-bar`）。断点、锚点、
 *   触发的对象层级都不同，勉强合并成一个组件只会让两条无关的判断条件绞在
 *   一起，故意保持两个文件。
 *
 * 询价入口只有一条真实逻辑：本条与决策卡的 CTA 都直接渲染调用方传入的
 * `cta`（同一个 `InquiryModal` 组件，同一份目标房源 props）——本文件不
 * 重新实现询价表单、不定义第二个提交处理函数。
 */
export default function StickyInquiryBar({
  title,
  priceText,
  priceUnit,
  summaryText,
  cta,
  anchorSelector = '.dt-decision',
}: Readonly<{
  /** 房源标题（含楼层信息） */
  title: string
  /** 价格主数字，已格式化（如 "8.50"）；无有效价格时传 null 整块隐藏 */
  priceText: string | null
  /** 价格单位（如 "元/㎡/天"） */
  priceUnit?: string
  /** 面积/月租摘要文案 */
  summaryText?: string
  /** 询价 / 预约看房触发器——与决策卡同一个 InquiryModal 实例配置，不新建逻辑 */
  cta: ReactNode
  /** 决策卡容器选择器；决策卡离屏（零相交）时本条才渲染 */
  anchorSelector?: string
}>) {
  // 默认隐藏（不同于 DetailMobileBarPrice 的默认显示）：决策卡本身已经用
  // 纯 CSS sticky 常驻可见，无 JS（SSR / JS 加载失败）时用户仍能从决策卡
  // 完成询价，不会因为本条缺席而彻底失去入口；反过来如果默认显示，无 JS
  // 时它会从页面顶部就贴住，与决策卡长期重叠，比"缺一个入口"更糟。
  //
  // 观察 + 翻转 + 断开的样板收敛进 useAnchorVisibility（与 DetailMobileBarPrice
  // 共用同一个 hook，见 src/lib/frontend/use-anchor-visibility.ts 文件头注释）；
  // defaultVisible/mapVisible/anchorSelector 三处仍各自决定，两个组件的渲染层、
  // 断点、默认可见性完全独立，收敛的只是观察器样板本身。
  const visible = useAnchorVisibility(anchorSelector, {
    defaultVisible: false,
    mapVisible: (isIntersecting) => !isIntersecting,
  })

  if (!visible) return null

  return (
    <div className="dt-sticky-bar" role="region" aria-label="询价操作栏">
      <div className="dt-container dt-sticky-bar__inner">
        <span className="dt-sticky-bar__title">{title}</span>
        {priceText != null && (
          <span className="dt-sticky-bar__price">
            <span className="dt-sticky-bar__price-num">{priceText}</span>
            {priceUnit && <span className="dt-sticky-bar__price-unit">{priceUnit}</span>}
          </span>
        )}
        {summaryText && <span className="dt-sticky-bar__summary">{summaryText}</span>}
        <div className="dt-sticky-bar__cta">{cta}</div>
      </div>
    </div>
  )
}
