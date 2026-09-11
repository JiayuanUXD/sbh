/**
 * 验证码的纯规则（OPT-088 §4.2 / §6.2）：生成、HMAC、比对、生命周期。不碰数据库。
 * 明文只在这里的返回值里出现一次，调用方负责只把它交给短信适配器。
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export type SmsPurpose = 'login' | 'set-password' | 'bind-wechat'
export const SMS_PURPOSES: readonly SmsPurpose[] = ['login', 'set-password', 'bind-wechat']
export const SMS_CODE_TTL_MS = 5 * 60_000
export const SMS_CODE_MAX_ATTEMPTS = 5
export const FIXTURE_SMS_CODE = '123456'

export function isSmsPurpose(value: unknown): value is SmsPurpose {
  return typeof value === 'string' && (SMS_PURPOSES as readonly string[]).includes(value)
}

export function generateSmsCode(mode: 'random' | 'fixture'): string {
  if (mode === 'fixture') return FIXTURE_SMS_CODE
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashSmsCode(
  secret: string,
  phone: string,
  purpose: SmsPurpose,
  code: string,
): string {
  return createHmac('sha256', secret)
    .update(`member-sms|${phone}|${purpose}|${code}`, 'utf8')
    .digest('hex')
}

export function smsCodeMatches(
  secret: string,
  phone: string,
  purpose: SmsPurpose,
  code: string,
  storedHash: string,
): boolean {
  const a = Buffer.from(hashSmsCode(secret, phone, purpose, code), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export type StoredSmsCode = Readonly<{
  codeHash: string
  expiresAt: string
  attempts: number
  consumedAt?: string | null
}>
export type SmsCodeCheck = 'ok' | 'invalid' | 'expired'

/** `stored.attempts` 是调用方已经 +1 写回后的值。 */
export function checkSmsCode(input: {
  secret: string
  phone: string
  purpose: SmsPurpose
  code: string
  stored: StoredSmsCode | null
  now: Date
}): SmsCodeCheck {
  const { stored } = input
  if (!stored || stored.consumedAt) return 'invalid'
  if (stored.attempts > SMS_CODE_MAX_ATTEMPTS) return 'invalid'
  if (new Date(stored.expiresAt).getTime() <= input.now.getTime()) return 'expired'
  if (!/^\d{6}$/.test(input.code)) return 'invalid'
  return smsCodeMatches(input.secret, input.phone, input.purpose, input.code, stored.codeHash)
    ? 'ok'
    : 'invalid'
}
