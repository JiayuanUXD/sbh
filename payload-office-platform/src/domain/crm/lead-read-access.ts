import type { CollectionConfig, Where } from 'payload'

import {
  derivePermissionContextFromRequest,
  type RequestContext,
} from '@/domain/auth/access'
import type { PermissionContext } from '@/domain/auth/permission-context'

type LeadReadAccess = NonNullable<
  NonNullable<CollectionConfig['access']>['read']
>

/**
 * Build the authoritative collection predicate for reading Leads.
 *
 * BRK and custom self-scoped roles are constrained through Lead.owner -> Broker.user.
 * Account cityScope remains the final upper bound and is derived from req.user, never
 * from URL parameters. Other scopes retain their existing domain-service behavior.
 */
export function buildLeadReadScope(
  permission: PermissionContext,
): boolean | Where {
  if (permission.dataScope === 'none') return false
  if (permission.dataScope !== 'self') return true

  const ownerWhere: Where = {
    'owner.user': { equals: permission.userId },
  }
  if (permission.cityIds === 'all') return ownerWhere

  const cityIDs = [...permission.cityIds]
  if (cityIDs.length === 0) return false

  return {
    and: [
      ownerWhere,
      { city: { in: cityIDs } },
    ],
  }
}

export const leadReadAccess: LeadReadAccess = async ({ req }) => {
  const permission = await derivePermissionContextFromRequest(
    req as RequestContext,
  )
  if (!permission) return false
  return buildLeadReadScope(permission)
}
