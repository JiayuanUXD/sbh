import { describe, expect, it } from 'vitest'
import { applyBuildingFilters, sortBuildings, partitionByStock } from '@/domain/public-catalog/building-search'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'

const b = (over: Partial<BuildingSummaryViewModel> & { slug: string }): BuildingSummaryViewModel =>
  ({ id: 1, name: over.slug, address: 'addr', citySlug: 'shanghai', cityName: '上海', ...over }) as BuildingSummaryViewModel

describe('applyBuildingFilters', () => {
  const docs = [
    b({ slug: 'a', district: { slug: 'jingan', name: '静安区' } as never, grade: 'a' as never, leasableArea: 1200 }),
    b({ slug: 'b', district: { slug: 'huangpu', name: '黄浦区' } as never, grade: 'b' as never, leasableArea: 0 }),
    b({ slug: 'c', district: { slug: 'jingan', name: '静安区' } as never, grade: 'a' as never }),
  ]
  it('区域多选取并集', () => {
    expect(applyBuildingFilters(docs, { district: ['jingan'], sort: 'stock-desc', page: 1, pageSize: 24 }).map(d => d.slug)).toEqual(['a', 'c'])
  })
  it('onlyWithStock 排除 leasableArea 缺失与 0', () => {
    expect(applyBuildingFilters(docs, { onlyWithStock: true, sort: 'stock-desc', page: 1, pageSize: 24 }).map(d => d.slug)).toEqual(['a'])
  })
  it('在租面积区间按 leasableArea 过滤，缺失视为不命中', () => {
    const out = applyBuildingFilters(docs, { leasableAreaMin: 1000, sort: 'stock-desc', page: 1, pageSize: 24 })
    expect(out.map(d => d.slug)).toEqual(['a'])
  })
  it('无条件时原样返回', () => {
    expect(applyBuildingFilters(docs, { sort: 'stock-desc', page: 1, pageSize: 24 })).toHaveLength(3)
  })
})

describe('sortBuildings', () => {
  it('area-desc 把缺失面积排到末尾而不是当作 0 混在中间', () => {
    const docs = [b({ slug: 'x' }), b({ slug: 'y', leasableArea: 500 }), b({ slug: 'z', leasableArea: 900 })]
    expect(sortBuildings(docs, 'area-desc').map(d => d.slug)).toEqual(['z', 'y', 'x'])
  })
  it('同值时按 slug 稳定收束', () => {
    const docs = [b({ slug: 'q', leasableArea: 100 }), b({ slug: 'p', leasableArea: 100 })]
    expect(sortBuildings(docs, 'area-desc').map(d => d.slug)).toEqual(['p', 'q'])
  })
})

describe('partitionByStock', () => {
  it('按有无在租面积分两组，各自保持入参顺序', () => {
    const docs = [b({ slug: 'a', leasableArea: 10 }), b({ slug: 'b' }), b({ slug: 'c', leasableArea: 0 }), b({ slug: 'd', leasableArea: 5 })]
    const { withStock, withoutStock } = partitionByStock(docs)
    expect(withStock.map(d => d.slug)).toEqual(['a', 'd'])
    expect(withoutStock.map(d => d.slug)).toEqual(['b', 'c'])
  })
})
