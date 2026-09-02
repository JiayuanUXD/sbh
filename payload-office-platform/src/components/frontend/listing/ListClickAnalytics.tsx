'use client'

import { useEffect } from 'react'

import { track } from '@/lib/frontend/analytics'
import {
  LIST_ANALYTICS_ATTR,
  isListSection,
  positiveInteger,
} from '@/components/frontend/listing/list-analytics'

/**
 * 列表页结果点击的委托监听器（OPT-064）。
 *
 * 一个页面挂一个，靠冒泡接住所有结果卡的点击——而不是给几十张卡各挂一个 onClick。
 * 与详情页的 `DetailClickAnalytics` 同构，区别只在读的 data 属性集不同。
 *
 * 所有值都过一遍白名单/正整数校验：dataset 是 DOM 里的字符串，
 * 任何一项不合规就整条不报，宁可少一条也不报脏数据。
 */
export default function ListClickAnalytics(): null {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const el = event.target.closest<HTMLElement>(`[${LIST_ANALYTICS_ATTR.event}]`)
      if (!el) return

      const eventName = el.getAttribute(LIST_ANALYTICS_ATTR.event)
      if (eventName !== 'listing_result_click' && eventName !== 'building_result_click') return

      const city = el.getAttribute(LIST_ANALYTICS_ATTR.city) ?? undefined
      const section = el.getAttribute(LIST_ANALYTICS_ATTR.section) ?? undefined
      const rank = positiveInteger(el.getAttribute(LIST_ANALYTICS_ATTR.rank) ?? undefined)
      const pageIndex = positiveInteger(el.getAttribute(LIST_ANALYTICS_ATTR.pageIndex) ?? undefined)
      if (!city || !isListSection(section) || rank === null || pageIndex === null) return

      if (eventName === 'listing_result_click') {
        const listingId = positiveInteger(el.getAttribute(LIST_ANALYTICS_ATTR.listingId) ?? undefined)
        if (listingId === null) return
        track(eventName, { city, listing_id: listingId, rank, page_index: pageIndex, section })
        return
      }

      const buildingId = positiveInteger(el.getAttribute(LIST_ANALYTICS_ATTR.buildingId) ?? undefined)
      if (buildingId === null) return
      track(eventName, { city, building_id: buildingId, rank, page_index: pageIndex, section })
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return null
}
