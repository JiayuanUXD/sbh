/**
 * 相邻词项合并：空格把一个名字拆成了几个词项（「shanghai 中心」「上海 中心」「shang hai zhongxin」）。
 *
 * 各词项独立处理时，`shanghai` 被解析成城市「上海」，楼盘检索只拿「上海」去搜，「中心」被忽略。
 * 这里把相邻的几个词项拼起来（最长 4 个词项，先试长的），整体对上某个实体的**完整名字**才合并：
 *   - 纯拉丁：名称 / 别名 / 整词全拼 / 首字母相等；
 *   - 含汉字（纯汉字，或汉字拼音混输）：名称 / 别名相等，或整名对齐的模糊匹配（编辑数 0）。
 * 整体对上完整名字的，合并后的词项就是实体的规范名，后面的分词 / 扩展 / 楼盘检索都按实体名处理。
 *
 * 只对上名字的**一部分**时分两种：
 *   - 纯汉字、且拼起来是某个名称的连续子串（「上海 国金」⊂「上海国金中心」，至少 3 个字）：
 *     拼回一个词项（「上海国金」）交给 ILIKE，而不是「上海」AND「国金」——后者会把所有带上海的楼盘都带出来。
 *     不当成实体（不进候选、不当楼盘检索词的优先项）；
 *   - 其它（含拉丁的片段、顺序反了的「zhongxin 上海」）保持分开。
 */

import { resolveFuzzyWhole } from './fuzzy'
import {
  isPreciseMatch,
  nameKey,
  resolveVocabularyTerm,
  type SearchVocabulary,
  type VocabularyEntry,
} from './vocabulary'

const MAX_SPAN = 4
const ASCII_TERM = /^[a-z0-9]+$/
const HAN_ONLY = /^\p{Script=Han}+$/u
/** 拼回片段的最少字数：更短（「上海 大」→「上海大」）太容易误拼。 */
const MIN_FRAGMENT_LENGTH = 3

export type MergedTerms = Readonly<{
  terms: readonly string[]
  /** 由合并得到的实体规范名（按出现顺序）。 */
  entityTerms: readonly string[]
  /** 合并命中的词表条目（含同名候选），供建议 / 零结果页使用。 */
  entries: readonly VocabularyEntry[]
}>

/** 拼起来的词是否恰好是某个实体的完整名字；返回候选（按匹配器排序）。 */
function resolveWhole(vocab: SearchVocabulary, joined: string): readonly VocabularyEntry[] {
  if (ASCII_TERM.test(joined)) {
    const precise = resolveVocabularyTerm(vocab, joined).filter((entry) => isPreciseMatch(entry, joined))
    if (precise.length > 0) return precise
    return resolveFuzzyWhole(vocab, joined)
  }
  // 含汉字：latinKey 只看字母，「shanghai中心」会被误判成拼音 shanghai（城市「上海」），所以只认名称 / 别名相等。
  const key = nameKey(joined)
  const byName = resolveVocabularyTerm(vocab, joined).filter(
    (entry) => nameKey(entry.name) === key || entry.aliases.some((alias) => nameKey(alias) === key),
  )
  if (byName.length > 0) return byName
  return resolveFuzzyWhole(vocab, joined)
}

/** 纯汉字的相邻词项拼起来，是否某个名称 / 别名的连续子串（且不止 3 个字以内）。 */
function isNameFragment(vocab: SearchVocabulary, joined: string): boolean {
  if (!HAN_ONLY.test(joined) || Array.from(joined).length < MIN_FRAGMENT_LENGTH) return false
  return vocab.entries.some(
    (entry) =>
      nameKey(entry.name).includes(joined) || entry.aliases.some((alias) => nameKey(alias).includes(joined)),
  )
}

export function mergeAdjacentTerms(terms: readonly string[], vocab: SearchVocabulary): MergedTerms {
  const out: string[] = []
  const entityTerms: string[] = []
  const entries: VocabularyEntry[] = []
  const seenEntries = new Set<string>()

  for (let i = 0; i < terms.length; ) {
    let merged: { matches: readonly VocabularyEntry[]; end: number } | null = null
    let fragment: { text: string; end: number } | null = null
    for (let end = Math.min(terms.length - 1, i + MAX_SPAN - 1); end > i; end -= 1) {
      const joined = terms.slice(i, end + 1).join('')
      const matches = resolveWhole(vocab, joined)
      if (matches.length > 0) {
        merged = { matches, end }
        break
      }
      if (!fragment && isNameFragment(vocab, joined)) fragment = { text: joined, end }
    }
    if (!merged && fragment) {
      out.push(fragment.text)
      i = fragment.end + 1
      continue
    }
    if (!merged) {
      out.push(terms[i]!)
      i += 1
      continue
    }
    const best = merged.matches[0]!
    out.push(best.name)
    if (!entityTerms.includes(best.name)) entityTerms.push(best.name)
    for (const entry of merged.matches) {
      const key = `${entry.kind}:${String(entry.id)}`
      if (seenEntries.has(key)) continue
      seenEntries.add(key)
      entries.push(entry)
    }
    i = merged.end + 1
  }

  return { terms: out, entityTerms, entries }
}
