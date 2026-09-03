import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMiniBuildingsMock, getMiniBuildingDetailMock } = vi.hoisted(() => ({
  getMiniBuildingsMock: vi.fn(),
  getMiniBuildingDetailMock: vi.fn(),
}))

vi.mock('@/lib/mini-program/catalog-service', () => ({
  getMiniBuildings: getMiniBuildingsMock,
  getMiniBuildingDetail: getMiniBuildingDetailMock,
}))

import { GET as getBuildingsRoute, runtime as buildingsRuntime } from '@/app/api/mini/v1/buildings/route'
import { GET as getBuildingDetailRoute, runtime as detailRuntime } from '@/app/api/mini/v1/buildings/[slug]/route'

const BUILDINGS_DATA = {
  items: [
    {
      id: 'b-1',
      slug: 'heng-long-plaza',
      name: '恒隆广场',
      district: '静安区',
      address: '南京西路 1266 号',
      grade: 'A',
      completedYear: 2001,
      totalFloors: 66,
      occupancyRate: 92,
      activeListingCount: 14,
      priceRange: {
        min: 10.2,
        max: 13.8,
        unit: '元/㎡·天',
        displayUnit: 'rmb-sqm-day',
        text: '10.2–13.8 元/㎡·天',
      },
      coverImage: null,
      nearestMetro: {
        line: '2/12/13号线',
        station: '南京西路站',
        distanceMeters: 180,
      },
    },
  ],
  inactiveItems: [],
  pagination: {
    page: 1,
    pageSize: 20,
    totalDocs: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
  totalActiveCount: 1,
  totalInactiveCount: 0,
}

const DETAIL_DATA = {
  id: 'b-1',
  slug: 'heng-long-plaza',
  name: '恒隆广场',
  address: '南京西路 1266 号',
  district: '静安区',
  grade: 'A',
  completedYear: 2001,
  totalFloors: 66,
  standardFloorArea: 2000,
  elevators: { passenger: 12, cargo: 2 },
  parkingSpaces: 600,
  propertyManagementCompany: '第一太平戴维斯',
  propertyFee: 38,
  gallery: [],
  activeListingCount: 14,
  groupedListings: [],
  nearestMetro: {
    line: '2/12/13号线',
    station: '南京西路站',
    distanceMeters: 180,
  },
  comparableBuildings: [],
}

const AS_OF = '2026-09-03T00:00:00.000Z'

beforeEach(() => {
  getMiniBuildingsMock.mockReset()
  getMiniBuildingDetailMock.mockReset()
})

describe('GET /api/mini/v1/buildings', () => {
  it('passes URL to getMiniBuildings and returns standard success response', async () => {
    getMiniBuildingsMock.mockResolvedValue({ asOf: AS_OF, data: BUILDINGS_DATA })
    const request = new Request('https://example.test/api/mini/v1/buildings?city=shanghai&page=1')

    const response = await getBuildingsRoute(request)
    const body = await response.json()

    expect(buildingsRuntime).toBe('nodejs')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body).toEqual({
      ok: true,
      data: BUILDINGS_DATA,
      meta: {
        requestId: expect.any(String),
        asOf: AS_OF,
        maxAgeSeconds: 300,
      },
    })
  })

  it('returns 404 when city is not supported', async () => {
    getMiniBuildingsMock.mockResolvedValue(null)
    const request = new Request('https://example.test/api/mini/v1/buildings?city=unknown')

    const response = await getBuildingsRoute(request)
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('city_not_found')
  })
})

describe('GET /api/mini/v1/buildings/[slug]', () => {
  it('returns building detail when slug and city exist', async () => {
    getMiniBuildingDetailMock.mockResolvedValue({
      status: 'ok',
      snapshot: { asOf: AS_OF, data: DETAIL_DATA },
    })
    const request = new Request('https://example.test/api/mini/v1/buildings/heng-long-plaza?city=shanghai')

    const response = await getBuildingDetailRoute(request, {
      params: Promise.resolve({ slug: 'heng-long-plaza' }),
    })
    const body = await response.json()

    expect(detailRuntime).toBe('nodejs')
    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: DETAIL_DATA,
      meta: {
        requestId: expect.any(String),
        asOf: AS_OF,
        maxAgeSeconds: 300,
      },
    })
  })

  it('returns 404 when building is not found', async () => {
    getMiniBuildingDetailMock.mockResolvedValue({ status: 'building_not_found' })
    const request = new Request('https://example.test/api/mini/v1/buildings/not-exist?city=shanghai')

    const response = await getBuildingDetailRoute(request, {
      params: Promise.resolve({ slug: 'not-exist' }),
    })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.code).toBe('building_not_found')
  })
})
