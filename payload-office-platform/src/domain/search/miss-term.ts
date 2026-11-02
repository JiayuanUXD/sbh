/**
 * 站内搜索「未命中词」的脱敏与分类（OPT-126 §4、§5）。
 *
 * 这是整条采集链路里唯一决定「哪些文本可以落库」的地方，所以刻意写成纯函数：
 *   - `sanitizeMissTerm`：原始输入 → 可存的归一化词，或「丢弃（带原因）/ 不采（带原因）」；
 *   - `classifyMissKind`：三类结果数 + 是否放宽 → 未命中类型，不构成缺口则 `null`。
 *
 * 存的词一律是 `normalizeSearchQuery().normalized`，**从不存原始输入**。
 * 被丢弃的输入只返回原因枚举，调用方只能按原因计数，拿不到任何文本。
 */

import { normalizeSearchQuery } from './normalize'

export const MISS_KINDS = ['zero', 'entity-no-supply', 'relaxed'] as const
export type MissKind = (typeof MISS_KINDS)[number]

/** 命中隐私规则而被丢弃：计数，不存文本。 */
export type MissDropReason = 'contact' | 'digits' | 'too_long'
/** 不构成有价值的词：不采，也不当作隐私丢弃计数。 */
export type MissSkipReason = 'empty' | 'too_short'

export type SanitizeMissTermResult =
  | Readonly<{ kind: 'keep'; term: string }>
  | Readonly<{ kind: 'drop'; reason: MissDropReason }>
  | Readonly<{ kind: 'skip'; reason: MissSkipReason }>

/** 归一化后允许的最大码点数；超过视为整句 / 粘贴内容。 */
export const MISS_TERM_MAX_LENGTH = 20
/** 归一化后至少要有的码点数；单字是噪音。 */
export const MISS_TERM_MIN_LENGTH = 2

/**
 * 常见域名后缀。后面不能紧跟字母，否则 `a.company` 会被 `.co` 误伤。
 * 没有穷举：目的是挡住「把网址 / 邮箱当关键词搜」，不是做域名识别。
 */
const DOMAIN_SUFFIX = /\.(?:com|cn|net|org|io|cc|top|xyz|info|biz|co|me|tv|vip|app|dev|edu|gov)(?![a-z])/

/** 连续 6 位及以上数字：手机号、证件号、订单号。 */
const LONG_DIGIT_RUN = /\d{6,}/
/**
 * 空格 / 连字符分段的数字（`138 1234 5678`、`021-12345678`）：合计 8 位及以上。
 * 归一化会把连字符变成空格，所以必须在归一化**之前**的原文上判。
 * 阈值取 8 而不是 6，是为了放过 `100-200平` 这类面积区间。
 */
const SEGMENTED_DIGITS = /\d(?:[\s-]*\d){7,}/

/** 句号的全角 / 半角变体，统一成 `.` 再判域名后缀（`baidu。com`）。 */
const DOT_VARIANTS = /[。．｡]/g

function isContactLike(folded: string): boolean {
  return (
    folded.includes('@')
    || folded.includes('http')
    || folded.includes('www.')
    || DOMAIN_SUFFIX.test(folded.replace(DOT_VARIANTS, '.'))
  )
}

export function sanitizeMissTerm(raw: string): SanitizeMissTermResult {
  const { normalized } = normalizeSearchQuery(raw)
  if (normalized.length === 0) return { kind: 'skip', reason: 'empty' }

  // 联系方式与数字规则要在「标点已被抹掉」之前判：`@`、`.`、`-` 归一化后都没了。
  const folded = raw.normalize('NFKC').toLowerCase()
  if (isContactLike(folded)) return { kind: 'drop', reason: 'contact' }
  if (LONG_DIGIT_RUN.test(folded) || SEGMENTED_DIGITS.test(folded)) {
    return { kind: 'drop', reason: 'digits' }
  }

  const length = Array.from(normalized).length
  if (length > MISS_TERM_MAX_LENGTH) return { kind: 'drop', reason: 'too_long' }
  if (length < MISS_TERM_MIN_LENGTH) return { kind: 'skip', reason: 'too_short' }
  return { kind: 'keep', term: normalized }
}

export type MissClassificationInput = Readonly<{
  counts: Readonly<{ listings: number; buildings: number; news: number }>
  /** 房源是否经放宽（去掉最后一个词 / 改 OR）后才有结果。 */
  relaxed: boolean
}>

/**
 * 未命中类型。判据与页面上用户实际看到的一致：
 *   - `zero`：房源 / 楼盘 / 资讯三类全 0，即「零结果页」；
 *   - `entity-no-supply`：楼盘有命中、在租房源为 0（SiteSearchView 的「暂无在租房源」分支），
 *     资讯命中不参与；
 *   - `relaxed`：房源是放宽后才有的。
 * 只有资讯命中，或正常命中，都不是房源 / 楼盘侧的缺口，返回 `null`。
 */
export function classifyMissKind(input: MissClassificationInput): MissKind | null {
  const { listings, buildings, news } = input.counts
  if (listings + buildings + news === 0) return 'zero'
  if (buildings > 0 && listings === 0) return 'entity-no-supply'
  if (input.relaxed && listings > 0) return 'relaxed'
  return null
}
