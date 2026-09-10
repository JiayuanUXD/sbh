import { describe, expect, it, vi } from 'vitest'

import type { PermissionContext } from '@/domain/auth/permission-context'
import { CityPartnerApplications } from '@/collections/CityPartnerApplications'
import { buildCityPartnerCityScopeWhere } from '@/domain/city-partner-application/access'
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
  it('为全权限用户构造九个固定统计口径', () => {
    const queries = buildAdminNavigationBadgeQueries(permission(), AS_OF)

    expect(queries.map((query) => query.key)).toEqual([
      'tasks',
      'notifications',
      'listingReviews',
      'listingReports',
      'leads',
      'formSubmissions',
      'supplySubmissions',
      'informationCorrections',
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
    expect(queryByKey(queries, 'supplySubmissions')).toMatchObject({
      collection: 'supply-submissions',
      where: { status: { equals: 'pending' } },
    })
    expect(queryByKey(queries, 'informationCorrections')).toMatchObject({
      collection: 'information-corrections',
      where: { status: { in: ['new', 'triaged'] } },
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

  it('keeps MGR team-scope collection access and badge on the same city-only predicate', async () => {
    const manager = permission({
      roleCodes: ['MGR'],
      cityIds: new Set([11]),
      teamIds: new Set([7]),
      operationPermissions: new Set([
        'city_partner_application:read',
        'city_partner_application:manage',
      ]),
      menuPermissions: new Set(['city-partner-applications']),
      dataScope: 'team',
    })

    const readAccess = CityPartnerApplications.access?.read
    if (typeof readAccess !== 'function') throw new Error('missing city partner read access')
    const collectionScope = await readAccess({
      req: {
        user: {
          id: 42,
          status: 'active',
          sessionVersion: 1,
          cityScope: [{ id: 11 }],
          roles: [{
            id: 70,
            code: 'MGR',
            status: 'active',
            builtin: true,
            operationPermissions: ['city_partner_application:read'],
            menuPermissions: ['city-partner-applications'],
            dataScope: 'team',
          }],
        },
        payload: {},
      },
    } as never)
    expect(collectionScope).toEqual({ city: { in: [11] } })
    expect(queryByKey(
      buildAdminNavigationBadgeQueries(manager, AS_OF),
      'cityPartnerApplications',
    ).where).toEqual({
      and: [
        { status: { equals: 'pending' } },
        collectionScope,
      ],
    })
  })

  it('城市合伙人范围为 false 时只跳过该角标，其余已授权查询一条不少', () => {
    // 内置 OPS 的 cityIds 是 'all' 而不是 Set，buildCityPartnerCityScopeWhere 会返回 false
    //（本地夹具库以 e2e-ops@example.com 登录即命中）。这条守卫钉住的是「false 只跳过这一块」：
    // 若那里写成 return queries，排在城市合伙人之后追加的任何角标都会被静默吞掉且无报错。
    // 以全权限用户的键列表为基准，将来新增角标不必改这里；新块一旦被吞，这里立刻红。
    const helperFalse = permission({
      roleCodes: ['OPS'],
      cityIds: 'all',
      dataScope: 'global',
    })
    expect(buildCityPartnerCityScopeWhere(helperFalse)).toBe(false)

    const everyKey = buildAdminNavigationBadgeQueries(permission(), AS_OF)
      .map((query) => query.key)
    const keys = buildAdminNavigationBadgeQueries(helperFalse, AS_OF)
      .map((query) => query.key)

    expect(everyKey).toContain('cityPartnerApplications')
    expect(keys).not.toContain('cityPartnerApplications')
    expect(keys).toEqual(
      everyKey.filter((key) => key !== 'cityPartnerApplications'),
    )
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

  it('OPS 同时拿到投放申请与信息纠错两条角标，且各自按自己的字段收窄', () => {
    const queries = buildAdminNavigationBadgeQueries(
      permission({
        roleCodes: ['OPS'],
        cityIds: new Set([11, 12]),
        operationPermissions: new Set([
          'supply_submission:read',
          'correction:read',
        ]),
        menuPermissions: new Set(['supply-submissions', 'reports']),
        dataScope: 'city',
      }),
      AS_OF,
    )

    // 投放申请自带 city 关系字段，城市上限能表达 → 合并进 where。
    expect(queryByKey(queries, 'supplySubmissions')).toEqual({
      key: 'supplySubmissions',
      collection: 'supply-submissions',
      where: {
        and: [
          { status: { equals: 'pending' } },
          { city: { in: [11, 12] } },
        ],
      },
    })
    // 信息纠错没有任何地理字段，收窄无从表达；这里刻意不收窄，
    // 与该集合 access.read（只校验 correction:read、不做范围收窄）保持同口径。
    expect(queryByKey(queries, 'informationCorrections')).toEqual({
      key: 'informationCorrections',
      collection: 'information-corrections',
      where: { status: { in: ['new', 'triaged'] } },
    })
  })

  it('OPS：城市合伙人角标因城市范围判为 false 被跳过，其余角标一条都不能少', () => {
    // 与 src/test/factory/roles.ts 里真实的 OPS 同形：dataScope=global、cityIds='all'、
    // 既有 city-partner-applications 菜单也有 city_partner_application:read。
    // buildCityPartnerCityScopeWhere 对「非 ADM 且 cityIds 不是 Set」返回 false，
    // 也就是说这条分支在生产上天天被真实角色走到（不是理论边界）。它一旦写成提前
    // 返回，排在它之后的查询就会被整片吞掉，而且单测全绿、只在线上静默少角标。
    const ops = permission({
      roleCodes: ['OPS'],
      cityIds: 'all',
      teamIds: 'all',
      dataScope: 'global',
      operationPermissions: new Set([
        'task:read',
        'notification:read',
        'listing:review',
        'report:read',
        'supply_submission:read',
        'city_partner_application:read',
      ]),
      menuPermissions: new Set([
        'todos',
        'notifications',
        'listing-reviews',
        'reports',
        'form-submissions',
        'supply-submissions',
        'city-partner-applications',
      ]),
    })

    const queries = buildAdminNavigationBadgeQueries(ops, AS_OF)
    const keys = queries.map((query) => query.key)

    expect(keys).not.toContain('cityPartnerApplications')
    expect(keys).toContain('supplySubmissions')
    // 排序后整体比对：钉的是「该上下文有资格拿到的 key 一个不少」，
    // 与各查询块在源码里的先后顺序无关——按顺序写死的断言挡不住这类回归，
    // 因为搬动块顺序时它本来就会跟着改。OPS 没有 correction:read，
    // 故 informationCorrections 不在其中；没有 leads / my-leads 菜单，故无 leads。
    expect([...keys].sort()).toEqual([
      'formSubmissions',
      'listingReports',
      'listingReviews',
      'notifications',
      'supplySubmissions',
      'tasks',
    ])
    // 顺带把值钉死：global + cityIds='all' 不产生任何收窄片段，只剩业务口径。
    expect(queryByKey(queries, 'supplySubmissions').where).toEqual({
      status: { equals: 'pending' },
    })
  })

  it.each([
    [
      'BRK',
      permission({
        roleCodes: ['BRK'],
        cityIds: new Set([11]),
        teamIds: new Set(),
        operationPermissions: new Set([
          'task:read',
          'notification:read',
          'lead:claim',
        ]),
        menuPermissions: new Set([
          'dashboard',
          'todos',
          'notifications',
          'listings',
          'my-leads',
        ]),
        dataScope: 'self',
      }),
    ],
    [
      'CSR',
      permission({
        roleCodes: ['CSR'],
        operationPermissions: new Set([
          'task:read',
          'notification:read',
          'lead:create',
        ]),
        menuPermissions: new Set([
          'dashboard',
          'todos',
          'notifications',
          'leads',
          'customers',
          'form-submissions',
        ]),
        dataScope: 'global',
      }),
    ],
  ] as const)(
    '%s 拿不到投放申请与信息纠错角标（两个入口都不在其菜单里）',
    (_roleCode, context) => {
      const keys = buildAdminNavigationBadgeQueries(context, AS_OF).map(
        (query) => query.key,
      )

      expect(keys).not.toContain('supplySubmissions')
      expect(keys).not.toContain('informationCorrections')
    },
  )

  it('MGR 只拿到投放申请角标：有 supply_submission:read，但没有 reports 菜单与 correction:read', () => {
    const queries = buildAdminNavigationBadgeQueries(
      permission({
        roleCodes: ['MGR'],
        cityIds: new Set([11]),
        teamIds: new Set([7]),
        operationPermissions: new Set([
          'task:read',
          'supply_submission:read',
        ]),
        menuPermissions: new Set(['supply-submissions', 'leads']),
        dataScope: 'team',
      }),
      AS_OF,
    )
    const keys = queries.map((query) => query.key)

    expect(keys).toContain('supplySubmissions')
    expect(keys).not.toContain('informationCorrections')
    // 团队范围在 supply-submissions 上无字段可表达（该集合只有 city，没有 team），
    // 因此按既有约定 fail-closed 成 no-match，宁可少算也不放大到全平台房东信息。
    expect(queryByKey(queries, 'supplySubmissions').where).toEqual({
      and: [
        { status: { equals: 'pending' } },
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
