/**
 * 房源关键词 SQL 的结构守卫：楼盘侧匹配必须是「全量楼盘 + is_hit 标记」的命中集，再左连房源。
 *
 * 为什么钉结构：2026-11 的性能改写里，命中集最初写成 `WHERE (b.name ILIKE ...)` 只留命中楼盘，
 * 规划器把它估成几行、选了嵌套循环，对 5.5 万房源逐行重扫命中集，最慢的词从 0.4s 变成 9s。
 * 结果集合与排序都对，只有 SQL 形状变坏——单测看不出来，只能把形状钉住。
 * 行为等价由 `listing-query-postgres.test.ts` 与 `artifacts/verification/PERF-search-listing-prematch/compare.ts` 保证。
 */

import { describe, expect, it } from 'vitest'

import { buildListingFacetsQuery, buildListingPageQuery } from '@/domain/public-catalog/listing-query-sql'
import { createSearchContext } from '@/domain/public-catalog/types'

const ctx = createSearchContext('shanghai')
const input = { sort: 'recommended', page: 1, pageSize: 24 } as const

/** 去掉所有命中集 CTE，剩下主查询。 */
const withoutHitCtes = (text: string) => text.replace(/(?:term_hit_\d+|q_hit) AS MATERIALIZED \([\s\S]*?\n {2}\),?\s*/g, '')

describe('房源关键词 SQL：楼盘侧命中集', () => {
  const query = buildListingPageQuery({ ...input }, ctx, { terms: ['徐家汇', '大厦'], mode: 'and' })

  it('每个词项一个命中集，主查询按 building_id 左连', () => {
    expect(query.text).toContain('term_hit_0 AS MATERIALIZED')
    expect(query.text).toContain('term_hit_1 AS MATERIALIZED')
    expect(query.text).not.toContain('term_hit_2')
    expect(query.text).toContain('LEFT JOIN term_hit_0 ON term_hit_0.id = l.building_id')
  })

  it('命中集不在 CTE 里过滤楼盘（保留全量楼盘，规划器才估得准、走哈希连接）', () => {
    const cte = query.text.slice(query.text.indexOf('term_hit_0 AS'), query.text.indexOf('term_hit_1 AS'))
    expect(cte).toContain('AS is_hit')
    expect(cte).not.toMatch(/\bWHERE\b/)
  })

  it('楼盘 / 行政区 / 商圈 / 地铁 / 地址的 ILIKE 只出现在命中集里，主查询只剩标题', () => {
    const main = withoutHitCtes(query.text)
    expect(main).toContain('l.title ILIKE')
    for (const column of ['b.name', 'dist.name', 'ba.name', 'metro.name', 'b.address']) {
      expect(main, column).not.toContain(`${column} ILIKE`)
    }
  })

  it('得分次序：标题三档先于楼盘侧，楼盘侧未命中记 0', () => {
    expect(query.text).toMatch(/WHEN l\.title ILIKE \$\d+ THEN 100\s+WHEN l\.title ILIKE \$\d+ THEN 80\s+WHEN l\.title ILIKE \$\d+ THEN 60\s+ELSE COALESCE\(term_hit_0\.building_score, 0\) END/)
  })

  it('用户输入只走绑定参数', () => {
    expect(query.text).not.toContain('徐家汇')
    expect(query.values).toContain('%徐家汇%')
  })
})

describe('房源 q 筛选与无关键词', () => {
  it('q 走同样的命中集（不带得分与地址）', () => {
    const query = buildListingPageQuery({ ...input, q: '陆家嘴' }, ctx)
    expect(query.text).toContain('q_hit AS MATERIALIZED')
    expect(query.text).toContain('LEFT JOIN q_hit ON q_hit.id = l.building_id')
    expect(query.text).not.toContain('building_score')
    expect(query.text).not.toContain('b.address')
    expect(withoutHitCtes(query.text)).not.toContain('b.name ILIKE')
  })

  it('分面查询共用同一份过滤', () => {
    const query = buildListingFacetsQuery({ ...input, q: '陆家嘴' }, ctx)
    expect(query.text).toContain('q_hit AS MATERIALIZED')
  })

  it('没有关键词时不生成命中集', () => {
    expect(buildListingPageQuery({ ...input }, ctx).text).not.toMatch(/term_hit|q_hit/)
  })
})
