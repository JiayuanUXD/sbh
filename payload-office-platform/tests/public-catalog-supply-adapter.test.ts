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
    building: {
      id: 10,
      city: { id: 100, status: 'active' },
      district: { id: 101, status: 'active' },
    },
  }
}

function activeRelation(listingId: number): Record<string, unknown> {
  return {
    id: listingId + 10_000,
    listing: listingId,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    merchant: {
      id: 50,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2027-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
  }
}

describe('Payload public catalog supply adapter', () => {
  beforeEach(() => {
    payloadState.find.mockReset()
    payloadState.findByID.mockReset()
  })

  it('batch-loads active relations instead of issuing one query per listing', async () => {
    payloadState.find.mockImplementation(async (params) => {
      if (params.collection === 'listing-reports') {
        return { docs: [], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listings') {
        return { docs: [listing(1), listing(2)], hasNextPage: false, nextPage: null }
      }
      if (params.collection === 'listing-merchant-relations') {
        const where = params.where as {
          and?: Array<{ listing?: { equals?: number } }>
        }
        const singleListingId = where.and?.[0]?.listing?.equals
        return {
          docs: singleListingId == null
            ? [activeRelation(1), activeRelation(2)]
            : [activeRelation(singleListingId)],
          hasNextPage: false,
          nextPage: null,
        }
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
      payloadState.find.mock.calls.filter(([params]) =>
        params.collection === 'listing-merchant-relations'),
    ).toHaveLength(1)
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
      if (params.collection === 'listing-merchant-relations') {
        return { docs: [], hasNextPage: false, nextPage: null }
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
})
