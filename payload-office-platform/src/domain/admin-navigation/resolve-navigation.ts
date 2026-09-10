import {
  hasMenuPermission,
  hasOperationPermission,
  type PermissionContext,
} from '@/domain/auth/permission-context'

import { ADMIN_NAV_GROUPS } from './navigation-config'
import type { AdminNavGroup, AdminNavLeaf } from './navigation-types'

export type ResolvedAdminNavLeaf = Pick<AdminNavLeaf, 'id' | 'label' | 'href' | 'badgeKey'>

export type ResolvedAdminNavGroup = {
  kind: 'group'
  id: string
  label: string
  icon: string
  children: readonly ResolvedAdminNavLeaf[]
}

/**
 * 被扁平化的单叶组：它在侧栏里就是一个顶级链接，没有组头按钮。
 * `icon` 取自原来那个组——叶子自身没有图标键，而收起态（48px）只画图标。
 */
export type ResolvedAdminNavFlatLeaf = ResolvedAdminNavLeaf & {
  kind: 'leaf'
  icon: string
}

export type ResolvedAdminNavEntry = ResolvedAdminNavGroup | ResolvedAdminNavFlatLeaf

type ResolveAdminNavigationInput = {
  groups: readonly AdminNavGroup[]
  permission: PermissionContext
  canReadCollection: (slug: string) => boolean
}

/**
 * 在服务端根据当前 PermissionContext 与 Collection read 权限解析可见导航。
 *
 * 输出是判别联合而不是「组的数组」：一个组按权限筛完只剩一片叶子时，
 * 「点开组 → 点组里唯一一项」是纯空转，故直接降成顶级扁平叶（OPT-084 Phase 1）。
 * 这件事必须在解析层做——客户端拿到的已经是筛过的树，它无从判断
 * 「只有一项」是配置本来如此还是权限筛剩的，两者在渲染上应当同样处理。
 *
 * Collection access 回调或配置遍历异常时，回退仅保留已获 dashboard 菜单权限的工作台入口。
 */
export function resolveAdminNavigation(
  input: ResolveAdminNavigationInput,
): readonly ResolvedAdminNavEntry[] {
  try {
    return input.groups.flatMap((group) => resolveGroup(group, input))
  } catch {
    return resolveWorkspaceFallback(input.permission)
  }
}

function resolveGroup(
  group: AdminNavGroup,
  input: ResolveAdminNavigationInput,
): ResolvedAdminNavEntry[] {
  const children = group.children.flatMap((item) => resolveLeaf(item, input))

  if (children.length === 0) return []
  if (children.length === 1) return [toFlatLeaf(children[0], group.icon)]

  return [{ kind: 'group', id: group.id, label: group.label, icon: group.icon, children }]
}

function resolveLeaf(
  leaf: AdminNavLeaf,
  input: ResolveAdminNavigationInput,
): ResolvedAdminNavLeaf[] {
  if (!leaf.menuCodes.some((menuCode) => hasMenuPermission(input.permission, menuCode))) {
    return []
  }

  if (
    leaf.requiredOperationCode &&
    !hasOperationPermission(input.permission, leaf.requiredOperationCode)
  ) {
    return []
  }

  if (leaf.collectionSlug && !input.canReadCollection(leaf.collectionSlug)) {
    return []
  }

  return [toResolvedLeaf(leaf)]
}

function resolveWorkspaceFallback(
  permission: PermissionContext,
): readonly ResolvedAdminNavEntry[] {
  if (!hasMenuPermission(permission, 'dashboard')) return []

  const workspace = ADMIN_NAV_GROUPS.find((group) => group.id === 'workspace')
  if (!workspace) return []

  const overview = workspace.children.find((item) => item.id === 'overview')
  if (!overview) return []

  // 回退只剩一项，按同一条扁平化规则输出扁平叶——否则用户会看到一个只装了一项的组。
  return [toFlatLeaf(toResolvedLeaf(overview), workspace.icon)]
}

function toResolvedLeaf(leaf: AdminNavLeaf): ResolvedAdminNavLeaf {
  return {
    id: leaf.id,
    label: leaf.label,
    href: leaf.href,
    ...(leaf.badgeKey ? { badgeKey: leaf.badgeKey } : {}),
  }
}

function toFlatLeaf(leaf: ResolvedAdminNavLeaf, icon: string): ResolvedAdminNavFlatLeaf {
  return { kind: 'leaf', ...leaf, icon }
}
