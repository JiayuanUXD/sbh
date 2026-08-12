import { describe, expect, it } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import { resolveAdminNavigation } from '@/domain/admin-navigation/resolve-navigation'

function makePermission(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    userId: 'navigation-test-user',
    roleCodes: [],
    cityIds: 'all',
    teamIds: new Set(),
    menuPermissions: new Set(),
    operationPermissions: new Set(),
    fieldPermissions: new Set(),
    dataScope: 'none',
    ...overrides,
  }
}

function resolveVisibleNavigation(args: {
  menuCodes?: readonly string[]
  operationCodes?: readonly string[]
  readableCollections?: readonly string[]
}) {
  return resolveAdminNavigation({
    groups: ADMIN_NAV_GROUPS,
    permission: makePermission({
      menuPermissions: new Set(args.menuCodes),
      operationPermissions: new Set(args.operationCodes),
    }),
    canReadCollection: (slug) => args.readableCollections?.includes(slug) ?? false,
  })
}

function visibleItemIds(groups: ReturnType<typeof resolveVisibleNavigation>): string[] {
  return groups.flatMap((group) => [
    group.id,
    ...group.children.flatMap((item) => [
      item.id,
      ...('children' in item ? item.children.map((child) => child.id) : []),
    ]),
  ])
}

describe('resolveAdminNavigation', () => {
  it('menuPermissions 中的通配符可显示已具 Collection read 权限的菜单', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['*'],
      operationCodes: ['*'],
      readableCollections: ['listings'],
    })

    expect(visibleItemIds(navigation)).toContain('listings')
  })

  it.each(['leads', 'my-leads'])('任一线索菜单编码即可显示咨询线索：%s', (menuCode) => {
    const navigation = resolveVisibleNavigation({
      menuCodes: [menuCode],
      readableCollections: ['leads'],
    })

    expect(visibleItemIds(navigation)).toEqual(['crm', 'leads'])
  })

  it('articles 菜单编码加 Collection read 权限可显示资讯中心', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['articles'],
      readableCollections: ['articles'],
    })

    expect(visibleItemIds(navigation)).toEqual(['content', 'articles'])
  })

  it('缺少目标 Collection read 权限时隐藏叶子，即使菜单权限存在', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['listings'],
      readableCollections: [],
    })

    expect(navigation).toEqual([])
  })

  it.each([
    ['domain-events', 'events:read', 'domain-events'],
    ['audit-logs', 'audit:view', 'audit-logs'],
  ] as const)(
    '缺少 %s 所需操作权限时隐藏高级工具叶子',
    (menuCode, requiredOperationCode, leafId) => {
      const navigation = resolveVisibleNavigation({
        menuCodes: [menuCode],
        readableCollections: [leafId],
      })

      expect(navigation).toEqual([])

      const withOperation = resolveVisibleNavigation({
        menuCodes: [menuCode],
        operationCodes: [requiredOperationCode],
        readableCollections: [leafId],
      })
      expect(visibleItemIds(withOperation)).toEqual(['system', 'advanced-tools', leafId])
    },
  )

  it('递归移除没有可见叶子的子分组和一级分组', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['locations'],
      readableCollections: ['locations'],
    })

    expect(visibleItemIds(navigation)).toEqual([
      'region-management',
      'cities',
      'districts',
      'metro-lines',
    ])
  })

  it('配置遍历失败时，为有 dashboard 权限的用户返回工作台安全回退', () => {
    let canReadCollectionCalls = 0
    const canReadCollection = (slug: string): boolean => {
      canReadCollectionCalls += 1
      expect(slug).toBe('tasks')
      throw new Error('collection access unavailable')
    }
    const navigation = resolveAdminNavigation({
      groups: ADMIN_NAV_GROUPS,
      permission: makePermission({
        menuPermissions: new Set(['dashboard', 'todos']),
        operationPermissions: new Set(['task:read']),
      }),
      canReadCollection,
    })

    expect(canReadCollectionCalls).toBe(1)
    expect(visibleItemIds(navigation)).toEqual(['workspace', 'overview'])
  })

  it('配置遍历失败时，不为无 dashboard 权限的用户提升可见性', () => {
    let canReadCollectionCalls = 0
    const canReadCollection = (slug: string): boolean => {
      canReadCollectionCalls += 1
      expect(slug).toBe('tasks')
      throw new Error('collection access unavailable')
    }
    const navigation = resolveAdminNavigation({
      groups: ADMIN_NAV_GROUPS,
      permission: makePermission({
        menuPermissions: new Set(['todos']),
        operationPermissions: new Set(['task:read']),
      }),
      canReadCollection,
    })

    expect(canReadCollectionCalls).toBe(1)
    expect(navigation).toEqual([])
  })
})
