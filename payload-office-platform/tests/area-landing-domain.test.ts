import { describe, expect, it } from 'vitest'

import {
  AREA_LANDING_MIN_LISTINGS,
  AREA_LANDING_MIN_PRICE_SAMPLES,
  areaLandingPath,
  buildAreaLandingCopy,
  isAreaLandingIndexable,
  summarizeAreaPrice,
  type AreaLandingStatsRow,
} from '@/domain/public-catalog/area-landing'

function row(overrides: Partial<AreaLandingStatsRow> = {}): AreaLandingStatsRow {
  return {
    kind: 'district',
    id: 15,
    slug: 'xuhui',
    name: '徐汇区',
    parentSlug: null,
    parentName: null,
    listingCount: 6216,
    buildingCount: 323,
    priceSampleCount: 6200,
    priceMin: 1.4,
    priceP25: 3.96,
    priceMedian: 4.31,
    priceP75: 5.1,
    priceMax: 9.78,
    otherUnitCount: 16,
    areaMedian: 313,
    lastUpdatedAt: '2026-10-15T08:00:00.000Z',
    ...overrides,
  }
}

describe('area landing indexing threshold', () => {
  it('indexes a location from the minimum listing count on', () => {
    expect(isAreaLandingIndexable(row({ listingCount: AREA_LANDING_MIN_LISTINGS }))).toBe(true)
    expect(isAreaLandingIndexable(row({ listingCount: AREA_LANDING_MIN_LISTINGS - 1 }))).toBe(false)
    expect(isAreaLandingIndexable(row({ listingCount: 0 }))).toBe(false)
  })
})

describe('areaLandingPath', () => {
  it('builds the prefixed path and encodes the slug exactly once', () => {
    expect(areaLandingPath('shanghai', 'xuhui')).toBe('/shanghai/area/xuhui')
    expect(areaLandingPath('shanghai', '徐汇')).toBe('/shanghai/area/%E5%BE%90%E6%B1%87')
  })
})

describe('summarizeAreaPrice', () => {
  it('summarizes the percentile band and a 100㎡ monthly estimate (日单价 × 面积 × 30)', () => {
    const price = summarizeAreaPrice(row())
    expect(price).toMatchObject({ unit: 'rmb-sqm-day', median: 4.31, p25: 3.96, p75: 5.1, min: 1.4, max: 9.78, sampleCount: 6200 })
    expect(price?.monthlyFor100Sqm).toEqual({ low: 11880, median: 12930, high: 15300 })
  })

  it('returns null below the sample threshold instead of showing a shaky number', () => {
    expect(summarizeAreaPrice(row({ priceSampleCount: AREA_LANDING_MIN_PRICE_SAMPLES - 1 }))).toBeNull()
  })

  it('returns null when any percentile is missing (never fabricates)', () => {
    expect(summarizeAreaPrice(row({ priceMedian: null }))).toBeNull()
    expect(summarizeAreaPrice(row({ priceP25: null }))).toBeNull()
    expect(summarizeAreaPrice(row({ priceMax: null }))).toBeNull()
  })

  it('rounds the monthly estimate to whole yuan', () => {
    const price = summarizeAreaPrice(row({ priceP25: 3.333, priceMedian: 4.449, priceP75: 5.555 }))
    expect(price?.monthlyFor100Sqm).toEqual({ low: 9999, median: 13347, high: 16665 })
  })
})

const topBuildings = [
  { name: '东航滨江中心', listingCount: 379 },
  { name: '枫林科创园', listingCount: 388 },
]
const childAreas = [
  { name: '漕河泾', listingCount: 1837 },
  { name: '龙华', listingCount: 1052 },
]

describe('buildAreaLandingCopy', () => {
  const base = {
    cityName: '上海',
    location: { kind: 'district' as const, name: '徐汇区', description: null },
    parentName: null,
    stats: row(),
    topBuildings,
    childAreas,
  }

  it('writes a unique, data-bearing title / description for a district', () => {
    const copy = buildAreaLandingCopy(base)
    expect(copy.title).toBe('徐汇区写字楼出租 · 办公室租金与热门楼盘')
    expect(copy.description).toContain('上海徐汇区')
    expect(copy.description).toContain('323 栋')
    expect(copy.description).toContain('6,216 套')
    expect(copy.description).toContain('4.31 元/㎡/天')
    expect(copy.description).toContain('挂牌价')
    expect(copy.description.length).toBeLessThanOrEqual(160)
  })

  it('names the parent district in a business-area description', () => {
    const copy = buildAreaLandingCopy({
      ...base,
      location: { kind: 'business_area', name: '陆家嘴', description: null },
      parentName: '浦东新区',
      stats: row({ kind: 'business_area', slug: 'lujiazui', name: '陆家嘴', parentSlug: 'pudong', parentName: '浦东新区', listingCount: 1004, buildingCount: 47, priceMedian: 5.95 }),
      childAreas: [],
    })
    expect(copy.title).toBe('陆家嘴写字楼出租 · 办公室租金与热门楼盘')
    expect(copy.description).toContain('上海浦东新区陆家嘴')
    expect(copy.description).toContain('5.95 元/㎡/天')
  })

  it('drops the price sentence when there are not enough price samples', () => {
    const copy = buildAreaLandingCopy({ ...base, stats: row({ priceSampleCount: 3 }) })
    expect(copy.description).not.toContain('元/㎡/天')
    expect(copy.faq.some((item) => item.question.includes('租金'))).toBe(false)
    expect(copy.faq.some((item) => item.question.includes('月租'))).toBe(false)
  })

  it('uses the editor-written description as intro when present, data facts otherwise', () => {
    const edited = buildAreaLandingCopy({ ...base, location: { ...base.location, description: '  运营写的介绍。  ' } })
    expect(edited.intro).toBe('运营写的介绍。')
    const generated = buildAreaLandingCopy(base)
    expect(generated.intro).toContain('徐汇区')
    expect(generated.intro).toContain('323 栋')
    expect(generated.intro).toContain('漕河泾')
    // 只写数据事实，不出现编造的地理 / 历史描述
    expect(generated.intro).not.toMatch(/历史|传统|核心地段|商务中心|毗邻/)
  })

  it('builds FAQ answers only from the numbers it was given', () => {
    const { faq } = buildAreaLandingCopy(base)
    const byQuestion = (needle: string) => faq.find((item) => item.question.includes(needle))
    expect(byQuestion('写字楼租金')?.answer).toContain('4.31')
    expect(byQuestion('写字楼租金')?.answer).toContain('3.96')
    expect(byQuestion('写字楼租金')?.answer).toContain('5.10')
    expect(byQuestion('写字楼租金')?.answer).toContain('不是成交价')
    expect(byQuestion('100')?.answer).toContain('12,930')
    expect(byQuestion('100')?.answer).toContain('11,880')
    expect(byQuestion('100')?.answer).toContain('15,300')
    expect(byQuestion('100')?.answer).toContain('× 30')
    expect(byQuestion('热门写字楼')?.answer).toContain('枫林科创园')
    expect(byQuestion('商圈')?.answer).toContain('漕河泾')
    expect(byQuestion('多少套')?.answer).toContain('6,216')
  })

  it('orders hot buildings by listing count descending in the FAQ', () => {
    const answer = buildAreaLandingCopy(base).faq.find((item) => item.question.includes('热门写字楼'))?.answer ?? ''
    expect(answer.indexOf('枫林科创园')).toBeLessThan(answer.indexOf('东航滨江中心'))
  })

  it('omits the business-area question on a business-area page and when a district has none', () => {
    const area = buildAreaLandingCopy({ ...base, location: { kind: 'business_area', name: '漕河泾', description: null }, parentName: '徐汇区', childAreas: [] })
    expect(area.faq.some((item) => item.question.includes('哪些商圈'))).toBe(false)
    const noChildren = buildAreaLandingCopy({ ...base, childAreas: [] })
    expect(noChildren.faq.some((item) => item.question.includes('哪些商圈'))).toBe(false)
  })

  it('mentions listings quoted in other units without converting them', () => {
    const answer = buildAreaLandingCopy(base).faq.find((item) => item.question.includes('租金'))?.answer ?? ''
    expect(answer).toContain('另有 16 套')
    const none = buildAreaLandingCopy({ ...base, stats: row({ otherUnitCount: 0 }) }).faq.find((item) => item.question.includes('租金'))?.answer ?? ''
    expect(none).not.toContain('另有')
  })
})
