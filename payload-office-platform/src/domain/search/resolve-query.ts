/**
 * 站内搜索的「查询解析」：先抽意图（类目 / 面积），再把剩余文字交给 L1 归一化。
 *
 * 路由层与取数层必须用同一个入口，否则页面上的「单字」判断、取数里的筛选条件会各算一遍、
 * 渐渐对不上（真实风险：单字拦截在路由、意图在取数，两边的 rest 不一致就会把「整层」当单字拦掉）。
 */

import { extractSearchIntent, type SearchIntent } from './intent'
import { normalizeSearchQuery, type NormalizedQuery } from './normalize'

export type ResolvedSiteSearchQuery = Readonly<{
  intent: SearchIntent
  /** 去掉意图片段后的文字归一化结果。 */
  normalized: NormalizedQuery
  /** 意图里是否带了房源筛选（类型 / 面积）。 */
  hasFilters: boolean
}>

const NO_INTENT = (rest: string): SearchIntent => ({ rest, labels: [] })

export function resolveSiteSearchQuery(rawQuery: string, useIntent = true): ResolvedSiteSearchQuery {
  const intent = useIntent ? extractSearchIntent(rawQuery) : NO_INTENT(rawQuery)
  const hasFilters =
    (intent.listingType?.length ?? 0) > 0 || intent.areaMin !== undefined || intent.areaMax !== undefined
  return { intent, normalized: normalizeSearchQuery(intent.rest), hasFilters }
}
