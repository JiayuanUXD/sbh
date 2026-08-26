import { describe, expect, expectTypeOf, it } from 'vitest'
import { miniError, miniOk, miniRequestId, MINI_CACHE_CONTROL } from '@/domain/mini-program/response'
import type { MiniApiSuccess, MiniHomeData } from '@/domain/mini-program/contracts'

describe('Mini API contract', () => {
  it('success carries requestId, data asOf and fixed cache age', () => {
    const result = miniOk({ featuredListings: [], quickFilters: [], stats: { listings: 0, buildings: 0, businessAreas: 0 } }, {
      requestId: 'req-1',
      asOf: '2026-08-26T00:00:00.000Z',
    })
    expect(result).toEqual({
      ok: true,
      data: { featuredListings: [], quickFilters: [], stats: { listings: 0, buildings: 0, businessAreas: 0 } },
      meta: { requestId: 'req-1', asOf: '2026-08-26T00:00:00.000Z', maxAgeSeconds: 300 },
    })
    expectTypeOf(result).toMatchTypeOf<MiniApiSuccess<MiniHomeData>>()
  })

  it('failure exposes stable code without internal error objects', () => {
    expect(miniError('city_not_found', '城市暂未开放', 'req-2')).toEqual({
      ok: false,
      error: { code: 'city_not_found', message: '城市暂未开放' },
      meta: { requestId: 'req-2' },
    })
  })

  it('serializes non-empty fields and omits empty fields', () => {
    expect(miniError('invalid_request', '请求参数无效', 'req-3', ['city', 'page'])).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: '请求参数无效', fields: ['city', 'page'] },
      meta: { requestId: 'req-3' },
    })
    expect(miniError('invalid_request', '请求参数无效', 'req-4', [])).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: '请求参数无效' },
      meta: { requestId: 'req-4' },
    })
  })

  it('accepts only bounded transport-safe request IDs', () => {
    expect(miniRequestId('req_20260826-1')).toBe('req_20260826-1')
    expect(miniRequestId('x'.repeat(101))).toMatch(/^[0-9a-f-]{36}$/)
    expect(miniRequestId('bad request id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(MINI_CACHE_CONTROL).toBe('private, no-store')
  })
})
