import { describe, expect, it } from 'vitest'

import {
  extractPgPool,
  isStrictJsonContentType,
  resolveDefaultCityId,
} from '@/app/api/supply-submissions/request-guards'
import {
  __resetRateStoreForTests,
  ratePruneRef,
} from '@/app/api/supply-submissions/rate-limit-state'

describe('supply-submissions request guards', () => {
  it.each([
    ['application/json', true],
    ['APPLICATION/JSON ; charset=utf-8', true],
    ['application/json; charset="utf-8"', true],
    ['application/jsonp', false],
    ['application/jsonx; charset=utf-8', false],
    ['application/json; charset', false],
    ['application/json;', false],
    [null, false],
  ] as const)('accepts only exact JSON media types: %s', (contentType, expected) => {
    expect(isStrictJsonContentType(contentType)).toBe(expected)
  })

  it('rejects a Payload DB object without a callable PostgreSQL pool', () => {
    expect(extractPgPool({})).toBeNull()
    expect(extractPgPool({ pool: {} })).toBeNull()
  })

  it('accepts a Payload DB object with a callable PostgreSQL pool', () => {
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) }

    expect(extractPgPool({ pool })).toBe(pool)
  })

  it('resets the shared prune timestamp for route tests', () => {
    ratePruneRef.value = 123

    __resetRateStoreForTests()

    expect(ratePruneRef.value).toBe(0)
  })

  it('returns no city when the default city lookup has no match', async () => {
    const cityId = await resolveDefaultCityId(
      { find: async () => ({ docs: [] }) },
      'shanghai',
    )

    expect(cityId).toBeNull()
  })

  it('returns no city when the default city ID is not a number', async () => {
    const cityId = await resolveDefaultCityId(
      { find: async () => ({ docs: [{ id: 'shanghai' }] }) },
      'shanghai',
    )

    expect(cityId).toBeNull()
  })

  it('returns no city when the default city lookup fails', async () => {
    const cityId = await resolveDefaultCityId(
      { find: async () => Promise.reject(new Error('database unavailable')) },
      'shanghai',
    )

    expect(cityId).toBeNull()
  })
})
