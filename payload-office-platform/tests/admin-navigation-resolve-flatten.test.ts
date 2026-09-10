/**
 * 解析层的「单叶组自动扁平化」与两级深度上限（OPT-084 Phase 1）
 *
 * 为什么要扁平化：一个组按权限解析后只剩一片叶子时，「先点开组、再点组里唯一一项」
 * 是纯粹的空转——收起态的 hover 浮层里更刺眼（浮层里只有一行）。所以这件事在解析层
 * 就做掉，客户端只负责按 kind 画，不再自己判断「这个组是不是只有一项」。
 *
 * 扁平叶为什么要带 icon：叶子自身没有图标键，而收起态（48px）只画图标，
 * 没有图标它就是一块空白。取所属组的图标是唯一不引入新数据的选择。
 *
 * 顺带守 G3：不再有子分组，组的 children 里不允许出现任何带 children 的项。
 * 这条不是风格偏好——子分组那一层曾让「配套字典」藏在「系统管理 → 基础配置」下面，
 * 两次点击才看得到，而它其实只有一片叶子。
 */

import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavGroup } from '@/domain/admin-navigation/navigation-types'
import { resolveAdminNavigation } from '@/domain/admin-navigation/resolve-navigation'
import type { PermissionContext } from '@/domain/auth/permission-context'

function makePermission(
  menuCodes: readonly string[],
  operationCodes: readonly string[] = [],
): PermissionContext {
  return {
    userId: 'flatten-test-user',
    roleCodes: [],
    cityIds: 'all',
    teamIds: new Set(),
    menuPermissions: new Set(menuCodes),
    operationPermissions: new Set(operationCodes),
    fieldPermissions: new Set(),
    dataScope: 'none',
  }
}

/** 用合成配置而不是真实导航树：真实树的组成不该决定「扁平化规则本身」是否成立。 */
const FIXTURE_GROUPS: readonly AdminNavGroup[] = [
  {
    id: 'solo',
    label: '独苗组',
    icon: 'settings',
    children: [
      {
        id: 'only-leaf',
        label: '唯一入口',
        href: '/admin/collections/only-leaf',
        menuCodes: ['solo'],
        badgeKey: 'tasks',
      },
    ],
  },
  {
    id: 'empty',
    label: '空组',
    icon: 'file',
    children: [
      {
        id: 'unreachable',
        label: '谁也看不到',
        href: '/admin/collections/unreachable',
        menuCodes: ['nobody-holds-this-code'],
      },
    ],
  },
  {
    id: 'pair',
    label: '双叶组',
    icon: 'user',
    children: [
      {
        id: 'first',
        label: '第一项',
        href: '/admin/collections/first',
        menuCodes: ['pair'],
      },
      {
        id: 'second',
        label: '第二项',
        href: '/admin/collections/second',
        menuCodes: ['pair'],
      },
    ],
  },
]

function resolveFixture(menuCodes: readonly string[]) {
  return resolveAdminNavigation({
    groups: FIXTURE_GROUPS,
    permission: makePermission(menuCodes),
    canReadCollection: () => true,
  })
}

describe('resolveAdminNavigation/单叶组扁平化', () => {
  it('只剩一片叶子的组降成顶级扁平叶，图标取组的图标键', () => {
    expect(resolveFixture(['solo'])).toEqual([
      {
        kind: 'leaf',
        id: 'only-leaf',
        label: '唯一入口',
        href: '/admin/collections/only-leaf',
        icon: 'settings',
        badgeKey: 'tasks',
      },
    ])
  })

  it('一片叶子都不剩的组整个不输出（不留空壳组头）', () => {
    expect(resolveFixture(['pair']).map((entry) => entry.id)).toEqual(['pair'])
  })

  it('两片及以上叶子仍是组，children 保持叶子形态', () => {
    expect(resolveFixture(['pair'])).toEqual([
      {
        kind: 'group',
        id: 'pair',
        label: '双叶组',
        icon: 'user',
        children: [
          { id: 'first', label: '第一项', href: '/admin/collections/first' },
          { id: 'second', label: '第二项', href: '/admin/collections/second' },
        ],
      },
    ])
  })

  it('遍历异常时的安全回退也是扁平叶 overview（回退只有一项，做成组同样是空转）', () => {
    const navigation = resolveAdminNavigation({
      groups: ADMIN_NAV_GROUPS,
      permission: makePermission(['dashboard', 'notifications'], ['notification:read']),
      canReadCollection: () => {
        throw new Error('collection access unavailable')
      },
    })

    expect(navigation).toEqual([
      {
        kind: 'leaf',
        id: 'overview',
        label: '运营概览',
        href: '/admin',
        icon: 'dashboard',
      },
    ])
  })
})

describe('导航深度不得超过两级（G3）', () => {
  it('配置里没有任何带 children 的组内项', () => {
    const nested = ADMIN_NAV_GROUPS.flatMap((group) =>
      group.children
        .filter((item) => 'children' in item)
        .map((item) => `${group.id} → ${item.id}`),
    )

    expect(nested, `这些组内项还带着 children，子分组应已删除：${nested.join('、')}`).toEqual([])
  })

  it('解析结果里组的 children 全是叶子', () => {
    const navigation = resolveAdminNavigation({
      groups: ADMIN_NAV_GROUPS,
      permission: makePermission(['*'], ['*']),
      canReadCollection: () => true,
    })

    const nested = navigation
      .filter((entry) => entry.kind === 'group')
      .flatMap((group) =>
        group.children.filter((leaf) => 'children' in leaf).map((leaf) => leaf.id),
      )

    expect(nested).toEqual([])
  })
})
