import { describe, expect, it } from 'vitest'
import { buildBuildingFilterRows, type BuildingFacets } from '@/lib/frontend/building-filter-rows'
import { parseBuildingSearchInput } from '@/domain/public-catalog'

/** OPT-103：楼盘列表商圈行，级联口径逐字对齐房源页（listing-filter-rows.ts）。 */

const FACETS: BuildingFacets = {
  districts: [
    { slug: 'jingan', name: '静安', count: 2 },
    { slug: 'huangpu', name: '黄浦', count: 1 },
  ],
  businessAreas: [
    { slug: 'nanjing-xi-lu', name: '南京西路', count: 1 },
    { slug: 'jingan-temple', name: '静安寺', count: 1 },
    { slug: 'bund', name: '外滩', count: 0 },
  ],
  grades: [{ value: 'grade-a', count: 3 }],
  metros: [],
}

const rowsFor = (query: string) =>
  buildBuildingFilterRows({ input: parseBuildingSearchInput(new URLSearchParams(query)), facets: FACETS })

describe('楼盘筛选行：商圈', () => {
  it('行序：位置 → 商圈 → 等级 → 地铁 → 在租面积 → 竣工年代；没有开关行', () => {
    expect(rowsFor('').rows.map((r) => r.key)).toEqual([
      'district', 'businessArea', 'grade', 'metro', 'leasableAreaMin', 'completedAfter',
    ])
  })

  it('未选行政区时商圈候选为空（整行由 FilterFormC 隐藏）', () => {
    expect(rowsFor('').rows.find((r) => r.key === 'businessArea')!.options).toEqual([])
  })

  it('选了行政区后商圈候选出现，计数 0 的不渲染、已选的保留', () => {
    const row = rowsFor('?district=jingan&businessArea=bund').rows.find((r) => r.key === 'businessArea')!
    expect(row.options.map((o) => o.value)).toEqual(['nanjing-xi-lu', 'jingan-temple', 'bund'])
    expect(row.options.find((o) => o.value === 'bund')!.count).toBeUndefined()
    expect(row.activeValue).toBe('bund')
  })

  it('位置行级联清商圈', () => {
    expect(rowsFor('').rows.find((r) => r.key === 'district')!.clearsKeys).toEqual(['businessArea'])
  })

  it('商圈维度：有词表印名字，查不到只印维度名，绝不回显 slug', () => {
    const known = rowsFor('?district=jingan&businessArea=jingan-temple').dimensions.find((d) => d.dimension === 'businessArea')!
    expect(known.active).toBe(true)
    expect(known.activeText).toBe('静安寺')
    expect(known.paramKeys).toEqual(['businessArea'])
    const unknown = rowsFor('?businessArea=not-a-real-area').dimensions.find((d) => d.dimension === 'businessArea')!
    expect(unknown.active).toBe(true)
    expect(unknown.activeText).toBeNull()
  })

  it('onlyWithStock 维度仍在清单里（老链接 ?onlyWithStock=1 要能补 chip）', () => {
    const dim = rowsFor('?onlyWithStock=1').dimensions.find((d) => d.dimension === 'onlyWithStock')!
    expect(dim.active).toBe(true)
    expect(dim.activeText).toBe('仅看有在租')
  })
})
