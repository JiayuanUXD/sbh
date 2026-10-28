import { describe, expect, it, vi } from 'vitest'

import {
  buildAreaLandingIndex,
  getAreaLandingIndex,
  getAreaLandingPage,
} from '@/domain/public-catalog/area-landing-facade'
import type { AreaLandingStatsRow } from '@/domain/public-catalog/area-landing'
import type { BuildingFilteredResult } from '@/domain/public-catalog/facade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import type { SupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import type { searchBuildingsFiltered } from '@/domain/public-catalog/facade'
import { createSearchContext } from '@/domain/public-catalog/types'
import type { Article, Location } from '@/payload-types'

const ctx = createSearchContext('shanghai', new Date('2026-10-16T00:00:00.000Z'), 'lease')

function location(overrides: Partial<Location> & Pick<Location, 'id' | 'slug' | 'name' | 'type'>): Location {
  return { immutableCode: `X-${overrides.id}`, status: 'active', frontendVisible: true, updatedAt: '', createdAt: '', ...overrides }
}
const xuhui = location({ id: 15, slug: 'xuhui', name: '徐汇区', type: 'district', description: null })
const pudong = location({ id: 3, slug: 'pudong', name: '浦东新区', type: 'district', description: '运营写的浦东介绍' })
const caohejing = location({ id: 40, slug: 'caohejing', name: '漕河泾', type: 'business_area', parent: xuhui })
const longhua = location({ id: 41, slug: 'longhua', name: '龙华', type: 'business_area', parent: xuhui })
const lujiazui = location({ id: 42, slug: 'lujiazui', name: '陆家嘴', type: 'business_area', parent: pudong })

function stats(overrides: Partial<AreaLandingStatsRow> & Pick<AreaLandingStatsRow, 'kind' | 'id' | 'slug' | 'name'>): AreaLandingStatsRow {
  return {
    parentSlug: null, parentName: null, listingCount: 100, buildingCount: 10, priceSampleCount: 100,
    priceMin: 2, priceP25: 3, priceMedian: 4, priceP75: 5, priceMax: 9, otherUnitCount: 0, areaMedian: 200,
    lastUpdatedAt: '2026-10-15T00:00:00.000Z', ...overrides,
  }
}
const statRows: AreaLandingStatsRow[] = [
  stats({ kind: 'district', id: 15, slug: 'xuhui', name: '徐汇区', listingCount: 6216 }),
  stats({ kind: 'district', id: 3, slug: 'pudong', name: '浦东新区', listingCount: 5241 }),
  stats({ kind: 'business_area', id: 40, slug: 'caohejing', name: '漕河泾', parentSlug: 'xuhui', parentName: '徐汇区', listingCount: 1837 }),
  stats({ kind: 'business_area', id: 41, slug: 'longhua', name: '龙华', parentSlug: 'xuhui', parentName: '徐汇区', listingCount: 1052 }),
  stats({ kind: 'business_area', id: 42, slug: 'lujiazui', name: '陆家嘴', parentSlug: 'pudong', parentName: '浦东新区', listingCount: 1004 }),
  // 有供给但后台没勾「前台可见」的商圈：绝不能生成页面
  stats({ kind: 'business_area', id: 99, slug: 'hidden-area', name: '隐藏商圈', parentSlug: 'xuhui', parentName: '徐汇区', listingCount: 500 }),
]

function building(id: number, name: string, listingCount: number): BuildingSummaryViewModel {
  return { id, slug: `b-${id}`, name, address: '', citySlug: 'shanghai', cityName: '上海', listingCount }
}
function article(id: number, slug: string): Article {
  return { id, slug, title: `资讯${id}`, status: 'published', publishedAt: '2026-10-01T00:00:00.000Z' } as unknown as Article
}

type ArticleQuery = (locationIds: readonly number[], limit: number) => Promise<readonly Article[]>

function makeAdapter(overrides: Partial<SupplyAdapter> = {}) {
  const findArticlesByRelatedLocations = vi.fn<ArticleQuery>(async () => [article(1, 'a1')])
  const adapter = {
    findAreaLandingStats: vi.fn(async () => statRows),
    findEffectiveDistricts: vi.fn(async () => [xuhui, pudong]),
    findEffectiveBusinessAreas: vi.fn(async () => [caohejing, longhua, lujiazui]),
    findArticlesByRelatedLocations,
    ...overrides,
  } as unknown as SupplyAdapter
  return Object.assign(adapter, { articleQuery: findArticlesByRelatedLocations })
}

const DIMENSION_HITS = { district: 0, businessArea: 0, grade: 0, metro: 0, leasableArea: 0, onlyWithStock: 0 }

function searchResult(docs: readonly BuildingSummaryViewModel[]): BuildingFilteredResult {
  return {
    docs, groups: { withStock: docs, withoutStock: [] }, totalDocs: docs.length, withStockTotal: docs.length,
    withoutStockTotal: 0, unfilteredTotalDocs: docs.length, page: 1, totalPages: 1,
    facets: { districts: [], businessAreas: [], grades: [], metroLines: [], metros: [] },
    dimensionHits: DIMENSION_HITS,
  }
}

describe('buildAreaLandingIndex', () => {
  it('只收前台可见的地点，隐藏商圈即使有供给也不生成', () => {
    const index = buildAreaLandingIndex({ stats: statRows, districts: [xuhui, pudong], businessAreas: [caohejing, longhua, lujiazui] })
    expect(index.map((entry) => entry.slug)).toEqual(['xuhui', 'pudong', 'caohejing', 'longhua', 'lujiazui'])
  })

  it('可见但没有任何有效供给的地点生成零值行（页面存在，但不收录）', () => {
    const index = buildAreaLandingIndex({ stats: [], districts: [xuhui], businessAreas: [caohejing] })
    const district = index.find((entry) => entry.slug === 'xuhui')!
    expect(district).toMatchObject({ listingCount: 0, buildingCount: 0, priceSampleCount: 0, priceMedian: null, lastUpdatedAt: null, indexable: false })
    // 零值商圈的所属行政区取自地点表的 parent，而不是 SQL 行
    expect(index.find((entry) => entry.slug === 'caohejing')).toMatchObject({ parentSlug: 'xuhui', parentName: '徐汇区' })
  })

  it('带上后台录入的介绍，并按门槛标记 indexable', () => {
    const index = buildAreaLandingIndex({
      stats: [stats({ kind: 'district', id: 3, slug: 'pudong', name: '浦东新区', listingCount: 9 })],
      districts: [pudong], businessAreas: [],
    })
    expect(index[0]).toMatchObject({ description: '运营写的浦东介绍', indexable: false })
  })

  it('用地点表里的当前名称，而不是 SQL 里的旧快照', () => {
    const renamed = location({ id: 15, slug: 'xuhui', name: '徐汇新区', type: 'district' })
    const index = buildAreaLandingIndex({ stats: statRows, districts: [renamed], businessAreas: [] })
    expect(index[0].name).toBe('徐汇新区')
  })
})

describe('getAreaLandingIndex', () => {
  it('同一份有效供给 SQL 统计 + 可见地点表求交，租赁频道', async () => {
    const adapter = makeAdapter()
    const index = await getAreaLandingIndex(ctx, adapter)
    expect(adapter.findAreaLandingStats).toHaveBeenCalledWith(ctx)
    expect(index).toHaveLength(5)
  })

  it('适配器不支持统计查询时 fail-closed 抛错，而不是静默返回空集', async () => {
    const adapter = makeAdapter({ findAreaLandingStats: undefined })
    await expect(getAreaLandingIndex(ctx, adapter)).rejects.toThrow(/area_landing_stats_unsupported/)
  })
})

describe('getAreaLandingPage', () => {
  const buildings = [building(1, '枫林科创园', 388), building(2, '东航滨江中心', 379)]
  const searchBuildings = vi.fn<typeof searchBuildingsFiltered>(async () => searchResult(buildings))

  it('不存在 / 不可见 / 非区域类 slug 返回 null', async () => {
    const adapter = makeAdapter()
    expect(await getAreaLandingPage('nope', ctx, adapter, searchBuildings)).toBeNull()
    expect(await getAreaLandingPage('hidden-area', ctx, adapter, searchBuildings)).toBeNull()
    expect(await getAreaLandingPage('shanghai', ctx, adapter, searchBuildings)).toBeNull()
  })

  it('行政区页：下辖商圈按在租套数降序，资讯按本区 + 下辖商圈 id 查询', async () => {
    const adapter = makeAdapter()
    const page = await getAreaLandingPage('xuhui', ctx, adapter, searchBuildings)
    expect(page?.entry.slug).toBe('xuhui')
    expect(page?.parent).toBeNull()
    expect(page?.childAreas.map((entry) => entry.slug)).toEqual(['caohejing', 'longhua'])
    expect(page?.siblingAreas).toEqual([])
    const ids = adapter.articleQuery.mock.calls[0][0]
    expect([...ids].sort((a, b) => a - b)).toEqual([15, 40, 41])
    expect(page?.articles.map((item) => item.slug)).toEqual(['a1'])
  })

  it('商圈页：带所属行政区、同区兄弟商圈（不含自己），资讯按本商圈 + 所属行政区查询', async () => {
    const adapter = makeAdapter()
    const page = await getAreaLandingPage('caohejing', ctx, adapter, searchBuildings)
    expect(page?.parent?.slug).toBe('xuhui')
    expect(page?.childAreas).toEqual([])
    expect(page?.siblingAreas.map((entry) => entry.slug)).toEqual(['longhua'])
    const ids = adapter.articleQuery.mock.calls[0][0]
    expect([...ids].sort((a, b) => a - b)).toEqual([15, 40])
  })

  it('热门楼盘：行政区用 district 条件、商圈用 businessArea 条件，最多 6 栋', async () => {
    const many = Array.from({ length: 9 }, (_, i) => building(i + 1, `楼${i}`, 100 - i))
    const search = vi.fn<typeof searchBuildingsFiltered>(async () => searchResult(many))
    const adapter = makeAdapter()
    const districtPage = await getAreaLandingPage('xuhui', ctx, adapter, search)
    expect(search.mock.calls[0][0]).toMatchObject({ district: ['xuhui'] })
    expect(search.mock.calls[0][0]).not.toHaveProperty('businessArea')
    expect(districtPage?.topBuildings).toHaveLength(6)
    await getAreaLandingPage('caohejing', ctx, adapter, search)
    expect(search.mock.calls[1][0]).toMatchObject({ businessArea: ['caohejing'] })
  })

  it('只取有在租的楼盘作热门楼盘，暂无在租的不上榜', async () => {
    const withoutStock = building(3, '暂无在租楼', 0)
    const search = vi.fn<typeof searchBuildingsFiltered>(async () => ({ ...searchResult(buildings), groups: { withStock: buildings, withoutStock: [withoutStock] } }))
    const page = await getAreaLandingPage('xuhui', ctx, makeAdapter(), search)
    expect(page?.topBuildings.map((b) => b.name)).toEqual(['枫林科创园', '东航滨江中心'])
  })

  it('价格摘要来自统计行；样本不足时为 null', async () => {
    const thin = statRows.map((row) => row.slug === 'xuhui' ? { ...row, priceSampleCount: 2 } : row)
    const adapter = makeAdapter({ findAreaLandingStats: vi.fn(async () => thin) })
    expect((await getAreaLandingPage('xuhui', ctx, adapter, searchBuildings))?.price).toBeNull()
    expect((await getAreaLandingPage('pudong', ctx, adapter, searchBuildings))?.price?.median).toBe(4)
  })

  it('零供给的可见地点：页面存在，不查热门楼盘也不查资讯（避免白打库）', async () => {
    const adapter = makeAdapter({ findAreaLandingStats: vi.fn(async () => []) })
    const search = vi.fn<typeof searchBuildingsFiltered>(async () => searchResult([]))
    const page = await getAreaLandingPage('xuhui', ctx, adapter, search)
    expect(page?.entry.indexable).toBe(false)
    expect(page?.topBuildings).toEqual([])
    expect(search).not.toHaveBeenCalled()
  })

  it('资讯查询缺失时降级为空列表，不拖垮页面', async () => {
    const adapter = makeAdapter({ findArticlesByRelatedLocations: undefined })
    const page = await getAreaLandingPage('xuhui', ctx, adapter, searchBuildings)
    expect(page?.articles).toEqual([])
  })
})
