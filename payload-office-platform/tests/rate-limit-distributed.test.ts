import { describe, it, expect, vi } from 'vitest'
import {
  computeWindowStart,
  computeRetryAfterSeconds,
  evaluateAcquired,
  shouldPrune,
  checkCapacity,
  decideOnStoreFailure,
  runDistributedRateLimit,
  type RateLimitDeps,
  type RateLimitConfig,
  type PruneTimestampRef,
} from '../src/lib/rate-limit-distributed'

// ---------------------------------------------------------------------------
// 纯函数：窗口对齐 / 重试秒数
// ---------------------------------------------------------------------------

describe('computeWindowStart', () => {
  it('把时间戳落到窗口起始边界', () => {
    expect(computeWindowStart(0, 60_000)).toBe(0)
    expect(computeWindowStart(1000, 60_000)).toBe(0)
    expect(computeWindowStart(59_999, 60_000)).toBe(0)
    expect(computeWindowStart(60_000, 60_000)).toBe(60_000)
    expect(computeWindowStart(65_000, 60_000)).toBe(60_000)
    expect(computeWindowStart(125_000, 60_000)).toBe(120_000)
  })
})

describe('computeRetryAfterSeconds', () => {
  it('返回当前窗口剩余秒数（向上取整）', () => {
    expect(computeRetryAfterSeconds(0, 60_000, 1000)).toBe(59)
    expect(computeRetryAfterSeconds(0, 60_000, 59_000)).toBe(1)
    expect(computeRetryAfterSeconds(0, 60_000, 59_500)).toBe(1)
    expect(computeRetryAfterSeconds(0, 60_000, 60_000)).toBe(0)
    expect(computeRetryAfterSeconds(0, 60_000, 65_000)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 纯函数：放行决策
// ---------------------------------------------------------------------------

describe('evaluateAcquired', () => {
  const opts = { max: 5, windowMs: 60_000, now: 10_000 }

  it('count <= max -> 放行，remaining 正确', () => {
    expect(evaluateAcquired({ count: 1, windowStart: 0 }, opts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      remaining: 4,
    })
    expect(evaluateAcquired({ count: 5, windowStart: 0 }, opts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      remaining: 0,
    })
  })

  it('count > max -> 拒绝，retryAfter > 0', () => {
    const r = evaluateAcquired({ count: 6, windowStart: 0 }, opts)
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
    expect(r.retryAfterSeconds).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// 纯函数：TTL 触发
// ---------------------------------------------------------------------------

describe('shouldPrune', () => {
  it('now - last >= interval -> true', () => {
    expect(shouldPrune(10_000, 0, 10_000)).toBe(true)
    expect(shouldPrune(10_000, 5_000, 5_000)).toBe(true)
  })
  it('未达间隔 -> false', () => {
    expect(shouldPrune(9_999, 0, 10_000)).toBe(false)
    expect(shouldPrune(10_000, 8_000, 5_000)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 纯函数：容量保护
// ---------------------------------------------------------------------------

describe('checkCapacity', () => {
  it('key 已存在 -> allow（递增不占新槽）', () => {
    expect(checkCapacity(1_000_000, 100_000, true)).toBe('allow')
  })
  it('未达上限 -> allow', () => {
    expect(checkCapacity(0, 100_000, false)).toBe('allow')
    expect(checkCapacity(99_999, 100_000, false)).toBe('allow')
  })
  it('达上限且新 key -> prune_first', () => {
    expect(checkCapacity(100_000, 100_000, false)).toBe('prune_first')
    expect(checkCapacity(200_000, 100_000, false)).toBe('prune_first')
  })
})

// ---------------------------------------------------------------------------
// 纯函数：失败策略
// ---------------------------------------------------------------------------

describe('decideOnStoreFailure', () => {
  it('failOpen=true -> 放行', () => {
    expect(decideOnStoreFailure(true)).toEqual({ allowed: true, failOpen: true })
  })
  it('failOpen=false -> 拒绝', () => {
    expect(decideOnStoreFailure(false)).toEqual({ allowed: false, failOpen: false })
  })
})

// ---------------------------------------------------------------------------
// 协调器：runDistributedRateLimit（mock deps）
// ---------------------------------------------------------------------------

function makeMockDeps(overrides: Partial<RateLimitDeps> = {}): RateLimitDeps {
  return {
    acquire: vi.fn(async () => ({ count: 1, windowStart: 0 })),
    pruneExpired: vi.fn(async () => 0),
    countKeys: vi.fn(async () => 0),
    keyExists: vi.fn(async () => false),
    now: () => 10_000,
    ...overrides,
  }
}

const baseConfig: RateLimitConfig = {
  windowMs: 60_000,
  max: 5,
  maxKeys: 100_000,
  pruneIntervalMs: 5 * 60_000,
  failOpen: true,
}

describe('runDistributedRateLimit', () => {
  it('happy path: 新 key + 计数 1 -> 放行，failedOpen=false', async () => {
    const deps = makeMockDeps()
    const pruneRef: PruneTimestampRef = { value: 10_000 } // 未达清理间隔
    const r = await runDistributedRateLimit(deps, baseConfig, 'key-a', pruneRef)
    expect(r.allowed).toBe(true)
    expect(r.failedOpen).toBe(false)
    expect(deps.acquire).toHaveBeenCalledWith('key-a', 0)
  })

  it('超过 max -> 拒绝，retryAfter > 0', async () => {
    const deps = makeMockDeps({
      acquire: vi.fn(async () => ({ count: 6, windowStart: 0 })),
    })
    const pruneRef: PruneTimestampRef = { value: 10_000 }
    const r = await runDistributedRateLimit(deps, baseConfig, 'key-a', pruneRef)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSeconds).toBe(50)
  })

  it('容量保护: key 不存在且达上限 -> 触发 pruneExpired', async () => {
    const prune = vi.fn(async () => 0)
    const deps = makeMockDeps({
      keyExists: vi.fn(async () => false),
      countKeys: vi.fn(async () => 100_000), // 达上限
      pruneExpired: prune,
    })
    const pruneRef: PruneTimestampRef = { value: 10_000 }
    await runDistributedRateLimit(deps, baseConfig, 'key-new', pruneRef)
    expect(prune).toHaveBeenCalledTimes(1)
  })

  it('容量保护: key 已存在 -> 不触发 prune', async () => {
    const prune = vi.fn(async () => 0)
    const deps = makeMockDeps({
      keyExists: vi.fn(async () => true),
      countKeys: vi.fn(async () => 100_000),
      pruneExpired: prune,
    })
    const pruneRef: PruneTimestampRef = { value: 10_000 }
    await runDistributedRateLimit(deps, baseConfig, 'key-exists', pruneRef)
    expect(prune).not.toHaveBeenCalled()
  })

  it('TTL 回收: 达清理间隔 -> 触发 pruneExpired + 更新时间戳', async () => {
    const prune = vi.fn(async () => 0)
    const deps = makeMockDeps({ pruneExpired: prune, now: () => 300_000 })
    const pruneRef: PruneTimestampRef = { value: 0 } // 300000 - 0 >= 5min(300000)
    await runDistributedRateLimit(deps, baseConfig, 'key-a', pruneRef)
    expect(prune).toHaveBeenCalledTimes(1)
    expect(pruneRef.value).toBe(300_000)
  })

  it('TTL 回收: 未达间隔 -> 不触发 prune', async () => {
    const prune = vi.fn(async () => 0)
    const deps = makeMockDeps({ pruneExpired: prune, now: () => 100_000 })
    const pruneRef: PruneTimestampRef = { value: 80_000 } // 20000 < 300000
    await runDistributedRateLimit(deps, baseConfig, 'key-a', pruneRef)
    expect(prune).not.toHaveBeenCalled()
  })

  it('存储失败 + failOpen=true -> 放行，failedOpen=true', async () => {
    const deps = makeMockDeps({
      acquire: vi.fn().mockRejectedValue(new Error('pg down')),
    })
    const pruneRef: PruneTimestampRef = { value: 10_000 }
    const r = await runDistributedRateLimit(deps, baseConfig, 'key-a', pruneRef)
    expect(r.allowed).toBe(true)
    expect(r.failedOpen).toBe(true)
  })

  it('存储失败 + failOpen=false -> 拒绝', async () => {
    const deps = makeMockDeps({
      acquire: vi.fn().mockRejectedValue(new Error('pg down')),
    })
    const config: RateLimitConfig = { ...baseConfig, failOpen: false }
    const pruneRef: PruneTimestampRef = { value: 10_000 }
    const r = await runDistributedRateLimit(deps, config, 'key-a', pruneRef)
    expect(r.allowed).toBe(false)
    expect(r.failedOpen).toBe(false)
  })

  it('keyExists 抛错也走失败策略', async () => {
    const deps = makeMockDeps({
      keyExists: vi.fn().mockRejectedValue(new Error('pg down')),
    })
    const pruneRef: PruneTimestampRef = { value: 10_000 }
    const r = await runDistributedRateLimit(deps, baseConfig, 'key-a', pruneRef)
    expect(r.failedOpen).toBe(true)
  })
})
