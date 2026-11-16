import { describe, expect, it } from 'vitest'

import { createLimiter } from '@/lib/bot-guard/limiter'

const LIMITS = { burst: 5, perMinute: 6, perHour: 20 } as const

function setup(maxKeys = 1000) {
  let t = 1_000_000
  const limiter = createLimiter({ now: () => t, maxKeys })
  return { limiter, advance: (ms: number) => (t += ms) }
}

describe('createLimiter', () => {
  it('突发额度用尽后拒绝，retryAfter >= 1，补充后恢复', () => {
    const { limiter, advance } = setup()
    for (let i = 0; i < 5; i++) expect(limiter.check('k', LIMITS).allowed).toBe(true)
    const denied = limiter.check('k', LIMITS)
    expect(denied.allowed).toBe(false)
    if (!denied.allowed) {
      expect(denied.window).toBe('burst')
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    }
    advance(11_000)
    expect(limiter.check('k', LIMITS).allowed).toBe(true)
  })

  it('小时预算用尽返回 hour，retryAfter 为到窗口结束的秒数', () => {
    const { limiter, advance } = setup()
    let allowed = 0
    // 每 11 秒一次（>= 补充速率），不触发突发
    for (let i = 0; i < 40; i++) {
      const d = limiter.check('k', LIMITS)
      if (d.allowed) allowed++
      else {
        expect(d.window).toBe('hour')
        expect(d.retryAfterSeconds).toBeGreaterThan(0)
        expect(d.retryAfterSeconds).toBeLessThanOrEqual(3600)
        break
      }
      advance(11_000)
    }
    expect(allowed).toBe(20)
    // 已经过去 20*11=220s，窗口剩余 3600-220=3380s 左右
    const d = limiter.check('k', LIMITS)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.retryAfterSeconds).toBe(3600 - 220)
    advance(3_601_000)
    expect(limiter.check('k', LIMITS).allowed).toBe(true)
  })

  it('不同键、不同类别互不影响', () => {
    const { limiter } = setup()
    for (let i = 0; i < 6; i++) limiter.check('a:page', LIMITS)
    expect(limiter.check('a:page', LIMITS).allowed).toBe(false)
    expect(limiter.check('b:page', LIMITS).allowed).toBe(true)
    expect(limiter.check('a:media', LIMITS).allowed).toBe(true)
  })

  it('键数有界', () => {
    const { limiter } = setup(100)
    for (let i = 0; i < 600; i++) limiter.check(`k${i}`, LIMITS)
    expect(limiter.size()).toBeLessThanOrEqual(100)
  })

  it('淘汰最久未用而非最新', () => {
    const { limiter } = setup(3)
    limiter.check('a', LIMITS)
    limiter.check('b', LIMITS)
    limiter.check('c', LIMITS)
    limiter.check('a', LIMITS) // a 变最新
    limiter.check('d', LIMITS) // 淘汰 b
    expect(limiter.size()).toBe(3)
    // a 已用 2 次，若被淘汰则重新计数；连续再用 3 次应第 6 次被拒（总 2+3=5 次后第 6 次）
    for (let i = 0; i < 3; i++) expect(limiter.check('a', LIMITS).allowed).toBe(true)
    expect(limiter.check('a', LIMITS).allowed).toBe(false)
  })

  it('真人序列不触发 page 限额', () => {
    const page = { burst: 30, perMinute: 30, perHour: 600 } as const
    const a = setup()
    for (let i = 0; i < 40; i++) {
      expect(a.limiter.check('u', page).allowed).toBe(true)
      a.advance(60_000)
    }
    const b = setup()
    for (let i = 0; i < 20; i++) expect(b.limiter.check('u', page).allowed).toBe(true)
    b.advance(120_000)
    for (let i = 0; i < 5; i++) expect(b.limiter.check('u', page).allowed).toBe(true)
  })
})
