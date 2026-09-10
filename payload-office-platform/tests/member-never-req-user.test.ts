import type { SanitizedConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'

const { default: configPromise } = await import('@/payload.config')
const payloadConfig = (await configPromise) as SanitizedConfig

/**
 * 会员永远不能成为后台 req.user 的守卫（OPT-088 §7.4）。
 * 即便将来有人给 members 挂了 auth 策略，所有 access 也必须对 collection='members' 的用户返回 false。
 */
const memberReq = {
  user: { id: 1, collection: 'members', username: '13800001234', status: 'active' },
  context: {},
  payload: { find: vi.fn(async () => ({ docs: [] })) },
}

const PUBLIC_READ_COLLECTIONS = new Set([
  'media', 'pages', 'articles', 'locations', 'buildings', 'listings', 'brokers', 'merchants',
  'building-merchant-relations', 'display-tags', 'city-site-profiles', 'amenities', 'business-area-extensions',
])
const PUBLIC_READ_GLOBALS = new Set(['site-settings', 'advisor-service-hours'])

/** 允许 C 端公开提交的业务集合（举报与纠错，create: () => true） */
const PUBLIC_CREATE_COLLECTIONS = new Set(['listing-reports', 'information-corrections'])

/** 允许缺 create 的既有待办（与 collection-write-access-coverage.test.ts:39 保持一致） */
const CREATE_ACCESS_TODO = new Set(['follow-ups', 'lead-ownership-history'])

/** Payload 官方插件自动注入的集合，使用插件默认准入 */
const PLUGIN_COLLECTIONS = new Set(['search', 'forms', 'form-submissions', 'exports', 'imports'])

const OPS = ['read', 'create', 'update', 'delete', 'unlock', 'readVersions'] as const

async function denied(fn: unknown): Promise<boolean> {
  const result = await (fn as (a: unknown) => unknown)({ req: memberReq, id: 1, data: {} })
  return result === false
}

describe('会员上下文必须被全后台 access 拒绝', () => {
  const collections = payloadConfig.collections
    .filter((c) => !c.slug.startsWith('payload-'))
    .filter((c) => !PLUGIN_COLLECTIONS.has(c.slug))

  it('每个集合都显式声明了 access.read', () => {
    const missing = collections.filter((c) => typeof c.access?.read !== 'function').map((c) => c.slug)
    expect(missing).toEqual([])
  })

  it.each(collections.map((c) => [c.slug, c] as const))('%s', async (slug, collection) => {
    for (const op of OPS) {
      if (op === 'unlock' && !collection.auth) continue
      if (op === 'create' && (PUBLIC_CREATE_COLLECTIONS.has(slug) || CREATE_ACCESS_TODO.has(slug))) continue
      const fn = collection.access?.[op]
      if (typeof fn !== 'function') continue
      if (op === 'read' && PUBLIC_READ_COLLECTIONS.has(slug)) continue
      expect(await denied(fn), `${slug}.access.${op} 对会员放行了`).toBe(true)
    }
  })

  it.each(payloadConfig.globals.filter((g) => !g.slug.startsWith('payload-')).map((g) => [g.slug, g] as const))('global %s', async (slug, global) => {
    for (const op of ['read', 'update', 'readVersions'] as const) {
      const fn = global.access?.[op]
      if (typeof fn !== 'function') continue
      if (op === 'read' && PUBLIC_READ_GLOBALS.has(slug)) continue
      expect(await denied(fn), `global ${slug}.access.${op} 对会员放行了`).toBe(true)
    }
  })
})
