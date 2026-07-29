import {
  hasMenuPermission,
  hasOperationPermission,
  type PermissionContext,
} from '@/domain/auth/permission-context'

import { ADMIN_NAV_GROUPS } from './navigation-config'
import type { AdminNavGroup, AdminNavItem, AdminNavLeaf, AdminNavSubgroup } from './navigation-types'

export type ResolvedAdminNavLeaf = Pick<AdminNavLeaf, 'id' | 'label' | 'href' | 'badgeKey'>

export type ResolvedAdminNavSubgroup = {
  id: string
  label: string
  children: readonly ResolvedAdminNavLeaf[]
}

export type ResolvedAdminNavItem = ResolvedAdminNavLeaf | ResolvedAdminNavSubgroup

export type ResolvedAdminNavGroup = {
  id: string
  label: string
  children: readonly ResolvedAdminNavItem[]
}

type ResolveAdminNavigationInput = {
  groups: readonly AdminNavGroup[]
  permission: PermissionContext
  canReadCollection: (slug: string) => boolean
}

/**
 * 在服务端根据当前 PermissionContext 与 Collection read 权限解析可见导航。
 * Collection access 回调或配置遍历异常时，回退仅保留已获 dashboard 菜单权限的工作台入口。
 */
export function resolveAdminNavigation(
  input: ResolveAdminNavigationInput,
): readonly ResolvedAdminNavGroup[] {
  try {
    return input.groups.flatMap((group) => resolveGroup(group, input))
  } catch {
    return resolveWorkspaceFallback(input.permission)
  }
}

function resolveGroup(
  group: AdminNavGroup,
  input: ResolveAdminNavigationInput,
): ResolvedAdminNavGroup[] {
  const children = group.children.flatMap((item) => resolveItem(item, input))

  return children.length > 0 ? [{ id: group.id, label: group.label, children }] : []
}

function resolveItem(
  item: AdminNavItem,
  input: ResolveAdminNavigationInput,
): ResolvedAdminNavItem[] {
  if (isSubgroup(item)) {
    const children = item.children.flatMap((leaf) => resolveLeaf(leaf, input))

    return children.length > 0 ? [{ id: item.id, label: item.label, children }] : []
  }

  return resolveLeaf(item, input)
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

function resolveWorkspaceFallback(permission: PermissionContext): readonly ResolvedAdminNavGroup[] {
  if (!hasMenuPermission(permission, 'dashboard')) return []

  const workspace = ADMIN_NAV_GROUPS.find((group) => group.id === 'workspace')
  if (!workspace) return []

  const overview = workspace.children.find(isOverviewLeaf)
  if (!overview) return []

  return [
    {
      id: workspace.id,
      label: workspace.label,
      children: [toResolvedLeaf(overview)],
    },
  ]
}

function isSubgroup(item: AdminNavItem): item is AdminNavSubgroup {
  return 'children' in item
}

function isOverviewLeaf(item: AdminNavItem): item is AdminNavLeaf {
  return item.id === 'overview' && !isSubgroup(item)
}

function toResolvedLeaf(leaf: AdminNavLeaf): ResolvedAdminNavLeaf {
  return {
    id: leaf.id,
    label: leaf.label,
    href: leaf.href,
    ...(leaf.badgeKey ? { badgeKey: leaf.badgeKey } : {}),
  }
}
