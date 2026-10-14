import { describe, it, expect, vi } from 'vitest'
import {
  countBuildingDeactivationImpact,
  countBuildingsDeactivationImpact,
} from '@/domain/supply/building-references'

/**
 * 楼盘停用影响预检测试（M3.5 → M4.7 / R3, R4, R8）
 *
 * M4.7 口径：停用某楼盘会从前台撤除该楼盘下「当前对外可见」的房源，度量的正是
 * 统一有效供给口径下的房源数——查询层 getEffectiveSupplyWhere 粗筛 + building 约束 +
 * 举报暂停 not_in（§5），取候选后逐条 resolveEffectiveSupply 精筛（商户 §8-§10）。
 * count = 精筛后长度，与前台 / 详情 / 楼盘聚合完全一致。
 *
 * OPT-034 起商户直接读 listing.merchant，不再经 listing-merchant-relations 关系表
 * 解析；精筛因此是纯内存计算，仍不走 payload.count（改 find + 精筛 + length）。
 */

/** 有效供给齐全的候选房源文档（depth≥1 已展开）。 */
function eligibleListing(
  id: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    gallery: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    building: { id: 5, city: { id: 100 } },
    merchant: {
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    ...extra,
  }
}

function makePayload(opts: {
  listings?: Array<Record<string, unknown>>
  pausedReports?: Array<{ targetListing: unknown }>
}) {
  const find = vi.fn(async (params: Record<string, unknown>) => {
    const collection = params.collection
    if (collection === 'listing-reports') {
      return { docs: opts.pausedReports ?? [] }
    }
    if (collection === 'listings') {
      return { docs: opts.listings ?? [] }
    }
    // OPT-034：精筛不再查 listing-merchant-relations——throw 而不是给空 docs，
    // 免得关系表又被悄悄查起来时这里还是绿的。
    throw new Error(`unexpected collection: ${String(collection)}`)
  })
  return { find } as never
}

describe('building-references/countBuildingDeactivationImpact', () => {
  it('无受影响房源 → total 0, referenced false, sources 空', async () => {
    const payload = makePayload({ listings: [] })
    const report = await countBuildingDeactivationImpact(payload, 42)
    expect(report.total).toBe(0)
    expect(report.referenced).toBe(false)
    expect(report.sources).toEqual([])
    expect(report.buildingId).toBe(42)
  })

  it('统计该楼盘下有效供给房源数（精筛后）', async () => {
    const payload = makePayload({
      listings: [
        eligibleListing(1),
        eligibleListing(2),
        // 未设置供给商户 → 精筛淘汰,不计入
        // （2026-08-19 前这里用的是「媒体不足」，图片条件移出精筛后换成「无生效
        // 关系」；OPT-034 删除关系表后再换成「listing.merchant 为空」）
        eligibleListing(3, { merchant: null }),
      ],
    })
    const report = await countBuildingDeactivationImpact(payload, 7)
    expect(report.total).toBe(2)
    expect(report.referenced).toBe(true)
    expect(report.sources).toHaveLength(1)
    expect(report.sources[0].collection).toBe('listings')
    expect(report.sources[0].label).toContain('房源')
    expect(report.sources[0].count).toBe(2)
  })

  it('不再调用 payload.count，走 find + 精筛', async () => {
    const payload = makePayload({ listings: [] })
    await countBuildingDeactivationImpact(payload, 1)
    expect('count' in payload).toBe(false)
  })

  it('listings 查询 where 携带有效供给谓词 + building', async () => {
    const payload = makePayload({ listings: [] })
    await countBuildingDeactivationImpact(payload, 99)
    const calls = (payload as { find: { mock: { calls: Array<[Record<string, unknown>]> } } }).find
      .mock.calls
    const listingCall = calls.find((c) => c[0].collection === 'listings')![0]
    expect(listingCall.where).toMatchObject({
      building: { equals: 99 },
      publicationStatus: { equals: 'published' },
      reviewStatus: { equals: 'approved' },
      supplyVisibilityHold: { equals: 'normal' },
      deletedAt: { exists: false },
    })
  })

  it('举报暂停房源经 id not_in 排除', async () => {
    const payload = makePayload({
      listings: [eligibleListing(1)],
      pausedReports: [{ targetListing: 77 }, { targetListing: { id: 88 } }],
    })
    await countBuildingDeactivationImpact(payload, 1)
    const calls = (payload as { find: { mock: { calls: Array<[Record<string, unknown>]> } } }).find
      .mock.calls
    const listingCall = calls.find((c) => c[0].collection === 'listings')![0]
    expect(listingCall.where).toMatchObject({ id: { not_in: [77, 88] } })
  })

  it('默认 overrideAccess:false（随权限脱敏,用于「停用影响」展示）', async () => {
    const payload = makePayload({ listings: [] })
    await countBuildingDeactivationImpact(payload, 1)
    const calls = (payload as { find: { mock: { calls: Array<[Record<string, unknown>]> } } }).find
      .mock.calls
    const listingCall = calls.find((c) => c[0].collection === 'listings')![0]
    expect(listingCall.overrideAccess).toBe(false)
  })

  it('overrideAccess:true 透传给 listings find（全量统计）', async () => {
    const payload = makePayload({ listings: [] })
    await countBuildingDeactivationImpact(payload, 1, undefined, { overrideAccess: true })
    const calls = (payload as { find: { mock: { calls: Array<[Record<string, unknown>]> } } }).find
      .mock.calls
    const listingCall = calls.find((c) => c[0].collection === 'listings')![0]
    expect(listingCall.overrideAccess).toBe(true)
  })
})

/**
 * OPT-113 批量停用预检：一次查询汇总多个楼盘，口径与单楼盘完全相同（同一套粗筛 + 精筛），
 * 只是 building 约束从 equals 换成 in，并按楼盘拆出计数。
 */
describe('building-references/countBuildingsDeactivationImpact', () => {
  function listingCallOf(payload: unknown): Record<string, unknown> {
    const calls = (payload as { find: { mock: { calls: Array<[Record<string, unknown>]> } } }).find
      .mock.calls
    return calls.find((c) => c[0].collection === 'listings')![0]
  }

  it('一次查询、按楼盘拆分计数；精筛淘汰的不计入', async () => {
    const payload = makePayload({
      listings: [
        eligibleListing(1, { building: { id: 5, city: { id: 100 } } }),
        eligibleListing(2, { building: { id: 5, city: { id: 100 } } }),
        eligibleListing(3, { building: { id: 6, city: { id: 100 } } }),
        eligibleListing(4, { building: { id: 6, city: { id: 100 } }, merchant: null }),
      ],
    })
    const report = await countBuildingsDeactivationImpact(payload, [5, 6, 7])
    expect(report.total).toBe(3)
    expect(report.sources).toEqual([
      { collection: 'listings', label: '对外可见房源', count: 3 },
    ])
    expect(report.byBuilding).toEqual([
      { buildingId: 5, count: 2 },
      { buildingId: 6, count: 1 },
      { buildingId: 7, count: 0 },
    ])
    expect(report.capped).toBe(false)

    const listingCall = listingCallOf(payload)
    expect(listingCall.where).toMatchObject({
      building: { in: [5, 6, 7] },
      publicationStatus: { equals: 'published' },
      reviewStatus: { equals: 'approved' },
      supplyVisibilityHold: { equals: 'normal' },
    })
    // 与单楼盘同口径：默认随权限脱敏
    expect(listingCall.overrideAccess).toBe(false)
  })

  it('举报暂停房源同样经 id not_in 排除', async () => {
    const payload = makePayload({ listings: [], pausedReports: [{ targetListing: 77 }] })
    await countBuildingsDeactivationImpact(payload, [1, 2])
    expect(listingCallOf(payload).where).toMatchObject({ id: { not_in: [77] } })
  })

  it('无受影响房源 → total 0、sources 空', async () => {
    const payload = makePayload({ listings: [] })
    const report = await countBuildingsDeactivationImpact(payload, [1])
    expect(report.total).toBe(0)
    expect(report.sources).toEqual([])
    expect(report.byBuilding).toEqual([{ buildingId: 1, count: 0 }])
  })

  it('空 id 列表 → 直接返回 0，不查库', async () => {
    const payload = makePayload({ listings: [] })
    const report = await countBuildingsDeactivationImpact(payload, [])
    expect(report.total).toBe(0)
    expect((payload as { find: { mock: { calls: unknown[] } } }).find.mock.calls).toHaveLength(0)
  })

  it('候选数触顶 → capped=true（界面据此说「至少」）', async () => {
    const many = Array.from({ length: 500 }, (_, i) => eligibleListing(i + 1))
    const payload = makePayload({ listings: many })
    const report = await countBuildingsDeactivationImpact(payload, [5])
    expect(report.capped).toBe(true)
    expect(report.total).toBe(500)
  })
})
