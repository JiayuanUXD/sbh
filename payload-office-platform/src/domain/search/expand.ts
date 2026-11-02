/**
 * 把 L1 词项按 L2 词表扩展成「查询词 + 楼盘 id」。
 *
 * ASCII 词项做完整扩展（拼音/首字母/英文别名）；中文词项原样保留，让现有
 * `ILIKE` 去匹配标题与楼盘名——中文前缀（如「上海」）不应该被替换成某一个
 * 具体楼盘名，否则会把结果收窄成单栋楼。
 *
 * 唯一的例外：中文词项**整词恰好等于某个别名**（且不是任何实体的名称）时换成规范名。
 * 运营在后台加的「小陆」→「陆家嘴」就是这种：别名不含在规范名里，原样 `ILIKE` 永远搜不到。
 * 4 字及以上的别名在分词阶段（segment.ts）已经处理，这里补 2–3 字的。
 *
 * 一个拼音命中多个实体时，查询只取排序第一的实体，但 `resolved` 保留全部，
 * 供「你是不是想找」展示消歧；不静默跨城由词表本身（按城市构建）保证。
 */

import {
  nameKey,
  resolveVocabularyTerm,
  type SearchVocabulary,
  type VocabularyEntry,
} from './vocabulary'

export type ExpandedQuery = Readonly<{
  /** 查询层按 AND 使用的词项；ASCII 词项已替换成解析后的中文实体名。 */
  listingTerms: readonly string[]
  /** 解析到的楼盘 id，供 SQL 直接下推。 */
  buildingIds: readonly number[]
  /** 全部候选（含歧义项），供建议/零结果页展示。 */
  resolved: readonly VocabularyEntry[]
}>

const ASCII_TERM = /^[A-Za-z0-9]+$/

/** 中文词项整词等于别名（不是名称、也不是前缀）时的候选；否则空数组。 */
function resolveChineseAlias(vocab: SearchVocabulary, term: string): readonly VocabularyEntry[] {
  const key = nameKey(term)
  const matches = resolveVocabularyTerm(vocab, term)
  if (matches.length === 0) return []
  const isAliasOnly = matches.every(
    (entry) => nameKey(entry.name) !== key && entry.aliases.some((alias) => nameKey(alias) === key),
  )
  return isAliasOnly ? matches : []
}

export function expandSearchTerms(
  terms: readonly string[],
  vocab: SearchVocabulary,
): ExpandedQuery {
  const listingTerms: string[] = []
  const buildingIds: number[] = []
  const resolved: VocabularyEntry[] = []
  const seenTerms = new Set<string>()
  const seenBuildings = new Set<number>()
  const seenEntries = new Set<string>()

  const pushTerm = (value: string) => {
    if (seenTerms.has(value)) return
    seenTerms.add(value)
    listingTerms.push(value)
  }

  const pushResolved = (entry: VocabularyEntry) => {
    const key = `${entry.kind}:${String(entry.id)}`
    if (seenEntries.has(key)) return
    seenEntries.add(key)
    resolved.push(entry)
  }

  for (const term of terms) {
    const matches = ASCII_TERM.test(term)
      ? resolveVocabularyTerm(vocab, term.toLowerCase())
      : resolveChineseAlias(vocab, term)

    if (matches.length === 0) {
      pushTerm(term)
      continue
    }

    for (const entry of matches) pushResolved(entry)

    const best = matches[0]!
    pushTerm(best.name)

    if (best.kind === 'building' && typeof best.id === 'number' && !seenBuildings.has(best.id)) {
      seenBuildings.add(best.id)
      buildingIds.push(best.id)
    }
  }

  return { listingTerms, buildingIds, resolved }
}
