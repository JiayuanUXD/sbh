import { describe, expect, it } from 'vitest'
import { checkRateLimit, type RateLimitStore } from '@/lib/rate-limit'

const opts = { windowMs: 60_000, max: 3 }

describe('checkRateLimit', () => {
  it('allows requests up to the limit within a window', () => {
    const store: RateLimitStore = new Map()
    expect(checkRateLimit(store, 'ip1', 1000, opts).allowed).toBe(true)
    expect(checkRateLimit(store, 'ip1', 1100, opts).allowed).toBe(true)
    expect(checkRateLimit(store, 'ip1', 1200, opts).allowed).toBe(true)
  })

  it('blocks the request that exceeds the limit', () => {
    const store: RateLimitStore = new Map()
    checkRateLimit(store, 'ip1', 1000, opts)
    checkRateLimit(store, 'ip1', 1100, opts)
    checkRateLimit(store, 'ip1', 1200, opts)
    const r = checkRateLimit(store, 'ip1', 1300, opts)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks limits per key independently', () => {
    const store: RateLimitStore = new Map()
    checkRateLimit(store, 'ip1', 1000, opts)
    checkRateLimit(store, 'ip1', 1000, opts)
    checkRateLimit(store, 'ip1', 1000, opts)
    expect(checkRateLimit(store, 'ip1', 1000, opts).allowed).toBe(false)
    // A different key is unaffected.
    expect(checkRateLimit(store, 'ip2', 1000, opts).allowed).toBe(true)
  })

  it('resets after the window elapses', () => {
    const store: RateLimitStore = new Map()
    checkRateLimit(store, 'ip1', 1000, opts)
    checkRateLimit(store, 'ip1', 1000, opts)
    checkRateLimit(store, 'ip1', 1000, opts)
    expect(checkRateLimit(store, 'ip1', 1000, opts).allowed).toBe(false)
    // Past the window boundary, the count resets.
    expect(checkRateLimit(store, 'ip1', 1000 + opts.windowMs + 1, opts).allowed).toBe(true)
  })

  it('reports retryAfterSeconds rounded up to the remaining window', () => {
    const store: RateLimitStore = new Map()
    checkRateLimit(store, 'ip1', 1000, opts)
    checkRateLimit(store, 'ip1', 1000, opts)
    checkRateLimit(store, 'ip1', 1000, opts)
    // 500ms into a 60s window → 59.5s remaining → ceil to 60.
    const r = checkRateLimit(store, 'ip1', 1500, opts)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSeconds).toBe(60)
  })
})
