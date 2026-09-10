/**
 * 会员接口限流（OPT-088 §6.1）。与 lib/rate-limit-config 同一张 inquiry_rate_limit 表，靠前缀隔离配额。
 * 发短信花钱，三条短信配额 failOpen:false；登录配额 failOpen:true（密码有 Payload 锁定、验证码有次数上限兜底）。
 */
import { createHash } from 'node:crypto'
import type { PruneTimestampRef, RateLimitConfig } from '@/lib/rate-limit-distributed'

type Limit = Readonly<{ prefix: string; config: RateLimitConfig }>

const base = { maxKeys: 100_000, pruneIntervalMs: 5 * 60_000 }

export const MEMBER_RATE_LIMITS: Readonly<
  Record<'smsPhoneMinute' | 'smsPhoneDay' | 'smsIp' | 'loginIp', Limit>
> = {
  smsPhoneMinute: {
    prefix: 'member-sms:phone',
    config: { ...base, windowMs: 60_000, max: 1, failOpen: false },
  },
  smsPhoneDay: {
    prefix: 'member-sms:phone-day',
    config: { ...base, windowMs: 86_400_000, max: 10, failOpen: false },
  },
  smsIp: {
    prefix: 'member-sms:ip',
    config: { ...base, windowMs: 3_600_000, max: 20, failOpen: false },
  },
  loginIp: {
    prefix: 'member-login:ip',
    config: { ...base, windowMs: 900_000, max: 30, failOpen: true },
  },
}

export function rateLimitKey(prefix: string, raw: string): string {
  return `${prefix}:${createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16)}`
}

export const memberRatePruneRef: PruneTimestampRef = { value: 0 }
