'use client'

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { HomepageStats } from '@/domain/public-catalog/contracts'

type StatItem = Readonly<{ value: number; decimals: 0 | 1; unit: string; label: string }>

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}
function getReducedMotionServerSnapshot() {
  return false
}

/**
 * OPT-035 数据带：白底满宽 padding 56，进入视口 30% 触发 1100ms easeOutCubic 数字滚动。
 * 值为 0 的格不渲染；可渲染格 < 2 时整段不渲染（不展示空货架）。
 * prefers-reduced-motion 时直接显示终值、不跑 rAF 循环。
 *
 * 用 useSyncExternalStore 读取 matchMedia，而不是在 useEffect 里同步 setState：
 * 后者会触发 react-hooks/set-state-in-effect（级联渲染），前者是 React 为订阅
 * 浏览器外部状态设计的正规写法，SSR 用 getServerSnapshot 兜底避免 hydration 不一致，
 * 客户端首次提交前就能拿到真实值——比原先"挂载后 effect 里再纠正"更早生效。
 */
export default function HomeStatsBand({ stats, avgResponseHours }: Readonly<{
  stats: HomepageStats
  avgResponseHours: number | null
}>) {
  const items: StatItem[] = [
    { value: stats.listings, decimals: 0 as const, unit: '套', label: '在租房源' },
    { value: stats.buildings, decimals: 0 as const, unit: '个', label: '收录楼盘' },
    { value: stats.businessAreas, decimals: 0 as const, unit: '个', label: '覆盖商圈' },
    ...(avgResponseHours != null ? [{ value: avgResponseHours, decimals: 1 as const, unit: '小时', label: '平均响应' }] : []),
  ].filter((item) => item.value > 0)

  const ref = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  )
  const displayProgress = prefersReducedMotion ? 1 : progress

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion) return
    let cancelled = false
    let rafId = 0
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      const start = performance.now()
      const tick = (now: number) => {
        if (cancelled) return
        const t = Math.min(1, (now - start) / 1100)
        setProgress(1 - (1 - t) ** 3) // easeOutCubic
        if (t < 1) rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    }, { threshold: 0.3 })
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [prefersReducedMotion])

  if (items.length < 2) return null
  return (
    <div className="hm-band hm-stats">
      <div className="hm-container hm-stats__grid" ref={ref}
        style={{ '--hm-stats-cols': items.length } as React.CSSProperties}>
        {items.map((item) => (
          <div className="hm-stat" key={item.label}>
            <span className="hm-stat__row">
              <span className="hm-stat__value hm-num">
                {item.decimals ? (item.value * displayProgress).toFixed(1)
                  : Math.round(item.value * displayProgress).toLocaleString('en-US')}
              </span>
              <span className="hm-stat__unit">{item.unit}</span>
            </span>
            <span className="hm-stat__label">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
