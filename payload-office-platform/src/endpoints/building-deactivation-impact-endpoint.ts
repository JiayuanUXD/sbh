import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { countBuildingDeactivationImpact } from '@/domain/supply/building-references'

/**
 * 楼盘停用影响预检 endpoint（tasks.md M3.5 / R3, R4, R8）
 *
 * GET /api/buildings/:id/deactivation-impact
 *   :id = 拟停用的楼盘
 *
 * 语义：停用是人为决策，本端点只做「停用前展示受影响房源数量并二次确认」的预检，
 * 绝不阻断停用，也不改写任何 Listing 的审核 / 发布状态（design §9/§10, R3）。
 * 计数口径 = 该楼盘下当前对外可见的房源数——走 M4.7 统一有效供给口径（查询层
 * getEffectiveSupplyWhere + §5 举报暂停排除,取候选后逐条精筛媒体/关系/商户),
 * 即用户此刻能看到、停用后将看不到的部分。计数随调用者数据权限脱敏（overrideAccess 默认 false）。
 *
 * 响应：
 *   - 200: { ok: true, report: { buildingId, sources, total, referenced } }
 *   - 400: 缺少楼盘 ID
 *   - 401: 未登录
 *   - 403: 无 building:freeze 权限
 *
 * 安全：
 *   - 必须登录且具备 building:freeze 操作权限（停用/预检同属「冻结」语义,
 *     与 toggle-operational-status endpoint 门禁一致,消除权限口径分裂）
 */
export function createBuildingDeactivationImpactEndpoint(): Endpoint {
  return {
    // 注册在 Buildings collection 的 endpoints 上 → 实际 HTTP 路径 /api/buildings/:id/deactivation-impact。
    // Payload 匹配前会先剥掉 /{slug}，故此处 path 用去 slug 前缀的相对路径。
    path: '/:id/deactivation-impact',
    method: 'get',
    handler: async (req) => {
      // 1. 鉴权：停用/预检同属「冻结」语义，要求 building:freeze
      //    （与 toggle-operational-status endpoint 门禁一致）
      try {
        await requireOperationPermission(req as RequestContext, 'building:freeze')
      } catch (err) {
        const message = err instanceof Error ? err.message : '权限不足'
        const status = message.includes('未登录') ? 401 : 403
        return Response.json({ ok: false, error: message }, { status })
      }

      // 2. 楼盘 ID：Payload 3.86 路由参数在 req.routeParams
      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const buildingId =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (buildingId === undefined || buildingId === '') {
        return Response.json({ ok: false, error: '缺少楼盘 ID' }, { status: 400 })
      }

      // 3. 领域服务统计受影响房源（只读预检，不阻断、不改状态）
      const report = await countBuildingDeactivationImpact(req.payload, buildingId, req)
      return Response.json({ ok: true, report })
    },
  }
}
