/**
 * OPT-128：proxy 接线契约（读源码文本，沿用仓库的 fs 契约测试写法）。
 * 只针对 config.matcher 数组的源文本断言，不扫注释；响应映射走纯函数单测。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runBotGuard, toBlockResponse } from '../src/lib/bot-guard/runtime'

const source = readFileSync(join(__dirname, '../src/proxy.ts'), 'utf8')

function matcherText(): string {
  const m = source.match(/matcher:\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error('proxy.ts 中找不到 config.matcher 数组')
  return m[1]
}

describe('proxy matcher 契约', () => {
  it('保留对 /api 与 /_next 的负向前瞻', () => {
    expect(matcherText()).toContain('api$|api/|_next/')
  })

  it('显式覆盖小程序只读接口与媒体文件', () => {
    expect(matcherText()).toContain("'/api/mini/v1/:path*'")
    expect(matcherText()).toContain("'/api/media/file/:path*'")
  })

  it('不放宽到整个 /api，也不碰 health / admin', () => {
    const text = matcherText()
    expect(text).not.toContain("'/api/:path*'")
    expect(text).not.toContain('/api/health')
    expect(text).not.toContain('/admin')
  })
})

describe('proxy 接线顺序', () => {
  it('Next 保留预取请求头供 proxy 归类', () => {
    const nextConfig = readFileSync(join(__dirname, '../next.config.ts'), 'utf8')
    expect(nextConfig).toMatch(/^\s*skipProxyUrlNormalize:\s*true,/m)
  })

  it('proxy 声明为 async', () => {
    expect(source).toMatch(/export\s+async\s+function\s+proxy\s*\(/)
  })

  it('先主域名 301，再进守卫（落在主域名上的请求才计数）', () => {
    const redirectAt = source.indexOf('resolveCanonicalRedirect(')
    const guardAt = source.indexOf('runBotGuard(')
    expect(redirectAt).toBeGreaterThan(-1)
    expect(guardAt).toBeGreaterThan(-1)
    expect(redirectAt).toBeLessThan(guardAt)
  })
})

describe('toBlockResponse：处置到响应的映射', () => {
  it('limit → 429，带 Retry-After 与 no-store，纯文本', async () => {
    const res = toBlockResponse({ action: 'limit', status: 429, retryAfterSeconds: 17 })
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    expect(res!.headers.get('retry-after')).toBe('17')
    expect(res!.headers.get('cache-control')).toBe('no-store')
    expect(res!.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect((await res!.text()).length).toBeGreaterThan(0)
  })

  it('deny → 403，无 Retry-After，正文不泄露规则名', async () => {
    const res = toBlockResponse({ action: 'deny', status: 403 })
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(res!.headers.get('retry-after')).toBeNull()
    expect(res!.headers.get('cache-control')).toBe('no-store')
    expect(res!.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const body = await res!.text()
    expect(body).not.toMatch(/curl|python|scrapy|burst|hour|ua-|rule/i)
    expect(body).toMatch(/[一-鿿]/)
  })

  it('allow → null（放行）', () => {
    expect(toBlockResponse({ action: 'allow' })).toBeNull()
  })
})

describe('runBotGuard：运行时单例', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const req = (path: string) =>
    new NextRequest(`https://shangban.cc${path}`, {
      headers: { 'user-agent': 'curl/8.4.0', 'x-forwarded-for': '203.0.113.9' },
    })

  it('mode=off 时放行（不构建依赖）', async () => {
    vi.stubEnv('BOT_GUARD_MODE', 'off')
    expect(await runBotGuard(req('/buildings'))).toBeNull()
  })

  it('enforce：脚本 UA 访问页面与带 ?prefix=media 的媒体地址均得 403', async () => {
    vi.stubEnv('BOT_GUARD_MODE', 'enforce')
    vi.stubEnv('BOT_GUARD_TRUSTED_PROXY_HOPS', '1')
    const { runBotGuard: fresh } = await import('../src/lib/bot-guard/runtime')
    expect((await fresh(req('/buildings')))?.status).toBe(403)
    expect((await fresh(req('/api/media/file/a.jpg?prefix=media')))?.status).toBe(403)
  })
})
