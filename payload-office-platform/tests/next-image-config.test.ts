import { describe, expect, it } from 'vitest'

import nextConfig from '../next.config'

/**
 * OPT-061：/_next/image 优化端点默认启用，remotePatterns 是它唯一的远程源白名单。
 * 一旦出现通配 hostname（此前是 `{ protocol: 'https', hostname: '**' }`），
 * 端点就退化为任意 https 源的公开图片代理——可刷出站带宽，也可当 SSRF 探测面。
 *
 * 本站媒体一律走同源相对路径 /api/media/file/*，相对路径不受 remotePatterns 约束，
 * 因此白名单应当为空。未来需要远程图源时按具体域名逐条加白，并同步改这里的断言。
 */
describe('next/image 远程源白名单（OPT-061）', () => {
  it('images.remotePatterns 为空：不为任何远程主机开图片代理', () => {
    const patterns = nextConfig.images?.remotePatterns ?? []
    expect(patterns).toEqual([])
  })
})
