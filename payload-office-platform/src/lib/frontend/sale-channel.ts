/**
 * 出售频道的可见性口径（单一真源）
 *
 * 出售房源在起步期数量很少。一个长期挂 0 结果的频道会拖低站点整体质量评分，也
 * 浪费抓取预算。解决办法是运营开关而不是砍功能——URL 与组件先占住结构，等房源
 * 量上来自动放开。
 *
 * 关键约束：**noindex 与 sitemap 必须同口径**。给页面打 noindex 却仍把它推进
 * sitemap 是自相矛盾的信号（「别收录」+「快来收录」），搜索引擎照样会抓，
 * noindex 的降噪作用被抵消。所以两处都调用这里的同一个函数，而不是各写各的判断。
 */

/**
 * 出售频道是否应进入索引。
 *
 * @param effectiveListingCount 该城市当前的有效出售房源数
 */
export function shouldIndexSaleChannel(effectiveListingCount: number): boolean {
  return Number.isFinite(effectiveListingCount) && effectiveListingCount > 0
}

/**
 * 出售频道是否应出现在 sitemap 中。
 *
 * 与 `shouldIndexSaleChannel` 是同一判断，刻意写成两个具名函数而不是让调用方
 * 直接比较数字：两处语义不同（一个控制 robots meta、一个控制 sitemap 条目），
 * 但必须永远一致。将来若要分化（例如 sitemap 更保守），改这里即可，调用点不动。
 */
export function shouldListSaleChannelInSitemap(effectiveListingCount: number): boolean {
  return shouldIndexSaleChannel(effectiveListingCount)
}

/** 出售频道路由。集中在此，避免各处硬编码字符串拼接。 */
export function saleChannelPath(citySlug?: string): string {
  return citySlug ? `/${citySlug}/sale` : '/sale'
}
