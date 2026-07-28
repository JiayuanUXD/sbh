import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'
import { describe, expect, it, vi } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type {
  AdminNavGroup,
  AdminNavLeaf,
  AdminNavSubgroup,
} from '@/domain/admin-navigation/navigation-types'
import {
  BUILTIN_ROLES,
  type BuiltinRoleCode,
  type RoleFixture,
} from '@/test/factory/roles'
import {
  down as restorePreviousRolePermissions,
  up as applyAdminNavigationRolePermissions,
} from '@/migrations/20260728_180000_opt_021_admin_navigation_roles'

function canSeeLeaf(role: RoleFixture, leaf: AdminNavLeaf): boolean {
  const hasMenuPermission =
    role.menuPermissions.includes('*') ||
    leaf.menuCodes.some((code) => role.menuPermissions.includes(code))
  const hasRequiredOperation =
    !leaf.requiredOperationCode ||
    role.operationPermissions.includes('*') ||
    role.operationPermissions.includes(leaf.requiredOperationCode)

  return hasMenuPermission && hasRequiredOperation
}

function canSeeItem(role: RoleFixture, item: AdminNavLeaf | AdminNavSubgroup): boolean {
  return item.children
    ? item.children.some((child) => canSeeLeaf(role, child))
    : canSeeLeaf(role, item)
}

function visibleTopGroups(code: BuiltinRoleCode): string[] {
  const role = BUILTIN_ROLES[code]

  return ADMIN_NAV_GROUPS.filter((group: AdminNavGroup) =>
    group.children.some((item) => canSeeItem(role, item)),
  ).map((group) => group.label)
}

describe('admin navigation role matrix', () => {
  it('ADM 可见全部一级分组', () => {
    expect(visibleTopGroups('ADM')).toEqual([
      '工作台',
      '房源运营',
      '审核与风控',
      '客户运营',
      '商户合作',
      '团队管理',
      '内容管理',
      '表单中心',
      '系统管理',
    ])
  })

  it('OPS 可见运营所需一级分组', () => {
    expect(visibleTopGroups('OPS')).toEqual([
      '工作台',
      '房源运营',
      '审核与风控',
      '商户合作',
      '内容管理',
      '表单中心',
    ])
  })

  it('MGR 可见团队销售所需一级分组', () => {
    expect(visibleTopGroups('MGR')).toEqual([
      '工作台',
      '房源运营',
      '客户运营',
      '团队管理',
    ])
  })

  it('BRK 可见个人销售所需一级分组', () => {
    expect(visibleTopGroups('BRK')).toEqual([
      '工作台',
      '房源运营',
      '客户运营',
    ])
  })

  it('CSR 可见客服所需一级分组', () => {
    expect(visibleTopGroups('CSR')).toEqual([
      '工作台',
      '客户运营',
      '表单中心',
    ])
  })

  it.each(['OPS', 'MGR', 'BRK', 'CSR'] as const)(
    '%s 仅获待办和通知读取权限',
    (code) => {
      const permissions = BUILTIN_ROLES[code].operationPermissions

      expect(permissions).toContain('task:read')
      expect(permissions).toContain('notification:read')
      expect(permissions).not.toContain('task:manage')
      expect(permissions).not.toContain('notification:manage')
    },
  )
})

describe('admin navigation role migration', () => {
  it('up 只查询五个内置角色并用 Local API 写入目标权限', async () => {
    const roleDocs = Object.keys(BUILTIN_ROLES).map((code, index) => ({
      id: index + 1,
      code,
      isBuiltin: true,
    }))
    const find = vi.fn().mockResolvedValue({
      docs: [
        ...roleDocs,
        { id: 98, code: 'OPS', isBuiltin: false },
        { id: 99, code: 'CUSTOM', isBuiltin: true },
      ],
    })
    const update = vi.fn().mockResolvedValue({})
    const req = { transactionID: 'role-migration-test' }
    const args = {
      payload: { find, update },
      req,
    } as unknown as MigrateUpArgs

    await applyAdminNavigationRolePermissions(args)

    expect(find).toHaveBeenCalledWith({
      collection: 'roles',
      where: {
        and: [
          { isBuiltin: { equals: true } },
          { code: { in: ['ADM', 'OPS', 'MGR', 'BRK', 'CSR'] } },
        ],
      },
      limit: 5,
      depth: 0,
      overrideAccess: true,
      req,
    })
    expect(update).toHaveBeenCalledTimes(5)
    for (const role of Object.values(BUILTIN_ROLES)) {
      expect(update).toHaveBeenCalledWith({
        collection: 'roles',
        id: roleDocs.find((doc) => doc.code === role.code)?.id,
        data: {
          menuPermissions: role.menuPermissions,
          operationPermissions: role.operationPermissions,
          fieldPermissions: role.fieldPermissions,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
    }
  })

  it('down 恢复变更前的 CSR 权限基线', async () => {
    const find = vi
      .fn()
      .mockResolvedValue({ docs: [{ id: 5, code: 'CSR', isBuiltin: true }] })
    const update = vi.fn().mockResolvedValue({})
    const req = { transactionID: 'role-migration-down-test' }
    const args = {
      payload: { find, update },
      req,
    } as unknown as MigrateDownArgs

    await restorePreviousRolePermissions(args)

    expect(update).toHaveBeenCalledWith({
      collection: 'roles',
      id: 5,
      data: {
        menuPermissions: ['leads', 'customers'],
        operationPermissions: ['lead:create', 'lead:assign'],
        fieldPermissions: ['phone:masked'],
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
  })
})
