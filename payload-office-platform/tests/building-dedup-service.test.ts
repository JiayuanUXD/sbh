import { describe, expect, it, vi } from 'vitest'

import {
  findBuildingDuplicates,
  mergeBuildings,
} from '@/domain/supply/building-dedup-service'
import { DUPLICATE_REASONS } from '@/domain/supply/building-dedup'
import { TransactionAbortedError } from '@/domain/shared/transaction-safety'

/**
 * M3.2 楼盘查重 / 合并服务单测（tasks.md M3.2 / R3, R8）
 * mock payload：按 collection + where 分派 find / findByID / update。
 */

describe('building-dedup-service/findBuildingDuplicates', () => {
  it('仅在同城候选中筛出高相似记录，排除自身与逻辑删除', async () => {
    const find = vi.fn(async (_args: Record<string, unknown>) => ({
      docs: [
        { id: 1, name: '环球金融中心', slug: 'a', district: 10, address: '世纪大道', operationalStatus: 'active', latitude: null, longitude: null },
        { id: 2, name: '恒隆广场', slug: 'b', district: 11, address: '南京西路', operationalStatus: 'active', latitude: 31.23, longitude: 121.4705 },
        { id: 3, name: '嘉里中心', slug: 'c', district: 12, address: '静安', operationalStatus: 'active', latitude: 31.5, longitude: 121.9 },
      ],
    }))
    const payload = { find } as never

    const report = await findBuildingDuplicates(payload, {
      name: '环球 金融中心',
      cityId: 100,
      latitude: 31.23,
      longitude: 121.47,
      excludeId: 99,
    })

    expect(report.candidates.map((c) => c.id)).toEqual([1, 2])
    expect(report.hasDuplicate).toBe(true)
    expect(report.total).toBe(2)
    // 候选带原因与详情
    const first = report.candidates[0]
    expect(first.reasons).toContain(DUPLICATE_REASONS.SAME_NAME)
    expect(first.name).toBe('环球金融中心')
    expect(first.address).toBe('世纪大道')

    // 查询按同城 + 排除自身 + 非删除
    const arg = find.mock.calls[0][0] as { collection: string; where: Record<string, unknown> }
    expect(arg.collection).toBe('buildings')
    expect(arg.where).toMatchObject({ city: { equals: 100 }, id: { not_equals: 99 } })
  })

  it('无城市 → 直接空报告，不查询', async () => {
    const find = vi.fn()
    const payload = { find } as never
    const report = await findBuildingDuplicates(payload, {
      name: '某楼',
      cityId: null,
      latitude: null,
      longitude: null,
    })
    expect(report.hasDuplicate).toBe(false)
    expect(report.candidates).toEqual([])
    expect(find).not.toHaveBeenCalled()
  })
})

describe('building-dedup-service/mergeBuildings', () => {
  function makeMergePayload(overrides?: {
    sourceRelations?: Array<Record<string, unknown>>
    targetRelations?: Array<Record<string, unknown>>
    sourceListings?: Array<Record<string, unknown>>
  }) {
    const buildings: Record<string, Record<string, unknown>> = {
      '1': { id: 1, name: '源楼盘', city: 100, deletedAt: null, version: 1 },
      '2': { id: 2, name: '目标楼盘', city: 100, deletedAt: null, version: 1 },
    }
    const findByID = vi.fn(async ({ id }: { id: number | string }) => {
      const doc = buildings[String(id)]
      if (!doc) throw new Error('not found')
      return doc
    })
    const find = vi.fn(async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => {
      const buildingEq = (where?.building as { equals?: number | string } | undefined)?.equals
      if (collection === 'building-merchant-relations') {
        const rel = buildingEq === 1 ? overrides?.sourceRelations : overrides?.targetRelations
        return { docs: rel ?? [] }
      }
      if (collection === 'listings') {
        return { docs: buildingEq === 1 ? overrides?.sourceListings ?? [] : [] }
      }
      return { docs: [] }
    })
    const update = vi.fn(async (_args: Record<string, unknown>) => ({}))
    return { payload: { findByID, find, update } as never, findByID, find, update }
  }

  it('源=目标 → 拒绝', async () => {
    const { payload } = makeMergePayload()
    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 1 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('INVALID_MERGE')
  })

  it('目标不存在 → 拒绝', async () => {
    const { payload } = makeMergePayload()
    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 999 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('NOT_FOUND')
  })

  it('迁移关联 + 软删源，返回迁移计数', async () => {
    const { payload, update } = makeMergePayload({
      sourceRelations: [
        { id: 50, building: 1, merchant: 7, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, version: 1 },
      ],
      targetRelations: [],
      sourceListings: [
        { id: 80, building: 1 },
        { id: 81, building: 1 },
      ],
    })
    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 2 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.report.migratedRelations).toBe(1)
      expect(res.report.migratedListings).toBe(2)
      expect(res.report.targetId).toBe(2)
    }

    // 关系迁移到目标（携带完整字段满足 protect hook）
    const relUpdate = update.mock.calls.find(
      ([a]) => (a as { collection: string }).collection === 'building-merchant-relations',
    )?.[0] as { data: Record<string, unknown> }
    expect(relUpdate.data.building).toBe(2)
    expect(relUpdate.data.merchant).toBe(7)

    // 房源迁移到目标
    const listingUpdates = update.mock.calls.filter(
      ([a]) => (a as { collection: string }).collection === 'listings',
    )
    expect(listingUpdates).toHaveLength(2)
    expect((listingUpdates[0][0] as { data: Record<string, unknown> }).data.building).toBe(2)

    // 源楼盘软删除（deletedAt 非空），非物理删除
    const srcUpdate = update.mock.calls.find(
      ([a]) => (a as { collection: string; id: unknown }).collection === 'buildings' &&
        (a as { id: unknown }).id === 1,
    )?.[0] as { data: Record<string, unknown> }
    expect(srcUpdate.data.deletedAt).toBeTruthy()
  })

  it('迁移后与目标既有关系区间重叠 → 预检失败，不发生任何写入', async () => {
    const { payload, update } = makeMergePayload({
      sourceRelations: [
        { id: 50, building: 1, merchant: 7, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, version: 1 },
      ],
      targetRelations: [
        { id: 60, building: 2, merchant: 9, effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: null, version: 1 },
      ],
    })
    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 2 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('RELATION_OVERLAP')
    expect(update).not.toHaveBeenCalled()
  })
})

/**
 * 合并的原子性（2026-08-31）
 *
 * 原注释写着「原子性由调用方在同一请求事务内传入 req 保证」，但**没有任何调用方
 * 这么做**：`building-merge-endpoint` 只是把 req 透传下来，而 Payload 的自定义
 * endpoint 不会开事务。于是每一次 `payload.update` 在 `initTransaction` 里都发现
 * `req.transactionID` 是空的，各自开一笔、各自提交——
 *
 *   关系迁移成功 → 房源迁移成功 → 软删源楼盘失败
 *
 * 会留下「关系和房源都搬走了、源楼盘还活着」的半合并状态，而 endpoint 返回 5xx，
 * 运营看到失败、数据却已经动了一半。
 *
 * 这里锁的是：mergeBuildings 自己开且只开一笔事务，所有写入都带着同一个
 * transactionID；任一步失败整笔回滚；已有外层事务时不抢提交权。
 */
describe('building-dedup-service/mergeBuildings 事务原子性', () => {
  type FakeReq = { transactionID?: unknown; payload?: unknown }

  function makeTxnPayload(options?: {
    sourceRelations?: Array<Record<string, unknown>>
    sourceListings?: Array<Record<string, unknown>>
    onUpdate?: (args: Record<string, unknown>, req: FakeReq) => void
  }) {
    const buildings: Record<string, Record<string, unknown>> = {
      '1': { id: 1, name: '源楼盘', city: 100, deletedAt: null, version: 1 },
      '2': { id: 2, name: '目标楼盘', city: 100, deletedAt: null, version: 1 },
    }
    const begin = vi.fn(async () => 'txn-A')
    const commit = vi.fn(async (_id?: unknown) => undefined)
    const rollback = vi.fn(async (_id?: unknown) => undefined)
    /** 每次写入时 req 上挂着的事务 id——原子性就体现在这些值是否同一笔。 */
    const seenTransactionIds: unknown[] = []

    const req: FakeReq = {}
    const payload = {
      db: { beginTransaction: begin, commitTransaction: commit, rollbackTransaction: rollback },
      findByID: vi.fn(async ({ id }: { id: number | string }) => {
        const doc = buildings[String(id)]
        if (!doc) throw new Error('not found')
        return doc
      }),
      find: vi.fn(async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => {
        const buildingEq = (where?.building as { equals?: number | string } | undefined)?.equals
        if (collection === 'building-merchant-relations') {
          return { docs: buildingEq === 1 ? options?.sourceRelations ?? [] : [] }
        }
        if (collection === 'listings') {
          return { docs: buildingEq === 1 ? options?.sourceListings ?? [] : [] }
        }
        return { docs: [] }
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        seenTransactionIds.push(req.transactionID)
        options?.onUpdate?.(args, req)
        return {}
      }),
    }
    req.payload = payload
    return { payload: payload as never, req: req as never, rawReq: req, begin, commit, rollback, seenTransactionIds }
  }

  const FIXTURE = {
    sourceRelations: [
      { id: 50, building: 1, merchant: 7, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, version: 1 },
    ],
    sourceListings: [{ id: 80, building: 1 }, { id: 81, building: 1 }],
  }

  it('整笔合并只开一笔事务，四次写入全部带同一个 transactionID', async () => {
    const { payload, req, begin, commit, rollback, seenTransactionIds } = makeTxnPayload(FIXTURE)

    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 2 }, req)

    expect(res.ok).toBe(true)
    expect(begin).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(rollback).not.toHaveBeenCalled()
    // 1 条关系 + 2 条房源 + 1 次软删源楼盘
    expect(seenTransactionIds).toHaveLength(4)
    expect(new Set(seenTransactionIds)).toEqual(new Set(['txn-A']))
  })

  it('软删源楼盘失败 → 已迁移的关系与房源整体回滚，错误抛出', async () => {
    const { payload, req, commit, rollback } = makeTxnPayload({
      ...FIXTURE,
      onUpdate: (args) => {
        if (args.collection === 'buildings') throw new Error('soft delete failed')
      },
    })

    await expect(
      mergeBuildings(payload, { sourceId: 1, targetId: 2 }, req),
    ).rejects.toThrow('soft delete failed')
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })

  it('预检失败（区间重叠）也回滚，不留下空提交', async () => {
    const { payload, req, commit, rollback } = makeTxnPayload({
      sourceRelations: FIXTURE.sourceRelations,
    })
    // 目标已有重叠区间：改用 find 返回目标关系
    ;(payload as unknown as { find: ReturnType<typeof vi.fn> }).find = vi.fn(
      async ({ collection, where }: { collection: string; where: Record<string, unknown> }) => {
        const buildingEq = (where?.building as { equals?: number | string } | undefined)?.equals
        if (collection === 'building-merchant-relations') {
          return {
            docs:
              buildingEq === 1
                ? FIXTURE.sourceRelations
                : [{ id: 60, building: 2, merchant: 9, effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: null, version: 1 }],
          }
        }
        return { docs: [] }
      },
    )

    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 2 }, req)

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('RELATION_OVERLAP')
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })

  it('调用方已经开了事务 → 不抢提交权，也不自己开第二笔', async () => {
    const { payload, rawReq, req, begin, commit, rollback, seenTransactionIds } = makeTxnPayload(FIXTURE)
    rawReq.transactionID = 'outer-txn'

    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 2 }, req)

    expect(res.ok).toBe(true)
    expect(begin).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(rollback).not.toHaveBeenCalled()
    expect(new Set(seenTransactionIds)).toEqual(new Set(['outer-txn']))
  })

  it('写入过程中事务被别人拆掉 → 抛错，绝不返回 ok:true', async () => {
    const { payload, req } = makeTxnPayload({
      ...FIXTURE,
      onUpdate: (args, r) => {
        // 模拟 Payload 的 killTransaction：回滚并抹掉 req 上的事务，但不抛错
        if (args.collection === 'listings') delete r.transactionID
      },
    })

    await expect(
      mergeBuildings(payload, { sourceId: 1, targetId: 2 }, req),
    ).rejects.toBeInstanceOf(TransactionAbortedError)
  })

  it('不传 req 时退化成逐条写入（保持旧行为，不静默假装原子）', async () => {
    const { payload, begin, commit } = makeTxnPayload(FIXTURE)
    const res = await mergeBuildings(payload, { sourceId: 1, targetId: 2 })
    expect(res.ok).toBe(true)
    expect(begin).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
})
