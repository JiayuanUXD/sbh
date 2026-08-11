import { redirect } from 'next/navigation'

import type { PayloadRequest } from 'payload'

import { buildPermissionContext, hasMenuPermission } from '@/domain/auth/permission-context'

/**
 * 地理自定义 admin 视图的准入守卫（审核修复 P1-1）
 *
 * 为什么不能只判 `req.user`：
 *  1. Payload 3.86 的 `isCustomAdminView` 把所有自定义视图当公共路由，跳过 `/admin`
 *     的登录重定向 → 不判 user 就是匿名可读（Task 6 已修）。
 *  2. 自定义视图同样不经 collection access 与导航解析，`navigation-config.ts` 的
 *     menuCodes 只决定**入口是否显示**。只判登录的话，任何登录账号（例如仅有线索
 *     权限的经纪人）直接敲 `/admin/geography/districts` 即可进入，`/new` 甚至能创建
 *     行政区——写侧越权。故此处按模块 menuCodes 做真正的准入判定。
 *
 * 语义与 `resolve-navigation.ts` 的叶子过滤一致：menuCodes 任一命中即放行。
 *
 * 未登录 / 账号停用 → `redirect()` 到登录页（带回跳）。已登录但权限不足 → 返回
 * false，由调用方 `return <GeographyForbidden />`（不抛异常，避免与 Next 的
 * NEXT_REDIRECT 控制流互相干扰）。
 */
export async function requireGeographyAccess(
  req: PayloadRequest,
  menuCodes: readonly string[],
): Promise<boolean> {
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

  return menuCodes.some((code) => hasMenuPermission(permission, code))
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

/** 权限不足的统一提示（不暴露该模块是否有数据） */
export function GeographyForbidden() {
  return (
    <div style={{ padding: 24 }}>
      <h3 style={{ margin: '0 0 8px' }}>无权访问</h3>
      <p style={{ margin: 0, color: 'var(--theme-elevation-600)' }}>
        当前账号没有该模块的菜单权限，请联系管理员在「角色管理」中开通。
      </p>
    </div>
  )
}
