/**
 * 由公开实体行构建 L2 词表。
 *
 * 拼音在**构建词表时**算一次，随词表一起缓存；请求期不做 `pinyin-pro`
 * 转换。`pinyin-pro` 对常见地名（长宁 / 银行 / 重庆 / 厦门 / 蚌埠）的默认
 * 读音已正确，多音字回归见 `tests/search/vocabulary-build.test.ts`。
 */

import { pinyin } from 'pinyin-pro'

import { SEARCH_ALIASES } from './aliases'
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

/** 首字母，小写，去掉分隔符。 */
export function initialsOf(name: string): string {
  return pinyin(name, {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }).join('').toLowerCase()
}

export function buildSearchVocabulary(
  rows: readonly SearchVocabularyRow[],
  city: string,
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
      aliases: SEARCH_ALIASES[row.name] ?? [],
      pinyin: pinyinOf(row.name),
      initials: initialsOf(row.name),
    })
  }

  return { city, entries }
}
