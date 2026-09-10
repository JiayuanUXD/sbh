import { describe, expect, it } from 'vitest'
import { MEMBER_RATE_LIMITS, rateLimitKey } from '@/domain/member/rate-limits'

describe('member rate limits', () => {
  it('键只含前缀与 16 位哈希', () => {
    const key = rateLimitKey('member-sms:phone', '13800001234')
    expect(key).toMatch(/^member-sms:phone:[0-9a-f]{16}$/)
    expect(key).not.toContain('13800001234')
    expect(rateLimitKey('a', 'x')).toBe(rateLimitKey('a', 'x'))
  })
  it('阈值与失败策略按母文档 §6.1', () => {
    expect(MEMBER_RATE_LIMITS.smsPhoneMinute.config).toMatchObject({
      windowMs: 60_000,
      max: 1,
      failOpen: false,
    })
    expect(MEMBER_RATE_LIMITS.smsPhoneDay.config).toMatchObject({
      windowMs: 86_400_000,
      max: 10,
      failOpen: false,
    })
    expect(MEMBER_RATE_LIMITS.smsIp.config).toMatchObject({
      windowMs: 3_600_000,
      max: 20,
      failOpen: false,
    })
    expect(MEMBER_RATE_LIMITS.loginIp.config).toMatchObject({
      windowMs: 900_000,
      max: 30,
      failOpen: true,
    })
  })
})
