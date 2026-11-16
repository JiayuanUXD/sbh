import { describe, expect, it, vi } from 'vitest'

import {
  claimedEngine,
  createNodeDnsDeps,
  createSearchEngineVerifier,
  hostMatchesSuffix,
  type DnsDeps,
} from '../src/lib/bot-guard/search-engine'

const HOUR = 3_600_000
const BAIDU_UA = 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'
const GOOGLE_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const BING_UA = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'
const SOGOU_UA = 'Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)'
const SO360_UA = 'Mozilla/5.0 (Linux; Android 8.0) AppleWebKit/537.36 360Spider'

function makeDeps(opts: {
  reverse?: (ip: string) => Promise<readonly string[]>
  resolve?: (host: string) => Promise<readonly string[]>
}) {
  const clock = { t: 1_000_000 }
  const reverse = vi.fn(opts.reverse ?? (async () => []))
  const resolve = vi.fn(opts.resolve ?? (async () => []))
  const deps: DnsDeps = { reverse, resolve, now: () => clock.t }
  return { deps, clock, reverse, resolve }
}

describe('claimedEngine', () => {
  it('按 UA 识别声称的引擎', () => {
    expect(claimedEngine(BAIDU_UA)).toBe('baidu')
    expect(claimedEngine(GOOGLE_UA)).toBe('google')
    expect(claimedEngine(BING_UA)).toBe('bing')
    expect(claimedEngine(SOGOU_UA)).toBe('sogou')
    expect(claimedEngine(SO360_UA)).toBe('so360')
  })
  it('普通浏览器与空 UA 不声称任何引擎', () => {
    expect(claimedEngine('Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36')).toBeNull()
    expect(claimedEngine(null)).toBeNull()
    expect(claimedEngine('')).toBeNull()
  })
})

describe('hostMatchesSuffix（点边界）', () => {
  it('子域匹配，同名伪装域不匹配', () => {
    expect(hostMatchesSuffix('baiduspider-1-2-3-4.crawl.baidu.com', ['.baidu.com'])).toBe(true)
    expect(hostMatchesSuffix('BAIDUSPIDER.CRAWL.BAIDU.COM.', ['.baidu.com'])).toBe(true)
    expect(hostMatchesSuffix('evilbaidu.com', ['.baidu.com'])).toBe(false)
    expect(hostMatchesSuffix('baidu.com.evil.com', ['.baidu.com'])).toBe(false)
    expect(hostMatchesSuffix('baidu.com', ['.baidu.com'])).toBe(false)
  })
})

describe('createSearchEngineVerifier', () => {
  it('UA 不声称任何引擎 → none 且不发任何 DNS', async () => {
    const { deps, reverse, resolve } = makeDeps({})
    const verify = createSearchEngineVerifier(deps)
    expect(await verify('1.2.3.4', 'Mozilla/5.0 Chrome/120')).toEqual({ kind: 'none' })
    expect(await verify('1.2.3.4', null)).toEqual({ kind: 'none' })
    expect(reverse).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('百度：后缀合格且正向含该 IP → verified', async () => {
    const { deps } = makeDeps({
      reverse: async () => ['baiduspider-123-125-66-120.crawl.baidu.com'],
      resolve: async () => ['123.125.66.120'],
    })
    expect(await createSearchEngineVerifier(deps)('123.125.66.120', BAIDU_UA)).toEqual({
      kind: 'verified',
      engine: 'baidu',
    })
  })

  it('百度宽松：后缀合格但正向失败 / NXDOMAIN / 不含该 IP → unresolved，而不是 spoofed', async () => {
    const reverse = async () => ['baiduspider-1-2-3-4.crawl.baidu.com']
    for (const resolve of [
      async () => [] as string[],
      async () => ['9.9.9.9'],
      async () => {
        throw new Error('ENOTFOUND')
      },
    ]) {
      const { deps } = makeDeps({ reverse, resolve })
      expect(await createSearchEngineVerifier(deps)('1.2.3.4', BAIDU_UA)).toEqual({
        kind: 'unresolved',
        engine: 'baidu',
      })
    }
  })

  it('百度：rDNS 后缀不匹配（含 evilbaidu.com）→ spoofed', async () => {
    for (const host of ['evilbaidu.com', 'crawl.example.com']) {
      const { deps } = makeDeps({ reverse: async () => [host], resolve: async () => ['1.2.3.4'] })
      expect(await createSearchEngineVerifier(deps)('1.2.3.4', BAIDU_UA)).toEqual({
        kind: 'spoofed',
        engine: 'baidu',
      })
    }
  })

  it('谷歌严格：正向不含该 IP → spoofed；含则 verified', async () => {
    const reverse = async () => ['crawl-66-249-66-1.googlebot.com']
    const bad = makeDeps({ reverse, resolve: async () => ['8.8.8.8'] })
    expect(await createSearchEngineVerifier(bad.deps)('66.249.66.1', GOOGLE_UA)).toEqual({
      kind: 'spoofed',
      engine: 'google',
    })
    const good = makeDeps({ reverse, resolve: async () => ['66.249.66.1'] })
    expect(await createSearchEngineVerifier(good.deps)('66.249.66.1', GOOGLE_UA)).toEqual({
      kind: 'verified',
      engine: 'google',
    })
  })

  it('必应：.search.msn.com 严格验真；不相干域名 → spoofed', async () => {
    const ok = makeDeps({
      reverse: async () => ['msnbot-157-55-39-1.search.msn.com'],
      resolve: async () => ['157.55.39.1'],
    })
    expect(await createSearchEngineVerifier(ok.deps)('157.55.39.1', BING_UA)).toEqual({
      kind: 'verified',
      engine: 'bing',
    })
    const bad = makeDeps({ reverse: async () => ['host.example.com'] })
    expect(await createSearchEngineVerifier(bad.deps)('157.55.39.1', BING_UA)).toEqual({
      kind: 'spoofed',
      engine: 'bing',
    })
  })

  it('搜狗 / 360 无官方 rDNS 方法 → 恒为 unresolved 且不发 DNS', async () => {
    const { deps, reverse, resolve } = makeDeps({})
    const verify = createSearchEngineVerifier(deps)
    expect(await verify('1.2.3.4', SOGOU_UA)).toEqual({ kind: 'unresolved', engine: 'sogou' })
    expect(await verify('1.2.3.4', SO360_UA)).toEqual({ kind: 'unresolved', engine: 'so360' })
    expect(reverse).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('reverse / resolve 抛错 → unresolved，不抛出', async () => {
    const r1 = makeDeps({
      reverse: async () => {
        throw new Error('ETIMEOUT')
      },
    })
    expect(await createSearchEngineVerifier(r1.deps)('66.249.66.1', GOOGLE_UA)).toEqual({
      kind: 'unresolved',
      engine: 'google',
    })
    const r2 = makeDeps({
      reverse: async () => ['crawl-1.googlebot.com'],
      resolve: async () => {
        throw new Error('ESERVFAIL')
      },
    })
    expect(await createSearchEngineVerifier(r2.deps)('66.249.66.1', GOOGLE_UA)).toEqual({
      kind: 'unresolved',
      engine: 'google',
    })
  })

  it('verified 缓存 24h：23h 不再查，25h 再查', async () => {
    const { deps, clock, reverse } = makeDeps({
      reverse: async () => ['crawl-1.googlebot.com'],
      resolve: async () => ['66.249.66.1'],
    })
    const verify = createSearchEngineVerifier(deps)
    await verify('66.249.66.1', GOOGLE_UA)
    clock.t += 23 * HOUR
    await verify('66.249.66.1', GOOGLE_UA)
    expect(reverse).toHaveBeenCalledTimes(1)
    clock.t += 2 * HOUR
    await verify('66.249.66.1', GOOGLE_UA)
    expect(reverse).toHaveBeenCalledTimes(2)
  })

  it('spoofed 缓存 10 分钟', async () => {
    const { deps, clock, reverse } = makeDeps({ reverse: async () => ['x.example.com'] })
    const verify = createSearchEngineVerifier(deps)
    await verify('1.2.3.4', GOOGLE_UA)
    clock.t += 9 * 60_000
    await verify('1.2.3.4', GOOGLE_UA)
    expect(reverse).toHaveBeenCalledTimes(1)
    clock.t += 2 * 60_000
    await verify('1.2.3.4', GOOGLE_UA)
    expect(reverse).toHaveBeenCalledTimes(2)
  })

  it('unresolved 缓存 60 秒，防 DNS 风暴', async () => {
    const { deps, clock, reverse } = makeDeps({
      reverse: async () => {
        throw new Error('ETIMEOUT')
      },
    })
    const verify = createSearchEngineVerifier(deps)
    await verify('1.2.3.4', GOOGLE_UA)
    clock.t += 30_000
    await verify('1.2.3.4', GOOGLE_UA)
    expect(reverse).toHaveBeenCalledTimes(1)
    clock.t += 31_000
    await verify('1.2.3.4', GOOGLE_UA)
    expect(reverse).toHaveBeenCalledTimes(2)
  })

  it('缓存超 5000 条淘汰最旧', async () => {
    const { deps, reverse } = makeDeps({ reverse: async () => ['x.example.com'] })
    const verify = createSearchEngineVerifier(deps)
    for (let i = 0; i < 5001; i++) await verify(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, GOOGLE_UA)
    expect(reverse).toHaveBeenCalledTimes(5001)
    await verify('10.0.0.1', GOOGLE_UA) // 仍在缓存
    expect(reverse).toHaveBeenCalledTimes(5001)
    await verify('10.0.0.0', GOOGLE_UA) // 最旧，已被淘汰
    expect(reverse).toHaveBeenCalledTimes(5002)
  })

  it('同一 IP 并发两次只发一次 DNS', async () => {
    let release: (v: readonly string[]) => void = () => {}
    const { deps, reverse } = makeDeps({
      reverse: () => new Promise<readonly string[]>((r) => (release = r)),
    })
    const verify = createSearchEngineVerifier(deps)
    const a = verify('1.2.3.4', GOOGLE_UA)
    const b = verify('1.2.3.4', GOOGLE_UA)
    release(['x.example.com'])
    expect(await a).toEqual({ kind: 'spoofed', engine: 'google' })
    expect(await b).toEqual({ kind: 'spoofed', engine: 'google' })
    expect(reverse).toHaveBeenCalledTimes(1)
  })
})

describe('createNodeDnsDeps', () => {
  it('可构造，now 返回毫秒时间戳', () => {
    const deps = createNodeDnsDeps(1000)
    expect(typeof deps.reverse).toBe('function')
    expect(typeof deps.resolve).toBe('function')
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(1000)
  })
})
