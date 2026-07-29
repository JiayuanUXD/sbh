import { describe, expect, it, vi } from 'vitest'

import { syncBuiltinRoles } from '@/domain/auth/sync-builtin-roles'
import { BUILTIN_ROLES } from '@/test/factory/roles'

function createStore(
  existingByCode: Readonly<
    Partial<Record<keyof typeof BUILTIN_ROLES, { id: number; isBuiltin: boolean }>>
  >,
) {
  return {
    findByCode: vi.fn(async (code: keyof typeof BUILTIN_ROLES) => existingByCode[code]),
    update: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
    info: vi.fn(),
  }
}

describe('syncBuiltinRoles', () => {
  it('更新已存在的内置角色 fixture', async () => {
    const store = createStore({ OPS: { id: 12, isBuiltin: true } })

    await syncBuiltinRoles(store, [BUILTIN_ROLES.OPS])

    expect(store.update).toHaveBeenCalledWith(12, BUILTIN_ROLES.OPS)
    expect(store.create).not.toHaveBeenCalled()
  })

  it('创建缺失的内置角色 fixture', async () => {
    const store = createStore({})

    await syncBuiltinRoles(store, [BUILTIN_ROLES.CSR])

    expect(store.create).toHaveBeenCalledWith(BUILTIN_ROLES.CSR)
    expect(store.update).not.toHaveBeenCalled()
  })

  it('保留占用内置 code 的非内置角色并在任何写入前失败', async () => {
    const store = createStore({
      ADM: { id: 1, isBuiltin: true },
      OPS: { id: 2, isBuiltin: false },
    })

    await expect(
      syncBuiltinRoles(store, [BUILTIN_ROLES.ADM, BUILTIN_ROLES.OPS]),
    ).rejects.toThrow('无法同步内置角色 OPS：该编码已被非内置角色占用')
    expect(store.update).not.toHaveBeenCalled()
    expect(store.create).not.toHaveBeenCalled()
  })
})
