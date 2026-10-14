import type { Endpoint, PayloadRequest } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { withAudit } from '@/domain/audit/with-audit'
import { runInRequestTransaction } from '@/domain/shared/transaction-safety'
import {
  batchFailureFromError,
  parseBatchItems,
  summarizeBatchResults,
  type BatchItem,
  type BatchItemResult,
} from '@/domain/shared/batch-request'
import {
  BUILDING_PUBLISH_ACTION_LABELS,
  BUILDING_STATUS_LABELS,
  isBuildingPublishAction,
  isBuildingStatus,
  nextBuildingStatus,
  type BuildingPublishAction,
} from '@/domain/supply/building-publication'

import { readEndpointBody } from './read-endpoint-body'

/**
 * 楼盘批量上下架 endpoint（OPT-113）
 *
 * POST /api/buildings/batch-publish
 *   body { action: 'publish' | 'unpublish', items: [{ id, expectedVersion? }] }
 *
 * 语义：
 *   - 只动发布状态 `status`：上架 = 草稿 / 下架 → 已发布；下架 = 已发布 → 下架
 *     （转移表见 `domain/supply/building-publication.ts`，列表预筛读同一张表）。
 *   - **绝不碰启停轴 `operationalStatus`，也不碰任何房源**。下架后楼盘及其房源从前台消失，
 *     是公开谓词组合出来的结果（`public-building.ts`），房源自己的发布 / 审核状态不变。
 *   - 权限 `building:update`：编辑页里「发布状态」就是个普通字段，能改楼盘就能改它；
 *     批量不比单条更宽也不更严。停用（building:freeze）是另一回事，不在这里。
 *   - 每条成功写一行 `building.update` 审计（changedFields ['status']）——复用已有枚举值，
 *     不为此加迁移。业务写与审计写同一事务，审计失败则这条回滚并记为失败（M8.2）。
 *   - 带了 expectedVersion 时版本号随写入提交，由 protectBuilding 在写入时再校验一次。
 *   - 逐条执行、逐条出结果；每条自开自提事务，一条失败不连累其它条。
 *
 * 响应：
 *   - 200: { ok: true, action, succeeded, failed, results }（同 listings/batch-publish）
 *   - 400: 请求体 / 动作 / 条目非法
 *   - 401: 未登录  403: 无 building:update
 */
export function createBuildingBatchPublishEndpoint(): Endpoint {
  return {
    // 注册在 Buildings collection 的 endpoints 上 → 实际路径 /api/buildings/batch-publish。
    path: '/batch-publish',
    method: 'post',
    handler: async (req) => {
      const body = await readEndpointBody(req)
      if (!body) {
        return Response.json({ ok: false, error: '请求体格式不正确' }, { status: 400 })
      }
      const action = body.action
      if (!isBuildingPublishAction(action)) {
        return Response.json(
          { ok: false, error: '批量操作只支持上架或下架' },
          { status: 400 },
        )
      }

      try {
        await requireOperationPermission(req as RequestContext, 'building:update')
      } catch (err) {
        const message = err instanceof Error ? err.message : '权限不足'
        const status = message.includes('未登录') ? 401 : 403
        return Response.json({ ok: false, error: message }, { status })
      }

      const parsed = parseBatchItems(body.items)
      if (!parsed.ok) {
        return Response.json({ ok: false, error: parsed.error }, { status: 400 })
      }

      // 串行：理由同 listings/batch-publish（不同时占多条连接）。
      const results: BatchItemResult[] = []
      for (const item of parsed.items) {
        try {
          results.push(await applyToBuilding(req, item, action))
        } catch (err) {
          console.error('[building-batch-publish] item_failed', { id: item.id, action, err })
          results.push(batchFailureFromError(item.id, err))
        }
      }

      return Response.json({ ok: true, action, ...summarizeBatchResults(results), results })
    },
  }
}

async function applyToBuilding(
  req: PayloadRequest,
  item: BatchItem,
  action: BuildingPublishAction,
): Promise<BatchItemResult> {
  let building: Record<string, unknown>
  try {
    building = (await req.payload.findByID({
      collection: 'buildings',
      id: item.id,
      depth: 0,
      req,
    })) as unknown as Record<string, unknown>
  } catch {
    return { id: item.id, ok: false, error: '楼盘不存在' }
  }

  if (item.expectedVersion !== null && building.version !== item.expectedVersion) {
    return {
      id: item.id,
      ok: false,
      error: '楼盘已被他人修改，请刷新后重试',
      code: 'VERSION_CONFLICT',
    }
  }

  const current = building.status
  const next = nextBuildingStatus(current, action)
  if (next === null) {
    const currentLabel = isBuildingStatus(current) ? BUILDING_STATUS_LABELS[current] : '未知'
    return {
      id: item.id,
      ok: false,
      error: `当前状态「${currentLabel}」不能${BUILDING_PUBLISH_ACTION_LABELS[action]}`,
      code: 'ILLEGAL_TRANSITION',
    }
  }

  // 业务写与审计写同一事务：审计写失败则发布状态一并回滚（M8.2）。
  const result = await runInRequestTransaction(req, 'building-batch-publish', () =>
    withAudit({
      req,
      action: 'building.update',
      object: {
        collection: 'buildings',
        objectId: item.id,
        objectVersion: typeof building.version === 'number' ? building.version : 1,
      },
      before: building,
      fn: async () => {
        const updated = await req.payload.update({
          collection: 'buildings',
          id: item.id,
          // 带上已校验的版本号：protectBuilding 在写入时按 originalDoc 再比一次，读写之间有人改过就 409。
          data:
            item.expectedVersion !== null
              ? { status: next, version: item.expectedVersion }
              : { status: next },
          req, // 透传 req → auditFieldsPlugin 记录 lastModifiedBy；afterChange 失效公开缓存
        })
        return {
          ok: true as const,
          data: next,
          after: updated as unknown as Record<string, unknown>,
          changedFields: ['status'],
        }
      },
      throwOnError: false,
    }),
  )

  if (result === null) {
    return { id: item.id, ok: false, error: '写入失败，请重试' }
  }
  return { id: item.id, ok: true, status: result }
}
