/**
 * 列表页埋点的 data-* 契约（OPT-064）
 *
 * 卡片组件本身不 import 埋点模块——它们只吐 data 属性，由页面级的一个委托监听器
 * 统一读取。这样做的原因和 `DetailClickAnalytics` 一样：
 *
 *   - 结果页一屏几十张卡，逐张挂 onClick 就是几十个监听器
 *   - 卡片可以继续作为服务端组件渲染，不必为了埋点整体转成 'use client'
 *
 * 只放公开 ID 与固定枚举，不放标题、URL、筛选原文——`assertSafeAnalyticsProps`
 * 的 PII 键名正则会拦下后者，但更根本的是这些值本来就不该进采集。
 */

export type ListAnalyticsEvent = 'listing_result_click' | 'building_result_click'

/** 结果卡在列表中的位置与身份。`rank` 是**页内 1 基序号**，跨页靠 pageIndex 区分。 */
export interface ListResultAnalytics {
  event: ListAnalyticsEvent
  city: string
  rank: number
  pageIndex: number
  /** 结果区块：网格视图 / 行视图，用于区分同一页的两种呈现 */
  section: 'grid' | 'row'
  listingId?: number
  buildingId?: number
}

/** data-* 属性名集中在这里，监听器和生产方共用，避免两边各写一份字符串。 */
export const LIST_ANALYTICS_ATTR = {
  event: 'data-list-analytics-event',
  city: 'data-analytics-city',
  rank: 'data-analytics-rank',
  pageIndex: 'data-analytics-page-index',
  section: 'data-analytics-section',
  listingId: 'data-analytics-listing-id',
  buildingId: 'data-analytics-building-id',
} as const

/**
 * 展开成可直接 spread 到元素上的 data-* 属性。
 *
 * 传 undefined 时返回空对象——卡片在非列表场景（详情页推荐位等）复用时不带埋点，
 * 与 `ListingCard` 的 `detailAnalytics` 同一套约定。
 */
export function listAnalyticsAttrs(
  analytics: ListResultAnalytics | undefined,
): Record<string, string | number> {
  if (!analytics) return {}
  const attrs: Record<string, string | number> = {
    [LIST_ANALYTICS_ATTR.event]: analytics.event,
    [LIST_ANALYTICS_ATTR.city]: analytics.city,
    [LIST_ANALYTICS_ATTR.rank]: analytics.rank,
    [LIST_ANALYTICS_ATTR.pageIndex]: analytics.pageIndex,
    [LIST_ANALYTICS_ATTR.section]: analytics.section,
  }
  if (analytics.listingId !== undefined) {
    attrs[LIST_ANALYTICS_ATTR.listingId] = analytics.listingId
  }
  if (analytics.buildingId !== undefined) {
    attrs[LIST_ANALYTICS_ATTR.buildingId] = analytics.buildingId
  }
  return attrs
}

/** 正整数解析：非正整数一律当作缺失，宁可不报也不报脏数据。 */
export function positiveInteger(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export const LIST_SECTIONS = ['grid', 'row'] as const

export function isListSection(value: string | undefined): value is 'grid' | 'row' {
  return value === 'grid' || value === 'row'
}
