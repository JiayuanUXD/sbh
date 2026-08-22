/**
 * 按批次回滚（OPT-041 Task 9）
 *
 * 背景：导入的房源/楼盘直接上架（Task 7 语义 2），绕过了正常审核闸门。回滚是补偿
 * 这个决定的唯一止血手段——出事时凭批次的 `affectedIds`（Task 7 修过的回滚锚点，
 * 跨次运行取并集，崩溃重跑也不会丢）把整批撤下前台。
 *
 * 四条不可妥协的语义：
 *   1. 回滚是下架，不是删除。房源 publicationStatus:'unpublished'，
 *      楼盘 status:'archived'（不动 operationalStatus——那是另一条独立轴，见
 *      Buildings.ts 的注释：停用只撤销前台有效性，不隐式改写关联房源状态）。
 *      本文件任何分支都不得物理清除文档（AGENTS.md：不得物理删除已引用主数据），
 *      验收时对本文件搜索那个 Payload 客户端方法名应零命中。
 *   2. 幂等：重复回滚不报错，已经不是 published 的计入 skipped。
 *   3. 文档必须仍然存在：回滚后 findByID 仍能取到，只是状态变了。
 *   4. 审计由调用方（bulk-import-endpoint.ts）负责写，这里只做纯粹的状态迁移。
 */

import type { Payload, PayloadRequest } from 'payload'

export interface RollbackResult {
  unpublished: number
  skipped: number
}

function isIdValue(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

/** affectedIds 是自由 json 字段，结构可能损坏；安全取出合法 id 列表。 */
function toIdArray(value: unknown): Array<number | string> {
  if (!Array.isArray(value)) return []
  return value.filter(isIdValue)
}

export async function rollbackImportBatch(params: {
  payload: Payload
  req?: PayloadRequest
  batchId: number | string
}): Promise<RollbackResult> {
  const { payload, req, batchId } = params

  const batch = await payload.findByID({
    collection: 'supply-import-batches',
    id: batchId,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const type: 'buildings' | 'listings' = batch.type === 'buildings' ? 'buildings' : 'listings'
  const affectedIds = toIdArray(batch.affectedIds)

  let unpublished = 0
  let skipped = 0

  for (const id of affectedIds) {
    if (type === 'listings') {
      const doc = await payload.findByID({
        collection: 'listings',
        id,
        depth: 0,
        overrideAccess: true,
        req,
      })
      // 语义 2：已经不是 published 的（含已经回滚过一次的 unpublished，
      // 以及 leased/sold/draft 等其它非上架态）一律计入 skipped，不重复下架。
      if (doc.publicationStatus !== 'published') {
        skipped += 1
        continue
      }
      await payload.update({
        collection: 'listings',
        id,
        data: { publicationStatus: 'unpublished' },
        overrideAccess: true,
        req,
      })
      unpublished += 1
    } else {
      const doc = await payload.findByID({
        collection: 'buildings',
        id,
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (doc.status !== 'published') {
        skipped += 1
        continue
      }
      // 只动 status（发布轴），不动 operationalStatus（启停轴）——两条轴独立。
      await payload.update({
        collection: 'buildings',
        id,
        data: { status: 'archived' },
        overrideAccess: true,
        req,
      })
      unpublished += 1
    }
  }

  return { unpublished, skipped }
}
