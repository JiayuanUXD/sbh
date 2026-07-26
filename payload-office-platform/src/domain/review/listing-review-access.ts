import type { Where } from 'payload'

import {
  hasMenuPermission,
  hasOperationPermission,
  type PermissionContext,
} from '@/domain/auth/permission-context'

const REVIEW_MENU_PERMISSION = 'listing-reviews'
const REVIEW_OPERATION_PERMISSION = 'listing:review'

export function canReadListingReviews(ctx: PermissionContext): boolean {
  if (!hasMenuPermission(ctx, REVIEW_MENU_PERMISSION)) return false
  if (!hasOperationPermission(ctx, REVIEW_OPERATION_PERMISSION)) return false
  return ctx.dataScope === 'global' || ctx.dataScope === 'city'
}

export function buildReviewCityScopeWhere(
  ctx: PermissionContext,
  cityFieldPath: string,
): Where | null {
  if (ctx.cityIds === 'all') return null
  const cityIds = [...ctx.cityIds]
  if (cityIds.length === 0) {
    return { id: { exists: false } }
  }
  return {
    [cityFieldPath]: { in: cityIds },
  }
}
