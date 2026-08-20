/**
 * OPT-035 Task 4：getPlatformHomepageStats 验收（平台汇总 stats，根页口径）
 *
 * 覆盖：根页 `/`（平台入口）跨城汇总各城 stats 计数之和；空城市清单返回全零，
 * 且不应触发任何 adapter 调用。
 *
 * 设计依据：.superpowers/sdd/2026-08-20-homepage-apple-redesign/task-4-brief.md
 */
import { describe, expect, it } from 'vitest'
import { getPlatformHomepageStats } from '@/domain/public-catalog/facade'
import {
  makeArea,
  makeBuilding,
  makeHomepageAdapter,
  makeListing,
} from './helpers/opt035-fixtures'

describe('getPlatformHomepageStats', () => {
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
})
