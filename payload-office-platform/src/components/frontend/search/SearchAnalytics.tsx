'use client'

import { useEffect, useRef } from 'react'

import { track } from '@/lib/frontend/analytics'

/**
 * 站内搜索埋点。
 *
 * 不上报 q 原文——搜索词是用户输入，按仓库既有口径只报长度与派生结果。
 * 去重键用 q 的轻量 hash + tab + page：同一状态下重复渲染不重复上报，
 * 不同关键词即使结果数相同也不会被误判成重复。
 */
function hashQuery(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

export default function SearchAnalytics({
  city,
  q,
  tab,
  page,
  counts,
  relaxed,
}: Readonly<{
  city: string
  q: string
  tab: string
  page: number
  counts: Readonly<{ listings: number; buildings: number; news: number }>
  relaxed: boolean
}>) {
  const lastKeyRef = useRef<string | null>(null)
  const total = counts.listings + counts.buildings + counts.news

  useEffect(() => {
    const key = [hashQuery(q), tab, page].join('|')
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key

    track('site_search', {
      city,
      q_length: q.length,
      tab,
      page,
      result_total: total,
      result_listings: counts.listings,
      result_buildings: counts.buildings,
      result_news: counts.news,
      zero_result: total === 0,
      relaxed,
    })
  }, [city, q, tab, page, counts.listings, counts.buildings, counts.news, total, relaxed])

  return null
}
