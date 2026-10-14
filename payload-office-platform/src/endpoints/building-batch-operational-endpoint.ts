import type { Endpoint, PayloadRequest } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import {
  batchFailureFromError,
  parseBatchItems,
  summarizeBatchResults,
  type BatchItemResult,
} from '@/domain/shared/batch-request'
import { isBuildingOperationalStatus } from '@/domain/supply/building'
import { setBuildingOperationalStatus } from '@/domain/supply/building-operational-action'
import { countBuildingsDeactivationImpact } from '@/domain/supply/building-references'

import { readEndpointBody } from './read-endpoint-body'

/**
 * 楼盘批量停用 / 启用，及批量停用预检（OPT-113）
 *
 * POST /api/buildings/batch-operational-status
 *   body { target: 'active' | 'disabled', items: [{ id, expectedVersion? }] }
 *   逐条调用与单条启停端点同一个 `setBuildingOperationalStatus`：只写 operationalStatus、
 *   已是目标状态幂等不写、每次实际写入记 building.freeze / building.restore 审计。
 *   响应形状同 listings / buildings 的 batch-publish：
 *   200 { ok: true, action: target, succeeded, failed, results }。
 *
 * POST /api/buildings/batch-deactivation-impact
 *   body { items: [{ id }] }
 *   一次查询汇总所选楼盘下「当前对外可见」的房源数（口径同单楼盘预检，只读、不阻断）。
 *   200 { ok: true, report: { total, sources, byBuilding, capped } }。
 *
 * 两个端点都要 building:freeze（停用专用码，与单条启停 / 单条预检一致）。
 * 400 请求体 / 目标 / 条目非法；401 未登录；403 无权限。
 */

async function requireFreeze(req: PayloadRequest): Promise<Response | null> {
  try {
    await requireOperationPermission(req as RequestContext, 'building:freeze')
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : '权限不足'
    const status = message.includes('未登录') ? 401 : 403
    return Response.json({ ok: false, error: message }, { status })
  }
}

export function createBuildingBatchOperationalEndpoint(): Endpoint {
  return {
    // 注册在 Buildings collection 的 endpoints 上 → 实际路径 /api/buildings/batch-operational-status。
    path: '/batch-operational-status',
    method: 'post',
    handler: async (req) => {
      const body = await readEndpointBody(req)
      if (!body) {
        return Response.json({ ok: false, error: '请求体格式不正确' }, { status: 400 })
      }
      const target = body.target
      if (!isBuildingOperationalStatus(target)) {
        return Response.json({ ok: false, error: '目标启停状态非法' }, { status: 400 })
      }

      const denied = await requireFreeze(req)
      if (denied) return denied

      const parsed = parseBatchItems(body.items)
      if (!parsed.ok) {
        return Response.json({ ok: false, error: parsed.error }, { status: 400 })
      }

      // 串行：理由同 listings/batch-publish（不同时占多条连接）。
      const results: BatchItemResult[] = []
      for (const item of parsed.items) {
        try {
          const outcome = await setBuildingOperationalStatus(req, {
            buildingId: item.id,
            target,
            expectedVersion: item.expectedVersion,
          })
          results.push(
            outcome.ok
              ? { id: item.id, ok: true, status: outcome.operationalStatus }
              : {
                  id: item.id,
                  ok: false,
                  error: outcome.error,
                  ...(outcome.code ? { code: outcome.code } : {}),
                },
          )
        } catch (err) {
          console.error('[building-batch-operational] item_failed', { id: item.id, target, err })
          results.push(batchFailureFromError(item.id, err))
        }
      }

      return Response.json({ ok: true, action: target, ...summarizeBatchResults(results), results })
    },
  }
}

export function createBuildingBatchDeactivationImpactEndpoint(): Endpoint {
  return {
    // 注册在 Buildings collection 的 endpoints 上 → 实际路径 /api/buildings/batch-deactivation-impact。
    // 用 POST 带条目，而不是 GET 拼 100 个 id 到查询串。
    path: '/batch-deactivation-impact',
    method: 'post',
    handler: async (req) => {
      const denied = await requireFreeze(req)
      if (denied) return denied

      const body = await readEndpointBody(req)
      const parsed = parseBatchItems(body?.items)
      if (!parsed.ok) {
        return Response.json({ ok: false, error: parsed.error }, { status: 400 })
      }

      const report = await countBuildingsDeactivationImpact(
        req.payload,
        parsed.items.map((item) => item.id),
        req,
      )
      return Response.json({ ok: true, report })
    },
  }
}
