import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMiniHomeMock } = vi.hoisted(() => ({
  getMiniHomeMock: vi.fn(),
}))

vi.mock('@/lib/mini-program/catalog-service', () => ({
  getMiniHome: getMiniHomeMock,
}))

import { GET, runtime } from '@/app/api/mini/v1/home/route'
const HOME_DATA = {
  featuredListings: [],
  quickFilters: [],
  stats: { listings: 12, buildings: 4, businessAreas: 3 },
}
const AS_OF = '2026-08-26T00:00:00.000Z'

beforeEach(() => {
  getMiniHomeMock.mockReset()
})

describe('GET /api/mini/v1/home', () => {
  it('runs on Node.js and returns a private no-store snapshot with one request ID', async () => {
    getMiniHomeMock.mockResolvedValue({ asOf: AS_OF, data: HOME_DATA })
    const request = new Request('https://example.test/api/mini/v1/home?city=shanghai', {
      headers: { 'x-request-id': 'home.req-1' },
    })

    const response = await GET(request)
    const body = await response.json()

    expect(runtime).toBe('nodejs')
    expect(getMiniHomeMock).toHaveBeenCalledWith('shanghai')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(requestId).not.toBe('home.req-1')
    expect(body).toEqual({
      ok: true,
      data: HOME_DATA,
      meta: { requestId, asOf: AS_OF, maxAgeSeconds: 300 },
    })
    expect(body.meta.requestId).toBe(response.headers.get('x-request-id'))
  })

  it('returns a stable uncached 404 when the city is unavailable', async () => {
    getMiniHomeMock.mockResolvedValue(null)

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/home?city=not-live',
      { headers: { 'x-request-id': 'home.not-found' } },
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

  it('returns a stable uncached 503 without leaking service details', async () => {
    getMiniHomeMock.mockRejectedValue(new Error('SELECT password FROM internal_users'))

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/home?city=shanghai&debug=secret-query',
      { headers: { 'x-request-id': 'home.failed' } },
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
    expect(serialized).not.toContain('SELECT')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('secret-query')
    expect(serialized).not.toContain('stack')
  })

  it.each(['x'.repeat(101), 'bad request id', 'mini.req-1', '13800001111.AppSecret.token']) (
    '忽略任意 caller request ID %s',
    async (incoming) => {
    getMiniHomeMock.mockResolvedValue({ asOf: AS_OF, data: HOME_DATA })

    const response = await GET(new Request(
      'https://example.test/api/mini/v1/home?city=shanghai',
      { headers: { 'x-request-id': incoming } },
    ))
    const requestId = response.headers.get('x-request-id')

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(requestId).not.toBe(incoming)
    await expect(response.json()).resolves.toMatchObject({ meta: { requestId } })
    },
  )
})
