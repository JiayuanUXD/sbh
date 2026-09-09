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
  /**
   * 结果区块，用于区分同一页里不同的呈现：
   *   - `grid`   网格卡（房源页 `?view=grid`、楼盘页有在租组的网格）
   *   - `row`    用户选中的横排版式（`?view=row`，两页同义）
   *   - `vacant` 楼盘页「暂无在租」组的降权紧凑行——**不是**用户选的版式，
   *              它恒定渲染成紧凑行，不随 `?view=` 改变
   *
   * `vacant` 是 OPT-081 加的。在此之前楼盘页那一组发的是 `row`，当时不冲突
   * （楼盘页没有版式切换）；加上切换之后，有在租组在 row 版式下也要发 `row`，
   * 两者会在同一页撞成同一个取值，这个维度就失去了它存在的理由。
   * **口径变更**：`building_result_click` 的 `section='row'` 在 OPT-081 之前
   * 指「暂无在租紧凑行」，之后指「用户选中的横排卡」，两段数据不可直接合并。
   */
  section: 'grid' | 'row' | 'vacant'
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

export const LIST_SECTIONS = ['grid', 'row', 'vacant'] as const

/**
 * 取值域守卫。**这是 fail-closed 的闸门**：`ListClickAnalytics` 用它判断整条点击
 * 事件报不报（不是「丢一个字段」，是整条丢），所以新增取值时必须同步改这里，
 * 否则新版式的点击会在生产环境静默消失、且没有日志。
 * 用 `LIST_SECTIONS` 推导而不是再写一遍字面量，正是为了不给「改了枚举忘了改守卫」
 * 留缝——原先两处各写一份，是同一事实的两个源。
 */
export function isListSection(value: string | undefined): value is (typeof LIST_SECTIONS)[number] {
  return LIST_SECTIONS.includes(value as (typeof LIST_SECTIONS)[number])
}
