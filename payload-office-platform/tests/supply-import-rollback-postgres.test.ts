import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { runSupplyImportBatch } from '@/domain/supply-import/import-task'
import { rollbackImportBatch } from '@/domain/supply-import/batch-rollback'

/**
 * 按批次回滚（OPT-041 Task 9）真库测试。
 *
 * 三条关键断言（brief Step 1，逐字保留）：
 *   1. 把本批房源打回下架，而不是删除
 *   2. 文档仍然存在——回滚绝不物理删除
 *   3. 重复回滚幂等，已下架的计入 skipped
 *
 * 评审第 1 轮 Critical 补充：`affectedIds` 混入软删 / 不存在的 id 时，循环不能
 * 中断——真实触发条件不是"理论上"，Listings.ts 声明了 `trash: true`，运营在后台
 * 把某条误点"移入回收站"是可达路径。真库探针（postgres 15）实测过三种
 * `findByID` 取值组合：
 *   - 默认（trash 未传，等价 trash:false）在软删文档上 → 抛 NotFound
 *   - `disableErrors:true`（trash 仍是 false）在软删文档上 → 返回 null
 *   - `trash:true` 在软删文档上 → 返回文档本身，`deletedAt` 是非空时间戳
 *   - `trash:true, disableErrors:true` 对一个从未存在过的 id / 非数字字符串 id
 *     → 同样返回 null（不抛错，Payload 内部已经吞掉了）
 * 据此 `rollbackImportBatch` 统一传 `trash:true, disableErrors:true`：
 * doc 为 null（真的找不到）计入 failed，`doc.deletedAt` 非空（已在回收站）计入
 * skipped，两者都不会让循环中断。
 */

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

describe.skipIf(!databaseAvailable)('OPT-041 按批次回滚', () => {
  let payload: Payload
  let buildingId: number | string
  let batchId: number | string
  let listingId: number | string
  const createdListingIds: Array<number | string> = []
  const createdBatchIds: Array<number | string> = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    const building = await payload.find({
      collection: 'buildings',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    buildingId = building.docs[0].id

    // 先跑一次真实写入层，造出一个带 affectedIds 的房源。
    const runResult = await runSupplyImportBatch({
      payload,
      type: 'listings',
      validRows: [
        {
          externalId: 'E2E-ROLLBACK-1',
          title: '回滚测试房源',
          listingType: 'traditional-office',
          buildingId,
          cityId: null,
          area: 200,
          rentAmount: 5,
          rentUnit: 'rmb-sqm-day',
          floor: 8,
          decorationStatus: null,
          availableFrom: null,
        },
      ],
    })
    expect(runResult.failed).toBe(0)
    listingId = runResult.affectedIds[0]
    createdListingIds.push(listingId)

    // 手工造一个 completed 批次，affectedIds 指向上面写入的房源
    // ——回滚只认批次的 affectedIds，不重新推导。
    const batch = await payload.create({
      collection: 'supply-import-batches',
      data: {
        type: 'listings',
        status: 'completed',
        fileName: 'rollback-probe.xlsx',
        rowCount: 1,
        affectedIds: runResult.affectedIds,
        stats: { processed: 1, created: 1, updated: 0, failed: 0 },
      },
      overrideAccess: true,
    })
    batchId = batch.id
    createdBatchIds.push(batchId)
  })

  afterAll(async () => {
    for (const id of createdListingIds) {
      // trash:true——本用例集里有一条被软删过（混合场景那条），plain delete()
      // 默认排除回收站文档会查不到、清不掉，加 trash:true 让"查找待删文档"这一步
      // 也能命中已软删的行；delete() 本身恒是硬删除（真库探针已确认），清理测试
      // 数据用硬删除没问题，这不是业务代码路径。
      await payload.delete({ collection: 'listings', id, overrideAccess: true, trash: true }).catch(() => null)
    }
    for (const id of createdBatchIds) {
      await payload.delete({ collection: 'supply-import-batches', id, overrideAccess: true }).catch(() => null)
    }
  })

  it('把本批房源打回下架，而不是删除', async () => {
    const result = await rollbackImportBatch({ payload, batchId })
    expect(result.unpublished).toBe(1)
    const doc = await payload.findByID({ collection: 'listings', id: listingId, overrideAccess: true })
    expect(doc.publicationStatus).toBe('unpublished')
  })

  it('文档仍然存在——回滚绝不物理删除', async () => {
    await expect(
      payload.findByID({ collection: 'listings', id: listingId, overrideAccess: true }),
    ).resolves.toBeTruthy()
  })

  it('重复回滚幂等，已下架的计入 skipped', async () => {
    const again = await rollbackImportBatch({ payload, batchId })
    expect(again).toMatchObject({ unpublished: 0, skipped: 1 })
  })

  it('affectedIds 混入已软删 / 不存在的 id 时，其余条目仍然全部被下架，不中断整批', async () => {
    // 自成一体的独立 fixture，不复用上面几条用例共享的 batchId/listingId 状态。
    const runResult = await runSupplyImportBatch({
      payload,
      type: 'listings',
      validRows: [
        {
          externalId: 'E2E-ROLLBACK-MIX-OK',
          title: '回滚混合场景-正常房源',
          listingType: 'traditional-office',
          buildingId,
          cityId: null,
          area: 180,
          rentAmount: 4,
          rentUnit: 'rmb-sqm-day',
          floor: 5,
          decorationStatus: null,
          availableFrom: null,
        },
        {
          externalId: 'E2E-ROLLBACK-MIX-TRASH',
          title: '回滚混合场景-将被软删的房源',
          listingType: 'traditional-office',
          buildingId,
          cityId: null,
          area: 150,
          rentAmount: 3.5,
          rentUnit: 'rmb-sqm-day',
          floor: 3,
          decorationStatus: null,
          availableFrom: null,
        },
      ],
    })
    expect(runResult.failed).toBe(0)
    const [okListingId, trashedListingId] = runResult.affectedIds
    createdListingIds.push(okListingId, trashedListingId)

    // 真正的软删（Payload trash 机制）：update + data.deletedAt + trash:true——
    // 不是 payload.delete({trash:true})，那个 trash 参数只影响"查找待删文档时
    // 是否包含已软删的"，db.deleteOne 本身恒是硬删除（真库探针已实测确认，
    // 写进了 task-9-report.md 的修复记录里）。
    await payload.update({
      collection: 'listings',
      id: trashedListingId,
      data: { deletedAt: new Date().toISOString() },
      trash: true,
      overrideAccess: true,
    })

    const bogusId = 999999999 // 从未存在过的 id，模拟 affectedIds 结构损坏/脏数据

    const mixedBatch = await payload.create({
      collection: 'supply-import-batches',
      data: {
        type: 'listings',
        status: 'completed',
        fileName: 'rollback-mixed-probe.xlsx',
        rowCount: 3,
        affectedIds: [okListingId, trashedListingId, bogusId],
        stats: { processed: 2, created: 2, updated: 0, failed: 0 },
      },
      overrideAccess: true,
    })
    createdBatchIds.push(mixedBatch.id)

    // 核心断言：不抛错、不中断——三条 id 各自落在不同分支，函数正常返回。
    const result = await rollbackImportBatch({ payload, batchId: mixedBatch.id })
    expect(result).toMatchObject({ unpublished: 1, skipped: 1, failed: 1 })

    const okDoc = await payload.findByID({ collection: 'listings', id: okListingId, overrideAccess: true })
    expect(okDoc.publicationStatus).toBe('unpublished')
  })
})
