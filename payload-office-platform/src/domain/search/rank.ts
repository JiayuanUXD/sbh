/**
 * 站内搜索的命中打分。
 *
 * 只做「同一个词在哪个字段命中、命中得有多完整」，不做 BM25 / 语义排序。
 * 分数只决定 `/search` 内部的顺序，不改变命中集合（命中集合仍由 SQL 的
 * `ILIKE` 决定）。跨实体不统一打分——房源、楼盘、资讯各自分区展示。
 *
 * 单字段取最高分而不是叠加：一条房源同时命中标题与楼盘名，不应该比
 * 「标题完全等于关键词」更相关；叠加会让长字段（标题+楼盘+区+地铁）天然
 * 压过精确命中。
 */

export type MatchFields = Readonly<{
  title?: string | null
  buildingName?: string | null
  districtName?: string | null
  metroName?: string | null
}>

type WeightTier = readonly [exact: number, prefix: number, contains: number]

const WEIGHTS: Readonly<Record<keyof MatchFields, WeightTier>> = {
  title: [100, 80, 60],
  buildingName: [90, 70, 50],
  districtName: [40, 35, 30],
  metroName: [35, 30, 25],
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function scoreField(value: string | null | undefined, needle: string, weights: WeightTier): number {
  if (!value) return 0
  const haystack = normalize(value)
  if (haystack === needle) return weights[0]
  if (haystack.startsWith(needle)) return weights[1]
  if (haystack.includes(needle)) return weights[2]
  return 0
}

/** 单词得分：各字段取最高分。 */
export function scoreListingMatch(fields: MatchFields, term: string): number {
  const needle = normalize(term).trim()
  if (needle.length === 0) return 0
  let best = 0
  for (const key of Object.keys(WEIGHTS) as (keyof MatchFields)[]) {
    const score = scoreField(fields[key], needle, WEIGHTS[key])
    if (score > best) best = score
  }
  return best
}

/** 多词得分：逐词取最高分后累加；`matched` 是命中词数。 */
export function scoreListingMatchAll(
  fields: MatchFields,
  terms: readonly string[],
): Readonly<{ score: number; matched: number }> {
  let score = 0
  let matched = 0
  for (const term of terms) {
    const termScore = scoreListingMatch(fields, term)
    if (termScore > 0) {
      score += termScore
      matched += 1
    }
  }
  return { score, matched }
}
