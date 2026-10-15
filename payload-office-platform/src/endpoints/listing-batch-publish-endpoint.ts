import type { Endpoint } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import { executeListingPublishAction } from '@/domain/listing/listing-publish-action'
import { permissionForPublishAction } from '@/domain/listing/publication-actions'
import {
  batchFailureFromError,
  parseBatchItems,
  summarizeBatchResults,
  type BatchItemResult,
} from '@/domain/shared/batch-request'

import { readEndpointBody } from './read-endpoint-body'

/**
 * 房源批量上下架 endpoint（OPT-113）
 *
 * POST /api/listings/batch-publish
 *   body { action: 'publish' | 'unpublish', items: [{ id, expectedVersion? }], reason? }
 *
 * 语义：
 *   - 只给上架 / 下架。标记已租 / 已售是不可逆终态，批量点错没有回头路，只留在编辑页逐条做。
 *   - 鉴权一次（按动作取权限码，与单条端点同一个 `permissionForPublishAction`）。
 *   - 下架原因在执行任何一条之前校验：缺原因整批 422，一条不改；同一原因写进每条的审计。
 *   - 逐条调用与单条端点**同一个** `executeListingPublishAction`：状态机、审核前置、
 *     有效供给、乐观锁、审计全部同源。不是全有或全无——批量上架里不满足有效供给的条目
 *     不改状态，结果里带原因，其余照常上架。
 *   - 每条自开自提事务（自定义端点没有请求级事务，见 OPT-113 §1 E5），一条失败不连累其它条；
 *     某条抛异常也只记成这一条失败。
 *
 * 响应：
 *   - 200: { ok: true, action, succeeded, failed, results: [{ id, ok, status? | error, code?, reasons? }] }
 *          results 与请求条目同序（已去重）。部分失败仍是 200：批量的「成功」是请求被逐条处理完。
 *   - 400: 请求体 / 动作 / 条目非法
 *   - 401: 未登录  403: 无对应权限
 *   - 422: 下架缺原因
 */
const BATCH_ACTIONS = ['publish', 'unpublish'] as const
type BatchAction = (typeof BATCH_ACTIONS)[number]

function isBatchAction(value: unknown): value is BatchAction {
  return typeof value === 'string' && (BATCH_ACTIONS as readonly string[]).includes(value)
}

export function createListingBatchPublishEndpoint(): Endpoint {
  return {
    // 注册在 Listings collection 的 endpoints 上 → 实际路径 /api/listings/batch-publish。
    // 自定义端点先于 Payload 默认路由匹配，且默认路由里没有 POST /:id，不会被当成某条房源。
    path: '/batch-publish',
    method: 'post',
    handler: async (req) => {
      const body = await readEndpointBody(req)
      if (!body) {
        return Response.json({ ok: false, error: '请求体格式不正确' }, { status: 400 })
      }
      const action = body.action
      if (!isBatchAction(action)) {
        return Response.json(
          { ok: false, error: '批量操作只支持上架或下架' },
          { status: 400 },
        )
      }

      try {
        await requireOperationPermission(req as RequestContext, permissionForPublishAction(action))
      } catch (err) {
        const message = err instanceof Error ? err.message : '权限不足'
        const status = message.includes('未登录') ? 401 : 403
        return Response.json({ ok: false, error: message }, { status })
      }

      const parsed = parseBatchItems(body.items)
      if (!parsed.ok) {
        return Response.json({ ok: false, error: parsed.error }, { status: 400 })
      }

      // 单条核心也会校验原因，但那是逐条的：缺原因时每条都回 422，结果是一整列一样的失败。
      // 原因是整批共用的，在这里一次挡住更直白，也保证一条都不读不写。
      if (
        action === 'unpublish' &&
        (typeof body.reason !== 'string' || body.reason.trim().length === 0)
      ) {
        return Response.json(
          { ok: false, error: '下架必须填写原因', code: 'UNPUBLISH_REASON_REQUIRED' },
          { status: 422 },
        )
      }

      // 串行而不是 Promise.all：每条都是「读 → 校验 → 写 → 审计」，并发会同时占住多条连接
      // （生产连接池吃过亏，见根 CLAUDE.md「连接池被占满的指纹」），而 100 条串行也只是秒级。
      const results: BatchItemResult[] = []
      for (const item of parsed.items) {
        try {
          const outcome = await executeListingPublishAction(req, {
            listingId: item.id,
            action,
            reason: body.reason,
            expectedVersion: item.expectedVersion,
          })
          if (outcome.ok) {
            results.push({ id: item.id, ok: true, status: outcome.publicationStatus })
          } else {
            results.push({
              id: item.id,
              ok: false,
              error: outcome.error,
              ...(outcome.code ? { code: outcome.code } : {}),
              ...(outcome.reasons ? { reasons: outcome.reasons } : {}),
            })
          }
        } catch (err) {
          console.error('[listing-batch-publish] item_failed', { id: item.id, action, err })
          results.push(batchFailureFromError(item.id, err))
        }
      }

      return Response.json({ ok: true, action, ...summarizeBatchResults(results), results })
    },
  }
}
