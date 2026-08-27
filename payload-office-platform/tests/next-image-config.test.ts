import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern'
import { describe, expect, it } from 'vitest'

import nextConfig from '../next.config'

/**
 * OPT-061：/_next/image 优化端点默认启用。它对**远程绝对 URL** 的放行由两份白名单
 * 决定——`images.remotePatterns` 与 deprecated 但仍受支持的 `images.domains`。
 * Next 16 的 `validateParams` 用 `hasRemoteMatch(domains, remotePatterns, url)` 判定，
 * 语义是 `domains 命中 || remotePatterns 命中`：**任一**非空且命中就放行。
 *
 * 一旦任一白名单出现通配/宽泛项（此前 remotePatterns 是 `{ protocol:'https', hostname:'**' }`），
 * 端点就退化为任意 https 源的公开图片代理——可刷出站带宽，也可当 SSRF 探测面。
 *
 * 本站媒体一律走同源相对路径 /api/media/file/*（相对路径不受这两份白名单约束），
 * 因此两份白名单都应为空。未来需要远程图源时按具体域名逐条加白，并同步改这里的断言。
 *
 * 只守 remotePatterns 不够：Codex 审查（PR #113）指出，若将来有人改走 `images.domains`，
 * 单看 remotePatterns 的断言会保持绿灯而代理重新打开。故下面既做静态断言，也用生产同款
 * gate 函数做行为断言，直接锚定「外部 URL 不被放行」这条安全不变量。
 */
describe('next/image 远程源白名单（OPT-061）', () => {
  const images = nextConfig.images ?? {}
  const domains = images.domains ?? []
  const remotePatterns = images.remotePatterns ?? []
  const external = new URL('https://attacker.example/probe.png')

  it('images.remotePatterns 为空', () => {
    expect(remotePatterns).toEqual([])
  })

  it('images.domains 为空（与 remotePatterns 是 OR 关系，任一非空都可能开代理）', () => {
    expect(domains).toEqual([])
  })

  it('运行期 gate：外部绝对 URL 不被两份白名单放行', () => {
    expect(hasRemoteMatch(domains, remotePatterns, external)).toBe(false)
  })

  it('负对照：任一白名单放开时同一 gate 会放行（证明上面的断言确实在测远程放行）', () => {
    expect(hasRemoteMatch(['attacker.example'], remotePatterns, external)).toBe(true)
    expect(hasRemoteMatch(domains, [{ protocol: 'https', hostname: '**' }], external)).toBe(true)
  })
})
