/**
 * F0.4 单测：URL 解析与 ListingFilters 构造
 *
 * 设计依据：FRONTEND_AGENT.md §13、specs/frontend-mvp/design.md §15
 *
 * 守护不变量：
 *   - URL 解析视为 unknown 输入，通过类型守卫收窄
 *   - 字段缺失或非法时降级为默认值（page=1、rentMin/Max=undefined）
 *   - 不向 where 注入未确认字段（district 由查询门面额外解析）
 *   - 查询参数复现：相同 URLSearchParams → 相同 ListingFilters
 */

import { describe, expect, it } from 'vitest'
import {
  buildListingWhere,
  parseListingFilters,
  type ListingFilters,
} from '@/lib/frontend/filters'

// ---------------------------------------------------------------------------
// parseListingFilters
// ---------------------------------------------------------------------------

describe('parseListingFilters', () => {
  it('解析 district/type/rent 范围/q 复合参数', () => {
    const sp = new URLSearchParams(
      'district=jingan&type=serviced-office&rentMin=2000&rentMax=5000&q=江景',
    )
    const f = parseListingFilters(sp)
    expect(f).toEqual({
      district: 'jingan',
      listingType: 'serviced-office',
      rentMin: 2000,
      rentMax: 5000,
      q: '江景',
      page: 1,
    })
  })

  it('空参数 → 全部字段默认值', () => {
    const f = parseListingFilters(new URLSearchParams())
    expect(f).toEqual({
      district: undefined,
      listingType: undefined,
      rentMin: undefined,
      rentMax: undefined,
      q: undefined,
      page: 1,
    })
  })

  it('page 缺失默认为 1', () => {
    expect(parseListingFilters(new URLSearchParams()).page).toBe(1)
  })

  it('page=0 → 回收为 1（禁止小于 1）', () => {
    expect(parseListingFilters(new URLSearchParams('page=0')).page).toBe(1)
  })

  it('page=-3 → 回收为 1', () => {
    expect(parseListingFilters(new URLSearchParams('page=-3')).page).toBe(1)
  })

  it('page=NaN → 回收为 1', () => {
    expect(parseListingFilters(new URLSearchParams('page=abc')).page).toBe(1)
  })

  it('page=999 正常解析（边界由查询层限制）', () => {
    expect(parseListingFilters(new URLSearchParams('page=999')).page).toBe(999)
  })

  it('rentMin 非数字 → 忽略', () => {
    expect(parseListingFilters(new URLSearchParams('rentMin=abc')).rentMin).toBeUndefined()
  })

  it('rentMin=Infinity → 忽略（防非法值）', () => {
    expect(
      parseListingFilters(new URLSearchParams('rentMin=Infinity')).rentMin,
    ).toBeUndefined()
  })

  it('rentMin=12.5 解析为数字', () => {
    expect(parseListingFilters(new URLSearchParams('rentMin=12.5')).rentMin).toBe(12.5)
  })

  it('rentMin=0 解析为 0（合法下界）', () => {
    expect(parseListingFilters(new URLSearchParams('rentMin=0')).rentMin).toBe(0)
  })

  it('q 包含中文与特殊字符', () => {
    const f = parseListingFilters(new URLSearchParams('q=南京西路 1788 号'))
    expect(f.q).toBe('南京西路 1788 号')
  })

  it('相同 URLSearchParams 复现相同 filters（URL 可分享）', () => {
    const sp = new URLSearchParams('district=pudong&type=coworking&page=3')
    const f1 = parseListingFilters(sp)
    const f2 = parseListingFilters(new URLSearchParams(sp.toString()))
    expect(f1).toEqual(f2)
  })
})

// ---------------------------------------------------------------------------
// buildListingWhere
// ---------------------------------------------------------------------------

describe('buildListingWhere', () => {
  it('默认包含 status=available（TODO: M4.7 后改为有效供给谓词）', () => {
    const f: ListingFilters = { page: 1 }
    const w = buildListingWhere(f)
    expect(w).toEqual({ status: { equals: 'available' } })
  })

  it('listingType 被注入 equals 条件', () => {
    const w = buildListingWhere({ listingType: 'coworking', page: 1 })
    const listingType = w.listingType as { equals: string } | undefined
    expect(listingType?.equals).toBe('coworking')
  })

  it('rentMin/rentMax 同时存在 → greater_than_equal + less_than_equal', () => {
    const w = buildListingWhere({ rentMin: 100, rentMax: 500, page: 1 })
    const rent = w.rent as { greater_than_equal?: number; less_than_equal?: number }
    expect(rent.greater_than_equal).toBe(100)
    expect(rent.less_than_equal).toBe(500)
  })

  it('仅 rentMin 存在 → 只注入 greater_than_equal', () => {
    const w = buildListingWhere({ rentMin: 200, page: 1 })
    const rent = w.rent as { greater_than_equal?: number; less_than_equal?: number }
    expect(rent.greater_than_equal).toBe(200)
    expect(rent.less_than_equal).toBeUndefined()
  })

  it('仅 rentMax 存在 → 只注入 less_than_equal', () => {
    const w = buildListingWhere({ rentMax: 5000, page: 1 })
    const rent = w.rent as { greater_than_equal?: number; less_than_equal?: number }
    expect(rent.less_than_equal).toBe(5000)
    expect(rent.greater_than_equal).toBeUndefined()
  })

  it('q 存在 → 注入 title contains', () => {
    const w = buildListingWhere({ q: '江景', page: 1 })
    const title = w.title as { contains: string } | undefined
    expect(title?.contains).toBe('江景')
  })

  it('district 不在 buildListingWhere 中处理（由 queries.ts 解析 building IDs）', () => {
    const w = buildListingWhere({ district: 'jingan', page: 1 })
    expect(w.district).toBeUndefined()
    // district 通过 building IDs 过滤，注入到 where.building.in
  })

  it('所有字段同时存在 → 复合 where', () => {
    const w = buildListingWhere({
      listingType: 'serviced-office',
      rentMin: 5000,
      rentMax: 20000,
      q: '静安',
      page: 2,
    })
    // q 通过 title.contains 注入，所以 where 键为 title 而非 q
    expect(Object.keys(w).sort()).toEqual(['listingType', 'rent', 'status', 'title'].sort())
  })

  it('返回的 where 不包含 page（page 在查询层 limit/page 参数处理）', () => {
    const w = buildListingWhere({ page: 999 })
    expect(w).not.toHaveProperty('page')
  })

  it('返回的 where 不包含 district 字段', () => {
    const w = buildListingWhere({ district: 'pudong', page: 1 })
    expect(w).not.toHaveProperty('district')
  })
})
