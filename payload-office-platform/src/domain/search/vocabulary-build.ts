/**
 * 由公开实体行构建 L2 词表。
 *
 * 拼音在**构建词表时**算一次，随词表一起缓存；请求期不做 `pinyin-pro`
 * 转换。`pinyin-pro` 对常见地名（长宁 / 银行 / 重庆 / 厦门 / 蚌埠）的默认
 * 读音已正确，多音字回归见 `tests/search/vocabulary-build.test.ts`。
 */

import { pinyin } from 'pinyin-pro'

import { SEARCH_ALIASES } from './aliases'
import { nameKey } from './vocabulary'
import type { SearchVocabulary, VocabularyEntry, VocabularyKind } from './vocabulary'

export type SearchVocabularyRow = Readonly<{
  kind: VocabularyKind
  id: number
  slug: string
  name: string
  parent_name: string | null
}>

/** 无声调全拼，小写，去掉分隔符。 */
export function pinyinOf(name: string): string {
  return pinyin(name, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }).join('').toLowerCase()
}

/** 无声调拼音的音节序列，小写；非汉字连续片段保持为一个整体。 */
export function syllablesOf(name: string): readonly string[] {
  return pinyin(name, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }).map((syllable) => syllable.toLowerCase())
}

/** 首字母，小写，去掉分隔符。 */
export function initialsOf(name: string): string {
  return pinyin(name, {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }).join('').toLowerCase()
}

/** 运营维护的别名：规范名 → 别名列表（来自 search-aliases 集合）。 */
export type ExtraAliases = Readonly<Record<string, readonly string[]>>

export type AliasRow = Readonly<{ canonical_name: string | null; alias: string | null }>

/** search_aliases 表的行 → 规范名分组。脏行（缺字段 / 非字符串）直接忽略，保持行顺序。 */
export function groupAliasRows(rows: readonly AliasRow[]): ExtraAliases {
  const grouped: Record<string, string[]> = {}
  for (const row of rows) {
    if (typeof row.canonical_name !== 'string' || typeof row.alias !== 'string') continue
    ;(grouped[row.canonical_name] ??= []).push(row.alias)
  }
  return grouped
}

/**
 * 合并代码别名与运营别名：代码在前；与规范名相同、空白、比较键重复的丢掉。
 * 比较键用 `nameKey`（NFKC、小写、去空白），与词表解析一致，所以 `IFC` 与 `ifc` 算同一个。
 */
function mergeAliases(name: string, extra: readonly string[]): readonly string[] {
  const merged: string[] = []
  const seen = new Set<string>([nameKey(name)])
  for (const alias of [...(SEARCH_ALIASES[name] ?? []), ...extra]) {
    const key = nameKey(alias)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    merged.push(alias)
  }
  return merged
}

export function buildSearchVocabulary(
  rows: readonly SearchVocabularyRow[],
  city: string,
  extraAliases: ExtraAliases = {},
): SearchVocabulary {
  const seen = new Set<string>()
  const entries: VocabularyEntry[] = []

  for (const row of rows) {
    const key = `${row.kind}:${row.id}`
    if (seen.has(key)) continue
    seen.add(key)

    entries.push({
      kind: row.kind,
      id: row.id,
      slug: row.slug,
      name: row.name,
      ...(row.parent_name ? { parentName: row.parent_name } : {}),
      aliases: mergeAliases(row.name, extraAliases[row.name] ?? []),
      pinyin: pinyinOf(row.name),
      initials: initialsOf(row.name),
      syllables: syllablesOf(row.name),
    })
  }

  return { city, entries }
}
