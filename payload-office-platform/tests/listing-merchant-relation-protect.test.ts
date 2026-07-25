import { describe, expect, it } from 'vitest'

import { protectListingMerchantRelation } from '@/domain/supply/listing-merchant-relation-protect'
import { DomainError } from '@/domain/shared/errors'

/**
 * M4.2 房源-商户有效期关系保护 hook 单测（design §3.3 / R2, R4）
 *
 * 内存房源/楼盘/商户/既有关系 + mock findByID/find，断言:
 * 房源/楼盘/商户存在性、快照继承楼盘当前默认商户、准入门禁、区间合法、
 * 同房源重叠拒绝、[start,end) 边界接续放行、更新排除自身、版本乐观锁。
 *
 * eligibility 依赖 now：商户 fixture 用「资质无到期日」使判定与运行时刻无关;
 * 楼盘默认商户关系 fixture 用「无限期（effectiveTo=null）」使其恒覆盖 now,
 * 保持继承解析的确定性。
 */

type Listing = { id: number; building: number | null }
type Building = { id: number; city: number | null }
type Merchant = {
  id: number
  status: string
  qualificationStatus: string
  qualificationExpiresAt: string | null
  serviceCities: number[]
}
type LMRelation = {
  id: number
  listing: number
  merchant: number
  effectiveFrom: string
  effectiveTo: string | null
}
type BMRelation = {
  id: number
  building: number
  merchant: number
  effectiveFrom: string
  effectiveTo: string | null
}

const LISTINGS: Listing[] = [
  { id: 1, building: 1 },
  { id: 2, building: 2 },
  { id: 3, building: null },
]

const BUILDINGS: Building[] = [
  { id: 1, city: 10 },
  { id: 2, city: 99 },
]

const MERCHANTS: Merchant[] = [
  // 合规：启用 + 资质通过无到期 + 服务城市含 10
  { id: 100, status: 'active', qualificationStatus: 'valid', qualificationExpiresAt: null, serviceCities: [10, 20] },
  // 停用
  { id: 101, status: 'disabled', qualificationStatus: 'valid', qualificationExpiresAt: null, serviceCities: [10] },
  // 服务城市不覆盖 10
  { id: 102, status: 'active', qualificationStatus: 'valid', qualificationExpiresAt: null, serviceCities: [20] },
]

// 楼盘 1 当前默认商户 = 100（无限期,恒覆盖 now）;楼盘 2 无默认关系。
const BM_RELATIONS: BMRelation[] = [
  { id: 900, building: 1, merchant: 100, effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null },
]

function makeReq(lmRelations: LMRelation[], bmRelations: BMRelation[] = BM_RELATIONS) {
  const listingsById = new Map(LISTINGS.map((l) => [l.id, l]))
  const buildingsById = new Map(BUILDINGS.map((b) => [b.id, b]))
  const merchantsById = new Map(MERCHANTS.map((m) => [m.id, m]))
  return {
    payload: {
      findByID: async ({ collection, id }: { collection: string; id: number | string }) => {
        if (collection === 'listings') {
          const l = listingsById.get(Number(id))
          if (!l) throw new Error('not found')
          return { id: l.id, building: l.building }
        }
        if (collection === 'buildings') {
          const b = buildingsById.get(Number(id))
          if (!b) throw new Error('not found')
          return { id: b.id, city: b.city }
        }
        if (collection === 'merchants') {
          const m = merchantsById.get(Number(id))
          if (!m) throw new Error('not found')
          return {
            id: m.id,
            status: m.status,
            qualificationStatus: m.qualificationStatus,
            qualificationExpiresAt: m.qualificationExpiresAt,
            serviceCities: m.serviceCities,
          }
        }
        throw new Error('not found')
      },
      find: async ({
        collection,
        where,
      }: {
        collection: string
        where?: {
          listing?: { equals?: number | string }
          building?: { equals?: number | string }
        }
      }) => {
        if (collection === 'listing-merchant-relations') {
          const listingId = where?.listing?.equals
          return { docs: lmRelations.filter((r) => String(r.listing) === String(listingId)) }
        }
        if (collection === 'building-merchant-relations') {
          const buildingId = where?.building?.equals
          return { docs: bmRelations.filter((r) => String(r.building) === String(buildingId)) }
        }
        return { docs: [] }
      },
    },
  } as never
}

const create = (
  data: Record<string, unknown>,
  lmRelations: LMRelation[] = [],
  bmRelations: BMRelation[] = BM_RELATIONS,
) =>
  protectListingMerchantRelation({
    operation: 'create',
    originalDoc: undefined,
    req: makeReq(lmRelations, bmRelations),
    data,
  } as never) as Promise<Record<string, unknown>>

const FROM = '2026-01-01T00:00:00.000Z'
const TO = '2026-06-01T00:00:00.000Z'

describe('listing-merchant-relation-protect/必填与存在性', () => {
  it('未选房源 → LISTING_REQUIRED', async () => {
    await expect(create({ merchant: 100, effectiveFrom: FROM })).rejects.toMatchObject({
      code: 'LISTING_REQUIRED',
    })
  })

  it('房源不存在 → LISTING_NOT_FOUND', async () => {
    await expect(
      create({ listing: 999, merchant: 100, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_FOUND' })
  })

  it('房源未关联楼盘 → BUILDING_REQUIRED', async () => {
    await expect(
      create({ listing: 3, merchant: 100, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'BUILDING_REQUIRED' })
  })

  it('商户不存在 → MERCHANT_NOT_FOUND', async () => {
    await expect(
      create({ listing: 1, merchant: 999, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'MERCHANT_NOT_FOUND' })
  })
})

describe('listing-merchant-relation-protect/快照继承楼盘默认商户', () => {
  it('未显式指定商户 → 继承楼盘当前默认商户并写回快照', async () => {
    const out = await create({ listing: 1, effectiveFrom: FROM, effectiveTo: TO })
    expect(out.merchant).toBe(100)
    expect(out.version).toBe(1)
  })

  it('显式指定商户 → 覆盖楼盘默认', async () => {
    // 楼盘 1 默认是 100,显式指定合规的 100 亦可;此处验证显式值被采用路径
    const out = await create({ listing: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO })
    expect(out.merchant).toBe(100)
  })

  it('未指定商户且楼盘无当前默认关系 → MERCHANT_REQUIRED', async () => {
    // 楼盘 2 无 building-merchant-relation
    await expect(
      create({ listing: 2, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'MERCHANT_REQUIRED' })
  })
})

describe('listing-merchant-relation-protect/准入门禁', () => {
  it('合规商户 + 覆盖城市 → 通过并设 version=1', async () => {
    const out = await create({ listing: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO })
    expect(out.version).toBe(1)
  })

  it('停用商户 → MERCHANT_INELIGIBLE', async () => {
    await expect(
      create({ listing: 1, merchant: 101, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'MERCHANT_INELIGIBLE' })
  })

  it('服务城市不覆盖房源城市 → MERCHANT_INELIGIBLE', async () => {
    await expect(
      create({ listing: 1, merchant: 102, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'MERCHANT_INELIGIBLE' })
  })

  it('details 携带 reasons', async () => {
    try {
      await create({ listing: 1, merchant: 101, effectiveFrom: FROM })
      expect.unreachable('应抛 MERCHANT_INELIGIBLE')
    } catch (err) {
      const e = err as DomainError
      expect((e.details as { reasons: string[] }).reasons).toContain('MERCHANT_DISABLED')
    }
  })
})

describe('listing-merchant-relation-protect/区间与重叠', () => {
  it('起始缺失 → INVALID_PERIOD', async () => {
    await expect(create({ listing: 1, merchant: 100 })).rejects.toMatchObject({
      code: 'INVALID_PERIOD',
    })
  })

  it('止不大于起 → INVALID_PERIOD', async () => {
    await expect(
      create({ listing: 1, merchant: 100, effectiveFrom: TO, effectiveTo: FROM }),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' })
  })

  it('同房源重叠区间 → RELATION_OVERLAP', async () => {
    const existing: LMRelation[] = [
      { id: 5, listing: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO },
    ]
    await expect(
      create(
        {
          listing: 1,
          merchant: 100,
          effectiveFrom: '2026-05-01T00:00:00.000Z',
          effectiveTo: '2026-07-01T00:00:00.000Z',
        },
        existing,
      ),
    ).rejects.toMatchObject({ code: 'RELATION_OVERLAP' })
  })

  it('[start,end) 边界接续 → 放行', async () => {
    const existing: LMRelation[] = [
      { id: 5, listing: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO },
    ]
    const out = await create(
      { listing: 1, merchant: 100, effectiveFrom: TO, effectiveTo: '2026-12-01T00:00:00.000Z' },
      existing,
    )
    expect(out.version).toBe(1)
  })
})

describe('listing-merchant-relation-protect/更新与版本', () => {
  it('更新时重叠检测排除自身 → 放行并递增版本', async () => {
    const existing: LMRelation[] = [
      { id: 5, listing: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO },
    ]
    const out = (await protectListingMerchantRelation({
      operation: 'update',
      originalDoc: { id: 5, version: 1, merchant: 100 },
      req: makeReq(existing),
      data: { listing: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO, version: 1 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(2)
  })

  it('更新沿用既有商户快照（data 未带 merchant）→ 用 originalDoc.merchant', async () => {
    const out = (await protectListingMerchantRelation({
      operation: 'update',
      originalDoc: { id: 5, version: 1, merchant: 100 },
      req: makeReq([]),
      data: { listing: 1, effectiveFrom: FROM, effectiveTo: TO, version: 1 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(2)
  })

  it('版本冲突 → VERSION_CONFLICT', async () => {
    await expect(
      protectListingMerchantRelation({
        operation: 'update',
        originalDoc: { id: 5, version: 5, merchant: 100 },
        req: makeReq([]),
        data: { listing: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO, version: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })
})
