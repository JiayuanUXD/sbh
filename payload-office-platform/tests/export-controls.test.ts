import { describe, expect, it, vi } from 'vitest'
import type { CollectionConfig } from 'payload'
import type { PayloadRequest } from 'payload'

import {
  EXPORT_LIMIT,
  buildExportAccessCreate,
  createExportAuditHook,
  overrideExportsCollection,
} from '@/domain/audit/export-controls'
import type { Role, User } from '@/payload-types'

/**
 * 受控导出装配层测试（M3.4 子项 4「完成……导出动作」/ R3, tasks.md 执行原则 line 7）
 *
 * 导出属可审计的批量数据外流，必须先过服务端 data:export 权限门再开放。
 * 复用 @payloadcms/plugin-import-export 自动生成的 exports 集合，仅补：
 *   - access.create 挂 data:export 权限门（未登录 false / 无权限 false / 有权限 true）
 *   - 批量上限 EXPORT_LIMIT
 *   - export.hooks.after 写审计（exports 集合被 auditFieldsPlugin 排除，需显式落日志）
 * 字段脱敏由 API 层继承（R1），本层不重复。
 */

function makeAdmRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    code: 'ADM',
    name: '平台管理员',
    isBuiltin: true,
    status: 'active',
    dataScope: 'global',
    menuPermissions: ['*'],
    operationPermissions: ['*'],
    fieldPermissions: ['*'],
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Role
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [1],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

function makeReq(params: {
  user?: User | null
  userRoles?: Role[]
}): PayloadRequest {
  const { user = makeUser(), userRoles = [makeAdmRole()] } = params
  const find = vi.fn(async () => ({ docs: userRoles }))
  const req = {
    user: user ?? null,
    payload: { find },
  }
  return req as unknown as PayloadRequest
}

describe('export-controls/data:export 权限门', () => {
  it('未登录 → false', async () => {
    const create = buildExportAccessCreate()
    const ok = await create({ req: makeReq({ user: null }) } as never)
    expect(ok).toBe(false)
  })

  it('登录但无 data:export → false', async () => {
    const opsRole = makeAdmRole({
      id: 2,
      code: 'OPS',
      operationPermissions: ['data:import'],
    })
    const create = buildExportAccessCreate()
    const ok = await create({
      req: makeReq({ userRoles: [opsRole], user: makeUser({ roles: [2] }) }),
    } as never)
    expect(ok).toBe(false)
  })

  it('具备 data:export → true', async () => {
    const expRole = makeAdmRole({
      id: 3,
      code: 'EXP',
      operationPermissions: ['data:export'],
    })
    const create = buildExportAccessCreate()
    const ok = await create({
      req: makeReq({ userRoles: [expRole], user: makeUser({ roles: [3] }) }),
    } as never)
    expect(ok).toBe(true)
  })

  it('通配符 * → true', async () => {
    const create = buildExportAccessCreate()
    const ok = await create({ req: makeReq({}) } as never)
    expect(ok).toBe(true)
  })
})

describe('export-controls/overrideExportsCollection', () => {
  it('把 data:export 门挂到 exports.access.create，保留其余 access 与配置', async () => {
    const baseRead = () => true
    const collection = {
      slug: 'exports',
      access: { read: baseRead },
      fields: [],
    } as unknown as CollectionConfig

    const result = await overrideExportsCollection({ collection })

    // create 被替换为权限门
    expect(typeof result.access?.create).toBe('function')
    // 无权限用户被拒
    const opsRole = makeAdmRole({
      id: 2,
      code: 'OPS',
      operationPermissions: ['data:import'],
    })
    const denied = await result.access!.create!({
      req: makeReq({ userRoles: [opsRole], user: makeUser({ roles: [2] }) }),
    } as never)
    expect(denied).toBe(false)
    // 其余 access（read）原样保留
    expect(result.access?.read).toBe(baseRead)
    // 不改动 slug
    expect(result.slug).toBe('exports')
  })
})

describe('export-controls/审计 after hook', () => {
  it('每批写一条 payload.logger.info 审计，含操作者/集合/批次/条数', async () => {
    const info = vi.fn()
    const hook = createExportAuditHook()
    await hook({
      batchNumber: 1,
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      format: 'csv',
      originalData: [{ id: 1 }, { id: 2 }, { id: 3 }],
      totalBatches: 2,
      req: {
        user: makeUser(),
        data: { collectionSlug: 'listings' },
        payload: { logger: { info } },
      } as unknown as PayloadRequest,
    })
    expect(info).toHaveBeenCalledTimes(1)
    const arg = info.mock.calls[0][0]
    expect(arg.event).toBe('data:export')
    expect(arg.userId).toBe(10)
    expect(arg.batchNumber).toBe(1)
    expect(arg.totalBatches).toBe(2)
    expect(arg.rowCount).toBe(3)
    expect(arg.format).toBe('csv')
  })

  it('未登录（系统触发）也不抛错，userId 记为 null', async () => {
    const info = vi.fn()
    const hook = createExportAuditHook()
    await hook({
      batchNumber: 1,
      data: [],
      format: 'json',
      originalData: [],
      totalBatches: 1,
      req: {
        user: null,
        payload: { logger: { info } },
      } as unknown as PayloadRequest,
    })
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0].userId).toBeNull()
  })
})

describe('export-controls/常量', () => {
  it('EXPORT_LIMIT 为正整数上限', () => {
    expect(Number.isInteger(EXPORT_LIMIT)).toBe(true)
    expect(EXPORT_LIMIT).toBeGreaterThan(0)
  })
})
