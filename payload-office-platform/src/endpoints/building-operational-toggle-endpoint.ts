import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { isBuildingOperationalStatus, type BuildingOperationalStatus } from '@/domain/supply/building'

/**
 * 楼盘启停 endpoint（tasks.md M3.4「完成……启停……动作」/ R3, M3 验收门第 3 条, R8）
 *
 * POST /api/buildings/:id/toggle-operational-status
 *   :id = 目标楼盘
 *
 * 语义：翻转楼盘 operationalStatus（active ⇄ disabled）。停用只从有效供给谓词的
 * 楼盘侧撤销可见性，**绝不改写任何 Listing 的 status / 审核 / 发布状态**
 * （R3、M3 验收门第 3 条「楼盘停用后前台不可见,房源状态值保持不变」、R8）。
 * 审计经 auditFieldsPlugin：透传 req 让 payload.update 自动记录 lastModifiedBy。
 *
 * 响应：
 *   - 200: { ok: true, buildingId, operationalStatus }（翻转后的新值）
 *   - 400: 缺少楼盘 ID / 当前状态非法
 *   - 401: 未登录
 *   - 403: 无 building:freeze 权限
 *   - 404: 楼盘不存在
 *
 * 安全：
 *   - 必须登录且具备 building:freeze 操作权限（停用语义专用码，非 building:update）
 */
export function createBuildingOperationalToggleEndpoint(): Endpoint {
  return {
    // 注册在 Buildings collection 的 endpoints 上 → 实际 HTTP 路径 /api/buildings/:id/toggle-operational-status。
    // Payload 匹配前会先剥掉 /{slug}，故此处 path 用去 slug 前缀的相对路径。
    path: '/:id/toggle-operational-status',
    method: 'post',
    handler: async (req) => {
      // 1. 鉴权：停用/启用属专用「冻结」权限语义，要求 building:freeze
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

      // 3. 读当前启停状态（不存在 → 404）
      let current: unknown
      try {
        const doc = await req.payload.findByID({
          collection: 'buildings',
          id: buildingId,
          depth: 0,
          req,
        })
        current = (doc as unknown as Record<string, unknown>)?.operationalStatus
      } catch {
        return Response.json({ ok: false, error: '楼盘不存在' }, { status: 404 })
      }
      if (!isBuildingOperationalStatus(current)) {
        return Response.json(
          { ok: false, error: '楼盘当前启停状态非法，无法翻转' },
          { status: 400 },
        )
      }

      // 4. 翻转:active ⇄ disabled。只改 operationalStatus，绝不触碰 Listing。
      const next: BuildingOperationalStatus = current === 'active' ? 'disabled' : 'active'
      await req.payload.update({
        collection: 'buildings',
        id: buildingId,
        data: { operationalStatus: next },
        req, // 透传 req → auditFieldsPlugin 记录 lastModifiedBy
      })

      return Response.json({ ok: true, buildingId, operationalStatus: next })
    },
  }
}
