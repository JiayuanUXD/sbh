import type { Endpoint } from 'payload'

import { searchLocations } from '@/domain/geography/location-search'

/**
 * 地理节点全局搜索 endpoint（Task 13）
 *
 * GET /api/locations/search?q=<keyword>&limit=20
 *
 * 响应：
 *   - 200: { ok: true, results: [{ id, name, type, cityId, cityName, parentName }] }
 *   - 401: 未登录
 *
 * 安全：
 *   - 必须登录（后台搜索）
 *   - 查询以 overrideAccess:false 继承当前用户数据权限（PRD 脱敏口径）
 *   - q 去空格后 <2 直接返回空数组，不打库
 */
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