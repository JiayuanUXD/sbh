/**
 * 站内搜索埋点的「形状」描述：只回答查询长什么样，不携带任何查询文本。
 *
 * `site_search` 不上报 q 原文（OPT-122 §9.1、OPT-126 §4）。为了在 Umami 里仍能
 * 区分零结果的形态——是一个没空格的中文长串，还是多个词；是拼音，还是数字——
 * 这里派生出两个枚举/计数量。输出里只有数字和白名单枚举，不会泄漏文本。
 */

import { normalizeSearchQuery } from './normalize'

export type QueryScript = 'cjk' | 'latin' | 'mixed' | 'digit' | 'other' | 'none'

export type QueryShape = Readonly<{
  /** 归一化后的词项数，与查询实际使用的口径一致（最多 8）。 */
  termCount: number
  /**
   * - `cjk`：只有汉字；
   * - `latin`：有拉丁字母、没有汉字（可带数字）；
   * - `digit`：只有数字；
   * - `mixed`：汉字与拉丁字母或数字并存；
   * - `other`：有字母，但既不是汉字也不是拉丁字母（假名、西里尔等）；
   * - `none`：归一化后为空。
   */
  script: QueryScript
}>

const HAN = /\p{Script=Han}/u
const LATIN = /\p{Script=Latin}/u
const DIGIT = /\p{N}/u
const LETTER = /\p{L}/u

export function describeQueryShape(raw: string): QueryShape {
  const { normalized, terms } = normalizeSearchQuery(raw)
  if (normalized.length === 0) return { termCount: 0, script: 'none' }

  const hasHan = HAN.test(normalized)
  const hasLatin = LATIN.test(normalized)
  const hasDigit = DIGIT.test(normalized)

  let script: QueryScript
  if (hasHan) {
    script = hasLatin || hasDigit ? 'mixed' : 'cjk'
  } else if (hasLatin) {
    script = 'latin'
  } else if (hasDigit && !LETTER.test(normalized)) {
    script = 'digit'
  } else {
    script = 'other'
  }

  return { termCount: terms.length, script }
}

/**
 * 楼盘有命中、但在租房源为 0：搜索本身没错，是供给侧的缺口。
 * 与 `SiteSearchView` 里「该关键词暂无在租房源，但命中了 N 个相关楼盘」同一判据。
 * 资讯命中不参与判定。
 */
export function hasEntityWithoutSupply(
  counts: Readonly<{ listings: number; buildings: number; news?: number }>,
): boolean {
  return counts.buildings > 0 && counts.listings === 0
}
