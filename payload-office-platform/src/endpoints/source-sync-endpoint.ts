import type { Endpoint, PayloadRequest } from 'payload'
import { addDataAndFileToRequest } from 'payload'

import { requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import type { PermissionContext } from '@/domain/auth/permission-context'
import { writeAuditFailed, writeAuditSuccess } from '@/domain/audit/audit-writer'
import { invalidateSupplyImportCache } from '@/domain/supply-import/cache-invalidation'
import { parseSyncChunk } from '@/domain/supply-sync/chunk'
import { rollbackSourceSyncBatch } from '@/domain/supply-sync/source-sync-rollback'
import { SOURCE_SYNC_QUEUE, SOURCE_SYNC_TASK } from '@/domain/supply-sync/source-sync-task'

/**
 * 外部来源同步 endpoint（OPT-104）：
 *
 *   - POST /source-sync/upload                 multipart 上传一个同步包 → 校验 → 落批次 → 入队
 *   - POST /source-sync/revalidate             按城市统一失效前台缓存（任务里逐条失效被关掉了）
 *   - POST /source-sync/batches/:id/rollback   恢复被下架的旧房源、还原被覆盖的已上架房源字段
 *
 * 只对「持 data:import 且全局范围」的人开放：同步写的是全量楼盘与房源，不按城市切。
 * 批次列表与进度走集合自带的 REST（`/api/source-sync-batches`，读权限同口径）。
 */

async function guardSync(
  req: RequestContext,
): Promise<{ ok: true; ctx: PermissionContext } | { ok: false; response: Response }> {
  try {
    const ctx = await requireOperationPermission(req, 'data:import')
    if (ctx.cityIds !== 'all') {
      return {
        ok: false,
        response: Response.json({ ok: false, error: '外部数据同步只对全局范围的账号开放' }, { status: 403 }),
      }
    }
    return { ok: true, ctx }
  } catch (err) {
    const message = err instanceof Error ? err.message : '无权限'
    return { ok: false, response: Response.json({ ok: false, error: message }, { status: 403 }) }
  }
}

const BATCH_COLLECTION = 'source-sync-batches' as const

async function shanghaiCityIds(req: PayloadRequest): Promise<number[]> {
  const res = await req.payload.find({
    collection: 'locations',
    where: { type: { equals: 'city' }, slug: { equals: 'shanghai' } },
    depth: 0,
    limit: 5,
    overrideAccess: true,
    req,
  })
  return res.docs.map((d) => d.id as number)
}

export function createSourceSyncEndpoints(): Endpoint[] {
  const upload: Endpoint = {
    path: '/source-sync/upload',
    method: 'post',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext
      const guard = await guardSync(req)
      if (!guard.ok) return guard.response
      const { ctx } = guard

      await addDataAndFileToRequest(req)
      const file = req.file
      if (!file) return Response.json({ ok: false, code: 'NO_FILE', error: '未上传文件' }, { status: 400 })

      const parsed = parseSyncChunk(new Uint8Array(file.data))
      if (!parsed.ok) {
        await writeAuditFailed({
          payload: req.payload,
          req,
          data: {
            action: 'data.import',
            object: { collection: BATCH_COLLECTION, objectId: 0, objectVersion: 1 },
            errorCode: parsed.code,
            errorMessage: `同步包 ${file.name} 校验不通过：${parsed.errors[0] ?? ''}`,
          },
        })
        return Response.json({ ok: false, code: parsed.code, errors: parsed.errors }, { status: 400 })
      }

      // 房源包 / 下架包依赖楼盘已入库，但这里不拒收：生产上楼盘阶段要拉图、可能跑几个小时，
      // 拒收就得有人开着页面守着重传。照收入队，由任务在楼盘批次写完前把房源段延后重排
      //（source-sync-task.ts 的 shouldWaitForBuildings）。

      const batch = await req.payload.create({
        collection: BATCH_COLLECTION,
        data: {
          source: 'huizuxuanzhi',
          kind: parsed.kind,
          status: 'queued',
          operator: Number(ctx.userId),
          fileName: file.name,
          rowCount: parsed.rows.length,
          rows: parsed.rows as unknown as Record<string, unknown>[],
          cursor: 0,
        },
        depth: 0,
        overrideAccess: true,
        req,
      })
      await req.payload.jobs.queue({ task: SOURCE_SYNC_TASK, queue: SOURCE_SYNC_QUEUE, input: { batchId: batch.id } })
      await writeAuditSuccess({
        payload: req.payload,
        req,
        data: {
          action: 'data.import',
          object: { collection: BATCH_COLLECTION, objectId: batch.id, objectVersion: 1 },
          after: { source: 'huizuxuanzhi', kind: parsed.kind, rowCount: parsed.rows.length, fileName: file.name },
        },
      })
      return Response.json({ ok: true, batchId: batch.id, kind: parsed.kind, rowCount: parsed.rows.length })
    },
  }

  const revalidate: Endpoint = {
    path: '/source-sync/revalidate',
    method: 'post',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext
      const guard = await guardSync(req)
      if (!guard.ok) return guard.response
      await invalidateSupplyImportCache(req.payload, req, await shanghaiCityIds(req), 'source_sync')
      return Response.json({ ok: true })
    },
  }

  const rollback: Endpoint = {
    path: '/source-sync/batches/:id/rollback',
    method: 'post',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext
      const guard = await guardSync(req)
      if (!guard.ok) return guard.response
      const id = Number((req.routeParams as Record<string, unknown> | undefined)?.id)
      if (!Number.isSafeInteger(id)) return Response.json({ ok: false, error: '批次 id 不合法' }, { status: 400 })

      const result = await rollbackSourceSyncBatch(req.payload, req, id)
      if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status })
      const { restored, republished, failures } = result

      await invalidateSupplyImportCache(req.payload, req, await shanghaiCityIds(req), 'source_sync_rollback')
      await writeAuditSuccess({
        payload: req.payload,
        req,
        data: {
          action: 'data.import',
          object: { collection: BATCH_COLLECTION, objectId: id, objectVersion: 1 },
          after: { rollback: true, restored, republished, failures: failures.length },
        },
      })
      return Response.json({ ok: true, restored, republished, failures })
    },
  }

  return [upload, revalidate, rollback]
}
