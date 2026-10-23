import { describe, expect, it } from 'vitest'

import {
  buildSnapshot,
  listingsInCity,
  normalizePrice,
  parseLandingPriceSummary,
  parseListPageCounts,
  percentileCont,
  reconcile,
  roundLikePg,
  type RawBuilding,
  type RawLocation,
} from '../scripts/lib/news-supply'

describe('percentileCont / roundLikePg：与落地页 SQL 同算法', () => {
  it('线性插值，同 PostgreSQL percentile_cont', () => {
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentileCont([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(percentileCont([7], 0.75)).toBe(7)
    expect(percentileCont([], 0.5)).toBeNull()
  })

  it('舍入照 ROUND(float8::numeric, 2)：二进制尾差不影响「五入」', () => {
    expect(roundLikePg(4.245, 2)).toBe(4.25)
    expect(roundLikePg(4.255, 2)).toBe(4.26)
    expect(roundLikePg(4.2500000000000004, 2)).toBe(4.25)
    expect(roundLikePg(4.244, 2)).toBe(4.24)
  })
})

describe('normalizePrice：同 listing-query-sql 的金额 / 单位片段', () => {
  it('结构化价格优先；套 = total', () => {
    expect(normalizePrice({ price: { amount: 3.3, currency: 'CNY', period: 'day', unit: 'sqm' } })).toEqual({ amount: 3.3, unit: 'rmb-sqm-day' })
    expect(normalizePrice({ price: { amount: 12000, currency: 'CNY', period: 'month', unit: 'suite' } })).toEqual({ amount: 12000, unit: 'rmb-month' })
  })

  it('结构化无效（非人民币 / 负数 / 缺单位）时退回旧字段，旧字段也无效就是 null', () => {
    expect(normalizePrice({ price: { amount: 3, currency: 'USD', period: 'day', unit: 'sqm' }, rent: 4.2, rentUnit: 'rmb-sqm-day' })).toEqual({ amount: 4.2, unit: 'rmb-sqm-day' })
    expect(normalizePrice({ price: { amount: -1, currency: 'CNY', period: 'day', unit: 'sqm' } })).toBeNull()
    expect(normalizePrice({ price: null, rent: null, rentUnit: 'rmb-sqm-day' })).toBeNull()
  })
})

describe('buildSnapshot：全市 / 行政区 / 商圈', () => {
  const locations = new Map<number, RawLocation>([
    [1, { id: 1, slug: 'shanghai', name: '上海', type: 'city' }],
    [10, { id: 10, slug: 'huangpu', name: '黄浦区', type: 'district' }],
    [11, { id: 11, slug: 'xuhui', name: '徐汇区', type: 'district' }],
    [20, { id: 20, slug: 'renminguangchang', name: '人民广场', type: 'business_area' }],
  ])
  const buildings = new Map<number, RawBuilding>([
    [100, { id: 100, city: 1, district: 10, businessDistrict: 20 }],
    [101, { id: 101, city: 1, district: 11, businessDistrict: null }],
    [102, { id: 102, city: 2, district: null, businessDistrict: null }],
  ])
  const day = (amount: number) => ({ price: { amount, currency: 'CNY', period: 'day', unit: 'sqm' } })
  const listings = [
    { id: 1, building: 100, ...day(5) },
    { id: 2, building: 100, ...day(7) },
    { id: 3, building: 100, price: { amount: 2000, currency: 'CNY', period: 'month', unit: 'seat' } },
    { id: 4, building: 101, ...day(3) },
    { id: 5, building: 102, ...day(9) },
  ]

  it('只算本城市；按楼盘的区 / 商圈分组；非「元/㎡/天」只计条数不进分位数', () => {
    const inCity = listingsInCity(listings, buildings, 1)
    expect(inCity.map((l) => l.id)).toEqual([1, 2, 3, 4])
    const s = buildSnapshot({ asOf: '2026-10-22T08:00:00.000Z', city: 'shanghai', listings: inCity, buildings, locations })
    expect(s).toMatchObject({ listingCount: 4, buildingCount: 2, priceSampleCount: 3, otherUnitCount: 1, median: 5 })
    expect(s.districts.map((d) => [d.slug, d.listingCount, d.priceSampleCount, d.median])).toEqual([
      ['huangpu', 3, 2, 6],
      ['xuhui', 1, 1, 3],
    ])
    expect(s.businessAreas).toEqual([
      { slug: 'renminguangchang', name: '人民广场', listingCount: 3, buildingCount: 1, priceSampleCount: 2, min: 5, p25: 5.5, median: 6, p75: 6.5, max: 7 },
    ])
  })
})

describe('前台页面解析', () => {
  it('列表页：「共 N 套」与位置筛选行', () => {
    const html = `<header>搜索</header><div>共 <span class="sf-num">33721</span> 套</div>
      <div>位置</div><a>黄浦区</a><span>6740</span><a>静安区</a><span>2533</span><div>类型</div><a>甲级</a><span>12</span>`
    expect(parseListPageCounts(html)).toEqual({ total: 33721, districts: { 黄浦区: 6740, 静安区: 2533 } })
    expect(parseListPageCounts('<div>暂无房源</div>')).toBeNull()
  })

  it('落地页：FAQ 里的中位数、P25–P75 与报价样本数；React 插的注释节点不影响', () => {
    const html = `<script type="application/ld+json">{"x":1}</script><p>黄浦区在租办公室的挂牌租金中位数约为 <!-- -->5.36<!-- --> 元/㎡/天，多数集中在 4.25–6.80 元/㎡/天，最低 1.73、最高 11.90 元/㎡/天（共 6,730 套报价样本）。</p>`
    expect(parseLandingPriceSummary(html)).toEqual({ median: 5.36, p25: 4.25, p75: 6.8, sampleCount: 6730 })
    expect(parseLandingPriceSummary('<p>样本不足</p>')).toBeNull()
  })
})

describe('reconcile：与前台逐项比对', () => {
  const snapshot = {
    asOf: 'x',
    city: 'shanghai',
    listingCount: 100,
    buildingCount: 10,
    priceSampleCount: 90,
    otherUnitCount: 10,
    median: 4,
    districts: [{ slug: 'huangpu', name: '黄浦区', listingCount: 60, buildingCount: 6, priceSampleCount: 55, min: 1, p25: 3, median: 4, p75: 5, max: 9 }],
    businessAreas: [],
  }

  it('全部一致才算通过', () => {
    const r = reconcile(snapshot, { total: 100, districts: { 黄浦区: 60 } }, new Map([['huangpu', { median: 4, p25: 3, p75: 5, sampleCount: 55 }]]))
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(6)
  })

  it('只对上全市总数不算通过：区计数没解析出来、或该有的落地页价格摘要缺失，都失败', () => {
    const noDistricts = reconcile(snapshot, { total: 100, districts: {} }, new Map([['huangpu', { median: 4, p25: 3, p75: 5, sampleCount: 55 }]]))
    expect(noDistricts.ok).toBe(false)
    expect(noDistricts.coverageProblems.join()).toContain('各区计数')
    const noLanding = reconcile(snapshot, { total: 100, districts: { 黄浦区: 60 } }, new Map())
    expect(noLanding.ok).toBe(false)
    expect(noLanding.coverageProblems.join()).toContain('黄浦区')
  })

  it('总数、区计数、价格任一不等或前台有我们没有，都不通过', () => {
    expect(reconcile(snapshot, { total: 101, districts: {} }, new Map()).ok).toBe(false)
    expect(reconcile(snapshot, { total: 100, districts: { 静安区: 5 } }, new Map()).ok).toBe(false)
    expect(
      reconcile(snapshot, { total: 100, districts: {} }, new Map([['huangpu', { median: 4.01, p25: 3, p75: 5, sampleCount: 55 }]])).ok,
    ).toBe(false)
  })
})
