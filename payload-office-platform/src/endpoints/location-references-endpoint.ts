import type { Endpoint } from 'payload'

import { countLocationReferences } from '@/domain/geography/location-references'

/**
 * 地理节点引用数量 endpoint（tasks.md M2.2 / PRD L99「查看引用」）
 *
 * GET /api/locations/:id/references
 *
 * 响应：
 *   - 200: { ok: true, report: { locationId, sources[], total, referenced } }
 *   - 400: 缺少 id
 *   - 401: 未登录
 *
 * 安全：
 *   - 必须登录（引用统计属后台维护能力）
 *   - 计数以 overrideAccess: false 继承当前用户数据权限（PRD L73 脱敏口径）
 */
export function createLocationReferencesEndpoint(): Endpoint {
  return {
    path: '/locations/:id/references',
    method: 'get',
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ ok: false, error: '未登录' }, { status: 401 })
      }

      // Payload 3.86 路由参数在 req.routeParams（见 role-copy-endpoint 注释）
      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const id =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (id === undefined || id === '') {
        return Response.json({ ok: false, error: '缺少区域节点 ID' }, { status: 400 })
      }

      const report = await countLocationReferences(req.payload, id, req)
      return Response.json({ ok: true, report })
    },
  }
}
