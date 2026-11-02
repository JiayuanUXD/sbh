'use client'

import { useEffect } from 'react'

import { planSearchMissBeacon, SEARCH_MISS_ENDPOINT } from '@/lib/search-miss/beacon-plan'

/**
 * 站内搜索「未命中词」采集信标（OPT-126 P1）。
 *
 * 与 SearchAnalytics 刻意分开：那个组件只往 Umami 报**不含文本**的字段，
 * 这里的文本只发给自有端点 /api/search-misses，进自有表，永远不进 Umami。
 * 不要把两者合并，也不要在这里接入埋点管道。
 *
 * 只发 `{ city, q }`，由服务端复核结果数并脱敏；page=1 且本会话同 city+q 只发一次。
 * 失败一律静默：采集不能影响搜索页。
 */
export default function SearchMissBeacon({
  city,
  q,
  page,
  counts,
  relaxed,
}: Readonly<{
  city: string
  q: string
  page: number
  counts: Readonly<{ listings: number; buildings: number; news: number }>
  relaxed: boolean
}>) {
  const { listings, buildings, news } = counts

  useEffect(() => {
    const plan = planSearchMissBeacon({
      city,
      q,
      page,
      counts: { listings, buildings, news },
      relaxed,
    })
    if (!plan) return

    try {
      if (window.sessionStorage.getItem(plan.dedupeKey) !== null) return
      // 先占位再发：即使 beacon 失败也不重试，宁可少记。
      window.sessionStorage.setItem(plan.dedupeKey, '1')
    } catch {
      // sessionStorage 不可用（隐私模式等）：无法跨渲染去重，宁可不采。
      return
    }

    try {
      if (typeof navigator.sendBeacon !== 'function') return
      navigator.sendBeacon(
        SEARCH_MISS_ENDPOINT,
        new Blob([JSON.stringify(plan.body)], { type: 'application/json' }),
      )
    } catch {
      // 静默。
    }
  }, [city, q, page, listings, buildings, news, relaxed])

  return null
}
