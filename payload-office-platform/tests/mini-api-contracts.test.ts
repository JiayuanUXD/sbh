import { describe, expect, expectTypeOf, it } from 'vitest'
import { miniError, miniOk, miniRequestId, MINI_CACHE_CONTROL } from '@/domain/mini-program/response'
import type { MiniApiSuccess, MiniHomeData } from '@/domain/mini-program/contracts'

describe('Mini API contract', () => {
  it('success carries requestId, data asOf and fixed cache age', () => {
    const home: MiniHomeData = { featuredListings: [], featuredBuildings: [], quickFilters: [], stats: { listings: 0, buildings: 0, businessAreas: 0 }, inquiryPolicy: { version: 'policy-v2' } }
    const result = miniOk(home, {
      requestId: 'req-1',
      asOf: '2026-08-26T00:00:00.000Z',
    })
    expect(result).toEqual({
      ok: true,
      data: home,
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

  it('每次只生成服务端 UUID，不回显任意客户端 header', () => {
    const sensitiveIncoming = '13800001111.AppSecret.token-shape'
    const first = miniRequestId()
    const second = miniRequestId()

    expectTypeOf<typeof miniRequestId>().parameters.toEqualTypeOf<[]>()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).toMatch(/^[0-9a-f-]{36}$/)
    expect(first).not.toBe(sensitiveIncoming)
    expect(second).not.toBe(first)
    expect(MINI_CACHE_CONTROL).toBe('private, no-store')
  })
})
