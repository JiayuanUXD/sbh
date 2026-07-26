import { describe, expect, it } from 'vitest'
import { protectBuiltinRole } from '@/domain/auth/role-protect'
import type { Role } from '@/payload-types'

// ────────────────────────────────────────────────────────────
// fixtures
// ────────────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 1,
    code: 'ADM',
    name: '平台管理员',
    isBuiltin: true,
    status: 'active',
    dataScope: 'global',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Role
}

/** 调用 hook 的薄封装（hook 是同步的，返回 data 或抛错） */
function run(args: {
  operation: 'create' | 'update' | 'delete' | 'read'
  data?: Record<string, unknown>
  originalDoc?: Role
}) {
  return protectBuiltinRole({
    operation: args.operation,
    data: args.data ?? {},
    originalDoc: args.originalDoc,
  } as never)
}

// ────────────────────────────────────────────────────────────
// create：内置码守卫
// ────────────────────────────────────────────────────────────

describe('role-protect/create', () => {
  it('create 自定义角色（isBuiltin=false）→ 放行', () => {
    const data = { code: 'SALES_LEAD', isBuiltin: false }
    expect(run({ operation: 'create', data })).toEqual(data)
  })

  it('create 内置角色且 code 合法（如 OPS）→ 放行', () => {
    const data = { code: 'OPS', isBuiltin: true }
    expect(run({ operation: 'create', data })).toEqual(data)
  })

  it('create 内置角色但 code 非法（第六种内置）→ 抛错', () => {
    expect(() =>
      run({ operation: 'create', data: { code: 'SUPERADMIN', isBuiltin: true } }),
    ).toThrow(/不可创建内置角色/)
  })

  it('create 内置角色但 code 为空 → 抛错', () => {
    expect(() =>
      run({ operation: 'create', data: { isBuiltin: true } }),
    ).toThrow(/不可创建内置角色/)
  })

  it('全部 5 个内置码标记 builtin 均放行', () => {
    for (const code of ['ADM', 'OPS', 'MGR', 'BRK', 'CSR']) {
      const data = { code, isBuiltin: true }
      expect(run({ operation: 'create', data })).toEqual(data)
    }
  })
})

// ────────────────────────────────────────────────────────────
// update：内置角色身份保护
// ────────────────────────────────────────────────────────────

describe('role-protect/update', () => {
  it('update 自定义角色（originalDoc.isBuiltin=false）→ 放行改码', () => {
    const originalDoc = makeRole({ isBuiltin: false, code: 'CUSTOM_A' })
    const data = { code: 'CUSTOM_B' }
    expect(run({ operation: 'update', data, originalDoc })).toEqual(data)
  })

  it('update 内置角色改 code → 抛错', () => {
    const originalDoc = makeRole({ isBuiltin: true, code: 'ADM' })
    expect(() =>
      run({ operation: 'update', data: { code: 'ADMIN2' }, originalDoc }),
    ).toThrow(/内置角色编码不可修改/)
  })

  it('update 内置角色 code 未变（同值提交）→ 放行', () => {
    const originalDoc = makeRole({ isBuiltin: true, code: 'ADM' })
    const data = { code: 'ADM', name: '改个名字' }
    expect(run({ operation: 'update', data, originalDoc })).toEqual(data)
  })

  it('update 内置角色移除 builtin 标记 → 抛错', () => {
    const originalDoc = makeRole({ isBuiltin: true, code: 'MGR' })
    expect(() =>
      run({ operation: 'update', data: { isBuiltin: false }, originalDoc }),
    ).toThrow(/builtin 标记不可移除/)
  })

  it('update 内置角色仅改 name（不动 code/builtin）→ 放行', () => {
    const originalDoc = makeRole({ isBuiltin: true, code: 'BRK' })
    const data = { name: '经纪人（新名）' }
    expect(run({ operation: 'update', data, originalDoc })).toEqual(data)
  })
})
