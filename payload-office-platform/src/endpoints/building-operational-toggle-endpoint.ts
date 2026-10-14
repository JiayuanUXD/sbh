import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { isBuildingOperationalStatus } from '@/domain/supply/building'
import { setBuildingOperationalStatus } from '@/domain/supply/building-operational-action'

import { readEndpointBody } from './read-endpoint-body'

/**
 * 楼盘启停 endpoint（tasks.md M3.4「完成……启停……动作」/ R3, M3 验收门第 3 条, R8）
 *
 * POST /api/buildings/:id/toggle-operational-status
 *   :id = 目标楼盘
 *   body（可选，OPT-113）{ target: 'active' | 'disabled' }
 *
 * 语义：翻转楼盘 operationalStatus（active ⇄ disabled）。停用只从有效供给谓词的
 * 楼盘侧撤销可见性，**绝不改写任何 Listing 的 status / 审核 / 发布状态**
 * （R3、M3 验收门第 3 条「楼盘停用后前台不可见,房源状态值保持不变」、R8）。
 * 审计经 auditFieldsPlugin：透传 req 让 payload.update 自动记录 lastModifiedBy；
 * OPT-113 起执行逻辑在 `domain/supply/building-operational-action.ts`（与批量启停共用），
 * 每次实际写入另记一行 building.freeze / building.restore 审计。
 *
 * target（OPT-113）：调用方按自己读到的状态渲染「停用 / 启用」按钮，读到的可能已经过期
 * （列表尤其常见：别人刚在编辑页停用过）。纯翻转语义下，过期的「停用」会被执行成「启用」，
 * 与按钮上写的相反。带 target 时按目标值写，已是目标值则幂等返回 `changed: false`、不写库。
 * 不带 body / 不带 target 时保持原翻转语义，兼容旧调用方。
 *
 * 响应：
 *   - 200: { ok: true, buildingId, operationalStatus, changed }（写入后的值；幂等时为当前值）
 *   - 400: 缺少楼盘 ID / 当前状态非法 / target 非法
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

      // 1b. 目标状态（可选）：空 body / 非 JSON 视同未带
      const body = (await readEndpointBody(req)) ?? {}
      const target = body.target
      if (target !== undefined && !isBuildingOperationalStatus(target)) {
        return Response.json({ ok: false, error: '目标启停状态非法' }, { status: 400 })
      }

      // 2. 楼盘 ID：Payload 3.86 路由参数在 req.routeParams
      const rawId = (req.routeParams as Record<string, unknown> | undefined)?.id
      const buildingId =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined
      if (buildingId === undefined || buildingId === '') {
        return Response.json({ ok: false, error: '缺少楼盘 ID' }, { status: 400 })
      }

      // 3. 执行：读取、幂等判断、写入、审计在共享核心里（批量启停同调这一个函数）。
      //    只改 operationalStatus，绝不触碰 Listing。
      const outcome = await setBuildingOperationalStatus(req, {
        buildingId,
        target: target ?? null,
      })
      if (!outcome.ok) {
        const { status, ...rest } = outcome
        return Response.json(rest, { status })
      }
      return Response.json({
        ok: true,
        buildingId,
        operationalStatus: outcome.operationalStatus,
        changed: outcome.changed,
      })
    },
  }
}
