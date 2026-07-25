import { describe, expect, it, vi } from 'vitest'
import type { BasePayload } from 'payload'

import { copyRole, validateRoleCode } from '@/domain/auth/role-copy'
import type { Role } from '@/payload-types'

// ────────────────────────────────────────────────────────────
// 测试 fixtures
// ────────────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    code: 'OPS',
    name: '运营人员',
    isBuiltin: true,
    status: 'active',
    dataScope: 'global',
    menuPermissions: ['dashboard', 'listings'],
    operationPermissions: ['listing:review', 'listing:publish'],
    fieldPermissions: ['phone:full', 'phone:masked'],
    description: '运营基线',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Role
}

type FindMock = ReturnType<typeof vi.fn>
type FindByIDMock = ReturnType<typeof vi.fn>
type CreateMock = ReturnType<typeof vi.fn>

interface MockPayload {
  find: FindMock
  findByID: FindByIDMock
  create: CreateMock
}

function makeMockPayload(params: {
  source?: Role | null
  sourceError?: boolean
  existing?: { docs: Role[] }
  createResult?: Role
  createError?: Error
}): MockPayload {
  const { source, sourceError, existing, createResult, createError } = params

  const findMock = vi.fn(async () => existing ?? { docs: [] })
  const findByIDMock = vi.fn(async () => {
    if (sourceError) throw new Error('DB error')
    return source ?? null
  })
  const createMock = vi.fn(async () => {
    if (createError) throw createError
    return createResult ?? makeRole({ id: 100, code: 'CUSTOM_X' })
  })

  return {
    find: findMock,
    findByID: findByIDMock,
    create: createMock,
  }
}

/** 将 mock payload 转换为 BasePayload（仅含 copyRole 用到的 3 个方法） */
function asPayload(mock: MockPayload): BasePayload {
  return mock as unknown as BasePayload
}

// ────────────────────────────────────────────────────────────
// validateRoleCode 纯函数
// ────────────────────────────────────────────────────────────

describe('role-copy/validateRoleCode', () => {
  it('合法编码（2-32 字符，大写字母开头）→ null', () => {
    expect(validateRoleCode('AB')).toBeNull()
    expect(validateRoleCode('OPS')).toBeNull()
    expect(validateRoleCode('CUSTOM_OPS')).toBeNull()
    expect(validateRoleCode('A1')).toBeNull()
    expect(validateRoleCode('A_B_C')).toBeNull()
  })

  it('边界：长度恰好 2 → 合法', () => {
    expect(validateRoleCode('AB')).toBeNull()
  })

  it('边界：长度恰好 32 → 合法', () => {
    expect(validateRoleCode('A' + 'B'.repeat(31))).toBeNull()
  })

  it('空字符串 → 错误', () => {
    expect(validateRoleCode('')).not.toBeNull()
    expect(validateRoleCode('')).toMatch(/必填/)
  })

  it('null / undefined → 错误', () => {
    expect(validateRoleCode(null as unknown as string)).not.toBeNull()
    expect(validateRoleCode(undefined as unknown as string)).not.toBeNull()
  })

  it('非字符串 → 错误', () => {
    expect(validateRoleCode(123 as unknown as string)).not.toBeNull()
    expect(validateRoleCode({} as unknown as string)).not.toBeNull()
  })

  it('长度 1（仅首字母）→ 错误', () => {
    expect(validateRoleCode('A')).not.toBeNull()
  })

  it('长度超过 32 → 错误', () => {
    expect(validateRoleCode('A' + 'B'.repeat(32))).not.toBeNull()
  })

  it('小写字母开头 → 错误', () => {
    expect(validateRoleCode('ops')).not.toBeNull()
    expect(validateRoleCode('aBCD')).not.toBeNull()
  })

  it('数字开头 → 错误', () => {
    expect(validateRoleCode('1ABC')).not.toBeNull()
    expect(validateRoleCode('9ABC')).not.toBeNull()
  })

  it('下划线开头 → 错误', () => {
    expect(validateRoleCode('_ABC')).not.toBeNull()
  })

  it('含小写字母 → 错误', () => {
    expect(validateRoleCode('ABcd')).not.toBeNull()
    expect(validateRoleCode('OPS_Lite')).not.toBeNull()
  })

  it('含特殊字符 → 错误', () => {
    expect(validateRoleCode('AB-CD')).not.toBeNull()
    expect(validateRoleCode('AB.CD')).not.toBeNull()
    expect(validateRoleCode('AB CD')).not.toBeNull()
    expect(validateRoleCode('AB@CD')).not.toBeNull()
    expect(validateRoleCode('AB:CD')).not.toBeNull()
  })

  it('含中文 → 错误', () => {
    expect(validateRoleCode('AB中文')).not.toBeNull()
  })

  it('仅大写字母 + 数字 + 下划线 → 合法（数字和下划线可在任意位置）', () => {
    expect(validateRoleCode('A1B2C3')).toBeNull()
    expect(validateRoleCode('OPS_2024')).toBeNull()
    expect(validateRoleCode('ABC_DEF_123')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────
// copyRole 成功路径
// ────────────────────────────────────────────────────────────

describe('role-copy/copyRole/success', () => {
  it('成功复制：返回 ok=true 且包含新角色', async () => {
    const source = makeRole({ id: 1, code: 'OPS' })
    const created = makeRole({ id: 100, code: 'CUSTOM_OPS', name: '运营精简版' })
    const payload = makeMockPayload({
      source,
      existing: { docs: [] }, // 新 code 不存在
      createResult: created,
    })

    const result = await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'CUSTOM_OPS',
      newName: '运营精简版',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.role.id).toBe(100)
      expect(result.role.code).toBe('CUSTOM_OPS')
      expect(result.role.name).toBe('运营精简版')
    }
  })

  it('调用 findByID 读取源角色（overrideAccess=true）', async () => {
    const source = makeRole({ id: 5 })
    const payload = makeMockPayload({ source })
    await copyRole(asPayload(payload), { sourceId: 5, newCode: 'COPY_X' })

    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'roles',
        id: 5,
        depth: 0,
        overrideAccess: true,
      }),
    )
  })

  it('调用 find 检查新 code 唯一性（overrideAccess=true）', async () => {
    const source = makeRole({ id: 1 })
    const payload = makeMockPayload({ source, existing: { docs: [] } })
    await copyRole(asPayload(payload), { sourceId: 1, newCode: 'NEW_CODE' })

    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'roles',
        where: { code: { equals: 'NEW_CODE' } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      }),
    )
  })

  it('调用 create 创建副本（isBuiltin=false）', async () => {
    const source = makeRole({
      id: 1,
      code: 'OPS',
      name: '运营人员',
      description: '运营基线',
      dataScope: 'global',
      menuPermissions: ['dashboard'],
      operationPermissions: ['listing:review'],
      fieldPermissions: ['phone:full'],
    })
    const payload = makeMockPayload({ source, existing: { docs: [] } })
    await copyRole(asPayload(payload), { sourceId: 1, newCode: 'COPY_OPS' })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'roles',
        data: expect.objectContaining({
          code: 'COPY_OPS',
          isBuiltin: false, // 副本总是自定义角色
          status: 'active',
          dataScope: 'global',
          menuPermissions: ['dashboard'],
          operationPermissions: ['listing:review'],
          fieldPermissions: ['phone:full'],
        }),
        overrideAccess: true,
      }),
    )
  })

  it('新名称默认为 ${source.name} - 副本', async () => {
    const source = makeRole({ id: 1, name: '运营人员' })
    const payload = makeMockPayload({ source })
    await copyRole(asPayload(payload), { sourceId: 1, newCode: 'COPY_X' })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '运营人员 - 副本',
        }),
      }),
    )
  })

  it('传入 newName → 使用 newName', async () => {
    const source = makeRole({ id: 1, name: '运营人员' })
    const payload = makeMockPayload({ source })
    await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'COPY_X',
      newName: '运营精简版',
    })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '运营精简版',
        }),
      }),
    )
  })

  it('传入 newName 仅含空格 → 回退到默认名称', async () => {
    const source = makeRole({ id: 1, name: '运营人员' })
    const payload = makeMockPayload({ source })
    await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'COPY_X',
      newName: '   ',
    })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '运营人员 - 副本',
        }),
      }),
    )
  })

  it('源角色 description 为空 → 副本 description 为 undefined', async () => {
    const source = makeRole({ id: 1, description: null as unknown as string })
    const payload = makeMockPayload({ source })
    await copyRole(asPayload(payload), { sourceId: 1, newCode: 'COPY_X' })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          description: undefined,
        }),
      }),
    )
  })

  it('从内置角色复制 → 副本 isBuiltin=false（不允许复制出第二个内置角色）', async () => {
    const source = makeRole({ id: 1, isBuiltin: true, code: 'ADM' })
    const payload = makeMockPayload({ source })
    await copyRole(asPayload(payload), { sourceId: 1, newCode: 'COPY_ADM' })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isBuiltin: false,
        }),
      }),
    )
  })

  it('保留源角色的 dataScope / 权限三层', async () => {
    const source = makeRole({
      id: 1,
      dataScope: 'team',
      menuPermissions: ['dashboard', 'leads'],
      operationPermissions: ['lead:assign'],
      fieldPermissions: ['phone:full', 'phone:masked', 'audit:before_after'],
    })
    const payload = makeMockPayload({ source })
    await copyRole(asPayload(payload), { sourceId: 1, newCode: 'COPY_MGR' })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataScope: 'team',
          menuPermissions: ['dashboard', 'leads'],
          operationPermissions: ['lead:assign'],
          fieldPermissions: ['phone:full', 'phone:masked', 'audit:before_after'],
        }),
      }),
    )
  })
})

// ────────────────────────────────────────────────────────────
// copyRole 失败路径
// ────────────────────────────────────────────────────────────

describe('role-copy/copyRole/failure', () => {
  it('newCode 格式不合法 → ok=false（不查 DB）', async () => {
    const payload = makeMockPayload({ source: makeRole() })
    const result = await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'invalid-lower',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/角色编码/)
    }
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('newCode 为空 → ok=false', async () => {
    const payload = makeMockPayload({ source: makeRole() })
    const result = await copyRole(asPayload(payload), { sourceId: 1, newCode: '' })
    expect(result.ok).toBe(false)
  })

  it('源角色不存在（findByID 返回 null）→ ok=false 含"源角色不存在"', async () => {
    const payload = makeMockPayload({ source: null })
    const result = await copyRole(asPayload(payload), {
      sourceId: 999,
      newCode: 'COPY_X',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('源角色不存在')
      expect(result.error).toContain('999')
    }
    // 唯一性检查不应被调用
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('源角色 findByID 抛错 → ok=false 含"源角色不存在"', async () => {
    const payload = makeMockPayload({ sourceError: true })
    const result = await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'COPY_X',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('源角色不存在')
    }
  })

  it('新 code 已存在 → ok=false 含"角色编码已存在"', async () => {
    const existing = makeRole({ id: 50, code: 'EXISTING_CODE' })
    const payload = makeMockPayload({
      source: makeRole(),
      existing: { docs: [existing] },
    })
    const result = await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'EXISTING_CODE',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('角色编码已存在')
      expect(result.error).toContain('EXISTING_CODE')
    }
    // create 不应被调用
    expect(payload.create).not.toHaveBeenCalled()
  })

  it('create 抛错 → ok=false 含"创建角色副本失败"', async () => {
    const payload = makeMockPayload({
      source: makeRole(),
      createError: new Error('DB constraint violation'),
    })
    const result = await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'COPY_X',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('创建角色副本失败')
      expect(result.error).toContain('DB constraint violation')
    }
  })

  it('create 抛非 Error 对象 → ok=false 含字符串化错误', async () => {
    const payload = makeMockPayload({
      source: makeRole(),
      createError: 'string error' as unknown as Error,
    })
    const result = await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'COPY_X',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('创建角色副本失败')
      expect(result.error).toContain('string error')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 调用顺序与参数透传
// ────────────────────────────────────────────────────────────

describe('role-copy/copyRole/call-order', () => {
  it('调用顺序：findByID → find（唯一性）→ create', async () => {
    const source = makeRole({ id: 1 })
    const payload = makeMockPayload({ source, existing: { docs: [] } })

    await copyRole(asPayload(payload), { sourceId: 1, newCode: 'NEW_X' })

    const findCall = (payload.find as FindMock).mock.invocationCallOrder[0]
    const findByIDCall = (payload.findByID as FindByIDMock).mock.invocationCallOrder[0]
    const createCall = (payload.create as CreateMock).mock.invocationCallOrder[0]

    expect(findByIDCall).toBeLessThan(findCall)
    expect(findCall).toBeLessThan(createCall)
  })

  it('newName 传入字符串 → 自动 trim', async () => {
    const source = makeRole({ id: 1, name: '运营人员' })
    const payload = makeMockPayload({ source, existing: { docs: [] } })

    await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: 'COPY_X',
      newName: '  运营精简版  ',
    })

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '运营精简版', // 已 trim
        }),
      }),
    )
  })

  it('newCode 含空格 → 校验失败（不在 copyRole 内 trim，由 endpoint 边界 trim）', async () => {
    const payload = makeMockPayload({ source: makeRole() })
    const result = await copyRole(asPayload(payload), {
      sourceId: 1,
      newCode: '  COPY_X  ',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/角色编码/)
    }
    expect(payload.findByID).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────
// sourceId 类型兼容性
// ────────────────────────────────────────────────────────────

describe('role-copy/copyRole/source-id-types', () => {
  it('sourceId 为字符串 → 正常处理', async () => {
    const source = makeRole({ id: 'abc' as unknown as number })
    const payload = makeMockPayload({ source })
    const result = await copyRole(asPayload(payload), {
      sourceId: 'abc',
      newCode: 'COPY_X',
    })
    expect(result.ok).toBe(true)
  })

  it('sourceId 为数字 → 正常处理', async () => {
    const source = makeRole({ id: 123 })
    const payload = makeMockPayload({ source })
    const result = await copyRole(asPayload(payload), {
      sourceId: 123,
      newCode: 'COPY_X',
    })
    expect(result.ok).toBe(true)
  })
})
