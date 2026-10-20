/**
 * 输入联想：词项 → 建议列表。
 *
 * 与 `resolveVocabularyTerm` 的分工：那个回答「这个词指向哪个实体」（查询用，
 * 取第一个）；本模块回答「用户正在打的是什么」（联想用，给一排）。因此这里
 * **跨层级收集**而不是短路——`上海` 同时命中两个楼盘，两个都该出现。
 *
 * 单字策略与查询解析刻意不同：中文单字允许名称前缀（打「上」出「上海中心」
 * 是有效联想），拉丁单字一律不前缀（`l` 命中一大片拼音，只是噪音）。
 */

import { latinKey, nameKey } from './vocabulary'
import type { SearchVocabulary, VocabularyEntry, VocabularyKind } from './vocabulary'

export type SuggestionTier =
  | 'name-exact'
  | 'alias-exact'
  | 'pinyin-exact'
  | 'initials-exact'
  | 'name-prefix'
  | 'pinyin-prefix'

const TIER_ORDER: readonly SuggestionTier[] = [
  'name-exact',
  'alias-exact',
  'pinyin-exact',
  'initials-exact',
  'name-prefix',
  'pinyin-prefix',
]

const KIND_ORDER: Readonly<Record<VocabularyKind, number>> = {
  building: 0,
  district: 1,
  businessArea: 2,
  metro: 3,
  city: 4,
}

export type SearchSuggestion = Readonly<{
  kind: VocabularyKind
  id: number | string
  slug: string
  name: string
  parentName?: string
  /** 命中层级，用于排序与「为什么出这条」的说明。 */
  tier: SuggestionTier
  /** 站内相对路径：楼盘进详情、地点进区域页、地铁进带筛选的列表、城市进城市首页。 */
  href: string
}>

function suggestionHref(city: string, entry: VocabularyEntry): string {
  switch (entry.kind) {
    case 'building':
      return `/${city}/buildings/${entry.slug}`
    case 'district':
    case 'businessArea':
      return `/${city}/area/${entry.slug}`
    case 'metro':
      return `/${city}/listings?metro=${encodeURIComponent(entry.slug)}`
    case 'city':
      return `/${entry.slug}`
  }
}

export function buildSearchSuggestions(
  vocab: SearchVocabulary,
  rawQuery: string,
  limit = 6,
): readonly SearchSuggestion[] {
  const name = nameKey(rawQuery)
  const latin = latinKey(rawQuery)
  if (name.length === 0 && latin.length === 0) return []

  const tiers: readonly [SuggestionTier, (entry: VocabularyEntry) => boolean][] = [
    ['name-exact', (entry) => name.length > 0 && nameKey(entry.name) === name],
    ['alias-exact', (entry) => name.length > 0 && entry.aliases.some((alias) => nameKey(alias) === name)],
    ['pinyin-exact', (entry) => latin.length > 0 && latinKey(entry.pinyin) === latin],
    ['initials-exact', (entry) => latin.length >= 2 && latinKey(entry.initials) === latin],
    ['name-prefix', (entry) => name.length > 0 && nameKey(entry.name).startsWith(name)],
    ['pinyin-prefix', (entry) => latin.length >= 2 && latinKey(entry.pinyin).startsWith(latin)],
  ]

  const best = new Map<string, SearchSuggestion>()
  for (const [tier, matches] of tiers) {
    for (const entry of vocab.entries) {
      // 当前城市不进联想：在 /shanghai 下打「上海」出「上海（城市）」是噪音，
      // 城市建议只服务「搜到外地」的场景。
      if (entry.kind === 'city' && entry.slug === vocab.city) continue
      if (!matches(entry)) continue
      const key = `${entry.kind}:${entry.id}`
      if (best.has(key)) continue
      best.set(key, {
        kind: entry.kind,
        id: entry.id,
        slug: entry.slug,
        name: entry.name,
        ...(entry.parentName != null ? { parentName: entry.parentName } : {}),
        tier,
        href: suggestionHref(vocab.city, entry),
      })
    }
  }

  return [...best.values()]
    .sort((a, b) => {
      const tier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
      if (tier !== 0) return tier
      const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      if (kind !== 0) return kind
      const length = a.name.length - b.name.length
      if (length !== 0) return length
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    .slice(0, Math.max(1, limit))
}
