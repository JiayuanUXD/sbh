'use client'

import { useEffect, useState } from 'react'

/**
 * 观察一个锚点元素是否与视口相交，据此驱动一个显隐开关。
 *
 * 抽取理由（第 7 次撞见同一模式后的收敛）：`DetailMobileBarPrice` 与
 * `StickyInquiryBar` 各自内联过一份逐字节相同的 `IntersectionObserver`
 * 样板——观察一个 `querySelector` 选中的锚点、`threshold:0`、翻转一个
 * `visible` state、卸载时 `disconnect()`。两个组件在渲染层完全不同
 * （不同断点、不同锚点、甚至故意相反的默认可见性），这些差异全部保留在
 * 各自组件里；本 hook 只收敛"观察 + 翻转 + 断开"这段与业务无关的样板本身。
 *
 * 守护不变量：
 *   - 找不到锚点（`querySelector` 返回 null）时不订阅，直接保持初始值；
 *   - `threshold:0`——锚点只要还有 1px 与视口相交就算"可见"，调用方据此
 *     决定 `visible` 该映射成"显示"还是"隐藏"（见 `mapVisible`）；
 *   - 卸载 / 选择器变化时断开观察器，不残留。
 */
export function useAnchorVisibility(
  anchorSelector: string,
  options: Readonly<{
    /** 找不到锚点、或锚点尚未挂载时的初始值。 */
    defaultVisible: boolean
    /**
     * 把"锚点当前是否与视口相交"映射成这个 hook 要返回的 `visible`。
     * 两个调用方对同一个原始信号的语义相反：
     *   - DetailMobileBarPrice：锚点（首屏价格）不相交时才要显示底栏价格
     *     → `(isIntersecting) => !isIntersecting`；
     *   - StickyInquiryBar：决策卡不相交（离屏）时才要显示吸附条
     *     → 同样是 `(isIntersecting) => !isIntersecting`，但语义上是各自
     *     独立做出的选择，不是共享同一个判断——因此保留为参数而非写死。
     */
    mapVisible: (isIntersecting: boolean) => boolean
  }>,
): boolean {
  const { defaultVisible, mapVisible } = options
  const [visible, setVisible] = useState(defaultVisible)

  useEffect(() => {
    const anchor = document.querySelector(anchorSelector)
    if (!anchor) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(mapVisible(entry.isIntersecting)),
      { threshold: 0 },
    )
    observer.observe(anchor)
    return () => observer.disconnect()
    // mapVisible 是调用方常量闭包，随渲染重建但语义不变（两处调用方都是
    // `(isIntersecting) => !isIntersecting` 字面量）；纳入依赖会在每次渲染
    // 重建 observer，无收益且抖动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorSelector])

  return visible
}
