import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMiniListingDetailMock } = vi.hoisted(() => ({
  getMiniListingDetailMock: vi.fn(),
}))

vi.mock('@/lib/mini-program/catalog-service', () => ({
  getMiniListingDetail: getMiniListingDetailMock,
}))

import { GET, runtime } from '@/app/api/mini/v1/listings/[slug]/route'
const DETAIL_DATA = {
  listing: { id: 'listing-1', slug: 'west-lake-office', title: '西湖办公室' },
  monthlyCost: {
    currency: 'CNY',
    period: 'month',
    propertyFeeInclusion: 'excluded',
    rent: 12000,
    propertyFee: 800,
    total: 12800,
    assumptions: [],
  },
  relatedListings: [],
}
const AS_OF = '2026-08-26T03:00:00.000Z'

beforeEach(() => {
  getMiniListingDetailMock.mockReset()
})

describe('GET /api/mini/v1/listings/[slug]', () => {
  it('passes the complete city and slug to the service and returns a private no-store snapshot with one request ID', async () => {
    getMiniListingDetailMock.mockResolvedValue({
      status: 'ok',
      snapshot: { asOf: AS_OF, data: DETAIL_DATA },
    })
    const request = new Request(
      'https://example.test/api/mini/v1/listings/west-lake-office?city=hangzhou',
      { headers: { 'x-request-id': 'detail.req-1' } },
    )

    const response = await GET(request, {
      params: Promise.resolve({ slug: 'west-lake-office' }),
    })
    const body = await response.json()

    expect(runtime).toBe('nodejs')
    expect(getMiniListingDetailMock).toHaveBeenCalledWith('hangzhou', 'west-lake-office')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-request-id')).toBe('detail.req-1')
    expect(body).toEqual({
      ok: true,
      data: DETAIL_DATA,
      meta: { requestId: 'detail.req-1', asOf: AS_OF, maxAgeSeconds: 300 },
    })
    expect(body.meta.requestId).toBe(response.headers.get('x-request-id'))
  })

  it('returns a stable uncached 404 when the city is unavailable', async () => {
    getMiniListingDetailMock.mockResolvedValue({ status: 'city-not-found' })

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/listings/west-lake-office?city=not-live',
      { headers: { 'x-request-id': 'detail.city-not-found' } },
    ), {
      params: Promise.resolve({ slug: 'west-lake-office' }),
    })

    expect(getMiniListingDetailMock).toHaveBeenCalledWith('not-live', 'west-lake-office')
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-request-id')).toBe('detail.city-not-found')
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: 'city_not_found', message: '城市暂未开放' },
      meta: { requestId: 'detail.city-not-found' },
    })
  })

  it('returns a stable uncached listing 404 for an invalid slug without bypassing the service guard', async () => {
    getMiniListingDetailMock.mockResolvedValue({ status: 'listing-not-found' })

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/listings/West_Lake?city=hangzhou',
      { headers: { 'x-request-id': 'detail.listing-not-found' } },
    ), {
      params: Promise.resolve({ slug: 'West_Lake' }),
    })

    expect(getMiniListingDetailMock).toHaveBeenCalledWith('hangzhou', 'West_Lake')
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-request-id')).toBe('detail.listing-not-found')
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: 'listing_not_found', message: '房源已失效或不存在' },
      meta: { requestId: 'detail.listing-not-found' },
    })
  })

  it('returns a stable uncached 503 without leaking service details or the query', async () => {
    getMiniListingDetailMock.mockRejectedValue(new Error('SELECT password FROM private_listings'))

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/listings/west-lake-office?city=hangzhou&debug=secret-query',
      { headers: { 'x-request-id': 'detail.failed' } },
    ), {
      params: Promise.resolve({ slug: 'west-lake-office' }),
    })
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-request-id')).toBe('detail.failed')
    expect(body).toEqual({
      ok: false,
      error: { code: 'service_unavailable', message: '服务暂不可用，请稍后重试' },
      meta: { requestId: 'detail.failed' },
    })
    expect(serialized).not.toContain('SELECT')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('secret-query')
    expect(serialized).not.toContain('stack')
  })
})
