import type { CollectionConfig, Where } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import type { PermissionContext } from '@/domain/auth/permission-context'

type AccessConfig = NonNullable<CollectionConfig['access']>
type ReadArgs = Parameters<NonNullable<AccessConfig['read']>>[0]

function createCityPartnerAccess(requiredPermission: string) {
  return async ({ req }: ReadArgs) => {
    const permission = await getPermissionContext(req as RequestContext)
    if (!permission || !hasOperationPermission(permission, requiredPermission)) return false
    return buildCityPartnerCityScopeWhere(permission)
  }
}

export function buildCityPartnerCityScopeWhere(permission: PermissionContext): boolean | Where {
  if (permission.roleCodes.includes('ADM') && permission.dataScope === 'global') return true
  if (!(permission.cityIds instanceof Set) || permission.cityIds.size === 0) return false
  return { city: { in: [...permission.cityIds] } }
}

export const cityPartnerApplicationReadAccess = createCityPartnerAccess(
  'city_partner_application:read',
)

export const cityPartnerApplicationManageAccess = createCityPartnerAccess(
  'city_partner_application:manage',
)
