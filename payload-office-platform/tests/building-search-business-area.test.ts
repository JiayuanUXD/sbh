import { describe, expect, it } from 'vitest'
import {
  applyBuildingFilters,
  buildBuildingCanonicalParams,
  BUILDING_CLEARABLE_DIMENSIONS,
  BUILDING_DIMENSION_PARAM_KEYS,
  omitBuildingSearchDimensions,
  parseBuildingSearchInput,
} from '@/domain/public-catalog/building-search'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { createSearchContext, searchBuildingsFiltered } from '@/domain/public-catalog'
import type { Location } from '@/payload-types'
import { DISTRICT_JINGAN, makeArea, makeBuilding, makeHomepageAdapter } from './helpers/opt035-fixtures'

/**
 * OPT-103：楼盘列表补「商圈」维度，口径逐字对齐房源页（OPT-099）。
 * 这里锁三件事：解析/canonical 的往返、内存过滤的命中判据、facet 的剥离口径。
 */

const b = (over: Partial<BuildingSummaryViewModel> & { slug: string }): BuildingSummaryViewModel =>
  ({ id: 1, name: over.slug, address: 'addr', citySlug: 'shanghai', cityName: '上海', ...over }) as BuildingSummaryViewModel

describe('parseBuildingSearchInput / buildBuildingCanonicalParams：businessArea', () => {
  it('解析为去重数组，canonical 排序后输出、位置紧跟 district', () => {
    const input = parseBuildingSearchInput(new URLSearchParams('?district=jingan&businessArea=nanjing-xi-lu&businessArea=jingan-temple&businessArea=nanjing-xi-lu'))
    expect(input.businessArea).toEqual(['nanjing-xi-lu', 'jingan-temple'])
    expect(buildBuildingCanonicalParams(input).toString()).toBe(
      'district=jingan&businessArea=jingan-temple&businessArea=nanjing-xi-lu',
    )
  })

  it('缺省不进 canonical，空值丢弃', () => {
    const input = parseBuildingSearchInput(new URLSearchParams('?businessArea=&businessArea=%20'))
    expect(input.businessArea).toBeUndefined()
    expect(buildBuildingCanonicalParams(input).toString()).toBe('')
  })
})

describe('applyBuildingFilters：businessArea', () => {
  const docs = [
    b({ slug: 'a', businessDistrict: { id: 11, slug: 'nanjing-xi-lu', name: '南京西路' } }),
    b({ slug: 'b', businessDistrict: { id: 12, slug: 'jingan-temple', name: '静安寺' } }),
    b({ slug: 'c' }),
  ]

  it('按 businessDistrict.slug 命中，多值取并集', () => {
    expect(applyBuildingFilters(docs, { businessArea: ['nanjing-xi-lu'], sort: 'stock-desc', page: 1, pageSize: 24 }).map((d) => d.slug)).toEqual(['a'])
    expect(applyBuildingFilters(docs, { businessArea: ['nanjing-xi-lu', 'jingan-temple'], sort: 'stock-desc', page: 1, pageSize: 24 }).map((d) => d.slug)).toEqual(['a', 'b'])
  })

  it('没有商圈的楼盘在任何商圈条件下都不命中（缺失 ≠ 任意）', () => {
    expect(applyBuildingFilters(docs, { businessArea: ['jingan-temple'], sort: 'stock-desc', page: 1, pageSize: 24 }).map((d) => d.slug)).toEqual(['b'])
  })
})

describe('维度清单', () => {
  it('businessArea 是可清除维度，占 URL 键 businessArea，omit 只删它', () => {
    expect(BUILDING_CLEARABLE_DIMENSIONS).toContain('businessArea')
    expect(BUILDING_DIMENSION_PARAM_KEYS.businessArea).toEqual(['businessArea'])
    const input = parseBuildingSearchInput(new URLSearchParams('?district=jingan&businessArea=x&grade=grade-a'))
    const omitted = omitBuildingSearchDimensions(input, ['businessArea'])
    expect(omitted.businessArea).toBeUndefined()
    expect(omitted.district).toEqual(['jingan'])
    expect(omitted.grade).toEqual(['grade-a'])
  })
})

describe('searchBuildingsFiltered：商圈 facet 与级联', () => {
  const DISTRICT_HUANGPU: Location = { ...DISTRICT_JINGAN, id: 2, name: '黄浦', slug: 'huangpu', immutableCode: 'TEST-2' }
  const AREA_NJXL = makeArea({ id: 11, slug: 'nanjing-xi-lu', name: '南京西路' })
  const AREA_TEMPLE = makeArea({ id: 12, slug: 'jingan-temple', name: '静安寺' })
  const AREA_BUND = makeArea({ id: 21, slug: 'bund', name: '外滩', parent: DISTRICT_HUANGPU.id })
  const raws = [
    makeBuilding({ id: 1, slug: 'b1', district: DISTRICT_JINGAN, businessDistrict: AREA_NJXL }),
    makeBuilding({ id: 2, slug: 'b2', district: DISTRICT_JINGAN, businessDistrict: AREA_TEMPLE }),
    makeBuilding({ id: 3, slug: 'b3', district: DISTRICT_HUANGPU, businessDistrict: AREA_BUND }),
  ]
  const adapter = makeHomepageAdapter({ findEffectiveBuildings: async () => raws })
  const ctx = createSearchContext('shanghai', new Date('2026-09-19T00:00:00Z'))

  it('businessAreas 计数剥掉商圈、保留 district：选了静安只见静安的两个商圈各 1', async () => {
    const result = await searchBuildingsFiltered({ district: ['jingan'], businessArea: ['nanjing-xi-lu'], sort: 'stock-desc', page: 1, pageSize: 24 }, ctx, adapter)
    expect(result.docs.map((d) => d.slug)).toEqual(['b1'])
    const areas = new Map(result.facets.businessAreas.map((a) => [a.slug, a.count]))
    expect(areas.get('nanjing-xi-lu')).toBe(1)
    expect(areas.get('jingan-temple')).toBe(1)
    // 清单取自全集：外滩仍在清单里，只是计数 0（视图层按「不显示 0」丢）
    expect(areas.get('bund')).toBe(0)
    expect(result.facets.businessAreas.find((a) => a.slug === 'jingan-temple')?.name).toBe('静安寺')
  })

  it('districts 计数连商圈一起剥：选了商圈后其余区不归零，用户切得走', async () => {
    const result = await searchBuildingsFiltered({ district: ['jingan'], businessArea: ['nanjing-xi-lu'], sort: 'stock-desc', page: 1, pageSize: 24 }, ctx, adapter)
    const districts = new Map(result.facets.districts.map((d) => [d.slug, d.count]))
    expect(districts.get('jingan')).toBe(2)
    expect(districts.get('huangpu')).toBe(1)
    expect(result.dimensionHits.businessArea).toBe(2)
  })
})
