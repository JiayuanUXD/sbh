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
import { buildCityPartnerCityScopeWhere } from '@/domain/city-partner-application/access'

export type AdminNavigationBadgeQuery = {
  key: AdminNavigationBadgeKey
  collection:
    | 'tasks'
    | 'notifications'
    | 'listings'
    | 'listing-reports'
    | 'leads'
    | 'form-submissions'
    | 'supply-submissions'
    | 'information-corrections'
    | 'city-partner-applications'
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
      collection: 'listings',
      where: combineWhere(
        { reviewStatus: { equals: 'pending' } },
        buildReviewCityScopeWhere(permission, 'building.city'),
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

  // 这两块必须排在城市合伙人之前：下面那块在拿不到城市范围时是 `return queries`
  // 提前返回（而不是 `continue` 语义），排在它后面的查询会被整片吞掉。
  if (canReadSupplySubmissions(permission)) {
    // 口径与 dashboard-stats 的 pendingSubmissions 一致：status=pending 即「待审单」。
    // 该集合有 city 关系字段，城市这一维能表达就必须表达——房东手机号与地址属于
    // 越界即泄漏的数据，宁可漏算不可放大。代价是 team / self 范围的角色（MGR）
    // 在这里没有对应字段，按 buildBadgeDataScopeWhere 的既定约定 fail-closed 成
    // no-match，角标恒 0；这是刻意选的方向，不是漏改。
    const scopeWhere = buildBadgeDataScopeWhere(permission, { city: 'city' })
    queries.push({
      key: 'supplySubmissions',
      collection: 'supply-submissions',
      where: combineWhere(
        { status: { equals: 'pending' } },
        ...scopeWhere,
      ),
    })
  }

  if (canReadInformationCorrections(permission)) {
    // 不收窄数据范围：information-corrections 一个可收窄的维度都没有
    // （只有 targetType/targetSlug/category，没有 city、team 或负责人），
    // 硬套 buildBadgeDataScopeWhere 会让所有非 global 角色恒得 0。
    // 这与该集合自己的 access.read 同口径：createCollectionAccess 只校验
    // correction:read，读到即读全量——角标不该比列表页更严，否则角标显示 0、
    // 点进去却满屏待处理。
    queries.push({
      key: 'informationCorrections',
      collection: 'information-corrections',
      // 未关闭 = 新建 + 已分诊；resolved / rejected 是终态，不再计入待处理。
      where: { status: { in: ['new', 'triaged'] } },
    })
  }

  if (canReadCityPartnerApplications(permission)) {
    const scopeWhere = buildCityPartnerCityScopeWhere(permission)
    // false 表示该用户没有城市合伙人的数据范围（如内置 OPS：cityIds 是 'all' 而不是 Set），
    // 此时只跳过这一条角标。这里绝不能 return queries——那会连带吞掉排在后面的所有查询，
    // 而且没有任何报错（曾迫使 OPT-084 把新增角标刻意排在本块之前来绕开）。
    if (scopeWhere !== false) {
      queries.push({
        key: 'cityPartnerApplications',
        collection: 'city-partner-applications',
        where: combineWhere(
          { status: { equals: 'pending' } },
          scopeWhere === true ? null : scopeWhere,
        ),
      })
    }
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

/**
 * 投放申请：菜单码与叶子的 requiredOperationCode 一字不差。
 *
 * 操作码这一层不能省——BRK 恰恰是「没有 supply-submissions 菜单」才读不到房东
 * 手机号与地址（roles fixture 里写明的渠道绕开风险），角标查询若比列表页宽，
 * 就等于从侧门把这批数据的存在性泄漏出去。
 */
function canReadSupplySubmissions(permission: PermissionContext): boolean {
  return (
    hasMenuPermission(permission, 'supply-submissions') &&
    hasOperationPermission(permission, 'supply_submission:read')
  )
}

/**
 * 信息纠错与举报处理共用 reports 菜单码，但各自的操作码不同。
 *
 * 只判菜单会让「有 report:read 没 correction:read」的角色多看到一个它根本
 * 打不开的角标，故与 canReadListingReports 同构地再判一次操作码。
 */
function canReadInformationCorrections(permission: PermissionContext): boolean {
  return (
    hasMenuPermission(permission, 'reports') &&
    hasOperationPermission(permission, 'correction:read')
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

function canReadCityPartnerApplications(permission: PermissionContext): boolean {
  return hasMenuPermission(permission, 'city-partner-applications') &&
    hasOperationPermission(permission, 'city_partner_application:read')
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
