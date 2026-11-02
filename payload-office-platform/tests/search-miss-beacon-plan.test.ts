import { describe, expect, it } from 'vitest'

import { planSearchMissBeacon, SEARCH_MISS_ENDPOINT } from '@/lib/search-miss/beacon-plan'

const base = {
  city: 'shanghai',
  q: '不存在的词',
  page: 1,
  counts: { listings: 0, buildings: 0, news: 0 },
  relaxed: false,
}

describe('planSearchMissBeacon', () => {
  it('第 1 页的未命中查询：只发 { city, q }，不带任何计数', () => {
    const plan = planSearchMissBeacon(base)
    expect(plan).not.toBeNull()
    expect(plan!.body).toEqual({ city: 'shanghai', q: '不存在的词' })
    expect(Object.keys(plan!.body).sort()).toEqual(['city', 'q'])
  })

  it('去重键含城市与原始 q', () => {
    expect(planSearchMissBeacon(base)!.dedupeKey).toBe('sbh:search-miss:shanghai:不存在的词')
  })

  it('page > 1 不发', () => {
    expect(planSearchMissBeacon({ ...base, page: 2 })).toBeNull()
  })

  it('有结果不发', () => {
    expect(planSearchMissBeacon({ ...base, counts: { listings: 2, buildings: 1, news: 0 } })).toBeNull()
  })

  it('楼盘有命中但无在租房源、放宽后才有结果：要发', () => {
    expect(planSearchMissBeacon({ ...base, counts: { listings: 0, buildings: 1, news: 0 } })).not.toBeNull()
    expect(planSearchMissBeacon({ ...base, counts: { listings: 2, buildings: 0, news: 0 }, relaxed: true })).not.toBeNull()
  })

  it.each(['13812345678', 'a@b.com', 'https://x.com', '静', '字'.repeat(21)])(
    '客户端就不发：%s',
    (q) => {
      expect(planSearchMissBeacon({ ...base, q })).toBeNull()
    },
  )

  it('端点路径', () => {
    expect(SEARCH_MISS_ENDPOINT).toBe('/api/search-misses')
  })
})
