import { describe, expect, it } from 'vitest'
import { MENU_CODES, OPERATION_CODES } from '@/domain/auth/permission-codes'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavLeaf } from '@/domain/admin-navigation/navigation-types'
import { BUILTIN_ROLES } from '@/test/factory/roles'

function leaves(): readonly AdminNavLeaf[] {
  return ADMIN_NAV_GROUPS.flatMap((g) => g.children)
}

describe('会员权限码与导航', () => {
  it('注册了菜单码 members 与操作码 member:manage', () => {
    expect(MENU_CODES).toContain('members')
    expect(OPERATION_CODES).toContain('member:manage')
  })

  it('OPS 夹具持有两码，ADM 通配', () => {
    expect(BUILTIN_ROLES.OPS.menuPermissions).toContain('members')
    expect(BUILTIN_ROLES.OPS.operationPermissions).toContain('member:manage')
    expect(BUILTIN_ROLES.ADM.operationPermissions).toEqual(['*'])
  })

  it('客户运营组下有会员叶子，且要求 member:manage', () => {
    const leaf = leaves().find((l) => l.id === 'members')
    expect(leaf).toBeDefined()
    expect(leaf?.href).toBe('/admin/collections/members')
    expect(leaf?.menuCodes).toEqual(['members'])
    expect(leaf?.requiredOperationCode).toBe('member:manage')
  })
})
