import { describe, expect, it } from 'vitest'

import type { SearchVocabulary } from '@/domain/search/vocabulary'
import { buildSearchSuggestions } from '@/domain/search/suggestions'
import { testVocabulary } from './search-fixtures'

const withCityEntry: SearchVocabulary = {
  city: 'shanghai',
  entries: [
    ...testVocabulary.entries,
    {
      kind: 'city',
      id: 99,
      slug: 'beijing',
      name: '北京',
      aliases: ['bj'],
      pinyin: 'beijing',
      initials: 'bj',
    },
  ],
}

describe('buildSearchSuggestions', () => {
  it('空词与纯空白没有建议', () => {
    expect(buildSearchSuggestions(testVocabulary, '')).toEqual([])
    expect(buildSearchSuggestions(testVocabulary, '   ')).toEqual([])
  })

  it('中文全等命中楼盘，tier 为 name-exact', () => {
    const [first] = buildSearchSuggestions(testVocabulary, '上海中心')
    expect(first.kind).toBe('building')
    expect(first.name).toBe('上海中心')
    expect(first.tier).toBe('name-exact')
    expect(first.href).toBe('/shanghai/buildings/shanghai-tower')
    expect(first.parentName).toBe('陆家嘴')
  })

  it('别名全等命中', () => {
    const [first] = buildSearchSuggestions(testVocabulary, '国金中心')
    expect(first.name).toBe('上海国金中心')
    expect(first.tier).toBe('alias-exact')
  })

  it('大小写不敏感的别名：IFC 命中', () => {
    const [first] = buildSearchSuggestions(testVocabulary, 'IFC')
    expect(first.name).toBe('上海国金中心')
    expect(first.tier).toBe('alias-exact')
  })

  it('首字母全等命中', () => {
    // shzx 既是别名也是首字母：别名层级更高，先走 alias-exact。
    const viaAlias = buildSearchSuggestions(testVocabulary, 'shzx')[0]
    expect(viaAlias.name).toBe('上海中心')
    expect(viaAlias.tier).toBe('alias-exact')
    // shgjzx 只是首字母、不是别名 → initials-exact。
    const viaInitials = buildSearchSuggestions(testVocabulary, 'shgjzx')[0]
    expect(viaInitials.name).toBe('上海国金中心')
    expect(viaInitials.tier).toBe('initials-exact')
  })

  it('全拼前缀命中', () => {
    const [first] = buildSearchSuggestions(testVocabulary, 'lujia')
    expect(first.name).toBe('陆家嘴')
    expect(first.tier).toBe('pinyin-prefix')
    expect(first.href).toBe('/shanghai/area/lujiazui')
  })

  it('中文前缀命中多个楼盘，按名称长度排前', () => {
    const suggestions = buildSearchSuggestions(testVocabulary, '上海')
    expect(suggestions.map((s) => s.name)).toEqual(['上海中心', '上海国金中心'])
    expect(suggestions.every((s) => s.tier === 'name-prefix')).toBe(true)
  })

  it('同 tier 按 kind 顺序：行政区先于地铁', () => {
    const names = buildSearchSuggestions(testVocabulary, 'jingan').map((s) => `${s.kind}:${s.name}`)
    expect(names.slice(0, 2)).toEqual(['district:静安', 'metro:静安站'])
  })

  it('单拉丁字母不给拼音/首字母前缀建议', () => {
    expect(buildSearchSuggestions(testVocabulary, 's')).toEqual([])
    expect(buildSearchSuggestions(testVocabulary, 'l')).toEqual([])
  })

  it('同一个实体命中多个层级只出现一次', () => {
    const names = buildSearchSuggestions(testVocabulary, '上海中心大厦')
    expect(names.filter((s) => s.name === '上海中心')).toHaveLength(1)
  })

  it('limit 生效，默认 6', () => {
    expect(buildSearchSuggestions(withCityEntry, '上')).toHaveLength(2)
    expect(buildSearchSuggestions(withCityEntry, '上', 1)).toHaveLength(1)
  })

  it('城市实体跳城市首页', () => {
    const [first] = buildSearchSuggestions(withCityEntry, 'beijing')
    expect(first.kind).toBe('city')
    expect(first.href).toBe('/beijing')
  })

  it('当前城市不进联想', () => {
    // 词表自身城市 = beijing，且存在「北京」城市实体：查询应把它排除。
    const vocab: SearchVocabulary = {
      city: 'beijing',
      entries: [
        {
          kind: 'city',
          id: 99,
          slug: 'beijing',
          name: '北京',
          aliases: [],
          pinyin: 'beijing',
          initials: 'bj',
        },
        ...testVocabulary.entries,
      ],
    }
    expect(buildSearchSuggestions(vocab, '北京')).toEqual([])
    expect(buildSearchSuggestions(vocab, 'beijing')).toEqual([])
  })

  it('地铁实体跳列表页并带 metro 筛选', () => {
    const [first] = buildSearchSuggestions(testVocabulary, '静安站')
    expect(first.kind).toBe('metro')
    expect(first.href).toBe('/shanghai/listings?metro=jingan-station')
  })

  it('全半角与大小写归一后仍可命中', () => {
    const [first] = buildSearchSuggestions(testVocabulary, 'ＳＨＺＸ')
    expect(first.name).toBe('上海中心')
  })
})
