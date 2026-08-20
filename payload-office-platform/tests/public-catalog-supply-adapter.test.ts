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
} from '@/domain/public-catalog'

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
})
