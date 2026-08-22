import { describe, expect, it } from 'vitest'
import { applyBuildingFilters, sortBuildings, partitionByStock } from '@/domain/public-catalog/building-search'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { createSearchContext, searchBuildingsFiltered } from '@/domain/public-catalog'
import type { Location } from '@/payload-types'
import { DISTRICT_JINGAN, makeBuilding, makeHomepageAdapter } from './helpers/opt035-fixtures'

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
  it('onlyWithStock：有 listingCount 但面积缺失的楼盘仍算有在租（OR 语义，不是只认 leasableArea）', () => {
    const docsWithCount = [
      b({ slug: 'count-only', listingCount: 3 }),
      b({ slug: 'neither' }),
    ]
    expect(applyBuildingFilters(docsWithCount, { onlyWithStock: true, sort: 'stock-desc', page: 1, pageSize: 24 }).map(d => d.slug))
      .toEqual(['count-only'])
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
  it('stock-desc 按 listingCount 排，不是 leasableArea 的别名——两种排序在这组数据上给出相反的顺序', () => {
    // a 套数多但面积小；b 套数少但面积大：area-desc 与 stock-desc 必须给出相反顺序，
    // 这才是真正证明 stock-desc 没有偷偷退化成 area-desc 的断言（同序的构造证明不了什么）。
    const docs = [
      b({ slug: 'a', listingCount: 50, leasableArea: 1000 }),
      b({ slug: 'b', listingCount: 10, leasableArea: 9000 }),
    ]
    expect(sortBuildings(docs, 'stock-desc').map(d => d.slug)).toEqual(['a', 'b'])
    expect(sortBuildings(docs, 'area-desc').map(d => d.slug)).toEqual(['b', 'a'])
  })
  it('stock-desc 把缺失 listingCount 排到末尾而不是当作 0 混在中间', () => {
    const docs = [b({ slug: 'x' }), b({ slug: 'y', listingCount: 5 }), b({ slug: 'z', listingCount: 9 })]
    expect(sortBuildings(docs, 'stock-desc').map(d => d.slug)).toEqual(['z', 'y', 'x'])
  })
  it('stock-desc 同值时按 slug 稳定收束', () => {
    const docs = [b({ slug: 'q', listingCount: 7 }), b({ slug: 'p', listingCount: 7 })]
    expect(sortBuildings(docs, 'stock-desc').map(d => d.slug)).toEqual(['p', 'q'])
  })
  it('grade 按声明序位排序：超甲级 > 甲级 > 创意园区 > 独栋办公', () => {
    const docs = [
      b({ slug: 'so', grade: 'serviced-office' as never }),
      b({ slug: 'cp', grade: 'creative-park' as never }),
      b({ slug: 'ga', grade: 'grade-a' as never }),
      b({ slug: 'sga', grade: 'super-grade-a' as never }),
    ]
    expect(sortBuildings(docs, 'grade').map(d => d.slug)).toEqual(['sga', 'ga', 'cp', 'so'])
  })
  it('grade 缺失或未识别排到末尾，不落进中间', () => {
    const docs = [
      b({ slug: 'so', grade: 'serviced-office' as never }),
      b({ slug: 'missing' }),
      b({ slug: 'sga', grade: 'super-grade-a' as never }),
      b({ slug: 'unknown', grade: 'not-a-real-grade' as never }),
    ]
    expect(sortBuildings(docs, 'grade').map(d => d.slug)).toEqual(['sga', 'so', 'missing', 'unknown'])
  })
  it('grade 同值时按 slug 稳定收束', () => {
    const docs = [
      b({ slug: 'b', grade: 'grade-a' as never }),
      b({ slug: 'a', grade: 'grade-a' as never }),
    ]
    expect(sortBuildings(docs, 'grade').map(d => d.slug)).toEqual(['a', 'b'])
  })
})

describe('partitionByStock', () => {
  it('按有无在租面积分两组，各自保持入参顺序', () => {
    const docs = [b({ slug: 'a', leasableArea: 10 }), b({ slug: 'b' }), b({ slug: 'c', leasableArea: 0 }), b({ slug: 'd', leasableArea: 5 })]
    const { withStock, withoutStock } = partitionByStock(docs)
    expect(withStock.map(d => d.slug)).toEqual(['a', 'd'])
    expect(withoutStock.map(d => d.slug)).toEqual(['b', 'c'])
  })
  it('有 listingCount 但面积缺失的楼盘仍进 withStock（OR 语义）——否则会渲染成一句用户可见的假话', () => {
    const docs = [
      b({ slug: 'count-only', listingCount: 12 }),
      b({ slug: 'area-only', leasableArea: 800 }),
      b({ slug: 'neither' }),
    ]
    const { withStock, withoutStock } = partitionByStock(docs)
    expect(withStock.map(d => d.slug)).toEqual(['count-only', 'area-only'])
    expect(withoutStock.map(d => d.slug)).toEqual(['neither'])
  })
})

describe('searchBuildingsFiltered', () => {
  it('facets 在筛选前的全集上计算：选中一个区域后，被筛掉的区域仍出现在 facets 里，且计数是筛选前的', async () => {
    const DISTRICT_HUANGPU: Location = {
      ...DISTRICT_JINGAN,
      id: 2,
      name: '黄浦',
      slug: 'huangpu',
      immutableCode: 'TEST-2',
    }
    const b1 = makeBuilding({ id: 1, slug: 'b1', district: DISTRICT_JINGAN })
    const b2 = makeBuilding({ id: 2, slug: 'b2', district: DISTRICT_JINGAN })
    const b3 = makeBuilding({ id: 3, slug: 'b3', district: DISTRICT_HUANGPU })

    const adapter = makeHomepageAdapter({
      findEffectiveBuildings: async () => [b1, b2, b3],
    })
    const ctx = createSearchContext('shanghai', new Date('2026-08-21T00:00:00Z'))

    const result = await searchBuildingsFiltered(
      { district: ['jingan'], sort: 'stock-desc', page: 1, pageSize: 24 },
      ctx,
      adapter,
    )

    // 结果集确实被筛选过：只剩静安的两栋楼
    expect(result.docs.map((d) => d.slug)).toEqual(['b1', 'b2'])

    // 但 facets 仍然报告筛选前的全集分布——黄浦没有从筛选条里消失，
    // 计数也是筛选前的 1，不是筛选后的 0（或干脆缺席）。
    const districtFacets = new Map(result.facets.districts.map((f) => [f.slug, f.count]))
    expect(districtFacets.get('jingan')).toBe(2)
    expect(districtFacets.get('huangpu')).toBe(1)
  })

  it('分页作用于合并后的序列：有在租排完才排暂无在租，一页可以跨组边界', async () => {
    // 20 个有在租 + 10 个暂无在租，每页 24：
    //   第 1 页 = 20 个有在租 + 4 个暂无在租（跨组边界的那一页）
    //   第 2 页 = 剩下 6 个暂无在租
    // 如果哪天有人改成「每组各自分页」，第 1 页会变成 20 + 10 或 24 + 24，这条会红。
    const raws = [
      ...Array.from({ length: 20 }, (_, i) => makeBuilding({ id: i + 1, slug: `s${String(i).padStart(2, '0')}` })),
      ...Array.from({ length: 10 }, (_, i) => makeBuilding({ id: 100 + i, slug: `v${String(i).padStart(2, '0')}` })),
    ]
    const adapter = makeHomepageAdapter({
      findEffectiveBuildings: async () => raws,
      // 只有 s* 那 20 个有在租供给；v* 完全不出现在聚合结果里（= 暂无在租）
      aggregateEffectiveSupplyByBuildings: async (ids: readonly (number | string)[]) =>
        new Map(
          ids
            .filter((id) => Number(id) <= 20)
            .map((id) => [String(id), { area: 100 * Number(id), count: 21 - Number(id) }]),
        ),
    })
    const ctx = createSearchContext('shanghai', new Date('2026-08-21T00:00:00Z'))
    const input = { sort: 'stock-desc' as const, page: 1, pageSize: 24 as const }

    const first = await searchBuildingsFiltered(input, ctx, adapter)
    expect(first.totalDocs).toBe(30)
    expect(first.totalPages).toBe(2)
    expect(first.docs).toHaveLength(24)
    expect(first.groups.withStock).toHaveLength(20)
    expect(first.groups.withoutStock).toHaveLength(4)
    // 合并序列的顺序：有在租全部排在前面
    expect(first.docs.slice(0, 20).every((d) => d.slug.startsWith('s'))).toBe(true)
    expect(first.docs.slice(20).every((d) => d.slug.startsWith('v'))).toBe(true)
    // 分组标题的计数是跨页总量，不是当页条数
    expect(first.withStockTotal).toBe(20)
    expect(first.withoutStockTotal).toBe(10)
    expect(first.unfilteredTotalDocs).toBe(30)

    const second = await searchBuildingsFiltered({ ...input, page: 2 }, ctx, adapter)
    expect(second.docs).toHaveLength(6)
    expect(second.groups.withStock).toHaveLength(0)
    expect(second.groups.withoutStock).toHaveLength(6)
  })

  it('各筛选维度的计数剥掉自己那一个维度、保留其余条件（选中一项后其余候选不归零）', async () => {
    const DISTRICT_HUANGPU: Location = {
      ...DISTRICT_JINGAN,
      id: 2,
      name: '黄浦',
      slug: 'huangpu',
      immutableCode: 'TEST-2',
    }
    const raws = [
      makeBuilding({ id: 1, slug: 'b1', district: DISTRICT_JINGAN, grade: 'grade-a' }),
      makeBuilding({ id: 2, slug: 'b2', district: DISTRICT_JINGAN, grade: 'super-grade-a' }),
      makeBuilding({ id: 3, slug: 'b3', district: DISTRICT_HUANGPU, grade: 'grade-a' }),
    ]
    const adapter = makeHomepageAdapter({ findEffectiveBuildings: async () => raws })
    const ctx = createSearchContext('shanghai', new Date('2026-08-21T00:00:00Z'))

    const result = await searchBuildingsFiltered(
      { district: ['jingan'], sort: 'stock-desc', page: 1, pageSize: 24 },
      ctx,
      adapter,
    )
    // 等级计数**保留**了「静安」这个条件（静安只有 1 个甲级、1 个超甲级），
    // 不是全库分布（那样甲级会报 2，点进去只有 1 个）。
    const grades = new Map(result.facets.grades.map((g) => [g.value, g.count]))
    expect(grades.get('grade-a')).toBe(1)
    expect(grades.get('super-grade-a')).toBe(1)
    // 退路命中数同源：取消「位置」后回到 3 个
    expect(result.dimensionHits.district).toBe(3)
    expect(result.dimensionHits.grade).toBe(2)
  })
})
