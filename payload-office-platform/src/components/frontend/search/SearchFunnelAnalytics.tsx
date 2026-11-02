'use client'

import { useEffect } from 'react'

import { parseSearchFunnelClick, SEARCH_FUNNEL_ATTR } from '@/domain/search/funnel-analytics'
import { track } from '@/lib/frontend/analytics'

/**
 * 搜索页零结果漏斗的委托监听器（OPT-126 P2）。
 *
 * 一个页面挂一个，靠冒泡接住建议词 / 兜底块的点击；读的是 `SearchZeroState`
 * 吐出的 data 属性，与 `ListClickAnalytics` 同一套做法。
 */
export default function SearchFunnelAnalytics({ city }: Readonly<{ city: string }>): null {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const el = event.target.closest<HTMLElement>(`[${SEARCH_FUNNEL_ATTR.event}]`)
      if (!el) return
      const payload = parseSearchFunnelClick(city, (name) => el.getAttribute(name))
      if (payload) track(payload.event, payload.props)
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [city])

  return null
}
