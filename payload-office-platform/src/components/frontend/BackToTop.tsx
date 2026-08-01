'use client'

import { useEffect, useState } from 'react'

/**
 * 返回顶部按钮
 *
 * 设计依据：评审 P4-B。详情页长页面导航辅助，滚动超过一屏后出现，
 * 点击平滑滚动回顶部。对标 58 商办详情页右下角返回顶部按钮。
 *
 * 守护不变量：
 *   - 客户端组件，纯交互
 *   - 滚动阈值 400px（约一屏）后才显示，避免首屏干扰
 *   - 尊重 prefers-reduced-motion
 *   - 固定定位，不遮挡移动端底部咨询栏（bottom 偏移避开）
 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const threshold = 400
    const onScroll = () => setVisible(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      className="back-to-top"
      aria-label="返回顶部"
      onClick={() => {
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  )
}
