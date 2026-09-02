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
 * 键 = `stateKey`（服务端传来的规范化 query）+ 事件名 + 城市。
 *
 * ⚠️ **不能只用结果类 props 拼键**。初版就是那么写的（result_count / sort /
 * filter_completeness / page_index），Codex review 指出了反例：切到另一个区，
 * 结果数同样是 10、生效筛选数同样是 1、排序页码都没变——键完全相同，
 * 于是第二次搜索被当成重复静默丢掉。**派生的结果属性不等价于导航状态**。
 *
 * `stateKey` 由服务端的 `buildCanonicalSearchParams(input)` 产出，
 * 是真正的「规范化后的筛选/排序/页码 query」，两个不同的区必然得到不同的串。
 *
 * 用 ref 而不是 state：只需要「和上次比一下」，不需要触发重渲染。
 */
export default function ListSearchAnalytics(
  props: Readonly<{
    event: 'listing_search' | 'building_search'
    city: string
    /**
     * 规范化后的搜索状态串（服务端 `buildCanonicalSearchParams(input).toString()`）。
     * 只用于去重，不进上报属性——它含筛选原文，属于不该采集的内容。
     */
    stateKey: string
    resultCount: number
    sort: string
    /** 已生效的筛选维度个数（整数 ≥0），不是比率 */
    filterCompleteness: number
    pageIndex: number
    /** 仅房源列表页有价格单位；楼盘页不传 */
    priceUnit?: string
  }>,
): null {
  const { event, city, stateKey, resultCount, sort, filterCompleteness, pageIndex, priceUnit } = props
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // 只用导航状态做键；结果类属性是它的函数，掺进来既冗余又给不出额外区分度
    const key = [event, city, stateKey].join('|')
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
  }, [event, city, stateKey, resultCount, sort, filterCompleteness, pageIndex, priceUnit])

  return null
}
