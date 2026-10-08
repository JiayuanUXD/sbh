/**
 * 同步批次回滚（OPT-104 §5.3-5）。只做两件前台可见的事：
 *   1. 被覆盖字段的已上架房源 → 按写前快照还原；
 *   2. 被下架的旧房源 → 仍是「已下架」的才恢复上架（期间被人改成已租 / 已售的不动）。
 * 新建的楼盘 / 房源都是草稿，前台不可见，不动（「不删」原则）；楼盘只填过空，也不还原。
 *
 * 单条失败计入 failures，不中断循环（同 batch-rollback.ts 的口径）。
 */
import type { Payload, PayloadRequest } from 'payload'

import { unflattenSnapshot } from './huizuxuanzhi-apply'
import { readAffected } from './source-sync-task'

export type SourceSyncRollbackResult =
  | { ok: true; restored: number; republished: number; failures: string[] }
  | { ok: false; status: 404 | 409; error: string }

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function rollbackSourceSyncBatch(
  payload: Payload,
  req: PayloadRequest | undefined,
  batchId: number,
): Promise<SourceSyncRollbackResult> {
  const batch = (await payload.findByID({
    collection: 'source-sync-batches',
    id: batchId,
    depth: 0,
    overrideAccess: true,
    req,
    disableErrors: true,
  })) as unknown as Record<string, unknown> | null
  if (!batch) return { ok: false, status: 404, error: '批次不存在' }
  if (batch.status !== 'completed' && batch.status !== 'failed') {
    return { ok: false, status: 409, error: '批次还在写入，结束后才能回滚' }
  }
  if (batch.rolledBackAt) return { ok: false, status: 409, error: '该批次已回滚过' }

  const affected = readAffected(batch.affected)
  let restored = 0
  let republished = 0
  const failures: string[] = []

  for (const { id, before } of affected.updatedPublishedListings) {
    try {
      await payload.update({
        collection: 'listings',
        id,
        data: unflattenSnapshot(before),
        depth: 0,
        overrideAccess: true,
        req,
      })
      restored++
    } catch (e) {
      failures.push(`房源 ${id} 还原失败：${errorMessage(e)}`)
    }
  }

  for (const id of affected.retiredListings) {
    const doc = await payload.findByID({
      collection: 'listings',
      id,
      depth: 0,
      trash: true,
      overrideAccess: true,
      req,
      disableErrors: true,
    })
    if (!doc || doc.deletedAt || doc.publicationStatus !== 'unpublished') continue
    try {
      await payload.update({
        collection: 'listings',
        id,
        data: { publicationStatus: 'published' },
        depth: 0,
        overrideAccess: true,
        req,
      })
      republished++
    } catch (e) {
      failures.push(`房源 ${id} 恢复上架失败：${errorMessage(e)}`)
    }
  }

  await payload.update({
    collection: 'source-sync-batches',
    id: batchId,
    data: { rolledBackAt: new Date().toISOString() },
    depth: 0,
    overrideAccess: true,
    req,
  })
  return { ok: true, restored, republished, failures }
}
