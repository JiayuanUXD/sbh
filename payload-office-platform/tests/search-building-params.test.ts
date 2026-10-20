import { describe, expect, it } from 'vitest'

import { buildBuildingCanonicalParams, parseBuildingSearchInput } from '@/domain/public-catalog/building-search'

describe('楼盘搜索的 q', () => {
  it('解析 q 并保留到 canonical', () => {
    const input = parseBuildingSearchInput(new URLSearchParams('q=虹桥'))
    expect(input.q).toBe('虹桥')
    expect(buildBuildingCanonicalParams(input).get('q')).toBe('虹桥')
  })

  it('trim 后为空视为未生效', () => {
    expect(parseBuildingSearchInput(new URLSearchParams('q=%20%20')).q).toBeUndefined()
  })

  it('按码点截断 100 字', () => {
    const q = '😀'.repeat(120)
    const input = parseBuildingSearchInput(new URLSearchParams(`q=${encodeURIComponent(q)}`))
    expect(Array.from(input.q ?? '')).toHaveLength(100)
  })
})
