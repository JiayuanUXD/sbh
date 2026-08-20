'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { HomepageStats } from '@/domain/public-catalog/contracts'

type StatItem = Readonly<{ value: number; decimals: 0 | 1; unit: string; label: string }>

/**
 * OPT-035 数据带：白底满宽 padding 56，进入视口 30% 触发 1100ms easeOutCubic 数字滚动。
 * 值为 0 的格不渲染；可渲染格 < 2 时整段不渲染（不展示空货架）。
 * prefers-reduced-motion 时直接显示终值。
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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setProgress(1); return }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 1100)
        setProgress(1 - (1 - t) ** 3) // easeOutCubic
        if (t < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, { threshold: 0.3 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (items.length < 2) return null
  return (
    <div className="hm-band hm-stats">
      <div className="hm-container hm-stats__grid" ref={ref}
        style={{ '--hm-stats-cols': items.length } as React.CSSProperties}>
        {items.map((item) => (
          <div className="hm-stat" key={item.label}>
            <span className="hm-stat__row">
              <span className="hm-stat__value hm-num">
                {item.decimals ? (item.value * progress).toFixed(1)
                  : Math.round(item.value * progress).toLocaleString('en-US')}
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
