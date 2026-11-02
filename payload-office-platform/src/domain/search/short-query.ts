/**
 * 单字查询判定。
 *
 * 归一化后只有一个词项且只有一个码点：`ILIKE %字%` 会命中名称里含这个字的几乎所有实体
 * （线上观测：一次返回 16439 条），没有任何检索价值。页面据此给提示而不是查库。
 *
 * 多词里带单字不算——另一个词会把结果收窄；只有「整条查询就是一个字」才拦。
 */

import type { NormalizedQuery } from './normalize'

export const MIN_QUERY_CODEPOINTS = 2

export function isTooShortQuery(query: NormalizedQuery): boolean {
  if (query.terms.length !== 1) return false
  return Array.from(query.terms[0]!.value).length < MIN_QUERY_CODEPOINTS
}
