import { describe, expect, it, vi } from 'vitest'

import {
  findBuildingDuplicates,
  mergeBuildings,
} from '@/domain/supply/building-dedup-service'
import { DUPLICATE_REASONS } from '@/domain/supply/building-dedup'

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
