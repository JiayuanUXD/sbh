import { describe, expect, it, vi } from 'vitest'

import {
  MERCHANT_STOP_CASCADE_QUEUE,
  MERCHANT_STOP_CASCADE_TASK,
  cascadeMerchantStopListings,
  enqueueMerchantStopCascade,
  findMerchantListingPage,
  markListingsPendingReview,
  merchantStopCascadeTask,
} from '../src/domain/supply/merchant-stop-listings'

/**
 * M4.8 商户停用冻结：批量标记关联 Listing 为待复核（design §3.5 / R2 §56 / R4 / R8）
 *
 * 业务不变量：
 *   - 商户停用时把当前由该商户供给（listings.merchant = merchantId）的房源全部置 reviewStatus=pending
 *   - **全部**是字面意思：游标遍历到底，不再有 limit 截断（原实现 limit:1000
 *     会把「官网」名下 2161 条里的 1161 条静默跳过，商户恢复启用时绕过人工复核）
 *   - 已是 pending 的房源跳过（避免无谓写入 + version 递增），也是 job 重试幂等的支点
 *   - publicationStatus 不改（保持 draft/published/offline 现值）
 *   - 写侧不共享事务：单条房源失败不连累同批其它房源
 *   - 失败详情返回给调用方（cascade 不抛，由 job handler 决定是否失败重试）
 */

interface FindCall {
  collection: string
  where: Record<string, unknown>
  sort?: string
  limit?: number
  req?: unknown
}

interface UpdateCall {
  collection: string
  id: number | string
  data: Record<string, unknown>
  req?: unknown
}

/**
 * 构造一个按 id 游标分页的假 payload。
 *
 * allIds 是「该商户名下全部房源」，find 会按 where.id.greater_than + limit
 * 真的切片返回——这样 cursor 逻辑本身才被测到，而不是被 mock 绕过。
 */
function makePagedPayload(options: {
  allIds?: Array<number>
  listingDocs?: Record<string | number, { reviewStatus?: string; version?: number }>
} = {}) {
  const { allIds = [], listingDocs = {} } = options
  const findCalls: FindCall[] = []
  const updateCalls: UpdateCall[] = []
  const infoCalls: unknown[][] = []

  const payload = {
    find: vi.fn(async (params: {
      collection: string
      where: Record<string, unknown>
      sort?: string
      limit?: number
      req?: unknown
    }) => {
      findCalls.push({
        collection: params.collection,
        where: params.where,
        sort: params.sort,
        limit: params.limit,
        req: params.req,
      })
      const after = (params.where.id as { greater_than?: number } | undefined)?.greater_than
      const limit = params.limit ?? 200
      const page = allIds.filter((id) => after === undefined || id > after).slice(0, limit)
      return { docs: page.map((id) => ({ id })) }
    }),
    findByID: vi.fn(async (params: { id: number | string }) => listingDocs[params.id] ?? null),
    update: vi.fn(async (params: {
      collection: string
      id: number | string
      data: Record<string, unknown>
      req?: unknown
    }) => {
      updateCalls.push({
        collection: params.collection,
        id: params.id,
        data: params.data,
        req: params.req,
      })
      // 写回，让「已 pending 则跳过」的幂等性在重复调用时真的生效
      listingDocs[params.id] = { ...listingDocs[params.id], ...params.data }
      return listingDocs[params.id]
    }),
    logger: {
      info: vi.fn((...args: unknown[]) => {
        infoCalls.push(args)
      }),
    },
  }
  return { payload, findCalls, updateCalls, infoCalls, listingDocs }
}

/** 生成 reviewStatus=approved 的房源字典 */
function approvedDocs(ids: number[]): Record<number, { reviewStatus: string; version: number }> {
  return Object.fromEntries(ids.map((id) => [id, { reviewStatus: 'approved', version: 1 }]))
}

describe('findMerchantListingPage', () => {
  it('按 listings.merchant 找该商户供给的房源，不再查关系表', async () => {
    const { payload, findCalls } = makePagedPayload({ allIds: [11, 12] })
    const page = await findMerchantListingPage(payload as never, 7)
    expect(page.ids).toEqual([11, 12])
    expect(findCalls[0].collection).toBe('listings')
    expect(findCalls[0].where).toMatchObject({ merchant: { equals: 7 } })
  })

  it('where 精确锁定 merchant.equals + deletedAt.exists:false（防止实现改成相反语义仍测试通过）', async () => {
    // 若实现被误改成 deletedAt:{exists:true}（只冻结已删除房源，语义完全颠倒），
    // 本测试必须失败——这是这条级联唯一的自动化保护，不能只锁键名不锁取值。
    const { payload, findCalls } = makePagedPayload({ allIds: [1] })
    await findMerchantListingPage(payload as never, 9)
    expect(findCalls[0].where).toEqual({ merchant: { equals: 9 }, deletedAt: { exists: false } })
  })

  it('首页不带游标条件，按 id 升序排序', async () => {
    const { payload, findCalls } = makePagedPayload({ allIds: [1, 2] })
    await findMerchantListingPage(payload as never, 5)
    expect(findCalls[0].where).not.toHaveProperty('id')
    expect(findCalls[0].sort).toBe('id')
  })

  it('传 after 时带 id.greater_than 游标条件', async () => {
    const { payload, findCalls } = makePagedPayload({ allIds: [1, 2, 3] })
    const page = await findMerchantListingPage(payload as never, 5, { after: 1, limit: 2 })
    expect(findCalls[0].where).toMatchObject({ id: { greater_than: 1 } })
    expect(page.ids).toEqual([2, 3])
  })

  it('返回满页时给出 nextCursor（本页最后一条 id）', async () => {
    const { payload } = makePagedPayload({ allIds: [1, 2, 3, 4, 5] })
    const page = await findMerchantListingPage(payload as never, 5, { limit: 3 })
    expect(page.ids).toEqual([1, 2, 3])
    expect(page.nextCursor).toBe(3)
  })

  it('不足一页说明已到末页，nextCursor 为 null', async () => {
    const { payload } = makePagedPayload({ allIds: [1, 2] })
    const page = await findMerchantListingPage(payload as never, 5, { limit: 10 })
    expect(page.nextCursor).toBeNull()
  })

  it('空结果返回空数组且 nextCursor 为 null', async () => {
    const { payload } = makePagedPayload({ allIds: [] })
    const page = await findMerchantListingPage(payload as never, 5)
    expect(page.ids).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
})

describe('markListingsPendingReview', () => {
  it('已是 pending 的房源跳过更新', async () => {
    const { payload, updateCalls } = makePagedPayload({
      listingDocs: {
        1: { reviewStatus: 'pending', version: 3 },
        2: { reviewStatus: 'approved', version: 1 },
      },
    })
    const results = await markListingsPendingReview(payload as never, [1, 2])
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ listingId: 1, ok: true, skipped: true })
    expect(results[1]).toEqual({ listingId: 2, ok: true })
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].id).toBe(2)
    expect(updateCalls[0].data.reviewStatus).toBe('pending')
  })

  it('listing 不存在时返回 ok=false', async () => {
    const { payload, updateCalls } = makePagedPayload({ listingDocs: {} })
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

  it('单条失败不影响同一批里的其它房源', async () => {
    // 写侧不共享事务，所以坏房源不会污染整批（共享事务下 PG 会拒绝后续语句）
    const payload = {
      findByID: vi.fn(async (params: { id: number }) =>
        params.id === 2 ? null : { reviewStatus: 'approved', version: 1 },
      ),
      update: vi.fn(async () => ({ reviewStatus: 'pending' })),
    }
    const results = await markListingsPendingReview(payload as never, [1, 2, 3])
    expect(results.map((r) => r.ok)).toEqual([true, false, true])
    expect(payload.update).toHaveBeenCalledTimes(2)
  })

  it('publicationStatus 不改（仅改 reviewStatus）', async () => {
    const { payload, updateCalls } = makePagedPayload({
      listingDocs: { 1: { reviewStatus: 'approved', version: 1 } },
    })
    await markListingsPendingReview(payload as never, [1])
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].data).toEqual({ reviewStatus: 'pending' })
    expect(updateCalls[0].data).not.toHaveProperty('publicationStatus')
  })
})

describe('cascadeMerchantStopListings', () => {
  it('游标翻页遍历全量：数量超过单页上限时一条都不漏（回归 limit:1000 静默截断）', async () => {
    // 生产实测「官网」名下 2161 条；这里用 2161 复刻同一量级，pageSize 200
    const allIds = Array.from({ length: 2161 }, (_, i) => i + 1)
    const { payload, updateCalls, findCalls } = makePagedPayload({
      allIds,
      listingDocs: approvedDocs(allIds),
    })

    const report = await cascadeMerchantStopListings(payload as never, 1, { pageSize: 200 })

    expect(report.total).toBe(2161)
    expect(report.succeeded).toBe(2161)
    expect(report.failed).toBe(0)
    expect(updateCalls).toHaveLength(2161)
    // 每条 id 都被写到，没有任何一条被跳过
    expect(new Set(updateCalls.map((c) => c.id)).size).toBe(2161)
    // 2161 / 200 = 10 整页 + 末页 161 条；末页不足一页即收敛，不必再取一次
    expect(report.pages).toBe(11)
    expect(findCalls).toHaveLength(11)
  })

  it('总数正好整除页大小时，多取一次空页收敛（不会漏掉最后一页，也不会死循环）', async () => {
    const allIds = [1, 2, 3, 4]
    const { payload, findCalls } = makePagedPayload({
      allIds,
      listingDocs: approvedDocs(allIds),
    })
    const report = await cascadeMerchantStopListings(payload as never, 1, { pageSize: 2 })
    expect(report.total).toBe(4)
    expect(report.succeeded).toBe(4)
    expect(report.pages).toBe(2)
    expect(findCalls).toHaveLength(3) // 2 页数据 + 1 次空页
  })

  it('游标严格前进：每页的 id.greater_than 都是上一页最后一条', async () => {
    const allIds = [1, 2, 3, 4, 5]
    const { payload, findCalls } = makePagedPayload({
      allIds,
      listingDocs: approvedDocs(allIds),
    })
    await cascadeMerchantStopListings(payload as never, 1, { pageSize: 2 })
    const cursors = findCalls.map(
      (c) => (c.where.id as { greater_than?: number } | undefined)?.greater_than,
    )
    expect(cursors).toEqual([undefined, 2, 4])
  })

  it('写侧不透传 req（每条 update 各自开事务，避免长事务超时与坏条目污染整批）', async () => {
    const allIds = [1, 2]
    const { payload, updateCalls } = makePagedPayload({
      allIds,
      listingDocs: approvedDocs(allIds),
    })
    await cascadeMerchantStopListings(payload as never, 1)
    expect(updateCalls).toHaveLength(2)
    for (const call of updateCalls) {
      expect(call.req).toBeUndefined()
    }
  })

  it('重复跑幂等：第二次全部命中已 pending，零写入', async () => {
    const allIds = [1, 2, 3]
    const { payload, updateCalls } = makePagedPayload({
      allIds,
      listingDocs: approvedDocs(allIds),
    })
    const first = await cascadeMerchantStopListings(payload as never, 1)
    expect(first.succeeded).toBe(3)
    expect(first.skipped).toBe(0)

    const second = await cascadeMerchantStopListings(payload as never, 1)
    expect(second.total).toBe(3)
    expect(second.succeeded).toBe(0)
    expect(second.skipped).toBe(3)
    expect(updateCalls).toHaveLength(3) // 仍是第一次的 3 次
  })

  it('空商户返回零影响', async () => {
    const { payload } = makePagedPayload({ allIds: [] })
    const report = await cascadeMerchantStopListings(payload as never, 5)
    expect(report.total).toBe(0)
    expect(report.succeeded).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.pages).toBe(0)
  })

  it('部分失败汇总到 failures，且不中断后续页的遍历', async () => {
    const allIds = [1, 2, 3, 4]
    const docs = approvedDocs(allIds)
    delete (docs as Record<number, unknown>)[2] // listing 2 不存在
    const { payload } = makePagedPayload({ allIds, listingDocs: docs })

    const report = await cascadeMerchantStopListings(payload as never, 5, { pageSize: 2 })

    expect(report.total).toBe(4)
    expect(report.succeeded).toBe(3)
    expect(report.failed).toBe(1)
    expect(report.failures).toEqual([{ listingId: 2, error: 'listing not found' }])
  })

  it('游标不前进时抛错而不是空转（防 sort/where 被改坏导致死循环）', async () => {
    // find 恒返回同一满页 → nextCursor 永远是 1，游标停滞
    const payload = {
      find: vi.fn(async () => ({ docs: [{ id: 1 }] })),
      findByID: vi.fn(async () => ({ reviewStatus: 'pending' })),
      update: vi.fn(),
      logger: { info: vi.fn() },
    }
    await expect(
      cascadeMerchantStopListings(payload as never, 5, { pageSize: 1 }),
    ).rejects.toThrow('merchant_stop_cascade_cursor_stalled')
  })

  it('完成后记录汇总日志', async () => {
    const allIds = [1, 2]
    const { payload, infoCalls } = makePagedPayload({
      allIds,
      listingDocs: approvedDocs(allIds),
    })
    await cascadeMerchantStopListings(payload as never, 42)
    expect(infoCalls).toHaveLength(1)
    expect(infoCalls[0][0]).toMatchObject({ merchantId: 42, total: 2, succeeded: 2, failed: 0 })
    expect(infoCalls[0][1]).toBe('merchant_stop_cascade_completed')
  })
})

describe('enqueueMerchantStopCascade', () => {
  it('投递到停用冻结队列，并透传 req（与停用同事务）', async () => {
    const queue = vi.fn(async () => ({ id: 1 }))
    const req = { payload: { jobs: { queue } } }
    await enqueueMerchantStopCascade(req as never, 7)
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({
        task: MERCHANT_STOP_CASCADE_TASK,
        queue: MERCHANT_STOP_CASCADE_QUEUE,
        input: { merchantId: '7' },
        req,
      }),
    )
  })
})

/** TaskConfig.handler 类型上允许是「handler 文件路径」字符串，这里收窄成函数 */
function taskHandler() {
  const handler = merchantStopCascadeTask.handler
  if (typeof handler !== 'function') throw new Error('handler 应是内联函数')
  return handler
}

describe('merchantStopCascadeTask', () => {
  it('input 的 merchantId 字符串还原成数字再查（否则 relationship 查询对不上）', async () => {
    const allIds = [1, 2]
    const { payload, findCalls } = makePagedPayload({
      allIds,
      listingDocs: approvedDocs(allIds),
    })
    const result = await taskHandler()({
      input: { merchantId: '31' },
      req: { payload },
    } as never)
    expect(findCalls[0].where).toMatchObject({ merchant: { equals: 31 } })
    expect((result as { output: { total: number } }).output).toEqual({
      total: 2,
      succeeded: 2,
      skipped: 0,
      failed: 0,
    })
  })

  it('有失败条目时抛错，让 payload_jobs 记录并触发重试（停用早已提交，抛错不连累它）', async () => {
    const allIds = [1, 2]
    const docs = approvedDocs(allIds)
    delete (docs as Record<number, unknown>)[2]
    const { payload } = makePagedPayload({ allIds, listingDocs: docs })

    await expect(
      taskHandler()({
        input: { merchantId: '5' },
        req: { payload },
      } as never),
    ).rejects.toThrow(/merchant_stop_cascade_partial_failure.*failed=1/)
  })

  it('任务 slug 与队列名与 payload.config 注册值一致', () => {
    expect(merchantStopCascadeTask.slug).toBe(MERCHANT_STOP_CASCADE_TASK)
    expect(MERCHANT_STOP_CASCADE_TASK).toBe('cascade-merchant-stop-listings')
    expect(MERCHANT_STOP_CASCADE_QUEUE).toBe('merchant-stop-cascade')
  })
})
