import { describe, expect, it } from 'vitest'

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
  planAdminNavigationRoleUpdates,
  planPreviousRolePermissionUpdates,
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
  it('up 计划只包含五个内置角色及其目标权限', () => {
    const roleDocs = Object.keys(BUILTIN_ROLES).map((code, index) => ({
      id: index + 1,
      code,
      isBuiltin: true,
    }))
    const returnedRoleDocs = [
      ...roleDocs,
      { id: 98, code: 'OPS', isBuiltin: false },
      { id: 99, code: 'CUSTOM', isBuiltin: true },
    ]

    expect(planAdminNavigationRoleUpdates(returnedRoleDocs)).toEqual(
      Object.values(BUILTIN_ROLES).map((role, index) => ({
        id: index + 1,
        code: role.code,
        permissions: {
          menuPermissions: role.menuPermissions,
          operationPermissions: role.operationPermissions,
          fieldPermissions: role.fieldPermissions,
        },
      })),
    )
  })

  it('down 恢复五个角色的变更前权限基线', () => {
    const roleDocs = Object.keys(BUILTIN_ROLES).map((code, index) => ({
      id: index + 1,
      code,
      isBuiltin: true,
    }))

    expect(planPreviousRolePermissionUpdates(roleDocs)).toEqual([
      {
        id: 1,
        code: 'ADM',
        permissions: {
          menuPermissions: ['*'],
          operationPermissions: ['*'],
          fieldPermissions: ['*'],
        },
      },
      {
        id: 2,
        code: 'OPS',
        permissions: {
          menuPermissions: [
            'dashboard',
            'buildings',
            'listings',
            'listing-reviews',
            'merchants',
            'reports',
            'analytics',
          ],
          operationPermissions: [
            'listing:review',
            'listing:publish',
            'listing:unpublish',
            'merchant:freeze',
            'merchant:restore',
            'report:triage',
            'report:resolve',
          ],
          fieldPermissions: ['phone:full', 'phone:masked', 'audit:before_after'],
        },
      },
      {
        id: 3,
        code: 'MGR',
        permissions: {
          menuPermissions: [
            'dashboard',
            'leads',
            'customers',
            'brokers',
            'teams',
            'follow-ups',
          ],
          operationPermissions: [
            'lead:assign',
            'lead:transfer',
            'lead:reclaim',
            'broker:manage',
          ],
          fieldPermissions: ['phone:full', 'phone:masked'],
        },
      },
      {
        id: 4,
        code: 'BRK',
        permissions: {
          menuPermissions: ['my-leads', 'my-customers', 'follow-ups', 'listings'],
          operationPermissions: ['lead:claim', 'lead:follow_up', 'lead:recommend'],
          fieldPermissions: ['phone:full'],
        },
      },
      {
        id: 5,
        code: 'CSR',
        permissions: {
          menuPermissions: ['leads', 'customers'],
          operationPermissions: ['lead:create', 'lead:assign'],
          fieldPermissions: ['phone:masked'],
        },
      },
    ])
  })
})
