import { describe, expect, it } from 'vitest'
import { clientIp, extractPgPool, isSameOrigin, isSameOriginHost, isStrictJsonContentType } from '@/lib/api/request-guards'

describe('共享请求守卫', () => {
  it('isSameOriginHost：Origin 的 host 等于 Host 头才放行，缺头拒绝', () => {
    const mk = (headers: Record<string, string>) => new Request('http://internal.invalid/api', { headers })
    expect(isSameOriginHost(mk({ host: 'localhost:3717', origin: 'http://localhost:3717' }))).toBe(true)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com', origin: 'https://sbh.example.com' }))).toBe(true)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com', origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com' }))).toBe(false)
    expect(isSameOriginHost(mk({ origin: 'https://sbh.example.com' }))).toBe(false)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com', origin: 'not a url' }))).toBe(false)
  })

  it('严格 JSON 媒体类型', () => {
    expect(isStrictJsonContentType('application/json')).toBe(true)
    expect(isStrictJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isStrictJsonContentType('text/json')).toBe(false)
    expect(isStrictJsonContentType(null)).toBe(false)
  })

  it('同源校验：origin 与 host 都必须匹配配置的站点 origin', () => {
    const ok = new Request('https://sbh.example.com/api', {
      headers: { host: 'sbh.example.com', origin: 'https://sbh.example.com' },
    })
    expect(isSameOrigin(ok, 'https://sbh.example.com')).toBe(true)
    const bad = new Request('https://sbh.example.com/api', {
      headers: { host: 'sbh.example.com', origin: 'https://attacker.example' },
    })
    expect(isSameOrigin(bad, 'https://sbh.example.com')).toBe(false)
    expect(isSameOrigin(new Request('https://sbh.example.com/api'), 'https://sbh.example.com')).toBe(false)
  })

  it('clientIp：x-forwarded-for 首段优先，其次 x-real-ip，否则 unknown', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4')
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': ' 9.9.9.9 ' } }))).toBe('9.9.9.9')
    expect(clientIp(new Request('http://x'))).toBe('unknown')
  })

  it('extractPgPool 只认带 query 函数的 pool', () => {
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) }
    expect(extractPgPool({ pool })).toBe(pool)
    expect(extractPgPool({ pool: {} })).toBeNull()
    expect(extractPgPool(null)).toBeNull()
  })
})
