import { redirect } from 'next/navigation'

import type { ReactElement } from 'react'
import type { AdminViewServerProps, PayloadRequest } from 'payload'

import { buildPermissionContext, hasOperationPermission } from '@/domain/auth/permission-context'

/**
 * 批量导入自定义 admin 视图的准入守卫（照抄
 * `src/components/admin/geography/require-geography-access.tsx` 的结构）。
 *
 * 与地理模块同理：Payload 3.86 把自定义视图当公共路由处理，既不做登录重定向，
 * 也不经导航的 menuCode 过滤——必须在视图内显式判定，否则任意登录账号敲 URL
 * 就能直接进入批量导入页（execute 阶段会真的写 buildings / listings 表）。
 *
 * 权限码用 `data:import`——这是 **操作权限**，不是菜单权限，与
 * `bulk-import-endpoint.ts` 的 `guardImport`（`requireOperationPermission(req, 'data:import')`）
 * 判据保持一致。用 `hasMenuPermission` 判它会恒为 false（`data:import` 根本没注册在
 * MENU_CODES 里），那样会把所有非通配符角色都挡在外面。
 *
 * 未登录 → `redirect()` 到登录页（带回跳）。已登录但无 `data:import` → 返回
 * `<ImportForbidden />`（不重定向，避免让运营误以为页面不存在）。
 *
 * 返回值设计为「非空即拒绝」的 ReactElement | null，供调用方：
 * ```tsx
 * const denied = await requireImportAccess(props)
 * if (denied) return denied
 * ```
 */
export async function requireImportAccess(
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

  return hasOperationPermission(permission, 'data:import') ? null : <ImportForbidden />
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
export function ImportForbidden() {
  return (
    <div style={{ padding: 24 }}>
      <h3 style={{ margin: '0 0 8px' }}>无权访问</h3>
      <p style={{ margin: 0, color: 'var(--theme-elevation-600)' }}>
        当前账号没有批量导入权限，请联系管理员在「角色管理」中开通 data:import。
      </p>
    </div>
  )
}
