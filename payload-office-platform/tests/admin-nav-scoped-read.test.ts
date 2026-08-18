/**
 * 后台导航：collection read 权限「收窄形态」的处理。
 *
 * 真实事故（2026-08-18 线上）：「审核队列」在侧边栏消失，但 URL 直达能打开、列表
 * 也查得出数据。根因是导航把 Payload 的两种 read 形态只认了一种：
 *
 *   read: true                                    → 无条件可读
 *   read: { permission: true, where: {...} }      → 可读，结果被 where 收窄
 *
 * 判 `read === true` 时，第二种被当成「没权限」，入口被静默吞掉。带城市范围的账号
 * （`ListingReviews.read` 返回 `buildReviewCityScopeWhere(...) ?? true`）必然中招。
 *
 * 守护不变量：
 *   - 收窄形态 = 可读，入口必须显示
 *   - { permission: false } 是拒绝，不能因为「是个对象」就放行
 *   - 端到端：城市范围账号解析导航时，审核队列在结果里
 */

import { describe, expect, it } from 'vitest'

import { canReadCollection } from '@/domain/admin-navigation/collection-read-access'
import { resolveAdminNavigation } from '@/domain/admin-navigation/resolve-navigation'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { PermissionContext } from '@/domain/auth/permission-context'

function permissions(read: unknown) {
  return { collections: { 'listing-reviews': { read } } } as never
}

describe('collection-read-access/两种 read 形态', () => {
  it('read: true → 可读', () => {
    expect(canReadCollection(permissions(true), 'listing-reviews')).toBe(true)
  })

  it('read: { permission: true, where } → 可读（回归：曾被误判为无权限）', () => {
    const scoped = permissions({
      permission: true,
      where: { 'listing.building.city': { in: [1] } },
    })
    expect(canReadCollection(scoped, 'listing-reviews')).toBe(true)
  })

  it('read: { permission: false } → 不可读（不能因为是对象就放行）', () => {
    expect(canReadCollection(permissions({ permission: false }), 'listing-reviews')).toBe(false)
  })

  it('read: false / 缺失 / permissions 未定义 → 不可读（fail-closed）', () => {
    expect(canReadCollection(permissions(false), 'listing-reviews')).toBe(false)
    expect(canReadCollection(permissions(undefined), 'listing-reviews')).toBe(false)
    expect(canReadCollection(undefined, 'listing-reviews')).toBe(false)
    expect(canReadCollection(permissions(true), 'not-a-collection')).toBe(false)
  })

  it('对象里没有 permission 键 → 不可读（不猜意图）', () => {
    expect(canReadCollection(permissions({ where: {} }), 'listing-reviews')).toBe(false)
  })
})

describe('resolve-navigation/城市范围账号看得到审核队列', () => {
  const ctx: PermissionContext = {
    userId: 1,
    roleCodes: ['ADM'],
    cityIds: new Set([1]),
    teamIds: new Set(),
    operationPermissions: new Set(['*']),
    fieldPermissions: new Set(['*']),
    menuPermissions: new Set(['*']),
    dataScope: 'global',
  }

  function reviewQueueVisible(canRead: (slug: string) => boolean): boolean {
    const groups = resolveAdminNavigation({
      groups: ADMIN_NAV_GROUPS,
      permission: ctx,
      canReadCollection: canRead,
    })

    return groups
      .flatMap((g) => g.children)
      .flatMap((child) => ('children' in child ? child.children : [child]))
      .some((leaf) => leaf.id === 'listing-reviews')
  }

  it('read 为收窄形态时入口仍在（端到端复现线上故障）', () => {
    const scoped = permissions({
      permission: true,
      where: { 'listing.building.city': { in: [1] } },
    })
    expect(reviewQueueVisible((slug) => canReadCollection(scoped, slug))).toBe(true)
  })

  it('真的不可读时入口才消失（确认这不是无条件显示）', () => {
    expect(reviewQueueVisible(() => false)).toBe(false)
  })
})
