import { beforeEach, describe, expect, it, vi } from 'vitest'

const payloadState = vi.hoisted(() => ({
  find: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  findByID: vi.fn<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
}))

vi.mock('payload', () => ({
  getPayload: async () => ({
    find: payloadState.find,
    findByID: payloadState.findByID,
  }),
}))

vi.mock('@/payload.config', () => ({ default: {} }))

import {
  createPayloadSupplyAdapter,
  createSearchContext,
  parseSearchInput,
  searchBuildingsFiltered,
} from '@/domain/public-catalog'
import { DISTRICT_JINGAN, makeBuilding, makeHomepageAdapter } from './helpers/opt035-fixtures'

function listing(id: number): Record<string, unknown> {
  return {
    id,
    slug: `listing-${id}`,
    title: `房源 ${id}`,
    listingType: 'traditional-office',
    publicationStatus: 'published',
    reviewStatus: 'approved',
    supplyVisibilityHold: 'normal',
    gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
    // OPT-034 起供给商户直接读 listings.merchant，不再经关系表解析。
    merchant: {
      id: 50,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    building: {
      id: 10,
      city: { id: 100, status: 'active' },
      district: { id: 101, status: 'active' },
    },
  }
}

function building(id: number): Record<string, unknown> {
  return {
    id,
    slug: `building-${id}`,
    name: `Building ${id}`,
    status: 'published',
    operationalStatus: 'active',
    updatedAt: '2026-08-13T00:00:00.000Z',
    city: { id: 100, slug: 'shanghai', name: '上海市', status: 'active' },
    district: { id: 101, slug: 'jing-an', name: '静安区', status: 'active' },
    businessDistrict: { id: 102, slug: 'nanjing-west-road', name: '南京西路商圈', status: 'active' },
    nearestMetro: { id: 103, slug: 'west-nanjing-road', name: '南京西路站', status: 'active' },
  }
}

describe('Payload public catalog supply adapter', () => {
  beforeEach(() => {
    payloadState.find.mockReset()
    payloadState.findByID.mockReset()
  })

  // OPT-034：精筛不再批量查 listing-merchant-relations，商户直接读已展开的
  // listing.merchant（depth 由粗筛查询保证）。用例改为断言这一点——mock 里干脆
  // 不接 listing-merchant-relations 分支，一旦精筛又悄悄查关系表就会直接抛错。
  it('fine-filters directly off listing.merchant, never queries the relation table', async () => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listings') {
        return { docs: [listing(1), listing(2)], hasNextPage: false, nextPage: null }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const adapter = createPayloadSupplyAdapter()
    const docs = await adapter.findEffectiveListings(
      parseSearchInput(new URLSearchParams()),
      createSearchContext('shanghai', new Date('2026-07-30T00:00:00.000Z')),
    )

    expect(docs.map((doc) => doc.id)).toEqual([1, 2])
    expect(
      payloadState.find.mock.calls.some(([params]) =>
        params.collection === 'listing-merchant-relations'),
    ).toBe(false)
  })

  it('caps a broad coarse candidate scan at an explicit production limit', async () => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listings') {
        const page = typeof params.page === 'number' ? params.page : 1
        return {
          docs: Array.from({ length: 200 }, (_, index) => listing((page - 1) * 200 + index + 1)),
          hasNextPage: true,
          nextPage: page + 1,
        }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const adapter = createPayloadSupplyAdapter()
    await adapter.findEffectiveListings(
      parseSearchInput(new URLSearchParams()),
      createSearchContext('shanghai', new Date('2026-07-30T00:00:00.000Z')),
    )

    expect(
      payloadState.find.mock.calls.filter(([params]) => params.collection === 'listings'),
    ).toHaveLength(5)
  })

  it.each([
    ['楼盘名称', '静安嘉里中心', 'name'],
    ['行政区', '静安区', 'district.name'],
    ['商圈', '南京西路商圈', 'businessDistrict.name'],
    ['地铁站', '南京西路站', 'nearestMetro.name'],
  ] as const)('用受控楼盘关联查询命中%s后返回有效房源', async (_label, keyword, field) => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'buildings') {
        const where = params.where as Record<string, unknown>
        const alternatives = where.or as readonly Record<string, unknown>[]
        expect(alternatives).toEqual(expect.arrayContaining([
          { [field]: { contains: keyword } },
        ]))
        expect(params).toEqual(expect.objectContaining({ depth: 0, limit: 1000 }))
        return { docs: [{ id: 10 }], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listing-reports') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listings') {
        const where = params.where as Record<string, unknown>
        expect(where.and).toEqual(expect.arrayContaining([
          {
            or: [
              { title: { contains: keyword } },
              { building: { in: [10] } },
            ],
          },
        ]))
        return { docs: [listing(1)], hasNextPage: false, nextPage: null }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const adapter = createPayloadSupplyAdapter()
    const docs = await adapter.findEffectiveListings(
      parseSearchInput(new URLSearchParams({ q: keyword })),
      createSearchContext('shanghai', new Date('2026-07-30T00:00:00.000Z')),
    )

    expect(docs.map((doc) => doc.id)).toEqual([1])
  })

  it('房源标题可直接命中，不因无关联楼盘命中而漏空', async () => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'buildings') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listing-reports') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listings') {
        const where = params.where as Record<string, unknown>
        expect(where.or).toEqual([
          { availableFrom: { exists: false } },
          { availableFrom: { less_than_equal: '2026-08-01' } },
        ])
        expect(where.and).toEqual(expect.arrayContaining([
          { or: [{ title: { contains: '东南角景观办公室' } }] },
        ]))
        return { docs: [{ ...listing(1), title: '东南角景观办公室' }], hasNextPage: false, nextPage: null }
      }
      throw new Error(`unexpected collection ${String(params.collection)}`)
    })

    const docs = await createPayloadSupplyAdapter().findEffectiveListings(
      parseSearchInput(new URLSearchParams({
        q: '东南角景观办公室',
        availableBefore: '2026-08-01',
      })),
      createSearchContext('shanghai', new Date('2026-07-30T00:00:00.000Z')),
    )
    expect(docs).toHaveLength(1)
  })

  it('uses a unique compound sort so equal timestamps stay stable across building pages', async () => {
    const fixtures = [building(1), building(2), building(3), building(4)]
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection !== 'buildings') {
        throw new Error(`unexpected collection ${String(params.collection)}`)
      }
      const page = typeof params.page === 'number' ? params.page : 1
      const stable = Array.isArray(params.sort) && params.sort.join(',') === '-updatedAt,id'
      const docs = stable
        ? fixtures.slice((page - 1) * 2, page * 2)
        : page === 1 ? [fixtures[0], fixtures[1]] : [fixtures[1], fixtures[2]]
      return {
        docs,
        hasNextPage: page === 1,
        nextPage: page === 1 ? 2 : null,
      }
    })

    const adapter = createPayloadSupplyAdapter()
    const context = createSearchContext('shanghai')
    const first = await adapter.findEffectiveBuildingsPage(context, { page: 1, limit: 2 })
    const second = await adapter.findEffectiveBuildingsPage(context, { page: 2, limit: 2 })

    expect([...first.docs, ...second.docs].map(({ id }) => id)).toEqual([1, 2, 3, 4])
    expect(payloadState.find.mock.calls.map(([params]) => params.sort)).toEqual([
      ['-updatedAt', 'id'],
      ['-updatedAt', 'id'],
    ])
  })

  it('枚举超过 200 个公开楼盘后再统计、分面与分页，不静默截断', async () => {
    const fixtures = Array.from({ length: 250 }, (_, index) => makeBuilding({
      id: index + 1,
      slug: `building-${String(index + 1).padStart(3, '0')}`,
      district: index < 225
        ? DISTRICT_JINGAN
        : { ...DISTRICT_JINGAN, id: 102, slug: 'huang-pu', name: '黄浦区' },
    }))
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection !== 'buildings') {
        throw new Error(`unexpected collection ${String(params.collection)}`)
      }
      const page = typeof params.page === 'number' ? params.page : 1
      const limit = typeof params.limit === 'number' ? params.limit : 200
      const start = (page - 1) * limit
      const docs = fixtures.slice(start, start + limit)
      return {
        docs,
        hasNextPage: start + limit < fixtures.length,
        nextPage: start + limit < fixtures.length ? page + 1 : null,
      }
    })

    const context = createSearchContext('shanghai')
    const production = createPayloadSupplyAdapter()
    const all = await production.findEffectiveBuildings(context)
    const result = await searchBuildingsFiltered(
      { sort: 'stock-desc', page: 11, pageSize: 24 },
      context,
      makeHomepageAdapter({
        findEffectiveBuildings: async () => all,
        aggregateEffectiveSupplyByBuildings: async () => new Map(),
      }),
    )

    expect(all).toHaveLength(250)
    expect(result.totalDocs).toBe(250)
    expect(result.totalPages).toBe(11)
    expect(result.docs.map((doc) => doc.slug)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `building-${241 + index}`),
    ])
    expect(new Map(result.facets.districts.map((item) => [item.slug, item.count]))).toEqual(
      new Map([['jingan', 225], ['huang-pu', 25]]),
    )
  })
})
