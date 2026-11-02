/**
 * 站内搜索未命中词的服务端采集编排（OPT-126 §6）。
 *
 * 端点只信 `{ city, q }`：结果数不由客户端报，而是服务端用搜索页同一组 cached 查询复核；
 * 复核确实构成缺口（zero / entity-no-supply / relaxed）才继续，再脱敏，再 upsert。
 * 依赖全部注入，路由层只管 HTTP 协议，这里可以不起库做单测。
 *
 * 返回的 outcome 是纯枚举，**不含任何查询文本**：调用方可以放心记日志、按原因计数。
 */

import {
  classifyMissKind,
  sanitizeMissTerm,
  type MissDropReason,
  type MissKind,
  type MissSkipReason,
} from '@/domain/search/miss-term'

/** 与搜索页一致的结果规模：只关心三类各有几条，以及房源是否经放宽。 */
export type SearchMissResults = Readonly<{
  counts: Readonly<{ listings: number; buildings: number; news: number }>
  relaxed: boolean
}>

export type SearchMissRow = Readonly<{
  city: string
  term: string
  missKind: MissKind
  lastResultTotal: number
}>

export type RecordSearchMissDeps = Readonly<{
  /** 公开、已开通（非 coming-soon）的城市才采集；返回规范 slug，否则 null。库里存的是它，不是请求里的原文。 */
  resolveCollectableCity: (citySlug: string) => Promise<string | null>
  /** 用搜索页同一组 cached 查询（page=1）取结果规模。 */
  loadResults: (citySlug: string, q: string) => Promise<SearchMissResults>
  upsert: (row: SearchMissRow) => Promise<void>
}>

export type SearchMissOutcome =
  | 'recorded'
  | 'unknown_city'
  | 'not_a_miss'
  | `dropped:${MissDropReason}`
  | `skipped:${MissSkipReason}`

/** 请求体里 q 的长度上限，远大于脱敏上限；超长在更早处就是无效请求。 */
export const SEARCH_MISS_MAX_Q_LENGTH = 200
const MAX_CITY_LENGTH = 64

export type SearchMissInput = Readonly<{ city: string; q: string }>

/**
 * 请求体收窄。只读 `city`、`q` 两个字符串；其他键（比如伪造的计数）一律忽略，不会被任何后续逻辑读到。
 */
export function parseSearchMissBody(body: unknown): SearchMissInput | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const { city, q } = body as Record<string, unknown>
  if (typeof city !== 'string' || typeof q !== 'string') return null
  if (city.length === 0 || city.length > MAX_CITY_LENGTH) return null
  if (q.length === 0 || q.length > SEARCH_MISS_MAX_Q_LENGTH) return null
  return { city, q }
}

export async function recordSearchMiss(
  input: SearchMissInput,
  deps: RecordSearchMissDeps,
): Promise<SearchMissOutcome> {
  const city = await deps.resolveCollectableCity(input.city)
  if (city === null) return 'unknown_city'

  const results = await deps.loadResults(city, input.q)
  const missKind = classifyMissKind(results)
  if (missKind === null) return 'not_a_miss'

  const sanitized = sanitizeMissTerm(input.q)
  if (sanitized.kind === 'drop') return `dropped:${sanitized.reason}`
  if (sanitized.kind === 'skip') return `skipped:${sanitized.reason}`

  const { listings, buildings, news } = results.counts
  await deps.upsert({
    city,
    term: sanitized.term,
    missKind,
    lastResultTotal: listings + buildings + news,
  })
  return 'recorded'
}
