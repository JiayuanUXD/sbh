import { describe, expect, it } from 'vitest'

import { resolveMiniTrustedClientIp } from '@/app/api/mini/v1/rate-limit-state'
import { resolveTrustedClientIp } from '@/lib/api/trusted-client-ip'

describe('resolveTrustedClientIp', () => {
  it('取链中倒数第 N 个', () => {
    expect(resolveTrustedClientIp('1.1.1.1, 2.2.2.2', 1)).toEqual({ ok: true, ip: '2.2.2.2' })
    expect(resolveTrustedClientIp('1.1.1.1, 2.2.2.2', 2)).toEqual({ ok: true, ip: '1.1.1.1' })
  })

  it('伪造的首段不影响结果', () => {
    expect(resolveTrustedClientIp('9.9.9.9, 1.1.1.1, 2.2.2.2', 2)).toEqual({
      ok: true,
      ip: '1.1.1.1',
    })
  })

  it('链短于跳数 -> bad_chain', () => {
    expect(resolveTrustedClientIp('1.1.1.1', 2)).toEqual({
      ok: false,
      reason: 'bad_chain',
      chainLength: 1,
    })
  })

  it.each(['1.1.1.1:443', '::ffff:1.2.3.4', 'abc'])('非法项 %s -> bad_chain', (bad) => {
    const result = resolveTrustedClientIp(`1.1.1.1, ${bad}`, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad_chain')
  })

  it('null 头 -> no_header', () => {
    expect(resolveTrustedClientIp(null, 1)).toEqual({
      ok: false,
      reason: 'no_header',
      chainLength: 0,
    })
  })

  it.each([null, 0, 6, 1.5])('跳数 %s -> bad_hops', (hops) => {
    const result = resolveTrustedClientIp('1.1.1.1, 2.2.2.2', hops)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad_hops')
  })

  it('IPv6 合法', () => {
    expect(resolveTrustedClientIp('2001:db8::1', 1)).toEqual({ ok: true, ip: '2001:db8::1' })
  })

  it('默认严格：拒绝 ::ffff: 映射地址', () => {
    expect(resolveTrustedClientIp('::ffff:1.2.3.4', 1)).toMatchObject({
      ok: false,
      reason: 'bad_chain',
    })
  })

  it('allowIpv4Mapped:true 时接受映射地址', () => {
    expect(resolveTrustedClientIp('::ffff:1.2.3.4', 1, { allowIpv4Mapped: true })).toEqual({
      ok: true,
      ip: '::ffff:1.2.3.4',
    })
    expect(resolveTrustedClientIp('abc', 1, { allowIpv4Mapped: true }).ok).toBe(false)
  })
})

describe('resolveMiniTrustedClientIp', () => {
  it('仍接受 ::ffff: 映射地址（保持 mini 既有行为）', () => {
    const request = new Request('http://x.test/', {
      headers: { 'x-forwarded-for': '::ffff:1.2.3.4' },
    })
    expect(resolveMiniTrustedClientIp(request, 1)).toEqual({ ok: true, clientIp: '::ffff:1.2.3.4' })
  })
})
