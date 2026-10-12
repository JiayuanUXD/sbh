/**
 * OPT-035 Task 4：getPlatformHomepageStats 验收（平台汇总 stats，根页口径）
 *
 * 覆盖：根页 `/`（平台入口）跨城汇总各城 stats 计数之和；空城市清单返回全零，
 * 且不应触发任何 adapter 调用。
 *
 * 设计依据：.superpowers/sdd/2026-08-20-homepage-apple-redesign/task-4-brief.md
 */
import { describe, expect, it, vi } from 'vitest'
import { getPlatformHomepageStats } from '@/domain/public-catalog/facade'
import {
  makeArea,
  makeBuilding,
  makeHomepageAdapter,
  makeListing,
} from './helpers/opt035-fixtures'

describe('getPlatformHomepageStats', () => {
  it('生产计数路径优先使用首页 SQL 概览与聚合，无需先拉全城楼盘 ID 数组', async () => {
    const fullScan = vi.fn(async () => { throw new Error('不应全量扫描') })
    const findIdentities = vi.fn(async () => { throw new Error('不应拉取楼盘 ID 列表') })
    const findHomepageListingAggregate = vi.fn(async () => ({
      count: 57500,
      types: [],
      nearbyCandidates: [],
    }))
    const findHomepageBuildingOverview = vi.fn(async () => ({
      count: 1564,
      representatives: [],
      areas: [],
    }))
    const adapter = makeHomepageAdapter({
      findEffectiveListings: fullScan,
      findEffectiveBuildings: fullScan,
      findEffectiveBuildingIdentities: findIdentities,
      findHomepageListingAggregate,
      findHomepageBuildingOverview,
      findEffectiveBusinessAreas: async () => [makeArea({ id: 21 })],
    })
    const stats = await getPlatformHomepageStats(['shanghai'], adapter)
    expect(stats).toEqual({ listings: 57500, buildings: 1564, businessAreas: 1 })
    expect(findHomepageListingAggregate).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ city: 'shanghai', businessType: 'lease' }),
      false,
    )
    expect(findHomepageBuildingOverview).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'shanghai', businessType: 'lease' }),
      [],
    )
    expect(findIdentities).not.toHaveBeenCalled()
    expect(fullScan).not.toHaveBeenCalled()
  })

  it('当首页 SQL 概览缺席时回退到有效供给聚合，不扫描完整房源或楼盘展示字段', async () => {
    const fullScan = vi.fn(async () => { throw new Error('不应全量扫描') })
    const aggregate = vi.fn(async () => new Map([['11', { area: 100, count: 57500 }]]))
    const adapter = makeHomepageAdapter({
      findEffectiveListings: fullScan,
      findEffectiveBuildings: fullScan,
      findEffectiveBuildingIdentities: async () => [makeBuilding({ id: 11 })],
      aggregateEffectiveSupplyByBuildings: aggregate,
      findEffectiveBusinessAreas: async () => [makeArea({ id: 21 })],
    })
    const stats = await getPlatformHomepageStats(['shanghai'], adapter)
    expect(stats).toEqual({ listings: 57500, buildings: 1, businessAreas: 1 })
    expect(aggregate).toHaveBeenCalledWith([11], expect.objectContaining({ city: 'shanghai', businessType: 'lease' }))
    expect(fullScan).not.toHaveBeenCalled()
  })

  it('跨城汇总各城计数之和', async () => {
    const adapter = makeHomepageAdapter({
      // 每城返回相同集合：2 房源 / 1 楼盘 / 1 商圈
      findEffectiveListings: async () => [makeListing({ id: 1 }), makeListing({ id: 2 })],
      findEffectiveBuildings: async () => [makeBuilding({ id: 11 })],
      findEffectiveBusinessAreas: async () => [makeArea({ id: 21 })],
    })
    const stats = await getPlatformHomepageStats(['shanghai', 'hangzhou'], adapter)
    expect(stats).toEqual({ listings: 4, buildings: 2, businessAreas: 2 })
  })

  it('空城市清单返回全零', async () => {
    const stats = await getPlatformHomepageStats([], makeHomepageAdapter())
    expect(stats).toEqual({ listings: 0, buildings: 0, businessAreas: 0 })
  })

  it('按 lease 频道请求各城数据，与城市首页缓存的口径一致（Task 9 补充断言）', async () => {
    const seenBusinessTypes: Array<string | undefined> = []
    const adapter = makeHomepageAdapter({
      findEffectiveListings: async (_input, ctx) => {
        seenBusinessTypes.push(ctx.businessType)
        return []
      },
    })
    await getPlatformHomepageStats(['shanghai', 'hangzhou'], adapter)
    expect(seenBusinessTypes).toEqual(['lease', 'lease'])
  })
})
