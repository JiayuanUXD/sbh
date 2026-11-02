'use client'

import { useEffect, useRef } from 'react'

import { describeQueryShape, hasEntityWithoutSupply } from '@/domain/search/analytics-shape'
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
  suggested,
  tooShort,
  intentApplied,
}: Readonly<{
  city: string
  q: string
  tab: string
  page: number
  counts: Readonly<{ listings: number; buildings: number; news: number }>
  relaxed: boolean
  /** 本次渲染是否展示了「你是不是想找」；由编排层按实际渲染条件算好传入。 */
  suggested: boolean
  /** 单字查询：没有查库，零结果口径里要排除。 */
  tooShort: boolean
  /** 查询里识别出了类目 / 面积意图，并已转成房源筛选。 */
  intentApplied: boolean
}>) {
  const lastKeyRef = useRef<string | null>(null)
  const total = counts.listings + counts.buildings + counts.news

  useEffect(() => {
    const key = [hashQuery(q), tab, page].join('|')
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key

    const shape = describeQueryShape(q)

    track('site_search', {
      city,
      q_length: q.length,
      tab,
      page,
      result_total: total,
      result_listings: counts.listings,
      result_buildings: counts.buildings,
      result_news: counts.news,
      zero_result: total === 0 && !tooShort,
      relaxed,
      term_count: shape.termCount,
      script: shape.script,
      entity_hit: hasEntityWithoutSupply({ listings: counts.listings, buildings: counts.buildings }),
      suggested,
      too_short: tooShort,
      intent_applied: intentApplied,
    })
  }, [city, q, tab, page, counts.listings, counts.buildings, counts.news, total, relaxed, suggested, tooShort, intentApplied])

  return null
}
