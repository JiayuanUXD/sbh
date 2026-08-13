import { describe, expect, it } from 'vitest'

import {
  extractPgPool,
  isStrictJsonContentType,
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

})
