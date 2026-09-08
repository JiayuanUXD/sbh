import type { Endpoint } from 'payload'

import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import { hasMenuPermission } from '@/domain/auth/permission-context'
import { GEOGRAPHY_MENU_CODES } from '@/domain/geography/geography-menu-codes'
import { loadAdministrativeNodes } from '@/domain/geography/location-tree-source'

/**
 * 级联选择数据源 endpoint（OPT-074）
 *
 * GET /api/locations/tree
 *
 * 响应：
 *   - 200: { ok: true, nodes: FlatLocationNode[] }  行政链摊平节点，客户端用
 *          location-tree.ts 的 buildChildrenIndex 自行组装成森林
 *   - 401: 未登录
 *   - 403: 已登录但无地理模块菜单权限
 *
 * 一次返回整条行政链（生产实测 378 节点 / 约 40KB），组件侧缓存，
 * 跨层搜索与逐级收窄都在客户端完成，不再逐级发请求。
 *
 * 安全口径与 location-search-endpoint 完全一致：
 *   - 必须登录
 *   - 需 `locations` 或 `business-areas` 菜单权限之一（否则任意后台账号可跨模块检索地理数据）
 *   - 查询以 overrideAccess:false 继承当前用户数据权限
 */

export function createLocationTreeEndpoint(): Endpoint {
  return {
    // 注册在 Locations collection 的 endpoints 上 → 实际 HTTP 路径 /api/locations/tree。
    // Payload 匹配前会先剥掉 /{slug}，故此处 path 用去 slug 前缀的相对路径。
    // 放顶层 config.endpoints 会被 slug 路由遮蔽 → 404。
    path: '/tree',
    method: 'get',
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      let permission
      try {
        permission = await requireAdminContext(req as RequestContext)
      } catch {
        return Response.json({ ok: false, error: '未登录或会话已失效' }, { status: 401 })
      }
      if (!GEOGRAPHY_MENU_CODES.some((code) => hasMenuPermission(permission, code))) {
        return Response.json({ ok: false, error: '无权检索地理数据' }, { status: 403 })
      }

      const nodes = await loadAdministrativeNodes(req.payload, req)
      return Response.json({ ok: true, nodes })
    },
  }
}
