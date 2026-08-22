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
  /** 模拟真实命中总数（不受 limit 截断）；不传则默认等于 findDocs.length（未截断） */
  totalDocs?: number
  listingDocs?: Record<string | number, { reviewStatus?: string; version?: number }>
} = {}) {
  const findCalls: FindCall[] = []
  const updateCalls: UpdateCall[] = []
  const { findDocs = [], totalDocs, listingDocs = {} } = options
  const warnCalls: unknown[][] = []

  const payload = {
    find: vi.fn(async (params: { collection: string; where: Record<string, unknown> }) => {
      findCalls.push({ collection: params.collection, where: params.where })
      return { docs: findDocs, totalDocs: totalDocs ?? findDocs.length, totalPages: 1, page: 1 }
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
    logger: {
      warn: vi.fn((...args: unknown[]) => {
        warnCalls.push(args)
      }),
    },
  }
  return { payload, findCalls, updateCalls, warnCalls }
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
    expect(findCalls[0].where).toEqual({ merchant: { equals: 5 }, deletedAt: { exists: false } })
  })

  it('where 精确锁定 merchant.equals + deletedAt.exists:false（防止实现改成相反语义仍测试通过）', async () => {
    // 若实现被误改成 deletedAt:{exists:true}（只冻结已删除房源，语义完全颠倒），
    // 本测试必须失败——这是这条级联唯一的自动化保护，不能只锁键名不锁取值。
    const { payload, findCalls } = makePayload({ findDocs: [{ id: 1 }] })
    await listActiveListingIdsForMerchant(payload as never, 9)
    expect(findCalls[0].where).toEqual({ merchant: { equals: 9 }, deletedAt: { exists: false } })
  })

  it('空结果返回空数组', async () => {
    const { payload } = makePayload({ findDocs: [] })
    const ids = await listActiveListingIdsForMerchant(payload as never, 5)
    expect(ids).toEqual([])
  })

  it('命中总数超过 limit(1000) 时记录截断告警（真实数据已越线的既有风险，见头注释）', async () => {
    // 模拟：真实命中 1200 条，但 payload.find 受 limit 截断只返回 3 条（不构造 1200 条 fixture）
    const { payload, warnCalls } = makePayload({
      findDocs: [{ id: 1 }, { id: 2 }, { id: 3 }],
      totalDocs: 1200,
    })
    const ids = await listActiveListingIdsForMerchant(payload as never, 5)
    expect(ids).toEqual([1, 2, 3])
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0][0]).toEqual({ merchantId: 5, totalDocs: 1200, limit: 1000, returned: 3 })
    expect(warnCalls[0][1]).toBe('merchant_stop_listings_truncated')
  })

  it('命中总数未超过 limit 时不记录告警', async () => {
    const { payload, warnCalls } = makePayload({
      findDocs: [{ id: 1 }, { id: 2 }],
      totalDocs: 2,
    })
    await listActiveListingIdsForMerchant(payload as never, 5)
    expect(warnCalls).toHaveLength(0)
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
