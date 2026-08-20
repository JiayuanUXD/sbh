import React from 'react'
import type { HomepageStats } from '@/domain/public-catalog/contracts'

type StatItem = Readonly<{ value: number; decimals: 0 | 1; unit: string; label: string }>

/**
 * OPT-035 数据带：白底满宽 padding 56 · 数字 48/600/1.08 tabular-nums。
 * 值为 0 的格不渲染；可渲染格 < 2 时整段不渲染（不展示空货架）。
 *
 * **与设计稿的有意偏差：不做「数字滚动」。**
 * 设计稿落地数值表列了「进入视口 30% 触发 · 1100ms · easeOutCubic」，但任何
 * 「从 0 滚到真值」的实现都必然在某些路径下把真实库存渲染成 0：
 *   - SSR / 首帧 / 禁用 JS：动画进度恒为初始值；
 *   - IntersectionObserver 未触发（整页截图、爬虫、用户从不滚到该段）：永久停在起点；
 *   - 动画进行中的任意一帧本身就是错的数值。
 * 而设计系统硬约束是「数值缺失显示 —，**不显示 0**」，北极星是「这家的数据是真的」。
 * 一次真实事故已经证明这条冲突会直接输出「0 套在租房源」。
 * 因此这里让数字在任何路径下都是服务端算出的真值，动效让位于正确性——
 * 设计稿是静态稿，它的数字是写死的文本，不承担这个矛盾。
 *
 * 纯展示、无状态，故为 Server Component（无 'use client'）。
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

  if (items.length < 2) return null
  return (
    <div className="hm-band hm-stats">
      <div className="hm-container hm-stats__grid"
        style={{ '--hm-stats-cols': items.length } as React.CSSProperties}>
        {items.map((item) => (
          <div className="hm-stat" key={item.label}>
            <span className="hm-stat__row">
              <span className="hm-stat__value sf-num">
                {item.decimals ? item.value.toFixed(1) : item.value.toLocaleString('en-US')}
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
