import { describe, expect, it } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import {
  resolveAdminNavigation,
  type ResolvedAdminNavEntry,
} from '@/domain/admin-navigation/resolve-navigation'

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

/**
 * 组给出「组 id + 各叶子 id」，扁平叶只给出它自己的 id。
 *
 * 于是「只剩一片叶子的组」在这里的指纹就是「结果里只有叶子 id，没有组 id」——
 * 下面多条用例正是靠这个区分「组还在」和「已被扁平化」。
 */
function visibleItemIds(entries: readonly ResolvedAdminNavEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === 'group' ? [entry.id, ...entry.children.map((leaf) => leaf.id)] : [entry.id],
  )
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

  it.each(['leads', 'my-leads'])(
    '任一线索菜单编码即可显示咨询线索（该组只剩它一片，扁平成顶级叶子）：%s',
    (menuCode) => {
      const navigation = resolveVisibleNavigation({
        menuCodes: [menuCode],
        readableCollections: ['leads'],
      })

      expect(visibleItemIds(navigation)).toEqual(['leads'])
    },
  )

  it('articles 菜单编码加 Collection read 权限可显示资讯中心', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['articles'],
      readableCollections: ['articles'],
    })

    expect(visibleItemIds(navigation)).toEqual(['articles'])
  })

  it('缺少目标 Collection read 权限时隐藏叶子，即使菜单权限存在', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['listings'],
      readableCollections: [],
    })

    expect(navigation).toEqual([])
  })

  it('缺少 audit:view 时隐藏审计日志', () => {
    expect(
      resolveVisibleNavigation({
        menuCodes: ['audit-logs'],
        readableCollections: ['audit-logs'],
      }),
    ).toEqual([])

    const withOperation = resolveVisibleNavigation({
      menuCodes: ['audit-logs'],
      operationCodes: ['audit:view'],
      readableCollections: ['audit-logs'],
    })
    expect(visibleItemIds(withOperation)).toEqual(['audit-logs'])
  })

  it('领域事件已退出导航：给足菜单码与操作码也不产出入口（OPT-084 裁定 2）', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['domain-events'],
      operationCodes: ['events:read'],
      readableCollections: ['domain-events'],
    })

    expect(navigation).toEqual([])
  })

  it('移除没有可见叶子的一级分组', () => {
    const navigation = resolveVisibleNavigation({
      menuCodes: ['locations'],
      readableCollections: ['locations'],
    })

    // 地理别名与城市站点配置都还要 location:manage，商圈管理挂的是 business-areas 菜单码
    expect(visibleItemIds(navigation)).toEqual([
      'geography',
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
    // 回退只有一项，按同一条扁平化规则输出顶级叶子而不是只装一项的组
    expect(visibleItemIds(navigation)).toEqual(['overview'])
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
