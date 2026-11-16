import { describe, expect, it } from 'vitest'

import {
  CLASS_LIMITS,
  ENFORCED_CLASSES,
  LIMITER_MAX_KEYS,
  UNRESOLVED_ENGINE_LIMIT_FACTOR,
  readBotGuardConfig,
} from '@/lib/bot-guard/config'

describe('readBotGuardConfig', () => {
  it('默认模式随 NODE_ENV', () => {
    expect(readBotGuardConfig({ NODE_ENV: 'production' }).mode).toBe('observe')
    expect(readBotGuardConfig({ NODE_ENV: 'development' }).mode).toBe('off')
    expect(readBotGuardConfig({}).mode).toBe('off')
  })

  it('BOT_GUARD_MODE 覆盖，非法回落', () => {
    expect(readBotGuardConfig({ NODE_ENV: 'production', BOT_GUARD_MODE: 'enforce' }).mode).toBe('enforce')
    expect(readBotGuardConfig({ NODE_ENV: 'development', BOT_GUARD_MODE: 'observe' }).mode).toBe('observe')
    expect(readBotGuardConfig({ NODE_ENV: 'production', BOT_GUARD_MODE: 'bogus' }).mode).toBe('observe')
    expect(readBotGuardConfig({ NODE_ENV: 'development', BOT_GUARD_MODE: 'bogus' }).mode).toBe('off')
  })

  it('可信代理跳数', () => {
    const hops = (v: string | undefined) =>
      readBotGuardConfig({ BOT_GUARD_TRUSTED_PROXY_HOPS: v }).trustedProxyHops
    expect(hops('1')).toBe(1)
    expect(hops('5')).toBe(5)
    expect(hops('0')).toBeNull()
    expect(hops('x')).toBeNull()
    expect(hops('9')).toBeNull()
    expect(hops(undefined)).toBeNull()
  })

  it('白名单 IP 只留合法项', () => {
    const cfg = readBotGuardConfig({ BOT_GUARD_ALLOW_IPS: '1.1.1.1, 2001:db8::1, nope' })
    expect([...cfg.allowIps].sort()).toEqual(['1.1.1.1', '2001:db8::1'])
    expect(readBotGuardConfig({}).allowIps.size).toBe(0)
  })

  it('logKey 回落顺序', () => {
    expect(readBotGuardConfig({ BOT_GUARD_LOG_KEY: 'a', PAYLOAD_SECRET: 'b' }).logKey).toBe('a')
    expect(readBotGuardConfig({ PAYLOAD_SECRET: 'b' }).logKey).toBe('b')
    expect(readBotGuardConfig({}).logKey).toBe('')
  })
})

describe('常量', () => {
  it('限额与计划一致', () => {
    expect(CLASS_LIMITS.page).toEqual({ burst: 30, perMinute: 30, perHour: 600 })
    expect(CLASS_LIMITS.sitemap).toEqual({ burst: 5, perMinute: 5, perHour: 12 })
    expect(CLASS_LIMITS.media).toEqual({ burst: 100, perMinute: 300, perHour: 3000 })
    expect(CLASS_LIMITS['mini-read']).toEqual(CLASS_LIMITS.page)
    expect(LIMITER_MAX_KEYS).toBe(50_000)
    expect(UNRESOLVED_ENGINE_LIMIT_FACTOR).toBe(10)
  })
  it('ENFORCED_CLASSES 不含 mini-read', () => {
    expect([...ENFORCED_CLASSES].sort()).toEqual(['media', 'page', 'sitemap'])
  })
})
