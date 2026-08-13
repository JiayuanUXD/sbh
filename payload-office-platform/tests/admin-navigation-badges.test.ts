import { describe, expect, it, vi } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'
import {
  buildAdminNavigationBadgeQueries,
  collectAdminNavigationBadges,
  formatBadgeCount,
  type AdminNavigationBadgeQuery,
} from '@/domain/admin-navigation/navigation-badges'

const AS_OF = new Date('2026-07-28T04:00:00.000Z')

function permission(
  overrides: Partial<PermissionContext> = {},
): PermissionContext {
  return {
    userId: 42,
    roleCodes: ['ADM'],
    cityIds: 'all',
    teamIds: 'all',
    operationPermissions: new Set(['*']),
    fieldPermissions: new Set(['*']),
    menuPermissions: new Set(['*']),
    dataScope: 'global',
    ...overrides,
  }
}

function queryByKey(
  queries: readonly AdminNavigationBadgeQuery[],
  key: AdminNavigationBadgeQuery['key'],
): AdminNavigationBadgeQuery {
  const query = queries.find((candidate) => candidate.key === key)
  if (!query) throw new Error(`missing badge query: ${key}`)
  return query
}

describe('formatBadgeCount', () => {
  it.each([
    [-1, null],
    [0, null],
    [1, '1'],
    [99, '99'],
    [100, '99+'],
  ] as const)('formats %s as %s', (count, expected) => {
    expect(formatBadgeCount(count)).toBe(expected)
  })
})

describe('buildAdminNavigationBadgeQueries / 业务口径', () => {
  it('为全权限用户构造六个固定统计口径', () => {
    const queries = buildAdminNavigationBadgeQueries(permission(), AS_OF)

    expect(queries.map((query) => query.key)).toEqual([
      'tasks',
      'notifications',
      'listingReviews',
      'listingReports',
      'leads',
      'formSubmissions',
      'cityPartnerApplications',
    ])
    expect(queryByKey(queries, 'tasks')).toMatchObject({
      collection: 'tasks',
      where: {
        and: [
          { status: { in: ['pending', 'in_progress'] } },
          { assignee: { equals: 42 } },
        ],
      },
    })
    expect(queryByKey(queries, 'notifications')).toMatchObject({
      collection: 'notifications',
      where: {
        and: [
          { read: { equals: false } },
          { recipient: { equals: 42 } },
        ],
      },
    })
    expect(queryByKey(queries, 'listingReviews')).toMatchObject({
      collection: 'listings',
      where: { reviewStatus: { equals: 'pending' } },
    })
    expect(queryByKey(queries, 'listingReports')).toMatchObject({
      collection: 'listing-reports',
      where: { status: { not_equals: 'closed' } },
    })
    expect(queryByKey(queries, 'leads')).toMatchObject({
      collection: 'leads',
      where: {
        or: [
          { stage: { equals: 'new' } },
          { nextFollowUpAt: { less_than: AS_OF.toISOString() } },
        ],
      },
    })
    expect(queryByKey(queries, 'formSubmissions')).toMatchObject({
      collection: 'form-submissions',
      where: { processingStatus: { equals: 'new' } },
    })
    expect(queryByKey(queries, 'cityPartnerApplications')).toMatchObject({
      collection: 'city-partner-applications',
      where: { status: { equals: 'pending' } },
    })
  })

  it('uses the same operation and city boundary for the city partner badge', () => {
    const queries = buildAdminNavigationBadgeQueries(permission({
      roleCodes: ['OPS'],
      cityIds: new Set([11, 12]),
      operationPermissions: new Set(['city_partner_application:read']),
      menuPermissions: new Set(['city-partner-applications']),
      dataScope: 'city',
    }), AS_OF)

    expect(queryByKey(queries, 'cityPartnerApplications')).toMatchObject({
      collection: 'city-partner-applications',
      where: {
        and: [
          { status: { equals: 'pending' } },
          { city: { in: [11, 12] } },
        ],
      },
    })
  })

  it('把审核、举报和线索的授权城市上限合并进业务 where', () => {
    const queries = buildAdminNavigationBadgeQueries(
      permission({
        roleCodes: ['OPS'],
        cityIds: new Set([11, 12]),
        operationPermissions: new Set([
          'listing:review',
          'report:read',
        ]),
        menuPermissions: new Set([
          'listing-reviews',
          'reports',
          'leads',
        ]),
        dataScope: 'city',
      }),
      AS_OF,
    )

    expect(queryByKey(queries, 'listingReviews').where).toEqual({
      and: [
        { reviewStatus: { equals: 'pending' } },
        { 'building.city': { in: [11, 12] } },
      ],
    })
    expect(queryByKey(queries, 'listingReports').where).toEqual({
      and: [
        { status: { not_equals: 'closed' } },
        { 'targetListing.building.city': { in: [11, 12] } },
      ],
    })
    expect(queryByKey(queries, 'leads').where).toEqual({
      and: [
        {
          or: [
            { stage: { equals: 'new' } },
            { nextFollowUpAt: { less_than: AS_OF.toISOString() } },
          ],
        },
        { city: { in: [11, 12] } },
      ],
    })
  })

  it('把团队和城市上限同时合并进线索 where', () => {
    const queries = buildAdminNavigationBadgeQueries(
      permission({
        roleCodes: ['MGR'],
        cityIds: new Set([11]),
        teamIds: new Set([7, 8]),
        operationPermissions: new Set(),
        menuPermissions: new Set(['leads']),
        dataScope: 'team',
      }),
      AS_OF,
    )

    expect(queryByKey(queries, 'leads').where).toEqual({
      and: [
        {
          or: [
            { stage: { equals: 'new' } },
            { nextFollowUpAt: { less_than: AS_OF.toISOString() } },
          ],
        },
        { city: { in: [11] } },
        { team: { in: [7, 8] } },
      ],
    })
  })

  it('本人范围按 owner.user 关联账号且仍受城市上限约束', () => {
    const queries = buildAdminNavigationBadgeQueries(
      permission({
        roleCodes: ['BRK'],
        cityIds: new Set([11]),
        teamIds: new Set(),
        operationPermissions: new Set(),
        menuPermissions: new Set(['my-leads']),
        dataScope: 'self',
      }),
      AS_OF,
    )

    expect(queryByKey(queries, 'leads').where).toEqual({
      and: [
        {
          or: [
            { stage: { equals: 'new' } },
            { nextFollowUpAt: { less_than: AS_OF.toISOString() } },
          ],
        },
        { city: { in: [11] } },
        { 'owner.user': { equals: 42 } },
      ],
    })
  })

  it('缺少可表达字段的受限表单范围使用 no-match，绝不退化为全量', () => {
    const queries = buildAdminNavigationBadgeQueries(
      permission({
        cityIds: new Set([11]),
        menuPermissions: new Set(['form-submissions']),
        operationPermissions: new Set(),
        dataScope: 'city',
      }),
      AS_OF,
    )

    expect(queryByKey(queries, 'formSubmissions').where).toEqual({
      and: [
        { processingStatus: { equals: 'new' } },
        { id: { exists: false } },
      ],
    })
  })
})

describe('collectAdminNavigationBadges / 权限与失败隔离', () => {
  it('未授权 badge key 不调用 count', async () => {
    const count = vi.fn<
      (query: AdminNavigationBadgeQuery) => Promise<number>
    >(async () => 3)
    const badges = await collectAdminNavigationBadges({
      permission: permission({
        roleCodes: ['BRK'],
        operationPermissions: new Set(['task:read']),
        menuPermissions: new Set(['todos']),
        dataScope: 'self',
      }),
      asOf: AS_OF,
      count,
    })

    expect(badges).toEqual({ tasks: 3 })
    expect(count).toHaveBeenCalledTimes(1)
    expect(count.mock.calls[0][0].key).toBe('tasks')
  })

  it('单项统计失败时省略该 key，记录错误并保留其他结果', async () => {
    const onError = vi.fn()
    const badges = await collectAdminNavigationBadges({
      permission: permission({
        operationPermissions: new Set(['task:read', 'notification:read']),
        menuPermissions: new Set(['todos', 'notifications']),
      }),
      asOf: AS_OF,
      count: async (query) => {
        if (query.key === 'notifications') throw new Error('database unavailable')
        return 5
      },
      onError,
    })

    expect(badges).toEqual({ tasks: 5 })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      'notifications',
      expect.objectContaining({ message: 'database unavailable' }),
    )
  })

  it('错误日志回调自身失败也不影响其他 badge', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const badges = await collectAdminNavigationBadges({
        permission: permission({
          operationPermissions: new Set(['task:read', 'notification:read']),
          menuPermissions: new Set(['todos', 'notifications']),
        }),
        asOf: AS_OF,
        count: async (query) => {
          if (query.key === 'notifications') throw new Error('count failed')
          return 7
        },
        onError: () => {
          throw new Error('logger failed')
        },
      })

      expect(badges).toEqual({ tasks: 7 })
      expect(consoleError).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})
