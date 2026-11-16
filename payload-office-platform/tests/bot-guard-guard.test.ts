import { describe, expect, it, vi } from 'vitest'

import { evaluateGuard, type GuardDeps, type GuardInput } from '../src/lib/bot-guard/guard'
import { CLASS_LIMITS, UNRESOLVED_ENGINE_LIMIT_FACTOR, type BotGuardConfig } from '../src/lib/bot-guard/config'
import { createLimiter } from '../src/lib/bot-guard/limiter'
import { createGuardLogger, type GuardLogEvent } from '../src/lib/bot-guard/log'
import type { SearchEngineVerdict } from '../src/lib/bot-guard/search-engine'

const BROWSER_UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Safari/605'
const BAIDU_UA = 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'

function input(over: Partial<GuardInput['headers']> & { pathname?: string; method?: string } = {}): GuardInput {
  return {
    method: over.method ?? 'GET',
    pathname: over.pathname ?? '/shanghai/listings',
    headers: {
      userAgent: over.userAgent === undefined ? BROWSER_UA : over.userAgent,
      xForwardedFor: over.xForwardedFor === undefined ? '198.51.100.9' : over.xForwardedFor,
      isPrefetch: over.isPrefetch ?? false,
    },
  }
}

function make(over: {
  mode?: BotGuardConfig['mode']
  hops?: number | null
  allowIps?: string[]
  verdict?: SearchEngineVerdict | Error
  limiterCheck?: ReturnType<typeof createLimiter>['check']
  recordImpl?: (e: GuardLogEvent) => void
} = {}) {
  let t = 0
  const real = createLimiter({ now: () => t, maxKeys: 1000 })
  const check = vi.fn(over.limiterCheck ?? real.check)
  const limiter = { check, size: real.size } as ReturnType<typeof createLimiter>
  const verifyEngine = vi.fn(async (): Promise<SearchEngineVerdict> => {
    if (over.verdict instanceof Error) throw over.verdict
    return over.verdict ?? { kind: 'none' }
  })
  const events: GuardLogEvent[] = []
  const record = vi.fn((e: GuardLogEvent) => {
    if (over.recordImpl) over.recordImpl(e)
    events.push(e)
  })
  const deps: GuardDeps = {
    config: {
      mode: over.mode ?? 'enforce',
      trustedProxyHops: over.hops === undefined ? 1 : over.hops,
      allowIps: new Set(over.allowIps ?? []),
      logKey: 'k',
    },
    limiter,
    verifyEngine,
    logger: { record },
  }
  return { deps, check, verifyEngine, record, events, advance: (ms: number) => (t += ms) }
}

describe('evaluateGuard 模式', () => {
  it('off：allow 且什么都不调用', async () => {
    const m = make({ mode: 'off' })
    expect(await evaluateGuard(input({ userAgent: 'curl/8.0' }), m.deps)).toEqual({ action: 'allow' })
    expect(m.check).not.toHaveBeenCalled()
    expect(m.verifyEngine).not.toHaveBeenCalled()
    expect(m.record).not.toHaveBeenCalled()
  })

  it('observe：脚本 UA 与超限都 allow，只记 would_*', async () => {
    const m = make({ mode: 'observe' })
    expect(await evaluateGuard(input({ userAgent: 'curl/8.0' }), m.deps)).toEqual({ action: 'allow' })
    expect(m.events.at(-1)).toMatchObject({ kind: 'would_deny', rule: 'curl', cls: 'page' })
    for (let i = 0; i < CLASS_LIMITS.page.burst + 1; i++) {
      expect(await evaluateGuard(input(), m.deps)).toEqual({ action: 'allow' })
    }
    expect(m.events.at(-1)).toMatchObject({ kind: 'would_limit', mode: 'observe' })
  })

  it('enforce：脚本 UA → 403；超限 → 429 且 retryAfter>=1', async () => {
    const m = make()
    expect(await evaluateGuard(input({ userAgent: 'curl/8.0' }), m.deps)).toEqual({ action: 'deny', status: 403 })
    expect(m.events.at(-1)).toMatchObject({ kind: 'denied' })
    let last
    for (let i = 0; i < CLASS_LIMITS.page.burst + 1; i++) last = await evaluateGuard(input(), m.deps)
    expect(last).toMatchObject({ action: 'limit', status: 429 })
    expect((last as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(m.events.at(-1)).toMatchObject({ kind: 'limited' })
  })

  it('page-prefetch 在自己的桶里受限', async () => {
    const m = make()
    const lim = CLASS_LIMITS['page-prefetch']
    let last
    for (let i = 0; i < lim.burst + 1; i++) last = await evaluateGuard(input({ isPrefetch: true }), m.deps)
    expect(last).toMatchObject({ action: 'limit', status: 429 })
    expect(m.events.at(-1)).toMatchObject({ cls: 'page-prefetch', kind: 'limited' })
    // 不占用 page 桶
    expect(await evaluateGuard(input(), m.deps)).toEqual({ action: 'allow' })
  })
})

describe('evaluateGuard 分类与 IP', () => {
  it('exempt 路径与非 GET 直接 allow', async () => {
    const m = make()
    expect(await evaluateGuard(input({ pathname: '/api/health', userAgent: 'curl/8' }), m.deps)).toEqual({ action: 'allow' })
    expect(await evaluateGuard(input({ method: 'POST', userAgent: 'curl/8' }), m.deps)).toEqual({ action: 'allow' })
    expect(m.check).not.toHaveBeenCalled()
  })

  it('mini-read 在 enforce 下超限仍 allow，只记 would_limit', async () => {
    const m = make()
    let last
    for (let i = 0; i < CLASS_LIMITS['mini-read'].burst + 1; i++) {
      last = await evaluateGuard(input({ pathname: '/api/mini/v1/home' }), m.deps)
      expect(last).toEqual({ action: 'allow' })
    }
    expect(m.events.at(-1)).toMatchObject({ kind: 'would_limit', cls: 'mini-read', mode: 'enforce' })
  })

  it('hops 为 null：allow 并记 ip_unresolved，带原始链长度', async () => {
    const m = make({ hops: null })
    expect(await evaluateGuard(input({ userAgent: 'curl/8', xForwardedFor: '1.1.1.1, 2.2.2.2' }), m.deps)).toEqual({ action: 'allow' })
    expect(m.events).toEqual([
      expect.objectContaining({ kind: 'ip_unresolved', ip: null, xffChainLength: 2 }),
    ])
  })

  it('链非法 / 缺头 → allow + ip_unresolved', async () => {
    const m = make()
    await evaluateGuard(input({ xForwardedFor: '1.1.1.1:443' }), m.deps)
    await evaluateGuard(input({ xForwardedFor: null }), m.deps)
    expect(m.events.map((e) => [e.kind, e.xffChainLength])).toEqual([
      ['ip_unresolved', 1],
      ['ip_unresolved', 0],
    ])
    expect(m.check).not.toHaveBeenCalled()
  })

  it('allowIps 命中直接 allow，不限速不拒绝', async () => {
    const m = make({ allowIps: ['198.51.100.9'] })
    expect(await evaluateGuard(input({ userAgent: 'curl/8' }), m.deps)).toEqual({ action: 'allow' })
    expect(m.check).not.toHaveBeenCalled()
  })
})

describe('evaluateGuard 搜索引擎', () => {
  it('verified：allow，不进限速器，记 se_verified', async () => {
    const m = make({ verdict: { kind: 'verified', engine: 'baidu' } })
    expect(await evaluateGuard(input({ userAgent: BAIDU_UA }), m.deps)).toEqual({ action: 'allow' })
    expect(m.check).not.toHaveBeenCalled()
    expect(m.events.at(-1)).toMatchObject({ kind: 'se_verified' })
  })

  it('非声明引擎的 UA 不触发验真', async () => {
    const m = make()
    await evaluateGuard(input(), m.deps)
    expect(m.verifyEngine).not.toHaveBeenCalled()
  })

  it('spoofed + 脚本 UA → deny，并记 se_spoofed', async () => {
    const m = make({ verdict: { kind: 'spoofed', engine: 'baidu' } })
    const ua = `${BAIDU_UA} python-requests/2.0`
    expect(await evaluateGuard(input({ userAgent: ua }), m.deps)).toEqual({ action: 'deny', status: 403 })
    expect(m.events.map((e) => e.kind)).toContain('se_spoofed')
  })

  it('spoofed 普通 UA 当普通客户端限速', async () => {
    const m = make({ verdict: { kind: 'spoofed', engine: 'baidu' } })
    let last
    for (let i = 0; i < CLASS_LIMITS.page.burst + 1; i++) last = await evaluateGuard(input({ userAgent: BAIDU_UA }), m.deps)
    expect(last).toMatchObject({ action: 'limit' })
  })

  it('unresolved：不因 UA 拒绝，限速用 ×10 的三项阈值', async () => {
    const m = make({ verdict: { kind: 'unresolved', engine: 'baidu' } })
    const ua = `${BAIDU_UA} python-requests/2.0`
    expect(await evaluateGuard(input({ userAgent: ua }), m.deps)).toEqual({ action: 'allow' })
    const l = CLASS_LIMITS.page
    expect(m.check).toHaveBeenCalledWith('198.51.100.9|page', {
      burst: l.burst * UNRESOLVED_ENGINE_LIMIT_FACTOR,
      perMinute: l.perMinute * UNRESOLVED_ENGINE_LIMIT_FACTOR,
      perHour: l.perHour * UNRESOLVED_ENGINE_LIMIT_FACTOR,
    })
  })

  it('普通请求用原阈值与 `${ip}|${cls}` 键', async () => {
    const m = make()
    await evaluateGuard(input(), m.deps)
    expect(m.check).toHaveBeenCalledWith('198.51.100.9|page', CLASS_LIMITS.page)
  })
})

describe('evaluateGuard 健壮性', () => {
  it('verifyEngine 抛错 → allow + guard_error', async () => {
    const m = make({ verdict: new Error('dns boom') })
    expect(await evaluateGuard(input({ userAgent: BAIDU_UA }), m.deps)).toEqual({ action: 'allow' })
    expect(m.events.at(-1)).toMatchObject({ kind: 'guard_error' })
  })

  it('limiter.check 抛错 → allow + guard_error', async () => {
    const m = make({ limiterCheck: () => { throw new Error('boom') } })
    expect(await evaluateGuard(input(), m.deps)).toEqual({ action: 'allow' })
    expect(m.events.at(-1)).toMatchObject({ kind: 'guard_error' })
  })

  it('enforce 下 logger.record 抛错不改变拦截结果（429 / 403）', async () => {
    const m = make({ recordImpl: () => { throw new Error('log boom') } })
    expect(await evaluateGuard(input({ userAgent: 'curl/8.0' }), m.deps)).toEqual({ action: 'deny', status: 403 })
    let last
    for (let i = 0; i < CLASS_LIMITS.page.burst + 1; i++) last = await evaluateGuard(input(), m.deps)
    expect(last).toMatchObject({ action: 'limit', status: 429 })
  })

  it('logger 只抛一次时 allow 路径也不抛', async () => {
    let first = true
    const m = make({ recordImpl: () => { if (first) { first = false; throw new Error('x') } } })
    await expect(evaluateGuard(input({ userAgent: 'curl/8.0' }), m.deps)).resolves.toEqual({ action: 'deny', status: 403 })
  })

  it('超长 / 控制字符 UA 不抛错', async () => {
    const m = make()
    await expect(evaluateGuard(input({ userAgent: '\u0000\u001f' + 'x'.repeat(10_000) }), m.deps)).resolves.toBeDefined()
  })
})

describe('evaluateGuard 真人序列', () => {
  it('5 秒内 10 个 page 请求全部 allow（突发 30）', async () => {
    const m = make()
    for (let i = 0; i < 10; i++) {
      expect(await evaluateGuard(input({ pathname: `/p/${i}` }), m.deps)).toEqual({ action: 'allow' })
      m.advance(500)
    }
  })

  it('同一 IP 40 分钟 40 个 page 请求，enforce 下全部 allow', async () => {
    const m = make()
    for (let i = 0; i < 40; i++) {
      expect(await evaluateGuard(input({ pathname: `/shanghai/listings/${i}` }), m.deps)).toEqual({ action: 'allow' })
      m.advance(60_000)
    }
  })
})

describe('evaluateGuard + 真实 logger 集成', () => {
  it('任何写出的行（含汇总）都不含原始 IP / UA / 路径 / query', async () => {
    const lines: string[] = []
    let t = 0
    const logger = createGuardLogger({
      write: (l) => lines.push(l),
      now: () => t,
      hashIp: (ip) => `hash${ip.length}`,
      summaryIntervalMs: 1000,
    })
    const limiter = createLimiter({ now: () => t, maxKeys: 100 })
    const deps: GuardDeps = {
      config: { mode: 'enforce', trustedProxyHops: 1, allowIps: new Set(), logKey: 'k' },
      limiter,
      verifyEngine: async () => ({ kind: 'none' }),
      logger,
    }
    const rawIp = '203.0.113.9'
    const rawUa = '\u0000\u001b[31mpython-requests/2.0 ' + 'A'.repeat(10_000)
    const path = '/secret-path/abc'
    for (let i = 0; i < 3; i++) {
      await evaluateGuard(
        { method: 'GET', pathname: `${path}${i}`, headers: { userAgent: rawUa, xForwardedFor: rawIp, isPrefetch: false } },
        deps,
      )
    }
    await evaluateGuard(
      { method: 'GET', pathname: path, headers: { userAgent: BROWSER_UA, xForwardedFor: 'bad:1', isPrefetch: false } },
      deps,
    )
    t += 2000
    await evaluateGuard(
      { method: 'GET', pathname: path, headers: { userAgent: BROWSER_UA, xForwardedFor: 'bad:1', isPrefetch: false } },
      deps,
    )
    expect(lines.length).toBeGreaterThan(1)
    const all = lines.join('\n')
    expect(all).not.toContain(rawIp)
    expect(all).not.toContain('python-requests/2.0 AAAA')
    expect(all).not.toContain('secret-path')
    expect(all).not.toContain('?')
    // eslint-disable-next-line no-control-regex
    expect(all).not.toMatch(/\\u0000|\\u001b/)
    for (const l of lines) {
      const row = JSON.parse(l)
      if (row.uaFamily !== undefined) expect(row.uaFamily).toMatch(/^[A-Za-z0-9._-]{1,24}$/)
    }
    expect(lines.some((l) => JSON.parse(l).kind === 'summary')).toBe(true)
  })
})
