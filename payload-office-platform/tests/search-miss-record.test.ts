import { describe, expect, it, vi } from 'vitest'

import {
  parseSearchMissBody,
  recordSearchMiss,
  type RecordSearchMissDeps,
  type SearchMissResults,
} from '@/lib/search-miss/record-search-miss'

const ZERO: SearchMissResults = { counts: { listings: 0, buildings: 0, news: 0 }, relaxed: false }
const HIT: SearchMissResults = { counts: { listings: 3, buildings: 1, news: 0 }, relaxed: false }

function makeDeps(results: SearchMissResults, city: string | null = 'shanghai') {
  const upsert = vi.fn(async () => {})
  const loadResults = vi.fn(async () => results)
  const deps: RecordSearchMissDeps = {
    resolveCollectableCity: async () => city,
    loadResults,
    upsert,
  }
  return { deps, upsert, loadResults }
}

describe('parseSearchMissBody', () => {
  it('只收 { city, q }；多余键被忽略且不会出现在结果里', () => {
    const parsed = parseSearchMissBody({ city: 'shanghai', q: '静安', count: 999, missKind: 'zero' })
    expect(parsed).toEqual({ city: 'shanghai', q: '静安' })
  })

  it.each([
    null,
    'x',
    [],
    {},
    { city: 'shanghai' },
    { q: '静安' },
    { city: 1, q: '静安' },
    { city: 'shanghai', q: 1 },
    { city: '', q: '静安' },
    { city: 'shanghai', q: '' },
    { city: 'shanghai', q: '字'.repeat(201) },
    { city: 'c'.repeat(65), q: '静安' },
  ])('无效请求体：%j', (body) => {
    expect(parseSearchMissBody(body)).toBeNull()
  })
})

describe('recordSearchMiss', () => {
  it('确实零结果：脱敏后 upsert，存归一化词与规范城市 slug', async () => {
    const { deps, upsert } = makeDeps(ZERO)
    await expect(recordSearchMiss({ city: 'SHANGHAI', q: '  静安，整层 ' }, deps)).resolves.toBe('recorded')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith({
      city: 'shanghai',
      term: '静安 整层',
      missKind: 'zero',
      lastResultTotal: 0,
    })
  })

  it('楼盘存在但无在租房源：entity-no-supply，lastResultTotal 为三类合计', async () => {
    const { deps, upsert } = makeDeps({ counts: { listings: 0, buildings: 2, news: 1 }, relaxed: false })
    await expect(recordSearchMiss({ city: 'shanghai', q: '某某大厦' }, deps)).resolves.toBe('recorded')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ missKind: 'entity-no-supply', lastResultTotal: 3 }),
    )
  })

  it('放宽后才有结果：relaxed', async () => {
    const { deps, upsert } = makeDeps({ counts: { listings: 4, buildings: 0, news: 0 }, relaxed: true })
    await expect(recordSearchMiss({ city: 'shanghai', q: '陆家嘴 整层' }, deps)).resolves.toBe('recorded')
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ missKind: 'relaxed', lastResultTotal: 4 }))
  })

  it('服务端复核有结果的词：不入库（伪造请求拦在复核）', async () => {
    const { deps, upsert } = makeDeps(HIT)
    await expect(recordSearchMiss({ city: 'shanghai', q: '静安' }, deps)).resolves.toBe('not_a_miss')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('城市不是已开通的公开城市：不查结果、不入库', async () => {
    const { deps, upsert, loadResults } = makeDeps(ZERO, null)
    await expect(recordSearchMiss({ city: 'atlantis', q: '静安' }, deps)).resolves.toBe('unknown_city')
    expect(loadResults).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['13812345678', 'dropped:digits'],
    ['a@b.com', 'dropped:contact'],
    ['https://x.com', 'dropped:contact'],
    ['字'.repeat(21), 'dropped:too_long'],
    ['静', 'skipped:too_short'],
  ] as const)('零结果但命中脱敏规则：%s → %s，不入库', async (q, expected) => {
    const { deps, upsert } = makeDeps(ZERO)
    await expect(recordSearchMiss({ city: 'shanghai', q }, deps)).resolves.toBe(expected)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('outcome 是纯枚举，不含查询文本', async () => {
    const { deps } = makeDeps(ZERO)
    const outcome = await recordSearchMiss({ city: 'shanghai', q: 'a@b.com' }, deps)
    expect(outcome).not.toContain('b.com')
  })
})
