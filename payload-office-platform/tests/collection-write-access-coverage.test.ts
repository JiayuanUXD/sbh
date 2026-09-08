import type { SanitizedConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { RequestContext } from '@/domain/auth/access'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

const { default: configPromise } = await import('@/payload.config')
const payloadConfig = (await configPromise) as SanitizedConfig

/**
 * 写侧准入的**全量覆盖守卫** + 本轮新收九个集合的角色矩阵
 *
 * 背景：Payload 3.86 在 collection 缺 `access.create/update/delete` 时会补上
 * `defaultAccess`（`collections/config/sanitize.js`，判据仅 `Boolean(req.user)`）
 * ——任何登录账号都能做对应动作。这是本仓库反复出现的同族缺陷
 * （OPT-051、OPT-053/055、#159，以及本轮的 Locations / Customers / Leads /
 * Buildings / Listings 与这九个）。
 *
 * 上面那条「覆盖守卫」是为了让它**不再复发**：新建 collection 忘了写 access，
 * 这条测试会红，而不是等到下一次审计才发现。
 */

// ────────────────────────────────────────────────────────────
// 1. 全量覆盖守卫
// ────────────────────────────────────────────────────────────

/**
 * 允许缺 `create` 的集合白名单——**只有两个，且都是已知待办，不是设计如此**。
 *
 * FollowUps 与 LeadOwnershipHistory 是 append-only 表（`update` / `delete` 都写死
 * `() => false`），但 `create` 至今缺省 = 任何登录账号都能追加跟进记录 / 归属历史。
 * 合适的判据分别是 `lead:follow_up` 与「仅系统写入」，但那要先确认领域服务的写入
 * 路径是否走 overrideAccess，属于另一件事，本轮不动。
 *
 * **加进这个名单前先问一遍：是真的该豁免，还是只是懒得收？** 目前答案是后者，
 * 所以它们留在这里当作可见的待办，而不是被默默忽略。
 */
const CREATE_ACCESS_TODO = new Set(['follow-ups', 'lead-ownership-history'])

const WRITE_OPERATIONS = ['create', 'update', 'delete'] as const

describe('全部 collection 都必须显式声明写侧 access', () => {
  const collections = payloadConfig.collections.filter(
    (c) => !c.slug.startsWith('payload-'),
  )

  it('注册的集合数量非零（否则本守卫等于空跑）', () => {
    expect(collections.length).toBeGreaterThan(20)
  })

  it.each(WRITE_OPERATIONS)('每个集合都声明了 access.%s', (op) => {
    const missing = collections
      .filter((c) => typeof c.access?.[op] !== 'function')
      .map((c) => c.slug)
      .filter((slug) => !(op === 'create' && CREATE_ACCESS_TODO.has(slug)))

    expect(
      missing,
      `以下集合缺 access.${op}，会落回 defaultAccess（任何登录账号都能做）：${missing.join(', ')}`,
    ).toEqual([])
  })

  it('白名单本身不许扩张：只允许两个已知待办', () => {
    expect([...CREATE_ACCESS_TODO].sort()).toEqual(['follow-ups', 'lead-ownership-history'])
  })
})

// ────────────────────────────────────────────────────────────
// 2. 本轮九个集合的角色矩阵
// ────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    name: 'test-user',
    email: 'test@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [1],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

function makeBuiltinRole(code: BuiltinRoleCode): Role {
  const fixture = BUILTIN_ROLES[code]
  return {
    id: 1,
    code: fixture.code,
    name: fixture.name,
    isBuiltin: true,
    status: 'active',
    dataScope: fixture.dataScope,
    menuPermissions: fixture.menuPermissions,
    operationPermissions: fixture.operationPermissions,
    fieldPermissions: fixture.fieldPermissions,
    updatedAt: '',
    createdAt: '',
  } as unknown as Role
}

function makeReq(params: { user?: User | null; roles?: Role[] }): RequestContext {
  return {
    user: params.user ?? null,
    payload: { find: vi.fn(async () => ({ docs: params.roles ?? [] })) },
  } as unknown as RequestContext
}

function reqForRole(code: BuiltinRoleCode): RequestContext {
  return makeReq({ user: makeUser({ roles: [1] }), roles: [makeBuiltinRole(code)] })
}

function accessFor(slug: string, op: (typeof WRITE_OPERATIONS)[number]): unknown {
  const c = payloadConfig.collections.find((x) => x.slug === slug)
  expect(c, `找不到集合 ${slug}`).toBeDefined()
  return c!.access?.[op]
}

async function can(
  slug: string,
  op: (typeof WRITE_OPERATIONS)[number],
  role: BuiltinRoleCode,
): Promise<boolean> {
  const fn = accessFor(slug, op)
  if (typeof fn !== 'function') throw new Error(`${slug}.${op} 未声明`)
  return (fn as (a: unknown) => boolean | Promise<boolean>)({ req: reqForRole(role) }) as
    | boolean
    | Promise<boolean>
}

/**
 * 每个集合的期望：谁能建/改（editors）、谁能删（deleters）。
 *
 * 口径来源见各 collection 文件头注释。一句话：有精确操作码且在用角色已持有
 * → 用操作码（brokers）；否则用承载模块的菜单码，前提是该菜单码的持有者集合
 * 恰好等于应该有写权限的角色。
 */
const MATRIX: ReadonlyArray<{
  slug: string
  editors: readonly BuiltinRoleCode[]
  deleters: readonly BuiltinRoleCode[]
  note: string
}> = [
  { slug: 'merchants', editors: ['ADM', 'OPS'], deleters: [], note: '菜单码 merchants；删除关死（冻结才是产品口径）' },
  { slug: 'building-merchant-relations', editors: ['ADM', 'OPS'], deleters: ['ADM', 'OPS'], note: '菜单码 merchants；解绑是正常操作，删除保留' },
  { slug: 'brokers', editors: ['ADM', 'MGR'], deleters: [], note: '操作码 broker:manage；删除关死（会清空归属历史两端）' },
  { slug: 'teams', editors: ['ADM', 'MGR'], deleters: [], note: '菜单码 teams；删除关死（会静默改变 MGR 的数据范围）' },
  { slug: 'media', editors: ['ADM', 'OPS'], deleters: ['ADM', 'OPS'], note: '菜单码 media；删除是被设计支持的（有摘除引用与缓存失效钩子）' },
  { slug: 'pages', editors: ['ADM', 'OPS'], deleters: ['ADM', 'OPS'], note: '菜单码 pages' },
  { slug: 'articles', editors: ['ADM', 'OPS'], deleters: ['ADM', 'OPS'], note: '菜单码 articles' },
  { slug: 'amenities', editors: ['ADM', 'OPS'], deleters: ['ADM', 'OPS'], note: '菜单码 dictionaries' },
  { slug: 'display-tags', editors: ['ADM', 'OPS'], deleters: ['ADM', 'OPS'], note: '菜单码 dictionaries' },
]

const ALL_ROLES: readonly BuiltinRoleCode[] = ['ADM', 'OPS', 'MGR', 'BRK', 'CSR']

describe('本轮九个集合的写侧角色矩阵', () => {
  it.each(MATRIX)('$slug（$note）', async ({ slug, editors, deleters }) => {
    for (const role of ALL_ROLES) {
      const shouldEdit = editors.includes(role)
      expect(await can(slug, 'create', role), `${slug}.create / ${role}`).toBe(shouldEdit)
      expect(await can(slug, 'update', role), `${slug}.update / ${role}`).toBe(shouldEdit)

      const shouldDelete = deleters.includes(role)
      expect(await can(slug, 'delete', role), `${slug}.delete / ${role}`).toBe(shouldDelete)
    }
  })

  it.each(MATRIX)('$slug：匿名一律拒绝', async ({ slug }) => {
    const req = makeReq({ user: null })
    for (const op of WRITE_OPERATIONS) {
      const fn = accessFor(slug, op) as (a: unknown) => boolean | Promise<boolean>
      expect(await fn({ req }), `${slug}.${op} 匿名`).toBe(false)
    }
  })

  it.each(MATRIX)('$slug：停用账号即便挂 ADM 也拒绝', async ({ slug }) => {
    const req = makeReq({
      user: makeUser({ status: 'disabled', roles: [1] }),
      roles: [makeBuiltinRole('ADM')],
    })
    for (const op of WRITE_OPERATIONS) {
      const fn = accessFor(slug, op) as (a: unknown) => boolean | Promise<boolean>
      expect(await fn({ req }), `${slug}.${op} 停用账号`).toBe(false)
    }
  })

  it('三个「关死删除」的集合，连 ADM 也删不掉', async () => {
    for (const slug of ['merchants', 'brokers', 'teams']) {
      expect(await can(slug, 'delete', 'ADM'), `${slug} 不应允许任何人删除`).toBe(false)
    }
  })
})
