import { describe, it, expect } from 'vitest'
import { buildSecurityHeaders, toNextHeaderEntries } from '../src/lib/security-headers'

describe('buildSecurityHeaders', () => {
  it('生产环境含 HSTS + CSP + 基础头', () => {
    const h = buildSecurityHeaders({ isProduction: true })
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload')
    expect(h['Content-Security-Policy']).toBeDefined()
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Permissions-Policy']).toContain('camera=()')
  })

  it('非生产环境不含 HSTS 与 CSP，保留基础头', () => {
    const h = buildSecurityHeaders({ isProduction: false })
    expect(h['Strict-Transport-Security']).toBeUndefined()
    expect(h['Content-Security-Policy']).toBeUndefined()
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Permissions-Policy']).toBeDefined()
  })

  it('生产 CSP 含关键收紧指令', () => {
    const csp = buildSecurityHeaders({ isProduction: true })['Content-Security-Policy']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('Permissions-Policy 禁用敏感能力', () => {
    const pp = buildSecurityHeaders({ isProduction: true })['Permissions-Policy']
    expect(pp).toContain('camera=()')
    expect(pp).toContain('microphone=()')
    expect(pp).toContain('geolocation=()')
    expect(pp).toContain('payment=()')
    expect(pp).toContain('interest-cohort=()')
  })
})

describe('toNextHeaderEntries', () => {
  it('把 Record 转成 {key,value} 数组', () => {
    const entries = toNextHeaderEntries({ 'X-A': '1', 'X-B': '2' })
    expect(entries).toEqual([
      { key: 'X-A', value: '1' },
      { key: 'X-B', value: '2' },
    ])
  })

  it('生产头集合可完整转换为 Next 格式', () => {
    const headers = buildSecurityHeaders({ isProduction: true })
    const entries = toNextHeaderEntries(headers)
    expect(entries.length).toBe(Object.keys(headers).length)
    for (const e of entries) {
      expect(typeof e.key).toBe('string')
      expect(typeof e.value).toBe('string')
    }
  })
})
