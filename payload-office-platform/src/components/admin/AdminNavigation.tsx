import type { ServerProps } from 'payload'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import { resolveAdminNavigation } from '@/domain/admin-navigation/resolve-navigation'
import { buildPermissionContext } from '@/domain/auth/permission-context'

import AdminNavigationClient from './AdminNavigationClient'
import './AdminNavigation.scss'

export default async function AdminNavigation({
  payload,
  permissions,
  user,
}: ServerProps) {
  if (!user || permissions?.canAccessAdmin !== true) return null

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

    const groups = resolveAdminNavigation({
      groups: ADMIN_NAV_GROUPS,
      permission,
      canReadCollection: (slug) =>
        permissions.collections?.[slug]?.read === true,
    })

    return <AdminNavigationClient groups={groups} />
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    payload.logger.error(
      `[admin-navigation] failed to resolve navigation: ${error.message}`,
    )
    return null
  }
}
