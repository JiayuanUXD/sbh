import { describe, expect, it } from 'vitest'
import { buildRecommendationCandidatesQuery } from '@/domain/public-catalog/listing-query-sql'
import { createSearchContext } from '@/domain/public-catalog/types'

// 2026-10-14 生产事故：推荐候选 SQL 把局部条件拼在整城 FROM 之后，规划器把 1536 行的
// `locations dist` 无条件交叉连进房源，单条查询跑 6~25 分钟、占满连接池。语义对齐由
// listing-query-postgres.test.ts 在真实 PostgreSQL 上校验；这里锁住防交叉放大的结构。
const ctx = createSearchContext('shanghai', new Date('2026-10-14T00:00:00.000Z'), 'lease')
const scopes = {
  商圈: { businessDistrictId: 10, districtId: 7, buildingId: 570 },
  行政区: { businessDistrictId: null, districtId: 7, buildingId: 570 },
  楼盘: { businessDistrictId: null, districtId: null, buildingId: 570 },
} as const

describe('详情页推荐候选 SQL', () => {
  it.each(Object.entries(scopes))('%s范围：先在 MATERIALIZED CTE 圈楼盘，主查询不再连 locations', (_, scope) => {
    const query = buildRecommendationCandidatesQuery(scope, ctx)!
    const boundary = query.text.indexOf('FROM scoped b')
    expect(boundary).toBeGreaterThan(0)
    const cte = query.text.slice(0, boundary)
    const main = query.text.slice(boundary)
    expect(cte).toMatch(/^WITH scoped AS MATERIALIZED \(/)
    expect(cte).toMatch(/JOIN locations city ON city\.id = b\.city_id/)
    expect(cte).toMatch(/JOIN locations dist ON dist\.id = b\.district_id/)
    expect(main).toMatch(/^FROM scoped b\s+JOIN listings l ON l\.building_id = b\.id/)
    expect(main).not.toMatch(/\blocations\b/)
  })

  it.each(Object.entries(scopes))('%s范围：每个绑定参数都被引用，不留无法推断类型的 $n', (_, scope) => {
    const query = buildRecommendationCandidatesQuery(scope, ctx)!
    const referenced = new Set([...query.text.matchAll(/\$(\d+)/g)].map(match => Number(match[1])))
    expect([...referenced].sort((a, b) => a - b)).toEqual(query.values.map((_, index) => index + 1))
  })

  it('按商圈 → 行政区 → 同楼盘的优先级取范围，三者皆空不查', () => {
    expect(buildRecommendationCandidatesQuery(scopes.商圈, ctx)!.text).toContain('b.business_district_id = $5')
    expect(buildRecommendationCandidatesQuery(scopes.商圈, ctx)!.values[4]).toBe(10)
    expect(buildRecommendationCandidatesQuery(scopes.行政区, ctx)!.text).toContain('b.district_id = $5')
    expect(buildRecommendationCandidatesQuery(scopes.行政区, ctx)!.values[4]).toBe(7)
    expect(buildRecommendationCandidatesQuery(scopes.楼盘, ctx)!.text).toContain('b.id = ANY($2::int[])')
    expect(buildRecommendationCandidatesQuery(scopes.楼盘, ctx)!.values[1]).toEqual([570])
    expect(buildRecommendationCandidatesQuery({ businessDistrictId: null, districtId: null, buildingId: null }, ctx))
      .toBeNull()
  })
})
