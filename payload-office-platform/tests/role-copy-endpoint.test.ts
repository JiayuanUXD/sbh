import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import { createRoleCopyEndpoint } from '@/endpoints/role-copy-endpoint'
import type { Role, User } from '@/payload-types'

/**
 * 角色复制 endpoint 的 HTTP 装配层测试（补审查发现的缺口）
 *
 * 重点：Payload 3.86 路由参数在 req.routeParams（不是 req.params）。
 * 之前误用 req.params → id 恒 undefined → 复制恒返回 400。
 * 这些测试锁定取参正确、缺参 400、无权限 403/401、成功 200 透传 id。
 */

// ────────────────────────────────────────────────────────────
// fixtures
// ────────────────────────────────────────────────────────────

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

/**
 * 构造 mock req。
 *
 * payload.find 承担两类查询：
 *   - where.id.in  → 加载登录用户的角色（权限上下文派生）
 *   - where.code.equals → copyRole 的 code 唯一性检查
 */
function makeReq(params: {
  user?: User | null
  routeParams?: Record<string, unknown>
  body?: unknown
  userRoles?: Role[]
  sourceRole?: Role | null
  existingByCode?: Role[]
  createResult?: Role
}): { req: PayloadRequest; create: ReturnType<typeof vi.fn> } {
  const {
    user = makeUser(),
    routeParams = { id: '1' },
    body = { code: 'CUSTOM_OPS' },
    userRoles = [makeAdmRole()],
    sourceRole = makeAdmRole({ id: 1, code: 'OPS', name: '运营人员' }),
    existingByCode = [],
    createResult = makeAdmRole({ id: 100, code: 'CUSTOM_OPS', isBuiltin: false }),
  } = params

  const create = vi.fn(async () => createResult)
  const find = vi.fn(async (opts: { collection: string; where?: unknown }) => {
    const where = opts.where as
      | { id?: { in?: unknown }; code?: { equals?: unknown } }
      | undefined
    if (where?.id?.in !== undefined) {
      // 权限上下文：加载登录用户角色
      return { docs: userRoles }
    }
    if (where?.code?.equals !== undefined) {
      // copyRole 唯一性检查
      return { docs: existingByCode }
    }
    return { docs: [] }
  })
  const findByID = vi.fn(async () => sourceRole)

  const req = {
    user: user ?? null,
    routeParams,
    payload: { find, findByID, create },
    json: async () => body,
  }
  return { req: req as unknown as PayloadRequest, create }
}

async function run(req: PayloadRequest): Promise<{ status: number; body: any }> {
  const endpoint = createRoleCopyEndpoint()
  const res = (await endpoint.handler(req)) as Response
  const body = await res.json()
  return { status: res.status, body }
}

// ────────────────────────────────────────────────────────────
// 取参正确性（核心回归）
// ────────────────────────────────────────────────────────────

describe('role-copy-endpoint/routeParams', () => {
  it('从 req.routeParams.id 取源角色 ID 并透传给 copyRole（成功 200）', async () => {
    const { req } = makeReq({ routeParams: { id: '7' } })
    const findByID = req.payload.findByID as ReturnType<typeof vi.fn>
    const { status, body } = await run(req)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    // copyRole 内部用透传的 sourceId 调 findByID
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'roles', id: '7' }),
    )
  })

  it('数字型 routeParams.id 也正确透传', async () => {
    const { req } = makeReq({ routeParams: { id: 42 } })
    const findByID = req.payload.findByID as ReturnType<typeof vi.fn>
    const { status } = await run(req)

    expect(status).toBe(200)
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
    )
  })

  it('routeParams 缺 id → 400 缺少源角色 ID（不会误当 200）', async () => {
    const { req } = makeReq({ routeParams: {} })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('缺少源角色 ID')
  })

  it('回归：绝不再从已废弃的 req.params 取参（params 有值也无效）', async () => {
    // 模拟旧 Payload 才有的 params；3.86 应完全忽略它
    const { req } = makeReq({ routeParams: {} })
    ;(req as unknown as { params?: { id?: string } }).params = { id: '999' }
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('缺少源角色 ID')
  })
})

// ────────────────────────────────────────────────────────────
// 鉴权
// ────────────────────────────────────────────────────────────

describe('role-copy-endpoint/auth', () => {
  it('未登录 → 401', async () => {
    const { req } = makeReq({ user: null })
    const { status, body } = await run(req)
    expect(status).toBe(401)
    expect(body.ok).toBe(false)
  })

  it('登录但无 role:manage 权限 → 403', async () => {
    const csrRole = makeAdmRole({
      id: 2,
      code: 'CSR',
      operationPermissions: ['lead:view'], // 无 role:manage、无通配符
      fieldPermissions: [],
      menuPermissions: [],
    })
    const { req } = makeReq({
      user: makeUser({ roles: [2] }),
      userRoles: [csrRole],
    })
    const { status, body } = await run(req)
    expect(status).toBe(403)
    expect(body.ok).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 请求体校验与错误映射
// ────────────────────────────────────────────────────────────

describe('role-copy-endpoint/body', () => {
  it('缺少 code → 400', async () => {
    const { req } = makeReq({ body: {} })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('code')
  })

  it('源角色不存在 → 404', async () => {
    const { req } = makeReq({ sourceRole: null })
    const { status, body } = await run(req)
    expect(status).toBe(404)
    expect(body.error).toContain('源角色不存在')
  })

  it('新 code 已存在 → 400', async () => {
    const { req } = makeReq({
      body: { code: 'DUP' },
      existingByCode: [makeAdmRole({ id: 5, code: 'DUP' })],
    })
    const { status, body } = await run(req)
    expect(status).toBe(400)
    expect(body.error).toContain('角色编码已存在')
  })
})
