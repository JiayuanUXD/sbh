/**
 * 错字纠错：对封闭词表做编辑距离匹配。
 *
 * 只用于零结果时的「你是不是想找」，不自动改写查询——改错了用户看到的是别的结果，
 * 而建议只是多一个可点的选项。
 *
 * 为什么不用 pg_trgm：TencentDB 是否允许装扩展没有闭环；词表是封闭的（楼盘 / 商圈 /
 * 地铁 / 行政区及其别名）、量级小，内存里做完全够用。为什么不用拼音：请求期不做
 * pinyin-pro 转换（拼音在构建词表时算一次，见 vocabulary-build.ts）；中文错字绝大多数是
 * 单字替换，编辑距离 1 已经覆盖。
 *
 * 规则：
 *   - 只处理纯中文（不含拉丁字母 / 数字）、2–10 个字的词项；
 *   - 已经是某个名称或别名的不算错字；
 *   - 容错上限随长度走：≤5 字容 1 处差异，≥6 字容 2 处（短词容错多了会满地乱猜）；
 *   - 按距离、再按 楼盘 > 行政区 > 商圈 > 地铁 排序，最多 3 条。
 */

import {
  nameKey,
  type SearchVocabulary,
  type VocabularyEntry,
  type VocabularyKind,
} from './vocabulary'

const MIN_TERM_LENGTH = 2
const MAX_TERM_LENGTH = 10
const MAX_SUGGESTIONS = 3
const ASCII_ALNUM = /[A-Za-z0-9]/

const KIND_ORDER: Readonly<Record<VocabularyKind, number>> = {
  building: 0,
  district: 1,
  businessArea: 2,
  metro: 3,
  city: 4,
}

/**
 * Levenshtein 距离（按码点）。距离超过 `max` 就提前返回 `max + 1`，不再往下算。
 */
export function editDistance(a: string, b: string, max: number): number {
  const left = Array.from(a)
  const right = Array.from(b)
  if (Math.abs(left.length - right.length) > max) return max + 1

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    previous = current
  }
  return previous[right.length]!
}

type Surface = Readonly<{ key: string; length: number; entry: VocabularyEntry }>
type SurfaceIndex = Readonly<{ surfaces: readonly Surface[]; exact: ReadonlySet<string> }>

const indexCache = new WeakMap<SearchVocabulary, SurfaceIndex>()

function surfaceIndex(vocab: SearchVocabulary): SurfaceIndex {
  const cached = indexCache.get(vocab)
  if (cached) return cached
  const surfaces: Surface[] = []
  const exact = new Set<string>()
  for (const entry of vocab.entries) {
    // 当前城市不进建议：在 /shanghai 下把错字纠成「上海（城市）」是噪音。
    if (entry.kind === 'city' && entry.slug === vocab.city) continue
    for (const surface of [entry.name, ...entry.aliases]) {
      const key = nameKey(surface)
      if (ASCII_ALNUM.test(key)) continue
      const length = Array.from(key).length
      if (length < MIN_TERM_LENGTH) continue
      exact.add(key)
      surfaces.push({ key, length, entry })
    }
  }
  const built = { surfaces, exact }
  indexCache.set(vocab, built)
  return built
}

function toleranceFor(length: number): number {
  return length >= 6 ? 2 : 1
}

export function suggestTypoCorrections(
  terms: readonly string[],
  vocab: SearchVocabulary,
): readonly VocabularyEntry[] {
  const { surfaces, exact } = surfaceIndex(vocab)
  const best = new Map<string, { entry: VocabularyEntry; distance: number }>()

  for (const term of terms) {
    const key = nameKey(term)
    const length = Array.from(key).length
    if (length < MIN_TERM_LENGTH || length > MAX_TERM_LENGTH) continue
    if (ASCII_ALNUM.test(key) || exact.has(key)) continue

    const tolerance = toleranceFor(length)
    for (const surface of surfaces) {
      const distance = editDistance(key, surface.key, tolerance)
      if (distance === 0 || distance > tolerance) continue
      const id = `${surface.entry.kind}:${String(surface.entry.id)}`
      const known = best.get(id)
      if (!known || distance < known.distance) best.set(id, { entry: surface.entry, distance })
    }
  }

  return [...best.values()]
    .sort((a, b) =>
      a.distance - b.distance
      || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind]
      || a.entry.name.length - b.entry.name.length
      || a.entry.name.localeCompare(b.entry.name, 'zh-CN'))
    .slice(0, MAX_SUGGESTIONS)
    .map((candidate) => candidate.entry)
}
