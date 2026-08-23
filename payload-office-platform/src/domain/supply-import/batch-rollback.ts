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
 *
 * 评审第 1 轮 Critical 修复：单条 id 处理绝不能让异常冒出循环——回滚是紧急止血，
 * 「前 N 条已生效、第 N+1 条抛错、后面全部还挂在前台」是这个场景里最不该出现的
 * 失败模式（对照 Task 7 `import-task.ts` 已确立的原则：单行失败不阻断后续行）。
 *
 * 触发条件不是"理论上"：Listings.ts / Buildings.ts 都声明了 `trash: true`（软删除），
 * 运营在后台把某条误点"移入回收站"是可达路径。实测过三种 `findByID` 取值组合
 * （真库探针，postgres 15）：
 *   - 默认（不传 trash，即 trash:false）在软删文档上 → **抛 NotFound**
 *   - `disableErrors:true`（trash 仍是 false）在软删文档上 → 返回 **null**
 *   - `trash:true` 在软删文档上 → 返回文档本身，`deletedAt` 是非空时间戳
 * 据此这里统一传 `trash:true, disableErrors:true`：一次查询同时兜住"软删"和"真的
 * 找不到"两种情况，不必先探测再决定要不要重试。
 *   - doc 为 null（真的找不到，比如 affectedIds 里的脏 id）→ 计入 failed
 *   - doc.deletedAt 非空（已被移入回收站）→ 视同"已不在架上"，计入 skipped，
 *     不对一条已软删的文档发 update（回收站里的文档本就不该被当作正常在架数据改）
 *   - 其余情况按原逻辑判断 publicationStatus / status
 * 每条 id 整体包一层 try/catch：findByID 与 update 之外的任何异常（并发冲突、
 * hook 拒绝等）同样只计入 failed、不中断循环。
 */

import type { Payload, PayloadRequest } from 'payload'

export interface RollbackResult {
  unpublished: number
  skipped: number
  failed: number
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
  let failed = 0

  for (const id of affectedIds) {
    try {
      if (type === 'listings') {
        // trash:true + disableErrors:true 一次查询兜住"软删"与"真的找不到"，
        // 不让 findByID 本身抛错中断这一条、更不能中断整个循环。
        const doc = await payload.findByID({
          collection: 'listings',
          id,
          depth: 0,
          overrideAccess: true,
          req,
          trash: true,
          disableErrors: true,
        })
        if (!doc) {
          // affectedIds 里的脏 id（真的查不到，非软删）：不是幂等意义上的"已下架"，
          // 计入 failed 让运营知道这条没处理成功，而不是悄悄当 skipped 糊弄过去。
          failed += 1
          continue
        }
        if (doc.deletedAt) {
          // 已被移入回收站：前台本就看不到，视同"已不在架上"，不对回收站里的
          // 文档发 update。
          skipped += 1
          continue
        }
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
          trash: true,
          disableErrors: true,
        })
        if (!doc) {
          failed += 1
          continue
        }
        if (doc.deletedAt) {
          skipped += 1
          continue
        }
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
    } catch {
      // 单条 id 的任何异常（并发冲突、hook 拒绝等）只计入 failed，绝不冒泡打断
      // 后续 id 的处理——回滚是紧急止血，半途而废比"这一条没处理成功"更糟。
      failed += 1
    }
  }

  return { unpublished, skipped, failed }
}
