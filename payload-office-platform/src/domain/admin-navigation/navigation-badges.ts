import type { Where } from 'payload'

import {
  hasMenuPermission,
  hasOperationPermission,
  type PermissionContext,
} from '@/domain/auth/permission-context'
import {
  buildReviewCityScopeWhere,
  canReadListingReviews,
} from '@/domain/review/listing-review-access'
import { mergeWhere } from '@/domain/analytics/queries/scope-where'
import type { AdminNavigationBadgeKey } from './navigation-types'

export type AdminNavigationBadgeQuery = {
  key: AdminNavigationBadgeKey
  collection:
    | 'tasks'
    | 'notifications'
    | 'listing-reviews'
    | 'listing-reports'
    | 'leads'
    | 'form-submissions'
  where: Where
}

type BadgeScopeFields = {
  city?: string
  team?: string
  self?: string
}

const NO_MATCH_WHERE: Where = { id: { exists: false } }

export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null
  if (count > 99) return '99+'
  return String(count)
}

export function buildAdminNavigationBadgeQueries(
  permission: PermissionContext,
  asOf: Date,
): readonly AdminNavigationBadgeQuery[] {
  const queries: AdminNavigationBadgeQuery[] = []

  if (canReadTasks(permission)) {
    queries.push({
      key: 'tasks',
      collection: 'tasks',
      where: combineWhere(
        { status: { in: ['pending', 'in_progress'] } },
        { assignee: { equals: permission.userId } },
      ),
    })
  }

  if (canReadNotifications(permission)) {
    queries.push({
      key: 'notifications',
      collection: 'notifications',
      where: combineWhere(
        { read: { equals: false } },
        { recipient: { equals: permission.userId } },
      ),
    })
  }

  if (canReadListingReviews(permission)) {
    queries.push({
      key: 'listingReviews',
      collection: 'listing-reviews',
      where: combineWhere(
        { taskStatus: { in: ['pending', 'processing'] } },
        buildReviewCityScopeWhere(permission, 'listing.building.city'),
      ),
    })
  }

  if (canReadListingReports(permission)) {
    const scopeWhere = buildBadgeDataScopeWhere(permission, {
      city: 'targetListing.building.city',
      self: 'assignee',
    })
    queries.push({
      key: 'listingReports',
      collection: 'listing-reports',
      where: combineWhere(
        { status: { not_equals: 'closed' } },
        ...scopeWhere,
      ),
    })
  }

  if (canReadLeads(permission)) {
    const scopeWhere = buildBadgeDataScopeWhere(permission, {
      city: 'city',
      team: 'team',
      // Lead.owner relates to brokers, so self must compare through Broker.user.
      self: 'owner.user',
    })
    queries.push({
      key: 'leads',
      collection: 'leads',
      where: combineWhere(
        {
          or: [
            { stage: { equals: 'new' } },
            { nextFollowUpAt: { less_than: asOf.toISOString() } },
          ],
        },
        ...scopeWhere,
      ),
    })
  }

  if (canReadFormSubmissions(permission)) {
    const scopeWhere = buildBadgeDataScopeWhere(permission, {})
    queries.push({
      key: 'formSubmissions',
      collection: 'form-submissions',
      where: combineWhere(
        { processingStatus: { equals: 'new' } },
        ...scopeWhere,
      ),
    })
  }

  return queries
}

export async function collectAdminNavigationBadges(input: {
  permission: PermissionContext
  asOf: Date
  count: (query: AdminNavigationBadgeQuery) => Promise<number>
  onError?: (key: AdminNavigationBadgeKey, error: Error) => void
}): Promise<Partial<Record<AdminNavigationBadgeKey, number>>> {
  const queries = buildAdminNavigationBadgeQueries(
    input.permission,
    input.asOf,
  )
  const results = await Promise.all(
    queries.map(async (query) => {
      try {
        return {
          ok: true as const,
          key: query.key,
          count: await input.count(query),
        }
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught))
        try {
          input.onError?.(query.key, error)
        } catch (reportingError) {
          // Observability failures must not turn one badge failure into a full
          // navigation outage. Fall back to the process logger for visibility.
          console.error(
            '[admin-navigation] badge error reporter failed',
            reportingError,
          )
        }
        return { ok: false as const }
      }
    }),
  )

  const badges: Partial<Record<AdminNavigationBadgeKey, number>> = {}
  for (const result of results) {
    if (result.ok) badges[result.key] = result.count
  }
  return badges
}

function canReadTasks(permission: PermissionContext): boolean {
  return (
    hasMenuPermission(permission, 'todos') &&
    hasOperationPermission(permission, 'task:read')
  )
}

function canReadNotifications(permission: PermissionContext): boolean {
  return (
    hasMenuPermission(permission, 'notifications') &&
    hasOperationPermission(permission, 'notification:read')
  )
}

function canReadListingReports(permission: PermissionContext): boolean {
  return (
    hasMenuPermission(permission, 'reports') &&
    hasOperationPermission(permission, 'report:read')
  )
}

function canReadLeads(permission: PermissionContext): boolean {
  return (
    hasMenuPermission(permission, 'leads') ||
    hasMenuPermission(permission, 'my-leads')
  )
}

function canReadFormSubmissions(permission: PermissionContext): boolean {
  return hasMenuPermission(permission, 'form-submissions')
}

/**
 * Build the server-derived data-scope predicate for a badge target.
 *
 * A Collection without the field required by the current scope fails closed with
 * an impossible predicate. This is especially important for plugin-owned form
 * submissions and team-scoped reports: neither currently stores a team/city owner.
 */
function buildBadgeDataScopeWhere(
  permission: PermissionContext,
  fields: BadgeScopeFields,
): readonly Where[] {
  if (permission.dataScope === 'none') return [NO_MATCH_WHERE]

  const parts: Where[] = []
  const cityWhere = buildBoundedIdsWhere(
    permission.cityIds,
    fields.city,
    permission.dataScope === 'global',
  )
  if (cityWhere === NO_MATCH_WHERE) return [NO_MATCH_WHERE]
  if (cityWhere) parts.push(cityWhere)

  if (permission.dataScope === 'global' || permission.dataScope === 'city') {
    if (permission.dataScope === 'city' && !fields.city) return [NO_MATCH_WHERE]
    return parts
  }

  if (permission.dataScope === 'team') {
    if (!fields.team) return [NO_MATCH_WHERE]
    const teamWhere = buildBoundedIdsWhere(
      permission.teamIds,
      fields.team,
      false,
    )
    if (teamWhere === NO_MATCH_WHERE) return [NO_MATCH_WHERE]
    if (teamWhere) parts.push(teamWhere)
    return parts
  }

  if (!fields.self) return [NO_MATCH_WHERE]
  parts.push({ [fields.self]: { equals: permission.userId } })
  return parts
}

function buildBoundedIdsWhere(
  ids: PermissionContext['cityIds'] | PermissionContext['teamIds'],
  field: string | undefined,
  unscopedAllAllowed: boolean,
): Where | null {
  if (ids === 'all') {
    return field || unscopedAllAllowed ? null : NO_MATCH_WHERE
  }
  if (!field || ids.size === 0) return NO_MATCH_WHERE
  return { [field]: { in: [...ids] } }
}

function combineWhere(...parts: Array<Where | null>): Where {
  return mergeWhere(...parts) as Where
}
