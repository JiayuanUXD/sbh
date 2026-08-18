import type { ServerProps } from 'payload'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import { canReadCollection } from '@/domain/admin-navigation/collection-read-access'
import {
  resolveAdminNavigation,
  type ResolvedAdminNavGroup,
} from '@/domain/admin-navigation/resolve-navigation'
import { buildPermissionContext } from '@/domain/auth/permission-context'

import AdminNavigationClient from './AdminNavigationClient'
import './AdminNavigation.scss'

export default async function AdminNavigation({
  payload,
  permissions,
  user,
}: ServerProps) {
  if (!user || permissions?.canAccessAdmin !== true) return null

  // 解析在 try/catch 内完成，JSX 构造放到 try 之外：
  // 服务端组件的 JSX 渲染错误不会被此 try/catch 捕获（react-hooks/error-boundaries）。
  let groups: readonly ResolvedAdminNavGroup[]
  try {
    const permission = await buildPermissionContext({
      user,
      loadRoles: async (roleIds) => {
        const roles = await payload.find({
          collection: 'roles',
          depth: 0,
          limit: roleIds.length,
          overrideAccess: true,
          where: {
            id: {
              in: roleIds,
            },
          },
        })

        return roles.docs
      },
    })

    if (!permission) return null

    groups = resolveAdminNavigation({
      groups: ADMIN_NAV_GROUPS,
      permission,
      canReadCollection: (slug) => canReadCollection(permissions, slug),
    })
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    payload.logger.error(
      `[admin-navigation] failed to resolve navigation: ${error.message}`,
    )
    return null
  }

  return <AdminNavigationClient groups={groups} />
}
