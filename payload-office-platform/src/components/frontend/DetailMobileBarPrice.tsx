'use client'

import { useAnchorVisibility } from '@/lib/frontend/use-anchor-visibility'

/**
 * 移动端底部栏价格（F-016）
 *
 * 底部栏是滚动全程常驻的，而页内价格只在首屏；两者同屏时价格上下出现两次。
 * 这里只在页内价格滚出视口后才显示底部栏价格：首屏保持单一价格焦点，滚动后
 * 用户依然能看到价格再决定询价。
 *
 * 守护不变量：
 *   - 默认显示（含 SSR、无 JS、找不到页内价格元素），只有观察器确认页内价格
 *     在视口内时才隐藏：宁可重复也不能让价格消失（`defaultVisible: true`，
 *     与 OPT-037 `StickyInquiryBar` 故意相反的默认值——那边宁可缺一个入口
 *     也不要常驻重叠，这里宁可重复也不要价格消失，两个组件面对的风险不同，
 *     默认值不该被强行统一）；
 *   - 观察 + 翻转 + 断开的样板本身收敛进 `useAnchorVisibility`
 *     （`src/lib/frontend/use-anchor-visibility.ts`）——本组件与
 *     `StickyInquiryBar` 曾经各自内联一份逐字节相同的 IntersectionObserver
 *     代码，是同一段判断逻辑存在多处，与两者渲染层/断点/锚点不同是两回事；
 *   - 只观察，不写任何布局属性，避免抖动。
 */
export default function DetailMobileBarPrice({
  rentText,
  anchorSelector = '.detail__rent',
}: Readonly<{ rentText: string; anchorSelector?: string }>) {
  const visible = useAnchorVisibility(anchorSelector, {
    defaultVisible: true,
    mapVisible: (isIntersecting) => !isIntersecting,
  })

  if (!visible) return null
  return <span className="detail__mobile-bar-rent">{rentText}</span>
}
