import { describe, expect, it, vi } from 'vitest'

import {
  listActiveListingIdsForMerchant,
  markListingsPendingReview,
  markListingsPendingReviewOnMerchantStop,
} from '../src/domain/supply/merchant-stop-listings'

/**
 * M4.8 商户停用冻结：批量标记关联 Listing 为待复核（design §3.5 / R2 §56 / R4 / R8）
 *
 * 业务不变量：
 *   - 商户停用时把当前由该商户供给（listings.merchant = merchantId）的房源全部置 reviewStatus=pending
 *   - 已是 pending 的房源跳过（避免无谓写入 + version 递增）
 *   - publicationStatus 不改（保持 draft/published/offline 现值）
 *   - 透传 req 保持事务一致性
 *   - 失败详情返回给调用方（不抛错，由调用方决定是否回滚）
 */

interface FindCall {
  collection: string
  where: Record<string, unknown>
}

interface UpdateCall {
  collection: string
  id: number | string
  data: Record<string, unknown>
}

function makePayload(options: {
  findDocs?: Array<{ id: number | string }>
  listingDocs?: Record<string | number, { reviewStatus?: string; version?: number }>
} = {}) {
  const findCalls: FindCall[] = []
  const updateCalls: UpdateCall[] = []
  const { findDocs = [], listingDocs = {} } = options

  const payload = {
    find: vi.fn(async (params: { collection: string; where: Record<string, unknown> }) => {
      findCalls.push({ collection: params.collection, where: params.where })
      return { docs: findDocs, totalDocs: findDocs.length, totalPages: 1, page: 1 }
    }),
    findByID: vi.fn(async (params: { collection: string; id: number | string }) => {
      return listingDocs[params.id] ?? null
    }),
    update: vi.fn(async (params: {
      collection: string
      id: number | string
      data: Record<string, unknown>
    }) => {
      updateCalls.push({
        collection: params.collection,
        id: params.id,
        data: params.data,
      })
      return { ...listingDocs[params.id], ...params.data }
    }),
  }
  return { payload, findCalls, updateCalls }
}

describe('listActiveListingIdsForMerchant', () => {
  it('按 listings.merchant 找该商户供给的房源，不再查关系表', async () => {
    const find = vi.fn(async () => ({ docs: [{ id: 11 }, { id: 12 }] }))
    const ids = await listActiveListingIdsForMerchant({ find } as never, 7)
    expect(ids).toEqual([11, 12])
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'listings',
        where: expect.objectContaining({ merchant: { equals: 7 } }),
      }),
    )
  })

  it('去重收集 listing id', async () => {
    const { payload, findCalls } = makePayload({
      findDocs: [{ id: 101 }, { id: 102 }, { id: 101 }, { id: 103 }], // 101 重复
    })
    const ids = await listActiveListingIdsForMerchant(payload as never, 5)
    expect(ids).toEqual([101, 102, 103])
    expect(findCalls).toHaveLength(1)
    expect(findCalls[0].collection).toBe('listings')
    // where 必须含 merchant + 排除已逻辑删除的房源；不再有有效期窗口
    const whereJson = JSON.stringify(findCalls[0].where)
    expect(whereJson).toContain('"equals":5')
    expect(whereJson).toContain('deletedAt')
    expect(whereJson).not.toContain('effectiveFrom')
    expect(whereJson).not.toContain('effectiveTo')
  })

  it('空结果返回空数组', async () => {
    const { payload } = makePayload({ findDocs: [] })
    const ids = await listActiveListingIdsForMerchant(payload as never, 5)
    expect(ids).toEqual([])
  })
})

describe('markListingsPendingReview', () => {
  it('已是 pending 的房源跳过更新', async () => {
    const { payload, updateCalls } = makePayload({
      listingDocs: {
        1: { reviewStatus: 'pending', version: 3 },
        2: { reviewStatus: 'approved', version: 1 },
      },
    })
    const results = await markListingsPendingReview(payload as never, [1, 2])
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ listingId: 1, ok: true, skipped: true })
    expect(results[1]).toEqual({ listingId: 2, ok: true })
    // 只有 listing 2 被更新
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].id).toBe(2)
    expect(updateCalls[0].data.reviewStatus).toBe('pending')
  })

  it('listing 不存在时返回 ok=false', async () => {
    const { payload, updateCalls } = makePayload({ listingDocs: {} })
    const results = await markListingsPendingReview(payload as never, [999])
    expect(results[0].ok).toBe(false)
    expect(results[0].error).toBe('listing not found')
    expect(updateCalls).toHaveLength(0)
  })

  it('update 抛错时捕获并返回 ok=false', async () => {
    const payload = {
      findByID: vi.fn(async () => ({ reviewStatus: 'approved', version: 1 })),
      update: vi.fn(async () => {
        throw new Error('version conflict')
      }),
    }
    const results = await markListingsPendingReview(payload as never, [1])
    expect(results[0].ok).toBe(false)
    expect(results[0].error).toBe('version conflict')
  })

  it('publicationStatus 不改（仅改 reviewStatus）', async () => {
    const { payload, updateCalls } = makePayload({
      listingDocs: {
        1: { reviewStatus: 'approved', version: 1 },
      },
    })
    await markListingsPendingReview(payload as never, [1])
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].data).toEqual({ reviewStatus: 'pending' })
    // 不应包含 publicationStatus
    expect(updateCalls[0].data).not.toHaveProperty('publicationStatus')
  })
})

describe('markListingsPendingReviewOnMerchantStop', () => {
  it('一站式：查找 + 批量标记 + 汇总', async () => {
    const { payload, findCalls, updateCalls } = makePayload({
      findDocs: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ],
      listingDocs: {
        1: { reviewStatus: 'approved', version: 1 },
        2: { reviewStatus: 'pending', version: 1 }, // 跳过
        3: { reviewStatus: 'rejected', version: 1 },
      },
    })

    const report = await markListingsPendingReviewOnMerchantStop(payload as never, 5)

    expect(report.merchantId).toBe(5)
    expect(report.affectedListingIds).toEqual([1, 2, 3])
    expect(report.total).toBe(3)
    expect(report.succeeded).toBe(2) // listing 1 + 3
    expect(report.skipped).toBe(1) // listing 2
    expect(report.failed).toBe(0)
    expect(report.failures).toEqual([])

    // find 调用 1 次（查 listings.merchant）
    expect(findCalls).toHaveLength(1)
    // update 调用 2 次（listing 1 + 3，listing 2 跳过）
    expect(updateCalls).toHaveLength(2)
    const updatedIds = updateCalls.map((c) => c.id).sort()
    expect(updatedIds).toEqual([1, 3])
  })

  it('空商户返回零影响', async () => {
    const { payload } = makePayload({ findDocs: [] })
    const report = await markListingsPendingReviewOnMerchantStop(payload as never, 5)
    expect(report.total).toBe(0)
    expect(report.succeeded).toBe(0)
    expect(report.failed).toBe(0)
  })

  it('部分失败时汇总到 failures', async () => {
    const payload = {
      find: vi.fn(async () => ({
        docs: [{ id: 1 }, { id: 2 }],
        totalDocs: 2,
        totalPages: 1,
        page: 1,
      })),
      findByID: vi.fn(async (params: { id: number | string }) => {
        if (params.id === 1) return { reviewStatus: 'approved', version: 1 }
        return null // listing 2 不存在
      }),
      update: vi.fn(async () => {
        return { reviewStatus: 'pending' }
      }),
    }
    const report = await markListingsPendingReviewOnMerchantStop(payload as never, 5)
    expect(report.total).toBe(2)
    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.failures).toEqual([{ listingId: 2, error: 'listing not found' }])
  })
})
