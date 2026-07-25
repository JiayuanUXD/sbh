import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { mergeBuildings, type MergeErrorCode } from '@/domain/supply/building-dedup-service'

/**
 * 楼盘合并 endpoint（tasks.md M3.2 / R3, R8）
 *
 * POST /api/buildings/:id/merge
 *   :id       = 源楼盘（被合并、迁出关联后软删除）
 *   body      = { "targetId": <保留不可变 ID 的目标楼盘> }
 *
 * 语义：合并是人为决策（查重端点只给候选，不阻断保存）。目标楼盘保留不可变 ID，
 * 接收源的全部供给关系 / 房源外键;源楼盘软删除（deletedAt，非物理删除，R8）。
 * 迁移与软删在同一请求事务内（透传 req），任一步失败整体回滚。
 *
 * 响应：
 *   - 200: { ok: true, report: { sourceId, targetId, migratedRelations, migratedListings } }
 *   - 400: 缺少源/目标 ID，或源=目标（INVALID_MERGE）
 *   - 401: 未登录
 *   - 403: 无 building:delete 权限
 *   - 404: 源或目标楼盘不存在（NOT_FOUND）
 *   - 409: 合并会导致目标供给关系有效期重叠（RELATION_OVERLAP）
 *
 * 安全：
 *   - 必须登录且具备 building:delete 操作权限（合并含源楼盘删除语义）
 */
export function createBuildingMergeEndpoint(): Endpoint {
  return {
    // 注册在 Buildings collection 的 endpoints 上 → 实际 HTTP 路径 /api/buildings/:id/merge。
    // Payload 匹配前会先剥掉 /{slug}，故此处 path 用去 slug 前缀的相对路径。
    path: '/:id/merge',
    method: 'post',
    handler: async (req) => {
      // 1. 鉴权：必须具备 building:delete 权限（合并会软删源楼盘）
      try {
        await requireOperationPermission(req as RequestContext, 'building:delete')
      } catch (err) {
        const message = err instanceof Error ? err.message : '权限不足'
        const status = message.includes('未登录') ? 401 : 403
        return Response.json({ ok: false, error: message }, { status })
      }

      // 2. 源楼盘 ID：Payload 3.86 路由参数在 req.routeParams
      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const sourceId =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (sourceId === undefined || sourceId === '') {
        return Response.json({ ok: false, error: '缺少源楼盘 ID' }, { status: 400 })
      }

      // 3. 目标楼盘 ID（请求体）
      const body = await parseBody(req)
      const rawTarget = body.targetId
      const targetId =
        typeof rawTarget === 'string' || typeof rawTarget === 'number'
          ? rawTarget
          : undefined
      if (targetId === undefined || targetId === '') {
        return Response.json(
          { ok: false, error: '缺少目标楼盘 ID（targetId）' },
          { status: 400 },
        )
      }

      // 4. 调用领域服务（同一请求事务内迁移 + 软删）
      const result = await mergeBuildings(req.payload, { sourceId, targetId }, req)
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error, code: result.code },
          { status: mergeErrorStatus(result.code) },
        )
      }

      return Response.json({ ok: true, report: result.report })
    },
  }
}

/** 合并错误码 → HTTP 状态：无效入参 400 / 不存在 404 / 重叠冲突 409。 */
function mergeErrorStatus(code: MergeErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'RELATION_OVERLAP':
      return 409
    case 'INVALID_MERGE':
    default:
      return 400
  }
}

async function parseBody(
  req: import('payload').PayloadRequest,
): Promise<{ targetId?: unknown }> {
  try {
    if (req.json && typeof req.json === 'function') {
      return await req.json()
    }
    if (req.body) {
      return req.body as { targetId?: unknown }
    }
  } catch {
    // 忽略解析失败
  }
  return {}
}
