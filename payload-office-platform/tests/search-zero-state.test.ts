import { describe, expect, it } from 'vitest'

import { classifyZeroResult } from '@/domain/search/zero-state'

const base = {
  exactEntity: null,
  cityMatch: null,
  suggestions: [] as readonly string[],
} as const

describe('classifyZeroResult', () => {
  it('实体存在但无供给时优先走实体兜底', () => {
    expect(classifyZeroResult({
      ...base,
      exactEntity: { kind: 'building', name: '上海中心' },
      cityMatch: { slug: 'beijing', name: '北京' },
      suggestions: ['上海中心大厦'],
    })).toBe('entity')
  })

  it('关键词命中其他城市时走城市兜底', () => {
    expect(classifyZeroResult({
      ...base,
      cityMatch: { slug: 'beijing', name: '北京' },
      suggestions: ['北京国贸'],
    })).toBe('city')
  })

  it('有改写建议时走建议页', () => {
    expect(classifyZeroResult({
      ...base,
      suggestions: ['陆家嘴'],
    })).toBe('suggestion')
  })

  it('什么线索都没有时走策展兜底', () => {
    expect(classifyZeroResult(base)).toBe('curated')
  })
})
