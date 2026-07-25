import { describe, expect, it } from 'vitest'

import { protectBuildingMerchantRelation } from '@/domain/supply/building-merchant-relation-protect'
import { DomainError } from '@/domain/shared/errors'

/**
 * M3.3 楼盘-商户有效期关系保护 hook 单测（design §3.3 / R2, R3）
 *
 * 内存楼盘/商户/既有关系 + mock findByID/find，断言:
 * 商户/楼盘存在、准入门禁（启用+资质+服务城市）、区间合法、同楼盘重叠拒绝、
 * [start,end) 边界接续放行、更新排除自身、版本乐观锁。
 *
 * eligibility 依赖 now：全部商户 fixture 用「资质无到期日」或极远到期日，
 * 使判定与测试运行时刻无关，保持确定性。
 */

type Building = { id: number; city: number | null; operationalStatus?: string }
type Merchant = {
  id: number
  status: string
  qualificationStatus: string
  qualificationExpiresAt: string | null
  serviceCities: number[]
}
type Relation = {
  id: number
  building: number
  merchant: number
  effectiveFrom: string
  effectiveTo: string | null
}

const BUILDINGS: Building[] = [
  { id: 1, city: 10, operationalStatus: 'active' },
  { id: 2, city: 99, operationalStatus: 'active' },
]

const MERCHANTS: Merchant[] = [
  // 合规：启用 + 资质通过无到期 + 服务城市含 10
  { id: 100, status: 'active', qualificationStatus: 'valid', qualificationExpiresAt: null, serviceCities: [10, 20] },
  // 停用
  { id: 101, status: 'disabled', qualificationStatus: 'valid', qualificationExpiresAt: null, serviceCities: [10] },
  // 服务城市不覆盖 10
  { id: 102, status: 'active', qualificationStatus: 'valid', qualificationExpiresAt: null, serviceCities: [20] },
]

function makeReq(relations: Relation[]) {
  const buildingsById = new Map(BUILDINGS.map((b) => [b.id, b]))
  const merchantsById = new Map(MERCHANTS.map((m) => [m.id, m]))
  return {
    payload: {
      findByID: async ({ collection, id }: { collection: string; id: number | string }) => {
        if (collection === 'buildings') {
          const b = buildingsById.get(Number(id))
          if (!b) throw new Error('not found')
          return { id: b.id, city: b.city, operationalStatus: b.operationalStatus }
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
        where?: { building?: { equals?: number | string } }
      }) => {
        if (collection !== 'building-merchant-relations') return { docs: [] }
        const buildingId = where?.building?.equals
        const docs = relations.filter((r) => String(r.building) === String(buildingId))
        return { docs }
      },
    },
  } as never
}

const create = (data: Record<string, unknown>, relations: Relation[] = []) =>
  protectBuildingMerchantRelation({
    operation: 'create',
    originalDoc: undefined,
    req: makeReq(relations),
    data,
  } as never) as Promise<Record<string, unknown>>

const FROM = '2026-01-01T00:00:00.000Z'
const TO = '2026-06-01T00:00:00.000Z'

describe('building-merchant-relation-protect/必填与存在性', () => {
  it('未选楼盘 → BUILDING_REQUIRED', async () => {
    await expect(create({ merchant: 100, effectiveFrom: FROM })).rejects.toMatchObject({
      code: 'BUILDING_REQUIRED',
    })
  })

  it('未选商户 → MERCHANT_REQUIRED', async () => {
    await expect(create({ building: 1, effectiveFrom: FROM })).rejects.toMatchObject({
      code: 'MERCHANT_REQUIRED',
    })
  })

  it('楼盘不存在 → BUILDING_NOT_FOUND', async () => {
    await expect(
      create({ building: 999, merchant: 100, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'BUILDING_NOT_FOUND' })
  })

  it('商户不存在 → MERCHANT_NOT_FOUND', async () => {
    await expect(
      create({ building: 1, merchant: 999, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'MERCHANT_NOT_FOUND' })
  })
})

describe('building-merchant-relation-protect/准入门禁', () => {
  it('合规商户 + 覆盖城市 → 通过并设 version=1', async () => {
    const out = await create({ building: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO })
    expect(out.version).toBe(1)
  })

  it('停用商户 → MERCHANT_INELIGIBLE', async () => {
    await expect(
      create({ building: 1, merchant: 101, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'MERCHANT_INELIGIBLE' })
  })

  it('服务城市不覆盖楼盘城市 → MERCHANT_INELIGIBLE', async () => {
    await expect(
      create({ building: 1, merchant: 102, effectiveFrom: FROM }),
    ).rejects.toMatchObject({ code: 'MERCHANT_INELIGIBLE' })
  })

  it('details 携带 reasons', async () => {
    try {
      await create({ building: 1, merchant: 101, effectiveFrom: FROM })
      expect.unreachable('应抛 MERCHANT_INELIGIBLE')
    } catch (err) {
      const e = err as DomainError
      expect((e.details as { reasons: string[] }).reasons).toContain('MERCHANT_DISABLED')
    }
  })
})

describe('building-merchant-relation-protect/区间与重叠', () => {
  it('起始缺失 → INVALID_PERIOD', async () => {
    await expect(create({ building: 1, merchant: 100 })).rejects.toMatchObject({
      code: 'INVALID_PERIOD',
    })
  })

  it('止不大于起 → INVALID_PERIOD', async () => {
    await expect(
      create({ building: 1, merchant: 100, effectiveFrom: TO, effectiveTo: FROM }),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' })
  })

  it('同楼盘重叠区间 → RELATION_OVERLAP', async () => {
    const existing: Relation[] = [
      { id: 5, building: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO },
    ]
    await expect(
      create(
        {
          building: 1,
          merchant: 100,
          effectiveFrom: '2026-05-01T00:00:00.000Z',
          effectiveTo: '2026-07-01T00:00:00.000Z',
        },
        existing,
      ),
    ).rejects.toMatchObject({ code: 'RELATION_OVERLAP' })
  })

  it('[start,end) 边界接续 → 放行', async () => {
    const existing: Relation[] = [
      { id: 5, building: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO },
    ]
    const out = await create(
      { building: 1, merchant: 100, effectiveFrom: TO, effectiveTo: '2026-12-01T00:00:00.000Z' },
      existing,
    )
    expect(out.version).toBe(1)
  })
})

describe('building-merchant-relation-protect/更新与版本', () => {
  it('更新时重叠检测排除自身 → 放行', async () => {
    const existing: Relation[] = [
      { id: 5, building: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO },
    ]
    const out = (await protectBuildingMerchantRelation({
      operation: 'update',
      originalDoc: { id: 5, version: 1 },
      req: makeReq(existing),
      data: { building: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO, version: 1 },
    } as never)) as Record<string, unknown>
    expect(out.version).toBe(2)
  })

  it('版本冲突 → VERSION_CONFLICT', async () => {
    await expect(
      protectBuildingMerchantRelation({
        operation: 'update',
        originalDoc: { id: 5, version: 5 },
        req: makeReq([]),
        data: { building: 1, merchant: 100, effectiveFrom: FROM, effectiveTo: TO, version: 2 },
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })
})
