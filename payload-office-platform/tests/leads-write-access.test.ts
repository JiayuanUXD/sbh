import { describe, expect, it, vi } from 'vitest'

import { Leads } from '@/collections/Leads'
import type { RequestContext } from '@/domain/auth/access'
import { LEAD_MENU_CODES } from '@/domain/crm/lead-menu-codes'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavLeaf } from '@/domain/admin-navigation/navigation-types'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/**
 * 线索写侧准入
 *
 * Leads 此前只写了 read，create/update/delete 三个全缺 → 落到 Payload 3.86 的
 * defaultAccess（判据仅 Boolean(req.user)），任何登录账号都能新建、改写、物理
 * 删除线索。读侧早就按数据范围收窄了，写侧却完全敞着——「读比写严」本身就
 * 说明是漏写。
 *
 * 口径（理由见 domain/crm/lead-write-access.ts）：
 *   - create：操作码 lead:create（permissions.md 把「创建线索」归给 CSR；
 *     该码早已注册并授予 CSR，却从没被任何 collection 消费过）
 *   - update：线索菜单码 + 与读侧同一套数据范围收窄（复用 buildLeadReadScope，
 *     不另写一份判据）
 *   - delete：一律 false。trash:true 不是防护，payload.delete 恒为硬删；
 *     删线索会把 follow_ups / lead_ownership_history 的 lead_id 置空，
 *     而那两个集合自己声明了 append-only 不可删。
 */

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
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

/** 直接用内置角色 fixture，避免测试自造一套与生产不一致的权限集合。 */
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
  const { user, roles = [] } = params
  return {
    user: user ?? null,
    payload: { find: vi.fn(async () => ({ docs: roles })) },
  } as unknown as RequestContext
}

type AccessResult = boolean | Record<string, unknown>

async function callAccess(fn: unknown, req: RequestContext): Promise<AccessResult> {
  if (typeof fn !== 'function') throw new Error('access 函数未定义（缺失即落回 defaultAccess）')
  return (fn as (a: unknown) => AccessResult | Promise<AccessResult>)({ req })
}

const WRITE_OPERATIONS = ['create', 'update', 'delete'] as const

function access(op: (typeof WRITE_OPERATIONS)[number] | 'read'): unknown {
  return Leads.access?.[op]
}

function reqForRole(code: BuiltinRoleCode): RequestContext {
  return makeReq({ user: makeUser({ roles: [1] }), roles: [makeBuiltinRole(code)] })
}

/** 把导航树摊平成叶子（OPT-084 后导航只有两级，组的 children 即叶子）。 */
function flattenNavLeaves(): readonly AdminNavLeaf[] {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.children)
}

describe('Leads 写侧准入', () => {
  it('create / update / delete 都显式声明，不落回 defaultAccess', () => {
    for (const op of WRITE_OPERATIONS) {
      expect(typeof access(op), `access.${op} 必须显式声明`).toBe('function')
    }
  })

  it('匿名三个写动作一律拒绝', async () => {
    const req = makeReq({ user: null })
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(access(op), req), `匿名不应通过 ${op}`).toBe(false)
    }
  })

  describe('create：认 lead:create 操作码', () => {
    it.each(['ADM', 'CSR'] as const)('%s 持有 lead:create，可新建', async (code) => {
      expect(await callAccess(access('create'), reqForRole(code))).toBe(true)
    })

    it.each(['MGR', 'BRK', 'OPS'] as const)(
      '%s 没有 lead:create，不可新建（相对收口前是刻意收窄）',
      async (code) => {
        expect(BUILTIN_ROLES[code].operationPermissions).not.toContain('lead:create')
        expect(await callAccess(access('create'), reqForRole(code))).toBe(false)
      },
    )
  })

  describe('update：菜单码 + 与读侧同一套数据范围', () => {
    it.each(['ADM', 'MGR', 'CSR'] as const)('%s 全量可改', async (code) => {
      expect(await callAccess(access('update'), reqForRole(code))).toBe(true)
    })

    it('BRK 被收窄到自己负责的线索，而不是放行全部', async () => {
      const result = await callAccess(access('update'), reqForRole('BRK'))
      // 复用 buildLeadReadScope，故与读侧同形：owner.user = 当前用户
      expect(result).not.toBe(true)
      expect(result).toEqual({ 'owner.user': { equals: 7 } })
    })

    it('OPS 虽然 dataScope=global，但没有线索菜单码，不可改', async () => {
      // 这是写侧比读侧多的那一道：读侧对 OPS 返回 true（看板要跨角色读线索），
      // 写侧不给——OPS 是供给侧运营，导航里没有「咨询线索」入口。
      for (const code of LEAD_MENU_CODES) {
        expect(BUILTIN_ROLES.OPS.menuPermissions).not.toContain(code)
      }
      expect(await callAccess(access('update'), reqForRole('OPS'))).toBe(false)
    })
  })

  it('任何角色都删不掉：会把 follow_ups / 归属历史的 lead_id 静默置空', async () => {
    for (const code of ['ADM', 'OPS', 'MGR', 'BRK', 'CSR'] as const) {
      expect(await callAccess(access('delete'), reqForRole(code)), `${code} 不应通过 delete`).toBe(
        false,
      )
    }
  })

  it('停用账号即便挂着 ADM 角色也拒绝写入', async () => {
    const req = makeReq({
      user: makeUser({ status: 'disabled', roles: [1] }),
      roles: [makeBuiltinRole('ADM')],
    })
    for (const op of WRITE_OPERATIONS) {
      expect(await callAccess(access(op), req), `停用账号不应通过 ${op}`).toBe(false)
    }
  })

  it('LEAD_MENU_CODES 与导航里咨询线索叶子的 menuCodes 保持一致', async () => {
    const leaf = flattenNavLeaves().find((l) => l.collectionSlug === 'leads')
    expect(leaf, '导航里应存在 collectionSlug=leads 的叶子').toBeDefined()
    expect([...leaf!.menuCodes]).toEqual([...LEAD_MENU_CODES])
  })
})
