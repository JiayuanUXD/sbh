/**
 * 模糊匹配评测集（见 tests/fixtures/search-golden.ts）：逐条跑，失败时指名道姓是哪条查询。
 */

import { describe, expect, it } from 'vitest'

import { resolveFuzzyAuto, suggestFuzzyCorrections } from '@/domain/search/fuzzy'
import { resolveVocabularyTerm } from '@/domain/search/vocabulary'
import { buildSearchVocabulary } from '@/domain/search/vocabulary-build'

import {
  GOLDEN_AUTO,
  GOLDEN_AUTO_NONE,
  GOLDEN_ROWS,
  GOLDEN_SUGGEST,
  GOLDEN_SUGGEST_NONE,
} from './fixtures/search-golden'

const vocab = buildSearchVocabulary(GOLDEN_ROWS, 'shanghai')

describe('评测集：自动改写（编辑数 0）', () => {
  it.each(GOLDEN_AUTO)('%s → %s', (query, expected) => {
    const result = resolveFuzzyAuto(vocab, query).map((entry) => entry.name)
    expect(result[0], `${query} → ${result.join(' / ')}`).toBe(expected)
  })

  it.each(GOLDEN_AUTO_NONE)('%s 不自动改写', (query) => {
    expect(resolveFuzzyAuto(vocab, query).map((entry) => entry.name)).toEqual([])
  })
})

describe('评测集：建议（整名对齐，允许 1–2 处编辑）', () => {
  it.each(GOLDEN_SUGGEST)('%s → 建议里有 %s', (query, expected) => {
    const result = suggestFuzzyCorrections(vocab, [query]).map((entry) => entry.name)
    expect(result, `${query} → ${result.join(' / ')}`).toContain(expected)
  })

  it.each(GOLDEN_SUGGEST_NONE)('%s 没有建议', (query) => {
    expect(suggestFuzzyCorrections(vocab, [query])).toEqual([])
  })

  it('建议里不会出现只对上一半的长名字（整名对齐）', () => {
    expect(suggestFuzzyCorrections(vocab, ['陆加嘴']).map((entry) => entry.name)).toEqual(['陆家嘴'])
  })

  it('已经是名称或别名的不算错字', () => {
    expect(suggestFuzzyCorrections(vocab, ['陆家嘴'])).toEqual([])
    expect(suggestFuzzyCorrections(vocab, ['国金中心'])).toEqual([])
  })
})

describe('与精确档自洽：精确档（名称 / 别名 / 整词全拼 / 首字母 / 前缀）命中的，打分器第一名一致', () => {
  const asciiCases = GOLDEN_AUTO.filter(([query]) => /^[a-z]+$/.test(query))

  it.each(asciiCases)('%s', (query, expected) => {
    const exact = resolveVocabularyTerm(vocab, query).map((entry) => entry.name)
    // 精确档没命中的（如 zhongxin 这类后半截）由打分器负责，不在这里比较
    if (exact.length === 0) return
    expect(exact[0]).toBe(expected)
    expect(resolveFuzzyAuto(vocab, query)[0]?.name).toBe(expected)
  })
})

