import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildAreaLandingStatsQuery, mapAreaLandingStatsRow } from '@/domain/public-catalog/area-landing-sql'
import { EFFECTIVE_BUILDING_WHERE, EFFECTIVE_LISTING_WHERE } from '@/domain/public-catalog/effective-supply-sql'
import { LISTING_PRICE_AMOUNT_SQL, LISTING_PRICE_UNIT_SQL } from '@/domain/public-catalog/listing-query-sql'
import { createSearchContext } from '@/domain/public-catalog/types'

const ctx = createSearchContext('shanghai', new Date('2026-10-16T00:00:00.000Z'), 'lease')

describe('区域落地页统计 SQL', () => {
  const query = buildAreaLandingStatsQuery(ctx)

  it('绑定参数顺序与全部公开 SQL 一致：asOf、楼盘不限、城市、租赁频道', () => {
    expect(query.values).toEqual(['2026-10-16T00:00:00.000Z', null, 'shanghai', 'lease'])
  })

  it('每个绑定参数都被引用，不留无法推断类型的 $n', () => {
    const referenced = new Set([...query.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))
    expect([...referenced].sort((a, b) => a - b)).toEqual(query.values.map((_, index) => index + 1))
  })

  it('资格谓词原样来自有效供给的两段，价格归一来自房源查询的导出片段', () => {
    expect(query.text).toContain(EFFECTIVE_LISTING_WHERE)
    expect(query.text).toContain(EFFECTIVE_BUILDING_WHERE)
    expect(query.text).toContain(LISTING_PRICE_AMOUNT_SQL)
    expect(query.text).toContain(LISTING_PRICE_UNIT_SQL)
  })

  it('源码里没有第二份有效供给条件或单位映射', () => {
    const source = readFileSync(join(process.cwd(), 'src/domain/public-catalog/area-landing-sql.ts'), 'utf8')
    for (const forbidden of ['publication_status', 'review_status', 'supply_visibility_hold', 'qualification_status', 'price_period', 'rent_unit']) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('只对 元/㎡/天 求分位数，其余单位只计数', () => {
    expect(query.text).toContain("price_unit = 'rmb-sqm-day'")
    expect(query.text).toContain('FILTER (WHERE is_day_price)')
    expect(query.text).toContain('other_unit_count')
    expect(query.text).toMatch(/percentile_cont\(0\.25\)/)
    expect(query.text).toMatch(/percentile_cont\(0\.5\)/)
    expect(query.text).toMatch(/percentile_cont\(0\.75\)/)
  })

  it('一次扫描出行政区与商圈两类分组', () => {
    expect(query.text).toContain("'district' AS kind")
    expect(query.text).toContain("'business_area' AS kind")
    expect(query.text.match(/UNION ALL/g)).toHaveLength(1)
  })
})

describe('mapAreaLandingStatsRow', () => {
  const base = {
    kind: 'business_area', id: 40, slug: 'caohejing', name: '漕河泾', parent_slug: 'xuhui', parent_name: '徐汇区',
    listing_count: 1837, building_count: 72, price_sample_count: 1800, price_min: 1.9, price_p25: 3.52,
    price_median: 4.14, price_p75: 4.34, price_max: 8.5, other_unit_count: 37, area_median: 280.5,
    last_updated_at: new Date('2026-10-15T08:00:00.000Z'),
  }

  it('把 SQL 行映射成统计行，时间转 ISO', () => {
    expect(mapAreaLandingStatsRow(base)).toEqual({
      kind: 'business_area', id: 40, slug: 'caohejing', name: '漕河泾', parentSlug: 'xuhui', parentName: '徐汇区',
      listingCount: 1837, buildingCount: 72, priceSampleCount: 1800, priceMin: 1.9, priceP25: 3.52,
      priceMedian: 4.14, priceP75: 4.34, priceMax: 8.5, otherUnitCount: 37, areaMedian: 280.5,
      lastUpdatedAt: '2026-10-15T08:00:00.000Z',
    })
  })

  it('无报价样本时分位数为 null，而不是 0', () => {
    const row = mapAreaLandingStatsRow({ ...base, price_sample_count: 0, price_min: null, price_p25: null, price_median: null, price_p75: null, price_max: null, area_median: null, last_updated_at: null })
    expect(row).toMatchObject({ priceMin: null, priceP25: null, priceMedian: null, priceP75: null, priceMax: null, areaMedian: null, lastUpdatedAt: null })
  })

  it('字符串形态的数字（numeric 被驱动当字符串返回）也能解析', () => {
    expect(mapAreaLandingStatsRow({ ...base, price_median: '4.14' }).priceMedian).toBe(4.14)
  })

  it.each([
    ['未知 kind', { kind: 'metro' }],
    ['缺 slug', { slug: null }],
    ['计数不是整数', { listing_count: 1.5 }],
    ['计数为负', { listing_count: -1 }],
    ['分位数不是数字', { price_median: 'abc' }],
  ])('拒绝畸形行：%s', (_, patch) => {
    expect(() => mapAreaLandingStatsRow({ ...base, ...patch })).toThrow(/area_landing_stats_row_invalid/)
  })
})
