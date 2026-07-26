import type { Endpoint, PayloadRequest } from 'payload'

import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import {
  deriveRoleDashboardType,
  resolveRoleDashboard,
  type DashboardBaseContext,
} from '@/domain/analytics/role-dashboard'
import type { MetricPayloadPort } from '@/domain/analytics/metric-types'

/**
 * 角色化工作台 endpoint（tasks.md M7.2 / design.md §7.2 / R1, R7）
 *
 * 路由（注册在 payload.config.ts endpoints，HTTP 前缀 /api）：
 *   - GET /dashboard   返回当前用户的角色化工作台
 *
 * 业务不变量：
 *   - 不同角色只看到授权指标和范围（registry.resolve 内部校验权限）
 *   - URL 参数不能扩大数据范围（每张卡按自身 metric.allowedScopeDims 重新 sanitize）
 *   - 单卡失败不影响其他组件（status=failed 标记，不阻断整体响应）
 *   - 所有卡片共用同一 asOf（生成时刻）
 *
 * 响应：
 *   - 200: { ok: true, role: RoleDashboardType | null, cards: DashboardCardResult[], asOf: string }
 *   - 401: 未登录或会话失效
 *
 * 查询参数（不可信，服务端按 metric 收窄）：
 *   - cityIds: number[] | string[]
 *   - teamIds: number[] | string[]
 *   - merchantIds: number[] | string[]
 *   - assigneeId: number | string
 *   - rangeStart: ISO date string
 *   - rangeEnd: ISO date string
 */

/**
 * 将 Payload Local API 包装为 MetricPayloadPort。
 *
 * 与 my-tasks-endpoint 的 PayloadTaskStore 类似，但只暴露 count / find。
 */
function createPayloadMetricPort(req: PayloadRequest): MetricPayloadPort {
  return {
    async count({ collection, where, overrideAccess }) {
      // collection 是动态字符串（来自 metric 定义），用 as 断言绕过 CollectionSlug 校验
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
 * 创建工作台 endpoint。
 *
 * 用法（在 payload.config.ts endpoints 数组）：
 *   ```ts
 *   endpoints: [createDashboardEndpoint()]
 *   ```
 */
export function createDashboardEndpoint(): Endpoint {
  return {
    path: '/dashboard',
    method: 'get',
    handler: async (req) => {
      // 鉴权：任意已登录用户（角色派生在领域层完成）
      let permission
      try {
        permission = await requireAdminContext(req as RequestContext)
      } catch (err) {
        const message = err instanceof Error ? err.message : '未登录'
        return Response.json({ ok: false, error: message }, { status: 401 })
      }

      // 解析客户端过滤输入（按 metric 收窄）
      const url = req.url
      const input = parseFilterInput(url)

      // 构造基础上下文（asOf = 当前时刻，所有卡共用）
      const base: DashboardBaseContext = {
        asOf: new Date(),
        permission,
        payload: createPayloadMetricPort(req),
        input,
      }

      // 派生角色工作台类型
      const type = deriveRoleDashboardType(permission)

      // 解析工作台（单卡失败局部标记）
      const result = await resolveRoleDashboard(type, base)

      return Response.json({
        ok: true,
        role: result.type,
        cards: result.cards,
        asOf: result.asOf,
      })
    },
  }
}
