import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMiniListingsMock } = vi.hoisted(() => ({
  getMiniListingsMock: vi.fn(),
}))

vi.mock('@/lib/mini-program/catalog-service', () => ({
  getMiniListings: getMiniListingsMock,
}))

import { GET, runtime } from '@/app/api/mini/v1/listings/route'
const LISTINGS_DATA = {
  items: [],
  pagination: {
    page: 2,
    pageSize: 24,
    totalDocs: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: true,
  },
  canonicalQuery: 'city=shanghai&page=2&priceUnit=rmb-sqm-day',
  currentPriceUnit: 'rmb-sqm-day',
  filters: [],
}
const AS_OF = '2026-08-26T00:00:00.000Z'

beforeEach(() => {
  getMiniListingsMock.mockReset()
})

describe('GET /api/mini/v1/listings', () => {
  it('passes the complete URL to the service and returns a private no-store snapshot with one request ID', async () => {
    getMiniListingsMock.mockResolvedValue({ asOf: AS_OF, data: LISTINGS_DATA })
    const request = new Request(
      'https://example.test/api/mini/v1/listings?city=shanghai&priceUnit=rmb-sqm-day&page=2',
      { headers: { 'x-request-id': 'list.req-1' } },
    )

    const response = await GET(request)
    const body = await response.json()

    expect(runtime).toBe('nodejs')
    expect(getMiniListingsMock).toHaveBeenCalledWith(new URL(request.url))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(requestId).not.toBe('list.req-1')
    expect(body).toEqual({
      ok: true,
      data: LISTINGS_DATA,
      meta: { requestId, asOf: AS_OF, maxAgeSeconds: 300 },
    })
    expect(body.meta.requestId).toBe(response.headers.get('x-request-id'))
  })

  it('returns a stable uncached 404 when the city is unavailable', async () => {
    getMiniListingsMock.mockResolvedValue(null)

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/listings?city=not-live',
      { headers: { 'x-request-id': 'list.not-found' } },
    ))

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: 'city_not_found', message: '城市暂未开放' },
      meta: { requestId },
    })
  })

  it('returns a stable uncached 503 without leaking service details or the query', async () => {
    getMiniListingsMock.mockRejectedValue(new Error('database timeout on private_table'))

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/listings?city=shanghai&internalFilter=secret-query',
      { headers: { 'x-request-id': 'list.failed' } },
    ))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body).toEqual({
      ok: false,
      error: { code: 'service_unavailable', message: '服务暂不可用，请稍后重试' },
      meta: { requestId },
    })
    expect(serialized).not.toContain('database')
    expect(serialized).not.toContain('private_table')
    expect(serialized).not.toContain('secret-query')
    expect(serialized).not.toContain('stack')
  })
})
