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
      await payload.delete({ collection: 'listings', id, overrideAccess: true }).catch(() => null)
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
})
