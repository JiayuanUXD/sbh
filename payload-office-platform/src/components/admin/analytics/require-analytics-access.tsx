import { redirect } from 'next/navigation'

import type { ReactElement } from 'react'
import type { AdminViewServerProps, PayloadRequest } from 'payload'

import { buildPermissionContext } from '@/domain/auth/permission-context'
import { canViewOverviewDashboard } from '@/domain/analytics/overview-dashboard'

/**
 * 数据看板自定义 admin 视图的准入守卫（OPT-065）。
 *
 * 结构照抄 `require-import-access.tsx`——**这不是偷懒，是刻意统一**：
 * Payload 3.86 把自定义视图当公共路由处理，既不做登录重定向、也不经导航的
 * menuCode 过滤，每个自定义视图都必须自己判一遍。判法不一致才是风险。
 *
 * ## 判据为什么是 canViewOverviewDashboard，而不是菜单码 `analytics`
 *
 * 菜单码只决定**导航项可见性**（`navigation-config.ts` 那一层）。页面准入必须与
 * 数据源的判据同源——`/api/overview` 自己就是用 `canViewOverviewDashboard` 拦 403 的。
 * 若这里改用 `hasMenuPermission(permission, 'analytics')`，就会出现两种错位：
 *   - 有菜单码但无任何指标权限 → 进得来，然后满页 403，白跑一趟；
 *   - 有指标权限但角色没勾菜单码 → 直访被挡，而 API 明明会给数据。
 * 两边同源，页面能进＝API 有数据。
 *
 * OPT-066 加流量块后，判据要放宽成
 * `canViewOverviewDashboard(...) || hasOperationPermission(..., 'analytics:traffic')`
 * ——那个操作码现在还没注册，故本期不提前引用。
 *
 * 用法：
 * ```tsx
 * const denied = await requireAnalyticsAccess(props)
 * if (denied) return denied
 * ```
 */
export async function requireAnalyticsAccess(
  props: AdminViewServerProps,
): Promise<ReactElement | null> {
  const req = props.initPageResult.req

  if (!req.user) redirectToLogin(req)

  const permission = await buildPermissionContext({
    user: req.user as Parameters<typeof buildPermissionContext>[0]['user'],
    loadRoles: async (roleIds) => {
      const roles = await req.payload.find({
        collection: 'roles',
        depth: 0,
        limit: roleIds.length,
        overrideAccess: true,
        where: { id: { in: roleIds } },
      })
      return roles.docs
    },
  })

  // buildPermissionContext 对停用账号返回 null（status !== 'active'）
  if (!permission) redirectToLogin(req)

  return canViewOverviewDashboard(permission) ? null : <AnalyticsForbidden />
}

/** 未登录 → 重定向登录页（带当前路径回跳）。`redirect()` 内部抛出，故返回 never。 */
function redirectToLogin(req: PayloadRequest): never {
  const { payload } = req
  const adminRoute = payload.config.routes.admin
  const loginRoute = payload.config.admin.routes.login
  const current = req.pathname ?? ''
  const qs = req.searchParams.toString()
  const target = `${adminRoute}${loginRoute}?redirect=${encodeURIComponent(
    qs ? `${current}?${qs}` : current,
  )}`
  redirect(target)
}

/** 权限不足的统一提示（不暴露有多少数据） */
export function AnalyticsForbidden() {
  return (
    <div style={{ padding: 24 }} data-testid="analytics-forbidden">
      <h3 style={{ margin: '0 0 8px' }}>无权访问</h3>
      <p style={{ margin: 0, color: 'var(--theme-elevation-600)' }}>
        当前账号没有数据看板的指标查看权限，请联系管理员在「角色管理」中开通。
      </p>
    </div>
  )
}
