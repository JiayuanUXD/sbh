import type {
  BuiltinRoleCode,
  RoleFixture,
} from '@/test/factory/roles'

export type ExistingRoleIdentity = {
  id: number | string
  isBuiltin?: boolean | null
}

export type BuiltinRoleSyncStore = {
  findByCode: (code: BuiltinRoleCode) => Promise<ExistingRoleIdentity | undefined>
  update: (id: number | string, role: RoleFixture) => Promise<void>
  create: (role: RoleFixture) => Promise<void>
  info: (message: string) => void
}

export async function syncBuiltinRoles(
  store: BuiltinRoleSyncStore,
  roles: readonly RoleFixture[],
): Promise<void> {
  const existingByCode = new Map<
    BuiltinRoleCode,
    ExistingRoleIdentity | undefined
  >()

  for (const role of roles) {
    const existing = await store.findByCode(role.code)
    if (existing && existing.isBuiltin !== true) {
      throw new Error(
        `无法同步内置角色 ${role.code}：该编码已被非内置角色占用`,
      )
    }
    existingByCode.set(role.code, existing)
  }

  for (const role of roles) {
    const existing = existingByCode.get(role.code)
    if (existing) {
      await store.update(existing.id, role)
      store.info(`角色 ${role.code} 已存在，已更新 fixture 权限`)
      continue
    }

    await store.create(role)
    store.info(`角色 ${role.code} 创建完成`)
  }
}
