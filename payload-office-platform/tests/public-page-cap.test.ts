import { describe, expect, it } from 'vitest'
import { capTotalPages, isCapped, MAX_PUBLIC_PAGE } from '@/domain/public-catalog/page-cap'
import { buildPagination, paginate } from '@/domain/public-catalog/stable-sort'
import { buildListingPageQuery } from '@/domain/public-catalog/listing-query-sql'
import { buildBuildingPageQuery } from '@/domain/public-catalog/building-query-sql'
import { createSearchContext } from '@/domain/public-catalog/types'

/** 取出 `LIMIT $n OFFSET $m` 对应的绑定值。 */
function limitOffset(query: { text: string; values: readonly unknown[] }) {
  const match = /LIMIT \$(\d+) OFFSET \$(\d+)/.exec(query.text)
  expect(match).not.toBeNull()
  return { limit: query.values[Number(match![1]) - 1], offset: query.values[Number(match![2]) - 1] }
}

describe('OPT-128 页码封顶', () => {
  it('常量与纯函数', () => {
    expect(MAX_PUBLIC_PAGE).toBe(50)
    expect([10, 50, 51, 1460].map(capTotalPages)).toEqual([10, 50, 50, 50])
    expect(isCapped(50)).toBe(false)
    expect(isCapped(51)).toBe(true)
  })

  it('buildPagination：封顶、页码不钳制', () => {
    expect(buildPagination(35000, 1, 24)).toMatchObject({ totalPages: 50, capped: true, hasNextPage: true })
    expect(buildPagination(35000, 50, 24)).toMatchObject({ hasNextPage: false })
    expect(buildPagination(35000, 51, 24)).toMatchObject({ page: 51, totalPages: 50, hasNextPage: false })
    expect(buildPagination(480, 3, 24)).toMatchObject({ totalPages: 20, capped: false })
    expect(buildPagination(0, 1, 24)).toMatchObject({ totalPages: 1, capped: false })
  })

  it('paginate：内存切片封顶，page > 50 返回空', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => i)
    const p50 = paginate(rows, 50, 24)
    expect(p50.docs).toHaveLength(24)
    expect(p50.totalPages).toBe(50)
    const p51 = paginate(rows, 51, 24)
    expect(p51.docs).toEqual([])
    expect(p51.totalDocs).toBe(2000)
    expect(p51.totalPages).toBe(50)
  })

  it('房源页 SQL：page=51 不产生偏移扫描，page=50 正常', () => {
    const ctx = createSearchContext('shanghai')
    const base = { sort: 'recommended', pageSize: 24 } as never
    const q50 = buildListingPageQuery({ ...(base as object), page: 50 } as never, ctx)
    expect(limitOffset(q50)).toEqual({ limit: 24, offset: 49 * 24 })
    const q51 = buildListingPageQuery({ ...(base as object), page: 51 } as never, ctx)
    expect(limitOffset(q51)).toEqual({ limit: 0, offset: 0 })
    expect(q51.text).toContain('COUNT(*)')
  })

  it('楼盘页 SQL：page=51 不产生偏移扫描，page=50 正常', () => {
    const ctx = createSearchContext('shanghai')
    const input = { sort: 'stock-desc', pageSize: 24 }
    const q50 = buildBuildingPageQuery({ ...input, page: 50 } as never, ctx, [1])
    expect(limitOffset(q50)).toEqual({ limit: 24, offset: 49 * 24 })
    const q51 = buildBuildingPageQuery({ ...input, page: 51 } as never, ctx, [1])
    expect(limitOffset(q51)).toEqual({ limit: 0, offset: 0 })
    expect(q51.text).toContain("'totalDocs'")
  })
})
