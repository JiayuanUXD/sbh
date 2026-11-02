import { classifyMissKind, sanitizeMissTerm } from '@/domain/search/miss-term'

export const SEARCH_MISS_ENDPOINT = '/api/search-misses'

export type SearchMissBeaconInput = Readonly<{
  city: string
  q: string
  page: number
  counts: Readonly<{ listings: number; buildings: number; news: number }>
  relaxed: boolean
}>

/**
 * 客户端预判：这次渲染要不要发 beacon，发什么。
 *
 * 只是减流量与减少敏感内容离开浏览器——手机号、邮箱这类输入客户端就不发了。
 * 真正的闸门在服务端（复核结果数 + 同一个脱敏函数），这里放过的东西服务端一样会再判一遍。
 * 请求体永远只有 `{ city, q }`，不带任何客户端算出来的计数。
 */
export function planSearchMissBeacon(
  input: SearchMissBeaconInput,
): Readonly<{ body: { city: string; q: string }; dedupeKey: string }> | null {
  if (input.page !== 1) return null
  if (classifyMissKind({ counts: input.counts, relaxed: input.relaxed }) === null) return null
  if (sanitizeMissTerm(input.q).kind !== 'keep') return null
  return {
    body: { city: input.city, q: input.q },
    dedupeKey: `sbh:search-miss:${input.city}:${input.q}`,
  }
}
