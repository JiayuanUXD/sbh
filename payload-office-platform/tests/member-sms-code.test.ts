import { describe, expect, it } from 'vitest'
import {
  FIXTURE_SMS_CODE,
  SMS_CODE_TTL_MS,
  checkSmsCode,
  generateSmsCode,
  hashSmsCode,
  isSmsPurpose,
  smsCodeMatches,
} from '@/domain/member/sms-code'

const secret = 'test-secret-with-enough-length-0123456789'
const phone = '13800001234'

describe('sms-code', () => {
  it('随机码是 6 位数字；fixture 恒为 123456', () => {
    for (let i = 0; i < 20; i += 1) expect(generateSmsCode('random')).toMatch(/^\d{6}$/)
    expect(generateSmsCode('fixture')).toBe(FIXTURE_SMS_CODE)
  })
  it('哈希稳定且与号码、用途、密钥绑定', () => {
    const h = hashSmsCode(secret, phone, 'login', '123456')
    expect(h).toBe(hashSmsCode(secret, phone, 'login', '123456'))
    expect(h).not.toBe(hashSmsCode(secret, phone, 'set-password', '123456'))
    expect(h).not.toBe(hashSmsCode('other', phone, 'login', '123456'))
    expect(smsCodeMatches(secret, phone, 'login', '123456', h)).toBe(true)
    expect(smsCodeMatches(secret, phone, 'login', '000000', h)).toBe(false)
  })
  it('isSmsPurpose', () => {
    expect(isSmsPurpose('login')).toBe(true)
    expect(isSmsPurpose('x')).toBe(false)
  })
  it('checkSmsCode：空 / 消费过 / 超次 / 不等 → invalid；过期 → expired；否则 ok', () => {
    const now = new Date('2026-09-11T00:00:00Z')
    const stored = {
      codeHash: hashSmsCode(secret, phone, 'login', '123456'),
      expiresAt: new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString(),
      attempts: 1,
    }
    const base = { secret, phone, purpose: 'login' as const, now }
    expect(checkSmsCode({ ...base, code: '123456', stored })).toBe('ok')
    expect(checkSmsCode({ ...base, code: '123456', stored: null })).toBe('invalid')
    expect(
      checkSmsCode({
        ...base,
        code: '123456',
        stored: { ...stored, consumedAt: now.toISOString() },
      }),
    ).toBe('invalid')
    expect(checkSmsCode({ ...base, code: '123456', stored: { ...stored, attempts: 6 } })).toBe(
      'invalid',
    )
    expect(checkSmsCode({ ...base, code: '654321', stored })).toBe('invalid')
    expect(
      checkSmsCode({
        ...base,
        code: '123456',
        stored: { ...stored, expiresAt: new Date(now.getTime() - 1).toISOString() },
      }),
    ).toBe('expired')
  })
})
