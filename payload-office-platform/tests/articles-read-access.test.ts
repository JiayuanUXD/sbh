import { describe, expect, it, vi } from 'vitest'

import { Articles } from '@/collections/Articles'
import type { RequestContext } from '@/domain/auth/access'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/**
 * 资讯读侧准入：匿名与无资讯菜单码的账号只能读「已发布且未进回收站」的文章。
 *
 * ## 修的是什么
 *
 * `Articles.access.read` 原先是 `() => true`，注释写「published 过滤由 facade 查询承担」。
 * 那句话对 C 端成立（C 端走 Local API，默认 overrideAccess，查询层自己带 status=published），
 * 但 Payload 自带的 REST / GraphQL 不经过任何 facade：
 *
 *   GET /api/articles?where[status][equals]=draft     → 草稿正文
 *   GET /api/articles/<草稿 id>                        → 草稿正文
 *   GET /api/articles?trash=true                       → 回收站里的文章（含已发布后删掉的）
 *
 * Articles 没有 `versions.drafts`，`status` 只是个普通 select 字段，所以 Payload 不会替我们
 * 拦草稿——拦不拦完全取决于 `access.read`。
 *
 * ## 断言的是行为，不是配置长什么样
 *
 * 直接**调用** access 函数、喂不同身份的 req，验返回值：`true`（全读）还是 Where（被收窄）。
 * 真正穿过 Payload REST 处理器的那一层在 `articles-read-access-postgres.test.ts`。
 */

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

function makeReq(params: { user?: unknown; roles?: Role[] }): RequestContext {
  const { user, roles = [] } = params
  return {
    user: user ?? null,
    payload: { find: vi.fn(async () => ({ docs: roles })) },
  } as unknown as RequestContext
}

function reqForRole(code: BuiltinRoleCode): RequestContext {
  return makeReq({ user: makeUser({ roles: [1] }), roles: [makeBuiltinRole(code)] })
}

async function readAccess(req: RequestContext): Promise<unknown> {
  const fn = Articles.access?.read
  if (typeof fn !== 'function') throw new Error('Articles.access.read 未定义')
  return (fn as (a: unknown) => unknown)({ req })
}

/** 被收窄后的读条件：已发布，且没有被移入回收站（trash=true 查询也绕不开）。 */
const PUBLISHED_ONLY = {
  status: { equals: 'published' },
  deletedAt: { exists: false },
}

describe('Articles 读侧准入', () => {
  it('匿名只读已发布且未删除：返回 Where，不是 true', async () => {
    expect(await readAccess(makeReq({ user: null }))).toEqual(PUBLISHED_ONLY)
  })

  it('会员（members 集合）等同匿名：只读已发布', async () => {
    const member = { id: 9, collection: 'members', status: 'active' }
    expect(await readAccess(makeReq({ user: member }))).toEqual(PUBLISHED_ONLY)
  })

  it('停用的后台账号等同匿名（buildPermissionContext 对停用账号返回 null）', async () => {
    const req = makeReq({ user: makeUser({ status: 'disabled' as User['status'] }), roles: [makeBuiltinRole('ADM')] })
    expect(await readAccess(req)).toEqual(PUBLISHED_ONLY)
  })

  it.each(['ADM', 'OPS'] as const)('%s 持资讯菜单码：全读（后台列表与编辑页要看草稿、回收站）', async (code) => {
    expect(await readAccess(reqForRole(code))).toBe(true)
  })

  it.each(['MGR', 'BRK', 'CSR'] as const)('%s 没有资讯菜单码：只读已发布，与写侧同一道门', async (code) => {
    // 守卫「谁能写谁才能读草稿」：若哪天有人给 MGR/BRK/CSR 授了 articles 菜单码，
    // 他们同时获得写权限（canManageArticle），这条会提醒这是一次有意的扩权。
    expect(BUILTIN_ROLES[code].menuPermissions).not.toContain('articles')
    expect(await readAccess(reqForRole(code))).toEqual(PUBLISHED_ONLY)
  })

  it('资讯日更专用账号（角色只有「资讯中心 + 素材库」两个菜单码）全读：news:publish 要靠它查草稿占用', async () => {
    const botRole = {
      id: 1,
      code: 'NEWS_BOT',
      name: '资讯日更',
      isBuiltin: false,
      status: 'active',
      dataScope: 'global',
      menuPermissions: ['articles', 'media'],
      operationPermissions: [],
      fieldPermissions: [],
      updatedAt: '',
      createdAt: '',
    } as unknown as Role
    const req = makeReq({ user: makeUser({ roles: [1] }), roles: [botRole] })
    expect(await readAccess(req)).toBe(true)
  })

  it('每次返回新对象：Payload 会把 access Where 与请求 where 合并，共享引用被改写会污染后续请求', async () => {
    const first = (await readAccess(makeReq({ user: null }))) as Record<string, unknown>
    const second = (await readAccess(makeReq({ user: null }))) as Record<string, unknown>
    expect(first).not.toBe(second)
    first.status = { equals: 'draft' }
    expect(await readAccess(makeReq({ user: null }))).toEqual(PUBLISHED_ONLY)
  })
})
