import type { Endpoint } from 'payload'

import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import { hasMenuPermission } from '@/domain/auth/permission-context'
import { searchLocations } from '@/domain/geography/location-search'

/**
 * 地理节点全局搜索 endpoint（Task 13）
 *
 * GET /api/locations/search?q=<keyword>&limit=20
 *
 * 响应：
 *   - 200: { ok: true, results: [{ id, name, type, cityId, cityName, parentName }] }
 *   - 401: 未登录
 *   - 403: 已登录但无地理模块菜单权限
 *
 * 安全：
 *   - 必须登录（后台搜索）
 *   - 与四个地理模块同权：需 `locations` 或 `business-areas` 菜单权限之一
 *     （审核修复 P1-1：只判登录会让任意后台账号跨模块检索地理数据）
 *   - 查询以 overrideAccess:false 继承当前用户数据权限（PRD 脱敏口径）
 *   - q 去空格后 <2 直接返回空数组，不打库
 */

/** 与 navigation-config.ts 的地理叶子一致；任一命中即放行。 */
const GEOGRAPHY_MENU_CODES = ['locations', 'business-areas'] as const

export function createLocationSearchEndpoint(): Endpoint {
  return {
    // 注册在 Locations collection 的 endpoints 上 → 实际 HTTP 路径 /api/locations/search。
    // Payload 匹配前会先剥掉 /{slug}，故此处 path 用去 slug 前缀的相对路径。
    path: '/search',
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

      const query = (req.query ?? {}) as Record<string, unknown>
      const q = typeof query.q === 'string' ? query.q.trim() : ''

      let limit = 20
      if (typeof query.limit === 'string' && query.limit !== '') {
        const n = Number(query.limit)
        if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), 50)
      }

      const results = await searchLocations(req.payload, q, limit, req)
      return Response.json({ ok: true, results })
    },
  }
}