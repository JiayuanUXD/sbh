/**
 * 流量块与转化漏斗（OPT-066）
 *
 * 重点覆盖三件事，其余是形状与边界：
 * 1. **缓存分层**——Umami 段命中缓存，线索段每次重算。整体缓存会造成真实越权。
 * 2. **非 global 调用方两个字段恒 null**——在服务端就 null，不是前端隐藏。
 * 3. **漏报率边界**——分母为 0、埋点数大于线索数各有明确处置。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeMissRate,
  INQUIRY_FUNNEL_SOURCE_PAGE_TYPES,
  isTrafficRange,
  resolveTrafficWindow,
} from '@/domain/analytics/traffic'
import { createUmamiClient, resolveUmamiServerConfig } from '@/domain/analytics/umami-client'
import { countFunnelLeads, fetchUmamiSegment } from '@/endpoints/traffic-endpoint'
import type { PermissionContext } from '@/domain/auth/permission-context'

// ────────────────────────────────────────────────────────────
// 时间窗
// ────────────────────────────────────────────────────────────

describe('resolveTrafficWindow', () => {
  // 北京时间 2026-09-02 10:00 => UTC 2026-09-02T02:00Z
  const now = new Date('2026-09-02T02:00:00.000Z')
  // 北京 2026-09-02 00:00 = UTC 2026-09-01T16:00Z
  const todayStart = Date.parse('2026-09-01T16:00:00.000Z')
  const DAY = 24 * 60 * 60 * 1000

  it('yesterday 取昨天整日（北京日界）', () => {
    expect(resolveTrafficWindow('yesterday', now)).toEqual({
      startAt: todayStart - DAY,
      endAt: todayStart,
    })
  })

  it('7d / 30d 不含今天', () => {
    // 今天是残缺的一天，混进来会让日均被不完整样本拉低，且每次刷新数字都在变
    expect(resolveTrafficWindow('7d', now).endAt).toBe(todayStart)
    expect(resolveTrafficWindow('7d', now).startAt).toBe(todayStart - 7 * DAY)
    expect(resolveTrafficWindow('30d', now).startAt).toBe(todayStart - 30 * DAY)
  })

  it('临近北京日界时仍按北京切日，不按 UTC', () => {
    // UTC 2026-09-01T16:30Z = 北京 2026-09-02 00:30，已是「今天」
    const justAfterMidnight = new Date('2026-09-01T16:30:00.000Z')
    expect(resolveTrafficWindow('yesterday', justAfterMidnight).endAt).toBe(todayStart)
  })

  it('range 枚举校验', () => {
    expect(isTrafficRange('yesterday')).toBe(true)
    expect(isTrafficRange('7d')).toBe(true)
    expect(isTrafficRange('90d')).toBe(false)
    expect(isTrafficRange(7)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 漏报率
// ────────────────────────────────────────────────────────────

describe('computeMissRate', () => {
  it('正常计算', () => {
    expect(computeMissRate(8, 10)).toBeCloseTo(0.2)
  })

  it('线索数为 0 → null（分母为零，任何数字都是编的）', () => {
    expect(computeMissRate(0, 0)).toBeNull()
    expect(computeMissRate(5, 0)).toBeNull()
  })

  it('线索数为 null（调用方无权取全量）→ null', () => {
    expect(computeMissRate(5, null)).toBeNull()
  })

  it('埋点数大于线索数 → 取 0 而不是负数', () => {
    // 重复提交 / 同一次咨询触发多次 success / 跨窗口时序错位都会导致这种情况，
    // 硬报负数只会让人以为看板坏了
    expect(computeMissRate(12, 10)).toBe(0)
  })

  it('非有限值不炸', () => {
    expect(computeMissRate(Number.NaN, 10)).toBeNull()
    expect(computeMissRate(1, Number.NaN)).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
// 漏斗分母判据
// ────────────────────────────────────────────────────────────

describe('漏斗分母口径', () => {
  it('排除 entrust——它写 sourcePageType 但不发 inquiry_success', () => {
    // 委托找房落地页也走 /api/inquiries、也写 sourcePageType，但只打 landing_* 事件。
    // 按「sourcePageType 非空」计数会把它算进分母而分子里没有它，漏报率被系统性高估。
    expect([...INQUIRY_FUNNEL_SOURCE_PAGE_TYPES]).not.toContain('entrust')
  })

  it('覆盖咨询弹窗可能出现的全部入口', () => {
    expect([...INQUIRY_FUNNEL_SOURCE_PAGE_TYPES].sort()).toEqual(
      ['building', 'content', 'home', 'listing', 'search'].sort(),
    )
  })
})

// ────────────────────────────────────────────────────────────
// 服务端配置
// ────────────────────────────────────────────────────────────

describe('resolveUmamiServerConfig', () => {
  const full = {
    UMAMI_URL: 'https://umami.example.com/',
    UMAMI_USERNAME: 'admin',
    UMAMI_PASSWORD: 'secret',
    UMAMI_WEBSITE_ID: 'abc-123',
  } as unknown as NodeJS.ProcessEnv

  it('齐备时解析并去掉尾斜杠', () => {
    expect(resolveUmamiServerConfig(full)).toEqual({
      url: 'https://umami.example.com',
      username: 'admin',
      password: 'secret',
      websiteId: 'abc-123',
    })
  })

  it('任一缺失返回 null（调用方据此降级为 unavailable）', () => {
    for (const key of Object.keys(full)) {
      const partial = { ...full }
      delete partial[key]
      expect(resolveUmamiServerConfig(partial), `缺 ${key} 应返回 null`).toBeNull()
    }
  })
})

// ────────────────────────────────────────────────────────────
// Umami 客户端：token 缓存与 401 重登
// ────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const CONFIG = {
  url: 'https://umami.example.com',
  username: 'admin',
  password: 'secret',
  websiteId: 'w1',
}

describe('createUmamiClient', () => {
  it('首次调用先登录，随后复用 token（不重复登录）', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/api/auth/login')) return jsonResponse({ token: 't1' })
      return jsonResponse({ pageviews: 10, visitors: 4 })
    })
    const client = createUmamiClient({ config: CONFIG, fetchImpl })

    await client.stats({ startAt: 1, endAt: 2 })
    await client.stats({ startAt: 1, endAt: 2 })

    expect(calls.filter((u) => u.includes('/api/auth/login'))).toHaveLength(1)
    expect(client.hasToken).toBe(true)
  })

  it('401 时重登一次并重放请求', async () => {
    let logins = 0
    let dataCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/login')) {
        logins += 1
        return jsonResponse({ token: `t${logins}` })
      }
      dataCalls += 1
      // 第一次数据请求 401（token 过期），重登后成功
      return dataCalls === 1
        ? jsonResponse({ error: { message: 'Unauthorized' } }, 401)
        : jsonResponse({ pageviews: 7, visitors: 3 })
    })
    const client = createUmamiClient({ config: CONFIG, fetchImpl })

    await expect(client.stats({ startAt: 1, endAt: 2 })).resolves.toEqual({
      pageviews: 7,
      visitors: 3,
    })
    expect(logins).toBe(2)
    expect(dataCalls).toBe(2)
  })

  it('重登后仍 401 → 抛错，不无限重试', async () => {
    // 密码错了的话无限重登会把 Umami 的登录接口打爆，且每次请求要等两轮超时
    let logins = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/login')) {
        logins += 1
        return jsonResponse({ token: 't' })
      }
      return jsonResponse({ error: { message: 'Unauthorized' } }, 401)
    })
    const client = createUmamiClient({ config: CONFIG, fetchImpl })

    await expect(client.stats({ startAt: 1, endAt: 2 })).rejects.toThrow(/Unauthorized/)
    expect(logins).toBe(2)
  })

  it('登录失败带出 Umami 的错误文案', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: 'Incorrect username and/or password.' } }, 401),
    )
    const client = createUmamiClient({ config: CONFIG, fetchImpl })
    await expect(client.stats({ startAt: 1, endAt: 2 })).rejects.toThrow(/Incorrect username/)
  })

  it('metrics 丢弃形状不合法的行', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/login')) return jsonResponse({ token: 't' })
      return jsonResponse([{ x: 'a', y: 3 }, { y: 5 }, 'junk', { x: 'b', y: 'nope' }])
    })
    const client = createUmamiClient({ config: CONFIG, fetchImpl })
    await expect(client.metrics('event', { startAt: 1, endAt: 2 })).resolves.toEqual([
      { x: 'a', y: 3 },
      { x: 'b', y: 0 },
    ])
  })
})

// ────────────────────────────────────────────────────────────
// Umami 段组装
// ────────────────────────────────────────────────────────────

describe('fetchUmamiSegment', () => {
  function stubClient(events: Array<{ x: string; y: number }>) {
    return {
      stats: async () => ({ pageviews: 100, visitors: 40 }),
      pageviews: async () => [{ t: '2026-09-01', pageviews: 50, visitors: 20 }],
      metrics: async (type: string) => {
        if (type === 'event') return events
        if (type === 'referrer') return [{ x: 'google.com', y: 9 }]
        return [{ x: '/shanghai/listings', y: 30 }]
      },
      hasToken: true,
    }
  }

  it('按事件名取漏斗后三步；缺失的事件记 0', async () => {
    const seg = await fetchUmamiSegment(
      stubClient([{ x: 'inquiry_open', y: 20 }, { x: 'inquiry_success', y: 5 }]),
      { startAt: 1, endAt: 2 },
    )
    expect(seg.funnel.inquiryOpen).toBe(20)
    expect(seg.funnel.inquirySubmit).toBe(0) // 没有该事件 = 没发生过
    expect(seg.funnel.inquirySuccess).toBe(5)
  })

  it('首步 detailView 为 null（不可测），而不是 0', async () => {
    // 0 会被读成「一个详情页都没人看」，null 才是「这一环量不到」。
    // 两者在看板上含义完全相反。
    const seg = await fetchUmamiSegment(stubClient([]), { startAt: 1, endAt: 2 })
    expect(seg.funnel.detailView).toBeNull()
  })

  it('来源与落地页各取前 10', async () => {
    const seg = await fetchUmamiSegment(stubClient([]), { startAt: 1, endAt: 2 })
    expect(seg.topReferrers[0]).toEqual({ name: 'google.com', visitors: 9 })
    expect(seg.topPages[0]).toEqual({ path: '/shanghai/listings', pageviews: 30 })
  })
})

// ────────────────────────────────────────────────────────────
// 线索段：dataScope 收窄
// ────────────────────────────────────────────────────────────

function permissionWith(dataScope: string): PermissionContext {
  return {
    userId: 1,
    roleCodes: new Set(['X']),
    operationPermissions: new Set(['analytics:traffic']),
    fieldPermissions: new Set<string>(),
    menuPermissions: new Set(['analytics']),
    dataScope,
    cityScope: 'all',
    teamScope: 'all',
  } as unknown as PermissionContext
}

describe('countFunnelLeads', () => {
  let counted: Array<Record<string, unknown>>
  let req: { payload: { count: (a: Record<string, unknown>) => Promise<{ totalDocs: number }> } }

  beforeEach(() => {
    counted = []
    req = {
      payload: {
        count: async (args) => {
          counted.push(args)
          return { totalDocs: 42 }
        },
      },
    }
  })

  it('global 范围：真的去数，且 overrideAccess 必须为 false', async () => {
    const n = await countFunnelLeads(req as never, permissionWith('global'), {
      startAt: 0,
      endAt: 1000,
    })
    expect(n).toBe(42)
    expect(counted).toHaveLength(1)
    // overrideAccess:true 会绕开 leadReadAccess，等于把全量线索数漏给任何调用方
    expect(counted[0].overrideAccess).toBe(false)
    expect(counted[0].collection).toBe('leads')
  })

  for (const scope of ['team', 'self', 'city', 'none']) {
    it(`${scope} 范围：服务端直接返回 null，且根本不查库`, async () => {
      // 关键：不是「前端不显示那一行」。隐藏 UI 不是权限控制，
      // 直接打 API 照样能拿到别人范围内的线索聚合。
      const n = await countFunnelLeads(req as never, permissionWith(scope), {
        startAt: 0,
        endAt: 1000,
      })
      expect(n).toBeNull()
      expect(counted).toHaveLength(0)
    })
  }

  it('按入口枚举过滤，不是「sourcePageType 非空」', async () => {
    await countFunnelLeads(req as never, permissionWith('global'), { startAt: 0, endAt: 1000 })
    const where = JSON.stringify(counted[0].where)
    expect(where).toContain('sourcePageType')
    expect(where).toContain('listing')
    // entrust 走 landing_* 链路、不发 inquiry_success，不能进分母
    expect(where).not.toContain('entrust')
  })
})

// ────────────────────────────────────────────────────────────
// 缓存分层：这是越权防线，必须在 handler 层验
// ────────────────────────────────────────────────────────────

vi.mock('@/domain/auth/access', () => ({
  requireAdminContext: async (req: { __permission?: unknown }) => {
    if (!req.__permission) throw new Error('未登录')
    return req.__permission
  },
}))

describe('createTrafficEndpoint 缓存分层', () => {
  const UMAMI_CONFIG = {
    url: 'https://u.example.com',
    username: 'a',
    password: 'b',
    websiteId: 'w',
  }

  function makeReq(permission: PermissionContext | null, leadCount: number, range = 'yesterday') {
    const counts: Array<Record<string, unknown>> = []
    return {
      req: {
        __permission: permission,
        searchParams: new URLSearchParams({ range }),
        payload: {
          count: async (args: Record<string, unknown>) => {
            counts.push(args)
            return { totalDocs: leadCount }
          },
        },
      },
      counts,
    }
  }

  /** 每次调用都返回递增的 PV，便于分辨「是否走了缓存」 */
  function stubClientFactory() {
    let calls = 0
    const factory = () => {
      calls += 1
      const n = calls
      return {
        stats: async () => ({ pageviews: n * 100, visitors: n * 10 }),
        pageviews: async () => [],
        metrics: async (type: string) =>
          type === 'event' ? [{ x: 'inquiry_success', y: 5 }] : [],
        hasToken: true,
      }
    }
    return { factory, umamiCalls: () => calls }
  }

  beforeEach(async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    mod.__clearTrafficCache()
  })

  it('Umami 段命中缓存，但线索段每次重算——两个账号拿到各自的线索数', async () => {
    // 这是 Codex review P1 指出的真实越权：整体按 range 缓存，
    // 会把 A 的线索聚合在 60 秒内原样返回给 B。
    const mod = await import('@/endpoints/traffic-endpoint')
    const { factory, umamiCalls } = stubClientFactory()
    const endpoint = mod.createTrafficEndpoint({
      resolveConfig: () => UMAMI_CONFIG,
      createClient: factory as never,
      now: () => new Date('2026-09-02T02:00:00.000Z'),
    })

    // 第一个账号：global，线索 10
    const a = makeReq(permissionWith('global'), 10)
    const resA = await endpoint.handler!(a.req as never)
    const bodyA = await (resA as Response).json()

    // 第二个账号：同样 global 但线索只有 3（不同数据范围下的不同结果）
    const b = makeReq(permissionWith('global'), 3)
    const resB = await endpoint.handler!(b.req as never)
    const bodyB = await (resB as Response).json()

    // Umami 段：只拉了一次（第二次命中缓存），两次 PV 相同
    expect(umamiCalls()).toBe(1)
    expect(bodyA.traffic.pageviews).toBe(100)
    expect(bodyB.traffic.pageviews).toBe(100)

    // 线索段：各算各的，绝不能复用第一次的值
    expect(bodyA.traffic.leadsInWindow).toBe(10)
    expect(bodyB.traffic.leadsInWindow).toBe(3)
    expect(b.counts).toHaveLength(1) // 第二个请求确实查了库
  })

  it('第二个账号是非 global 时，拿到的是 null 而不是第一个账号的缓存值', async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    const { factory } = stubClientFactory()
    const endpoint = mod.createTrafficEndpoint({
      resolveConfig: () => UMAMI_CONFIG,
      createClient: factory as never,
      now: () => new Date('2026-09-02T02:00:00.000Z'),
    })

    const a = makeReq(permissionWith('global'), 10)
    const bodyA = await (await endpoint.handler!(a.req as never) as Response).json()
    expect(bodyA.traffic.leadsInWindow).toBe(10)

    const b = makeReq(permissionWith('team'), 999)
    const bodyB = await (await endpoint.handler!(b.req as never) as Response).json()
    expect(bodyB.traffic.leadsInWindow).toBeNull()
    expect(bodyB.traffic.missRate).toBeNull()
    expect(b.counts).toHaveLength(0) // 根本没查库
  })

  it('缓存按 range 分键，不同 range 各拉各的', async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    const { factory, umamiCalls } = stubClientFactory()
    const endpoint = mod.createTrafficEndpoint({
      resolveConfig: () => UMAMI_CONFIG,
      createClient: factory as never,
      now: () => new Date('2026-09-02T02:00:00.000Z'),
    })
    await endpoint.handler!(makeReq(permissionWith('global'), 1, 'yesterday').req as never)
    await endpoint.handler!(makeReq(permissionWith('global'), 1, '7d').req as never)
    expect(umamiCalls()).toBe(2)
  })

  it('无 analytics:traffic → 403，且不碰 Umami 也不查库', async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    const { factory, umamiCalls } = stubClientFactory()
    const endpoint = mod.createTrafficEndpoint({
      resolveConfig: () => UMAMI_CONFIG,
      createClient: factory as never,
    })
    const noTraffic = permissionWith('global')
    ;(noTraffic.operationPermissions as Set<string>).delete('analytics:traffic')

    const r = makeReq(noTraffic, 10)
    const res = (await endpoint.handler!(r.req as never)) as Response
    expect(res.status).toBe(403)
    expect(umamiCalls()).toBe(0)
    expect(r.counts).toHaveLength(0)
  })

  it('未登录 → 401', async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    const endpoint = mod.createTrafficEndpoint({ resolveConfig: () => UMAMI_CONFIG })
    const res = (await endpoint.handler!(makeReq(null, 0).req as never)) as Response
    expect(res.status).toBe(401)
  })

  it('非法 range → 400', async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    const endpoint = mod.createTrafficEndpoint({ resolveConfig: () => UMAMI_CONFIG })
    const res = (await endpoint.handler!(
      makeReq(permissionWith('global'), 1, '90d').req as never,
    )) as Response
    expect(res.status).toBe(400)
  })

  it('未配 UMAMI_* → 流量块 unavailable，但响应仍是 200（业务块不受牵连）', async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    const endpoint = mod.createTrafficEndpoint({ resolveConfig: () => null })
    const res = (await endpoint.handler!(
      makeReq(permissionWith('global'), 1).req as never,
    )) as Response
    expect(res.status).toBe(200)
    const body = await res.json()
    // reason 区分「没配」与「配了连不上」——没有它，两种故障在页面上长得一模一样，
    // OPT-066 上线首日就因此只能靠「响应耗时 38ms」这种间接证据倒推
    expect(body.traffic).toEqual({ status: 'unavailable', reason: 'not-configured' })
  })

  it('Umami 抛错 → 同样降级为 unavailable，不把整个请求打挂', async () => {
    const mod = await import('@/endpoints/traffic-endpoint')
    const endpoint = mod.createTrafficEndpoint({
      resolveConfig: () => UMAMI_CONFIG,
      createClient: (() => ({
        stats: async () => { throw new Error('boom') },
        pageviews: async () => [],
        metrics: async () => [],
        hasToken: false,
      })) as never,
    })
    const res = (await endpoint.handler!(
      makeReq(permissionWith('global'), 1).req as never,
    )) as Response
    expect(res.status).toBe(200)
    // 配置读到了、调用失败 → upstream-error（与上一条的 not-configured 必须可区分）
    expect((await res.json()).traffic).toEqual({ status: 'unavailable', reason: 'upstream-error' })
  })
})

describe('环境变量读取的健壮性（OPT-066 线上排障后补）', () => {
  it('URL 漏写协议时自动补 https://', async () => {
    // 漏写协议的表现是 fetch 立刻抛 Failed to parse URL——耗时接近 0，
    // 与「压根没配」的症状完全一样，排查时极难分辨
    const mod = await import('@/domain/analytics/umami-client')
    const cfg = mod.resolveUmamiServerConfig({
      UMAMI_URL: 'umami.example.com',
      UMAMI_USERNAME: 'a',
      UMAMI_PASSWORD: 'b',
      UMAMI_WEBSITE_ID: 'w',
    } as unknown as NodeJS.ProcessEnv)
    expect(cfg?.url).toBe('https://umami.example.com')
  })

  it('已有协议时不重复添加', async () => {
    const mod = await import('@/domain/analytics/umami-client')
    for (const input of ['https://u.example.com', 'http://u.example.com']) {
      const cfg = mod.resolveUmamiServerConfig({
        UMAMI_URL: input,
        UMAMI_USERNAME: 'a',
        UMAMI_PASSWORD: 'b',
        UMAMI_WEBSITE_ID: 'w',
      } as unknown as NodeJS.ProcessEnv)
      expect(cfg?.url).toBe(input)
    }
  })

  it('missingUmamiEnvKeys 只报键名，且把空串算作缺失', async () => {
    const mod = await import('@/domain/analytics/umami-client')
    const missing = mod.missingUmamiEnvKeys({
      UMAMI_URL: 'https://u.example.com',
      UMAMI_USERNAME: '   ',
      UMAMI_PASSWORD: 'b',
    } as unknown as NodeJS.ProcessEnv)
    // 空白值与不存在同等对待——控制台里「建了键但没填值」是常见操作失误
    expect(missing.sort()).toEqual(['UMAMI_USERNAME', 'UMAMI_WEBSITE_ID'])
  })
})

describe('Umami 400 的错误信息必须保留可定位的细节', () => {
  it('errors[] 数组要带出来，而不只是顶层 "Bad request"', async () => {
    const mod = await import('@/domain/analytics/umami-client')
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/login')) return jsonResponse({ token: 't' })
      return jsonResponse(
        {
          error: {
            message: 'Bad request',
            errors: ['Either startAt+endAt or startDate+endDate must be provided'],
          },
        },
        400,
      )
    })
    const client = mod.createUmamiClient({ config: CONFIG, fetchImpl })
    // 顶层 message 恒为 "Bad request"，没有 errors[] 就完全无法定位
    await expect(client.stats({ startAt: 1, endAt: 2 })).rejects.toThrow(/startAt\+endAt/)
  })

  it('properties 里按字段分组的校验错误也要带出字段名', async () => {
    const mod = await import('@/domain/analytics/umami-client')
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/login')) return jsonResponse({ token: 't' })
      return jsonResponse(
        {
          error: {
            message: 'Bad request',
            errors: [],
            properties: { type: { errors: ['Invalid input: expected string, received undefined'] } },
          },
        },
        400,
      )
    })
    const client = mod.createUmamiClient({ config: CONFIG, fetchImpl })
    await expect(client.metrics('event', { startAt: 1, endAt: 2 })).rejects.toThrow(/type:/)
  })

  it('错误里标明是哪个查询失败（5 个查询并发，不标明等于没说）', async () => {
    const mod = await import('@/domain/analytics/umami-client')
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/login')) return jsonResponse({ token: 't' })
      return jsonResponse({ error: { message: 'Bad request' } }, 400)
    })
    const client = mod.createUmamiClient({ config: CONFIG, fetchImpl })
    await expect(client.metrics('url', { startAt: 1, endAt: 2 })).rejects.toThrow(/\/metrics\?/)
    // 只带参数名不带值——值可能含时间窗以外的敏感内容
    await expect(client.metrics('url', { startAt: 1, endAt: 2 })).rejects.toThrow(/endAt,startAt,type/)
  })
})
