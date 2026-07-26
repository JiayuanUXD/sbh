import { describe, it, expect } from 'vitest'
import { computeSliSnapshot, type SliQueryDeps, type RateLimitWindowStats } from '../src/lib/observability/sli'

function makeDeps(overrides: Partial<{
  leadsSince: (sinceMs: number) => number
  rl: RateLimitWindowStats
  now: number
  max: number
}> = {}): SliQueryDeps {
  const leadsSinceMap = new Map<number, number>()
  const defaultLeads = overrides.leadsSince ?? (() => 0)
  return {
    countLeadsSince: async (sinceMs: number) => {
      if (leadsSinceMap.has(sinceMs)) return leadsSinceMap.get(sinceMs)!
      return typeof defaultLeads === 'function' ? defaultLeads(sinceMs) : 0
    },
    countRateLimitCurrentWindow: async () => overrides.rl ?? { totalIps: 0, limitedIps: 0, sumCount: 0, windowStart: 0 },
    now: () => overrides.now ?? 1_000_000,
    rateLimitMax: overrides.max ?? 5,
  }
}

describe('computeSliSnapshot', () => {
  it('无尝试时 success_rate=null, rating=unknown', async () => {
    const snap = await computeSliSnapshot(makeDeps({
      leadsSince: () => 12,
      rl: { totalIps: 0, limitedIps: 0, sumCount: 0, windowStart: 940_000 },
    }))
    expect(snap.inquiry_submissions_24h).toBe(12)
    expect(snap.inquiry_active_ips_current_window).toBe(0)
    expect(snap.inquiry_rate_limited_ips_current_window).toBe(0)
    expect(snap.inquiry_success_rate).toBeNull()
    expect(snap.ratings.inquiry_success_rate).toBe('unknown')
  })

  it('成功率高 -> good', async () => {
    // 当前窗口 100 次尝试，95 成功
    const snap = await computeSliSnapshot(makeDeps({
      leadsSince: (since) => (since === 940_000 ? 95 : 500), // windowStart=940000 -> 95, 24h -> 500
      rl: { totalIps: 20, limitedIps: 1, sumCount: 100, windowStart: 940_000 },
    }))
    expect(snap.inquiry_success_rate).toBe(0.95)
    expect(snap.ratings.inquiry_success_rate).toBe('good')
    expect(snap.inquiry_submissions_24h).toBe(500)
  })

  it('成功率中等 -> needs-improvement', async () => {
    const snap = await computeSliSnapshot(makeDeps({
      leadsSince: () => 92,
      rl: { totalIps: 10, limitedIps: 3, sumCount: 100, windowStart: 940_000 },
    }))
    expect(snap.inquiry_success_rate).toBe(0.92)
    expect(snap.ratings.inquiry_success_rate).toBe('needs-improvement')
  })

  it('成功率低 -> poor', async () => {
    const snap = await computeSliSnapshot(makeDeps({
      leadsSince: () => 50,
      rl: { totalIps: 10, limitedIps: 8, sumCount: 100, windowStart: 940_000 },
    }))
    expect(snap.inquiry_success_rate).toBe(0.5)
    expect(snap.ratings.inquiry_success_rate).toBe('poor')
  })

  it('success 超 sumCount 时 clamp 到 1', async () => {
    const snap = await computeSliSnapshot(makeDeps({
      leadsSince: () => 200,
      rl: { totalIps: 5, limitedIps: 0, sumCount: 100, windowStart: 940_000 },
    }))
    expect(snap.inquiry_success_rate).toBe(1)
    expect(snap.ratings.inquiry_success_rate).toBe('good')
  })
})
