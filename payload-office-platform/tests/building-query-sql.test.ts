import { describe, expect, it } from 'vitest'
import { buildBuildingPageQuery } from '@/domain/public-catalog/building-query-sql'
import { createSearchContext } from '@/domain/public-catalog/types'

describe('楼盘数据库筛选分页', () => {
  it('用户筛选值全部绑定，并保留独立分面和维度退路计数', () => {
    const query = buildBuildingPageQuery({ district: ["jingan' OR 1=1--"],
      businessArea: ['nanjingxilu'], leasableAreaMin: 1000, onlyWithStock: true,
      sort: 'stock-desc', page: 186, pageSize: 24 }, createSearchContext('shanghai'), [2, 1])
    expect(query.text).not.toContain("jingan' OR 1=1--")
    expect(query.values).toContainEqual(["jingan' OR 1=1--"])
    expect(query.values).toContain(185 * 24)
    expect(query.text).toContain('dimensionHits')
    expect(query.text).toContain('FILTER (WHERE')
    expect(query.text).toContain('WITH ORDINALITY')
    expect(query.text).toContain('rep.supply_paused = true')
    expect(query.text).toContain('LIMIT')
    expect(query.text).toContain('OFFSET')
  })
})
