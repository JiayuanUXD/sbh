/**
 * 中文长句分词：词表最长匹配。
 *
 * L1 归一化只按空白与标点切词，「陆家嘴整层办公室」整串成一个词项，拿去 `ILIKE`
 * 基本为零，且放宽逻辑（去掉最后一个词 / 改 OR）对单个词项无从下手。这里用 L2 词表
 * 把已知实体从长串里切出来，剩余片段去掉口水词后作为普通词项，交给后面的 AND / 放宽。
 *
 * 刻意不引入通用分词库：词表是封闭、可控的，命中不了就原样放行，不会把结果集弄得更怪。
 *
 * 规则：
 *   - 只处理纯中文（不含拉丁字母 / 数字）且至少 4 个字的词项；2–3 字本身就是名称，
 *     拉丁 / 数字词项走拼音那一路；
 *   - 从左到右，每个位置取最长的词表命中（名称或别名，至少 2 字）；别名换成规范名，
 *     与拼音别名的处理一致；
 *   - 一个实体都没命中就原样放行，口水词也不剥；
 *   - 城市名不参与切分：太泛，切出来楼盘检索会退化成只搜「上海」；
 *   - 整个词是某个名称 / 别名的一部分（用户还没打完，如「上海国金」⊂「上海国金中心」）
 *     不当长句切——切了会丢掉有效的限定词；整词恰好是别名时仍归一到规范名；
 *   - 剩余片段只按整词去掉口水词（「租金」不会被误伤成「金」），去完不足 2 字的丢弃。
 */

import {
  nameKey,
  resolveVocabularyTerm,
  type SearchVocabulary,
  type VocabularyEntry,
} from './vocabulary'

export type SegmentedTerms = Readonly<{
  /** 切分后的词项，保持出现顺序，已去重。 */
  terms: readonly string[]
  /** 其中由词表命中得到的实体规范名（按出现顺序）。 */
  entityTerms: readonly string[]
  /** 命中的词表条目（含同名歧义的全部候选），供建议 / 零结果页使用。 */
  entries: readonly VocabularyEntry[]
}>

const MIN_SEGMENT_TERM_LENGTH = 4
const MIN_SURFACE_LENGTH = 2
const ASCII_ALNUM = /[A-Za-z0-9]/

/** 口水词：对检索无贡献的找房套话。只放多字短语和「的」，不放「租」这类会误伤的单字。 */
const FILLER_PHRASES: readonly string[] = [
  '帮我找', '哪里有', '有没有', '我想找', '我想租', '我要租', '我想', '我要', '想租', '想找',
  '写字楼', '办公室', '办公楼', '出租', '求租', '附近', '周边', '的',
].sort((a, b) => b.length - a.length)

type SurfaceIndex = Readonly<{
  surfaces: ReadonlySet<string>
  /** 全部名称 / 别名（含城市名之外的所有 kind），用于判断「没打完的名称」。 */
  all: readonly string[]
  maxLength: number
}>

const indexCache = new WeakMap<SearchVocabulary, SurfaceIndex>()

function surfaceIndex(vocab: SearchVocabulary): SurfaceIndex {
  const cached = indexCache.get(vocab)
  if (cached) return cached
  const surfaces = new Set<string>()
  let maxLength = 0
  for (const entry of vocab.entries) {
    // 城市名太泛：「上海办公室出租」切出「上海」会让楼盘检索退化成按城市匹配。
    if (entry.kind === 'city') continue
    for (const surface of [entry.name, ...entry.aliases]) {
      const key = nameKey(surface)
      if (ASCII_ALNUM.test(key) || Array.from(key).length < MIN_SURFACE_LENGTH) continue
      surfaces.add(key)
      maxLength = Math.max(maxLength, Array.from(key).length)
    }
  }
  const built = { surfaces, all: [...surfaces], maxLength }
  indexCache.set(vocab, built)
  return built
}

function stripFillers(fragment: string): string {
  let rest = fragment
  for (const phrase of FILLER_PHRASES) rest = rest.split(phrase).join('')
  return rest
}

export function segmentSearchTerms(
  terms: readonly string[],
  vocab: SearchVocabulary,
): SegmentedTerms {
  const { surfaces, all, maxLength } = surfaceIndex(vocab)
  const out: string[] = []
  const entityTerms: string[] = []
  const entries: VocabularyEntry[] = []
  const seenTerms = new Set<string>()
  const seenEntries = new Set<string>()

  const push = (value: string) => {
    if (seenTerms.has(value)) return
    seenTerms.add(value)
    out.push(value)
  }

  for (const term of terms) {
    const chars = Array.from(term)
    if (chars.length < MIN_SEGMENT_TERM_LENGTH || ASCII_ALNUM.test(term)) {
      push(term)
      continue
    }

    // 没打完的名称（严格子串）不当长句切；整词恰好是名称 / 别名时仍走下面的归一。
    if (!surfaces.has(term) && all.some((surface) => surface.includes(term))) {
      push(term)
      continue
    }

    const pieces: Array<{ kind: 'entity'; matches: readonly VocabularyEntry[] } | { kind: 'text'; value: string }> = []
    let residual = ''
    const flush = () => {
      if (residual) pieces.push({ kind: 'text', value: residual })
      residual = ''
    }

    let index = 0
    while (index < chars.length) {
      let matched = 0
      const longest = Math.min(maxLength, chars.length - index)
      for (let length = longest; length >= MIN_SURFACE_LENGTH; length -= 1) {
        if (surfaces.has(chars.slice(index, index + length).join(''))) {
          matched = length
          break
        }
      }
      if (matched === 0) {
        residual += chars[index]
        index += 1
        continue
      }
      flush()
      const surface = chars.slice(index, index + matched).join('')
      pieces.push({ kind: 'entity', matches: resolveVocabularyTerm(vocab, surface) })
      index += matched
    }
    flush()

    if (!pieces.some((piece) => piece.kind === 'entity' && piece.matches.length > 0)) {
      push(term)
      continue
    }

    for (const piece of pieces) {
      if (piece.kind === 'entity') {
        const best = piece.matches[0]
        if (!best) continue
        push(best.name)
        if (!entityTerms.includes(best.name)) entityTerms.push(best.name)
        for (const entry of piece.matches) {
          const key = `${entry.kind}:${String(entry.id)}`
          if (seenEntries.has(key)) continue
          seenEntries.add(key)
          entries.push(entry)
        }
        continue
      }
      const kept = stripFillers(piece.value)
      if (Array.from(kept).length >= MIN_SURFACE_LENGTH) push(kept)
    }
  }

  return { terms: out, entityTerms, entries }
}
