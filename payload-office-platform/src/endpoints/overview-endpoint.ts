import type { Endpoint, PayloadRequest } from 'payload'

import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import {
  canViewOverviewDashboard,
  resolveOverviewDashboard,
  type DashboardBaseContext,
} from '@/domain/analytics/overview-dashboard'
import type { MetricPayloadPort } from '@/domain/analytics/metric-types'

/**
 * 经营概览 endpoint（tasks.md M7.3 / design.md §7.3 / R7）
 *
 * 路由（注册在 payload.config.ts endpoints，HTTP 前缀 /api）：
 *   - GET /overview   返回经营概览（卡 / 趋势 / 分布 + 数据截至时间）
 *
 * 业务不变量：
 *   - 不同角色只看到授权指标和范围（registry.resolve 内部校验权限）
 *   - URL 参数不能扩大数据范围（每张卡按自身 metric.allowedScopeDims 重新 sanitize）
 *   - 单卡失败局部标记（status=failed/no-permission/not-found），不影响其他卡 / 组
 *   - 所有卡 / 趋势 / 分布共用同一 asOf（生成时刻）
 *
 * 响应：
 *   - 200: { ok: true, cards, trends, distributions, asOf }
 *   - 401: 未登录或会话失效
 *   - 403: 无任何经营概览指标查看权限
 *
 * 查询参数（不可信，服务端按 metric 收窄）：
 *   - cityIds / teamIds / merchantIds / assigneeId / rangeStart / rangeEnd
 *   - 与 /dashboard 一致，由 sanitizeFilters 按 metric.allowedScopeDims 收窄
 */

/**
 * 将 Payload Local API 包装为 MetricPayloadPort。
 *
 * 与 dashboard-endpoint 同构；保留独立导出便于后续看板扩展（如 cache 注入）。
 */
function createPayloadMetricPort(req: PayloadRequest): MetricPayloadPort {
  return {
    async count({ collection, where, overrideAccess }) {
      const result = (await req.payload.count({
        collection: collection as never,
        where: where as never,
        overrideAccess: overrideAccess ?? true,
        req,
      })) as unknown as { totalDocs?: number }
      const total = result.totalDocs
      return typeof total === 'number' ? total : 0
    },
    async find({ collection, where, depth, limit, page, sort, overrideAccess }) {
      const result = (await req.payload.find({
        collection: collection as never,
        where: where as never,
        depth: depth ?? 0,
        limit: limit ?? 25,
        page: page ?? 1,
        sort: sort ?? undefined,
        overrideAccess: overrideAccess ?? true,
        req,
      })) as unknown as {
        docs?: ReadonlyArray<Record<string, unknown>>
        totalDocs?: number
        totalPages?: number
        page?: number
      }
      return {
        docs: (result.docs ?? []) as ReadonlyArray<Record<string, unknown>>,
        totalDocs: result.totalDocs ?? 0,
        totalPages: result.totalPages ?? 1,
        page: result.page ?? 1,
      }
    },
  }
}

/** 解析 URL 查询参数为 MetricFilterInput（不可信，由 sanitizeFilters 收窄）。 */
function parseFilterInput(
  url: string | undefined,
): import('@/domain/analytics/metric-types').MetricFilterInput {
  if (!url) return {}
  const sp = new URL(url, 'http://localhost').searchParams

  const cityIds = sp.getAll('cityIds')
  const teamIds = sp.getAll('teamIds')
  const merchantIds = sp.getAll('merchantIds')
  const assigneeRaw = sp.get('assigneeId')
  const rangeStart = sp.get('rangeStart') ?? undefined
  const rangeEnd = sp.get('rangeEnd') ?? undefined

  return {
    cityIds: cityIds.length > 0 ? cityIds : undefined,
    teamIds: teamIds.length > 0 ? teamIds : undefined,
    merchantIds: merchantIds.length > 0 ? merchantIds : undefined,
    assigneeId: assigneeRaw ?? null,
    rangeStart,
    rangeEnd,
  }
}

/**
 * 创建经营概览 endpoint。
 *
 * 用法（在 payload.config.ts endpoints 数组）：
 *   ```ts
 *   endpoints: [createDashboardEndpoint(), createOverviewEndpoint()]
 *   ```
 */
export function createOverviewEndpoint(): Endpoint {
  return {
    path: '/overview',
    method: 'get',
    handler: async (req) => {
      // 鉴权：任意已登录用户
      let permission
      try {
        permission = await requireAdminContext(req as RequestContext)
      } catch (err) {
        const message = err instanceof Error ? err.message : '未登录'
        return Response.json({ ok: false, error: message }, { status: 401 })
      }

      // 提前拦截：无任何经营概览指标权限 → 403
      if (!canViewOverviewDashboard(permission)) {
        return Response.json(
          { ok: false, error: '无经营概览查看权限' },
          { status: 403 },
        )
      }

      // 解析客户端过滤输入（按 metric 收窄）
      const url = req.url
      const input = parseFilterInput(url)

      // 构造基础上下文（asOf = 当前时刻，所有卡 / 趋势 / 分布共用）
      const base: DashboardBaseContext = {
        asOf: new Date(),
        permission,
        payload: createPayloadMetricPort(req),
        input,
      }

      // 解析经营概览（单卡失败局部标记，组间并发）
      const result = await resolveOverviewDashboard(base)

      return Response.json({
        ok: true,
        cards: result.cards,
        trends: result.trends,
        distributions: result.distributions,
        asOf: result.asOf,
      })
    },
  }
}
