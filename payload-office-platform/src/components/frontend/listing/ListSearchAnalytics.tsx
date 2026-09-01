'use client'

import { useEffect, useRef } from 'react'

import { track } from '@/lib/frontend/analytics'

/**
 * 列表页结果呈现事件（OPT-064）。
 *
 * 由服务端组件把「这一次搜索到底是什么」当 props 传下来——结果数、排序、
 * 生效筛选项个数、页码——客户端只负责去重上报。
 *
 * ## 去重口径
 *
 * 键 = 全部 props 的序列化值，等价于 spec 里说的「pathname + 规范化后的
 * 筛选/排序/页码 query」：翻页、改排序、改筛选都产生新键 → 算新事件；
 * 浏览器后退回到同一状态命中旧键 → 不重报。
 *
 * 用 ref 而不是 state：这里只需要「和上次比一下」，不需要触发重渲染。
 */
export default function ListSearchAnalytics(
  props: Readonly<{
    event: 'listing_search' | 'building_search'
    city: string
    resultCount: number
    sort: string
    /** 已生效的筛选维度个数（整数 ≥0），不是比率 */
    filterCompleteness: number
    pageIndex: number
    /** 仅房源列表页有价格单位；楼盘页不传 */
    priceUnit?: string
  }>,
): null {
  const { event, city, resultCount, sort, filterCompleteness, pageIndex, priceUnit } = props
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const key = [event, city, resultCount, sort, filterCompleteness, pageIndex, priceUnit ?? ''].join('|')
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key

    track(event, {
      city,
      result_count: resultCount,
      sort,
      filter_completeness: filterCompleteness,
      page_index: pageIndex,
      ...(priceUnit ? { price_unit: priceUnit } : {}),
    })
  }, [event, city, resultCount, sort, filterCompleteness, pageIndex, priceUnit])

  return null
}
