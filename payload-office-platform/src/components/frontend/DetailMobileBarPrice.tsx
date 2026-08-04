'use client'

import { useEffect, useState } from 'react'

/**
 * 移动端底部栏价格（F-016）
 *
 * 底部栏是滚动全程常驻的，而页内价格只在首屏；两者同屏时价格上下出现两次。
 * 这里只在页内价格滚出视口后才显示底部栏价格：首屏保持单一价格焦点，滚动后
 * 用户依然能看到价格再决定询价。
 *
 * 守护不变量：
 *   - 默认显示（含 SSR、无 JS、找不到页内价格元素），只有观察器确认页内价格
 *     在视口内时才隐藏：宁可重复也不能让价格消失；
 *   - 只观察，不写任何布局属性，避免抖动；
 *   - 观察器在卸载时断开。
 */
export default function DetailMobileBarPrice({
  rentText,
  anchorSelector = '.detail__rent',
}: Readonly<{ rentText: string; anchorSelector?: string }>) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const anchor = document.querySelector(anchorSelector)
    if (!anchor) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [anchorSelector])

  if (!visible) return null
  return <span className="detail__mobile-bar-rent">{rentText}</span>
}
