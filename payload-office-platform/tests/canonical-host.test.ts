/**
 * OPT-098：主域名归一（www / 旧默认域名 → shangban.cc）。
 *
 * 纯函数层只认「显式列出的旧主机名」，其余一律放行，所以：
 *   - 主域名自己永远不会被重定向（不可能成环）；
 *   - 本地 / CI 的 localhost 不受影响；
 *   - /api 与 /_next 即使被 matcher 漏进来也不跳（CI 冒烟只打 /api/health）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LEGACY_HOSTS,
  normalizeHost,
  resolveCanonicalRedirect,
} from '../src/lib/frontend/canonical-host'

const CANONICAL = 'https://shangban.cc'
const OLD_DEFAULT = 'sbh-286300-10-1253925058.sh.run.tcloudbase.com'

function redirect(
  overrides: Partial<Parameters<typeof resolveCanonicalRedirect>[0]> & { host?: string | null },
) {
  return resolveCanonicalRedirect({
    host: null,
    forwardedHost: null,
    pathname: '/',
    search: '',
    canonicalOrigin: CANONICAL,
    ...overrides,
  })
}

describe('normalizeHost', () => {
  it('去端口、小写、取多跳 x-forwarded-host 的第一跳', () => {
    expect(normalizeHost('WWW.Shangban.cc:443')).toBe('www.shangban.cc')
    expect(normalizeHost('www.shangban.cc, gateway.internal')).toBe('www.shangban.cc')
    expect(normalizeHost(null)).toBe('')
    expect(normalizeHost('')).toBe('')
  })
})

describe('resolveCanonicalRedirect', () => {
  it('www → 裸域，保留 path 与 query，301 目标是绝对 URL', () => {
    expect(
      redirect({ host: 'www.shangban.cc', pathname: '/shanghai/listings', search: '?page=2' }),
    ).toBe('https://shangban.cc/shanghai/listings?page=2')
  })

  it('旧的 CloudRun 默认域名 → 裸域', () => {
    expect(redirect({ host: OLD_DEFAULT, pathname: '/shanghai' })).toBe(
      'https://shangban.cc/shanghai',
    )
    expect(
      redirect({
        host: 'sbh-sbh-d9gnr8h5ef7e22e30-1253925058.ap-shanghai.run.wxcloudrun.com',
        pathname: '/admin/login',
      }),
    ).toBe('https://shangban.cc/admin/login')
  })

  it('主域名自己不跳（防成环）', () => {
    expect(redirect({ host: 'shangban.cc', pathname: '/shanghai' })).toBeNull()
    expect(redirect({ host: 'shangban.cc:443', pathname: '/' })).toBeNull()
  })

  it('x-forwarded-host 优先于 host，与 Next.js Server Actions 的同源判定一致', () => {
    // 网关把 Host 改写成上游默认域名、真实主机放在 x-forwarded-host 的情况：必须按后者判
    expect(redirect({ host: OLD_DEFAULT, forwardedHost: 'shangban.cc', pathname: '/' })).toBeNull()
    expect(
      redirect({ host: 'shangban.cc', forwardedHost: 'www.shangban.cc', pathname: '/x' }),
    ).toBe('https://shangban.cc/x')
  })

  it('不在名单里的主机一律放行：localhost / CI / 未知反代', () => {
    expect(redirect({ host: 'localhost:3717', pathname: '/shanghai' })).toBeNull()
    expect(redirect({ host: '127.0.0.1:3717', pathname: '/' })).toBeNull()
    expect(redirect({ host: 'staging.example.com', pathname: '/' })).toBeNull()
    expect(redirect({ host: null, forwardedHost: null, pathname: '/' })).toBeNull()
  })

  it('/api 与 /_next 不跳：CI 冒烟打旧域名的 /api/health 必须仍是 200', () => {
    expect(redirect({ host: OLD_DEFAULT, pathname: '/api/health' })).toBeNull()
    expect(redirect({ host: OLD_DEFAULT, pathname: '/api' })).toBeNull()
    expect(redirect({ host: 'www.shangban.cc', pathname: '/api/media/file/a.jpg' })).toBeNull()
    expect(redirect({ host: 'www.shangban.cc', pathname: '/_next/static/chunks/x.js' })).toBeNull()
    // 前缀相似但不是 /api 的路径照跳
    expect(redirect({ host: 'www.shangban.cc', pathname: '/apix' })).toBe('https://shangban.cc/apix')
  })

  it('canonicalOrigin 本身是旧域名时（历史 CI 配置）不跳', () => {
    expect(
      redirect({ host: OLD_DEFAULT, pathname: '/', canonicalOrigin: `https://${OLD_DEFAULT}` }),
    ).toBeNull()
  })

  it('名单只含 www 与两个 CloudRun 默认域名', () => {
    expect([...LEGACY_HOSTS].sort()).toEqual(
      [
        'www.shangban.cc',
        OLD_DEFAULT,
        'sbh-sbh-d9gnr8h5ef7e22e30-1253925058.ap-shanghai.run.wxcloudrun.com',
      ].sort(),
    )
  })
})

describe('接线：proxy.ts 与构建期站点 URL', () => {
  const root = join(__dirname, '..')

  it('src/proxy.ts 存在，matcher 排除 /api 与 /_next', () => {
    const src = readFileSync(join(root, 'src/proxy.ts'), 'utf8')
    expect(src).toMatch(/export function proxy\(/)
    expect(src).toMatch(/resolveCanonicalRedirect/)
    const matcher = src.match(/matcher:\s*\[([^\]]+)\]/)?.[1] ?? ''
    expect(matcher).toContain('api')
    expect(matcher).toContain('_next')
  })

  it('Dockerfile 两个阶段的 NEXT_PUBLIC_SITE_URL 都是主域名', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    const values = [...dockerfile.matchAll(/^ENV NEXT_PUBLIC_SITE_URL=(\S+)$/gm)].map((m) => m[1])
    expect(values).toEqual([CANONICAL, CANONICAL])
  })

  it('CI 质量门与本地发布脚本的站点 URL 也是主域名', () => {
    const quality = readFileSync(join(root, '../.github/workflows/quality.yml'), 'utf8')
    expect(quality).toMatch(new RegExp(`NEXT_PUBLIC_SITE_URL:\\s*${CANONICAL.replace(/\./g, '\\.')}\\s*$`, 'm'))
    const release = readFileSync(join(root, '../scripts/cloudrun-release.sh'), 'utf8')
    expect(release).toContain(`SITE_URL="\${TCB_SERVICE_URL:-${CANONICAL}}"`)
  })
})
