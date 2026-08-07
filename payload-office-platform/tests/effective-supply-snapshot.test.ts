import { describe, expect, it, vi } from 'vitest'

import {
  toId,
  buildEffectiveSnapshot,
  loadRelationPeriod,
  resolveEffectiveSupply,
  resolveEffectiveSupplies,
} from '@/domain/review/effective-supply-snapshot'
import { EFFECTIVE_SUPPLY_EXCLUSION_CODES } from '@/domain/review/effective-supply'

/**
 * M4.7 有效供给快照助手单测
 *
 * 这些助手从 listing-publish-endpoint.ts 提取,供发布 endpoint 与 C 端适配器共用:
 *   - toId：关系字段归一为 id
 *   - buildEffectiveSnapshot：已解析房源文档 → 精筛入参
 *   - loadRelationPeriod：查当前生效的房源-商户关系区间
 *   - resolveEffectiveSupply：一站式(载关系 + 建快照 + 精筛)
 */

const asOf = new Date('2026-07-26T00:00:00.000Z')

/** 有效供给齐全的房源文档(depth≥1 已展开)。 */
function makeListing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    gallery: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    building: { id: 5, city: { id: 100 } },
    merchant: {
      id: 20,
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
      serviceCities: [{ id: 100 }],
    },
    ...overrides,
  }
}

describe('effective-supply-snapshot/toId', () => {
  it('数字/字符串直接返回', () => {
    expect(toId(5)).toBe(5)
    expect(toId('abc')).toBe('abc')
  })

  it('对象取 id', () => {
    expect(toId({ id: 7 })).toBe(7)
    expect(toId({ id: 'x' })).toBe('x')
  })

  it('null/undefined/无 id 对象 → null', () => {
    expect(toId(null)).toBeNull()
    expect(toId(undefined)).toBeNull()
    expect(toId({})).toBeNull()
  })
})

describe('effective-supply-snapshot/buildEffectiveSnapshot', () => {
  it('从已解析文档抽取媒体数/商户/楼盘城市', () => {
    const snap = buildEffectiveSnapshot(makeListing(), {
      startsAt: '2000-01-01T00:00:00.000Z',
      endsAt: null,
    })
    expect(snap.mediaCount).toBe(3)
    expect(snap.merchant.status).toBe('active')
    expect(snap.merchant.serviceCityIds).toEqual([100])
    expect(snap.buildingCityId).toBe(100)
    expect(snap.relationPeriod).toEqual({ startsAt: '2000-01-01T00:00:00.000Z', endsAt: null })
  })

  it('gallery 缺失 → mediaCount=0', () => {
    const snap = buildEffectiveSnapshot(makeListing({ gallery: undefined }), null)
    expect(snap.mediaCount).toBe(0)
  })

  it('building 缺失 → buildingCityId=null', () => {
    const snap = buildEffectiveSnapshot(makeListing({ building: null }), null)
    expect(snap.buildingCityId).toBeNull()
  })
})

describe('effective-supply-snapshot/loadRelationPeriod', () => {
  it('查到关系 → 转 ValidityPeriod(按 -effectiveFrom 取最近一条)', async () => {
    const find = vi.fn(async () => ({
      docs: [{ id: 1, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null }],
    }))
    const payload = { find } as unknown as Parameters<typeof loadRelationPeriod>[0]
    const period = await loadRelationPeriod(payload, 1)
    expect(period).toEqual({ startsAt: '2026-01-01T00:00:00.000Z', endsAt: null })
    const calls = find.mock.calls as unknown as Array<Array<Record<string, unknown>>>
    const arg = calls[0][0]
    expect(arg.collection).toBe('listing-merchant-relations')
    expect(arg.sort).toBe('-effectiveFrom')
    expect(arg.limit).toBe(1)
  })

  it('无关系记录 → null', async () => {
    const find = vi.fn(async (_params: unknown) => ({ docs: [] }))
    const payload = { find } as unknown as Parameters<typeof loadRelationPeriod>[0]
    expect(await loadRelationPeriod(payload, 1)).toBeNull()
  })

  it('关系时刻非法 → null(不抛)', async () => {
    const find = vi.fn(async () => ({
      docs: [{ id: 1, effectiveFrom: 'not-a-date', effectiveTo: null }],
    }))
    const payload = { find } as unknown as Parameters<typeof loadRelationPeriod>[0]
    expect(await loadRelationPeriod(payload, 1)).toBeNull()
  })
})

describe('effective-supply-snapshot/resolveEffectiveSupply', () => {
  it('有效供给齐全 → eligible=true', async () => {
    const find = vi.fn(async () => ({
      docs: [{
        id: 1,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveTo: null,
        merchant: makeListing().merchant,
      }],
    }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]
    const r = await resolveEffectiveSupply(payload, makeListing(), asOf)
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('无关系 → RELATION_NOT_EFFECTIVE', async () => {
    const find = vi.fn(async () => ({ docs: [] }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]
    const r = await resolveEffectiveSupply(payload, makeListing(), asOf)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE)
  })

  it('媒体不足 → INSUFFICIENT_MEDIA', async () => {
    const find = vi.fn(async () => ({
      docs: [{
        id: 1,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveTo: null,
        merchant: makeListing().merchant,
      }],
    }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]
    const r = await resolveEffectiveSupply(payload, makeListing({ gallery: [{ id: 'a' }] }), asOf)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.INSUFFICIENT_MEDIA)
  })

  it('uses the merchant from the effective relation instead of stale listing data', async () => {
    const find = vi.fn(async () => ({
      docs: [{
        id: 1,
        effectiveFrom: '2000-01-01T00:00:00.000Z',
        effectiveTo: null,
        merchant: {
          status: 'disabled',
          qualificationStatus: 'valid',
          qualificationExpiresAt: '2999-01-01T00:00:00.000Z',
          serviceCities: [{ id: 100 }],
        },
      }],
    }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]

    const result = await resolveEffectiveSupply(payload, makeListing(), asOf)
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.MERCHANT_INELIGIBLE)
  })

  it('fails closed when overlapping relations are returned', async () => {
    const relation = {
      effectiveFrom: '2000-01-01T00:00:00.000Z',
      effectiveTo: null,
      merchant: makeListing().merchant,
    }
    const find = vi.fn(async () => ({ docs: [{ id: 1, ...relation }, { id: 2, ...relation }] }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]

    const result = await resolveEffectiveSupply(payload, makeListing(), asOf)
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE)
  })

  it('queries the unique half-open relation at the requested asOf', async () => {
    const find = vi.fn(async (_params: unknown) => ({ docs: [] }))
    const payload = { find } as unknown as Parameters<typeof resolveEffectiveSupply>[0]
    await resolveEffectiveSupply(payload, makeListing(), asOf)

    const params = find.mock.calls[0][0] as Record<string, unknown>
    expect(params.limit).toBe(2)
    expect(params.depth).toBe(2)
    expect(params.overrideAccess).toBe(true)
    expect(params.where).toEqual({
      and: [
        { listing: { equals: 1 } },
        { effectiveFrom: { less_than_equal: asOf.toISOString() } },
        {
          or: [
            { effectiveTo: { exists: false } },
            { effectiveTo: { greater_than: asOf.toISOString() } },
          ],
        },
      ],
    })
  })
})

describe('effective-supply-snapshot/resolveEffectiveSupplies', () => {
  it('loads two listings with one relation query and fails closed for overlaps', async () => {
    const merchant = makeListing().merchant
    const find = vi.fn<(params: Record<string, unknown>) => Promise<{
      docs: Array<Record<string, unknown>>
    }>>(async () => ({
      docs: [
        {
          id: 11,
          listing: 1,
          effectiveFrom: '2000-01-01T00:00:00.000Z',
          effectiveTo: null,
          merchant,
        },
        {
          id: 21,
          listing: { id: 2 },
          effectiveFrom: '2000-01-01T00:00:00.000Z',
          effectiveTo: null,
          merchant,
        },
        {
          id: 22,
          listing: { id: 2 },
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveTo: null,
          merchant,
        },
      ],
      hasNextPage: false,
      nextPage: null,
    }))
    const payload: Parameters<typeof resolveEffectiveSupplies>[0] = { find }

    const results = await resolveEffectiveSupplies(
      payload,
      [makeListing(), makeListing({ id: 2 })],
      asOf,
    )

    expect(find).toHaveBeenCalledTimes(1)
    expect(results.get('1')).toMatchObject({ eligible: true })
    expect(results.get('2')?.eligible).toBe(false)
    expect(results.get('2')?.reasons).toContain(
      EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE,
    )
    expect(find.mock.calls[0][0]).toMatchObject({
      collection: 'listing-merchant-relations',
      depth: 1,
      limit: 1_000,
      page: 1,
      overrideAccess: true,
      where: {
        and: [
          { listing: { in: [1, 2] } },
          { effectiveFrom: { less_than_equal: asOf.toISOString() } },
          {
            or: [
              { effectiveTo: { exists: false } },
              { effectiveTo: { greater_than: asOf.toISOString() } },
            ],
          },
        ],
      },
    })
  })

  it('paginates active relations so a later page overlap fails closed', async () => {
    const merchant = makeListing().merchant
    const firstPage = [
      ...Array.from({ length: 999 }, (_, index) => ({
        id: index + 21,
        listing: 2,
        effectiveFrom: '2025-01-02T00:00:00.000Z',
        effectiveTo: null,
        merchant,
      })),
      {
        id: 1_020,
        listing: 1,
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        effectiveTo: null,
        merchant,
      },
    ]
    const find = vi.fn<(params: Record<string, unknown>) => Promise<{
      docs: Array<Record<string, unknown>>
      hasNextPage: boolean
      nextPage: number | null
    }>>(async (params) => {
      if (params.page === 2) {
        return {
          docs: [{
            id: 12,
            listing: 1,
            effectiveFrom: '2024-01-01T00:00:00.000Z',
            effectiveTo: null,
            merchant,
          }],
          hasNextPage: false,
          nextPage: null,
        }
      }
      return { docs: firstPage, hasNextPage: true, nextPage: 2 }
    })
    const payload: Parameters<typeof resolveEffectiveSupplies>[0] = { find }

    const results = await resolveEffectiveSupplies(
      payload,
      [makeListing(), makeListing({ id: 2 })],
      asOf,
    )

    expect(results.get('1')?.eligible).toBe(false)
    expect(results.get('1')?.reasons).toContain(
      EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE,
    )
    expect(find.mock.calls.map(([params]) => params.page)).toEqual([1, 2])
    expect(find.mock.calls[0][0]).toMatchObject({ limit: 1_000, page: 1 })
  })

  it('continues when nextPage alone indicates forward progress', async () => {
    const merchant = makeListing().merchant
    const find = vi.fn<(params: Record<string, unknown>) => Promise<{
      docs: Array<Record<string, unknown>>
      hasNextPage?: boolean
      nextPage?: number | null
    }>>(async (params) => {
      if (params.page === 2) {
        return {
          docs: [{
            id: 12,
            listing: 1,
            effectiveFrom: '2024-01-01T00:00:00.000Z',
            effectiveTo: null,
            merchant,
          }],
          hasNextPage: false,
          nextPage: null,
        }
      }
      return {
        docs: [{
          id: 11,
          listing: 1,
          effectiveFrom: '2025-01-01T00:00:00.000Z',
          effectiveTo: null,
          merchant,
        }],
        nextPage: 2,
      }
    })
    const payload: Parameters<typeof resolveEffectiveSupplies>[0] = { find }

    const results = await resolveEffectiveSupplies(payload, [makeListing()], asOf)

    expect(find.mock.calls.map(([params]) => params.page)).toEqual([1, 2])
    expect(results.get('1')?.eligible).toBe(false)
    expect(results.get('1')?.reasons).toContain(
      EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE,
    )
  })

  it('continues to the following page when hasNextPage alone is true', async () => {
    const merchant = makeListing().merchant
    const find = vi.fn<(params: Record<string, unknown>) => Promise<{
      docs: Array<Record<string, unknown>>
      hasNextPage?: boolean
      nextPage?: number | null
    }>>(async (params) => {
      if (params.page === 2) {
        return {
          docs: [{
            id: 12,
            listing: 1,
            effectiveFrom: '2024-01-01T00:00:00.000Z',
            effectiveTo: null,
            merchant,
          }],
          hasNextPage: false,
        }
      }
      return {
        docs: [{
          id: 11,
          listing: 1,
          effectiveFrom: '2025-01-01T00:00:00.000Z',
          effectiveTo: null,
          merchant,
        }],
        hasNextPage: true,
      }
    })
    const payload: Parameters<typeof resolveEffectiveSupplies>[0] = { find }

    const results = await resolveEffectiveSupplies(payload, [makeListing()], asOf)

    expect(find.mock.calls.map(([params]) => params.page)).toEqual([1, 2])
    expect(results.get('1')?.eligible).toBe(false)
    expect(results.get('1')?.reasons).toContain(
      EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE,
    )
  })

  it.each([
    ['missing pagination metadata', {}],
    ['null next page', { hasNextPage: true, nextPage: null }],
    ['non-advancing next page', { hasNextPage: true, nextPage: 1 }],
  ])('rejects malformed pagination metadata: %s', async (_label, metadata) => {
    let queryCount = 0
    const find = vi.fn(async () => {
      queryCount += 1
      if (queryCount > 2) throw new Error('pagination regression test guard exceeded')
      return { docs: [], ...metadata }
    })
    const payload: Parameters<typeof resolveEffectiveSupplies>[0] = { find }

    await expect(resolveEffectiveSupplies(payload, [makeListing()], asOf)).rejects.toThrow(
      'invalid effective-relation pagination metadata',
    )
  })

  it('rejects contradictory terminal and forward pagination metadata', async () => {
    const find = vi.fn(async () => ({
      docs: [],
      hasNextPage: false,
      nextPage: 2,
    }))
    const payload: Parameters<typeof resolveEffectiveSupplies>[0] = { find }

    await expect(resolveEffectiveSupplies(payload, [makeListing()], asOf)).rejects.toThrow(
      'invalid effective-relation pagination metadata',
    )
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('counts malformed active rows before parsing cardinality', async () => {
    const merchant = makeListing().merchant
    const find = vi.fn(async () => ({
      docs: [
        {
          id: 11,
          listing: 1,
          effectiveFrom: '2025-01-01T00:00:00.000Z',
          effectiveTo: null,
          merchant,
        },
        {
          id: 12,
          listing: 1,
          effectiveFrom: 'not-a-date',
          effectiveTo: null,
          merchant,
        },
      ],
      hasNextPage: false,
      nextPage: null,
    }))
    const payload: Parameters<typeof resolveEffectiveSupplies>[0] = { find }

    const results = await resolveEffectiveSupplies(payload, [makeListing()], asOf)

    expect(results.get('1')?.eligible).toBe(false)
    expect(results.get('1')?.reasons).toContain(
      EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE,
    )
  })
})

/**
 * depth 归一化契约（供 loadEffectiveRelations 依赖）
 *
 * 批量载入商户关系时用 depth 1 而非 depth 2：关系上只需要 listing 的 id 与
 * merchant 对象，listing 保持 id 形态即可。depth 2 会把每条关系的 listing
 * 整个文档再展开一层，数千条关系时是楼盘列表页最大的一笔开销。
 *
 * 本用例锁住该前提：merchant 的 serviceCities 无论是 id 数组（depth 1）还是
 * 已展开对象数组（depth 2），派生出的快照必须完全相同。前提一旦被破坏，
 * 房源可见性口径会在前台/预览/聚合/Dashboard 之间分叉。
 */
describe('buildEffectiveSnapshot: depth 1 与 depth 2 形态等价', () => {
  const merchantDepth2 = {
    id: 20,
    status: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: '2027-01-01T00:00:00.000Z',
    serviceCities: [{ id: 100, name: '上海' }, { id: 101, name: '北京' }],
  }
  const merchantDepth1 = { ...merchantDepth2, serviceCities: [100, 101] }
  const period = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: null }
  const gallery = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('serviceCities 为 id 数组或对象数组，快照一致', () => {
    const listing = { id: 1, gallery, building: { id: 5, city: 100 } }

    const fromDepth2 = buildEffectiveSnapshot(listing, period, merchantDepth2)
    const fromDepth1 = buildEffectiveSnapshot(listing, period, merchantDepth1)

    expect(fromDepth1).toEqual(fromDepth2)
    expect(fromDepth1.merchant.serviceCityIds).toEqual([100, 101])
  })

  it('building.city 为 id 或已展开对象，buildingCityId 一致', () => {
    const cityAsId = buildEffectiveSnapshot(
      { id: 1, gallery, building: { id: 5, city: 100 } },
      period,
      merchantDepth1,
    )
    const cityAsObject = buildEffectiveSnapshot(
      { id: 1, gallery, building: { id: 5, city: { id: 100, name: '上海' } } },
      period,
      merchantDepth1,
    )

    expect(cityAsId.buildingCityId).toBe(100)
    expect(cityAsObject.buildingCityId).toBe(100)
  })
})
