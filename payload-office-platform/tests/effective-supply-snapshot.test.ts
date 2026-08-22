import { describe, expect, it } from 'vitest'

import {
  toId,
  buildEffectiveSnapshot,
  resolveEffectiveSupply,
  resolveEffectiveSupplies,
} from '@/domain/review/effective-supply-snapshot'
import { EFFECTIVE_SUPPLY_EXCLUSION_CODES } from '@/domain/review/effective-supply'

/**
 * M4.7 有效供给快照助手单测（OPT-034 起商户直接读 listing.merchant，不再查
 * listing-merchant-relations 关系表）：
 *   - toId：关系字段归一为 id
 *   - buildEffectiveSnapshot：已解析房源文档 → 精筛入参
 *   - resolveEffectiveSupply / resolveEffectiveSupplies：建快照 + 精筛
 *
 * `resolveEffectiveSupply(payload, listing, asOf, req?)` 仍保留 payload/req 形参
 * （兼容既有调用方签名），但内部不再发起查询——测试里传入的 `payload.find`
 * 因此永远不应被调用，用它来断言「真的不再查关系表」。
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

/** 未接线的 payload 端口：find 被调用即失败，证明精筛不再查库。 */
function unusedPayloadPort() {
  return {
    find: async () => {
      throw new Error('resolveEffectiveSupply(Supplies) 不应再调用 payload.find')
    },
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
  it('从已解析文档抽取商户/楼盘城市', () => {
    const snap = buildEffectiveSnapshot(makeListing())
    expect(snap.merchant?.id).toBe(20)
    expect(snap.merchant?.status).toBe('active')
    expect(snap.merchant?.serviceCityIds).toEqual([100])
    expect(snap.buildingCityId).toBe(100)
  })

  it('building 缺失 → buildingCityId=null', () => {
    const snap = buildEffectiveSnapshot(makeListing({ building: null }))
    expect(snap.buildingCityId).toBeNull()
  })

  it('merchant 缺失（未设置供给商户）→ merchant=null', () => {
    const snap = buildEffectiveSnapshot(makeListing({ merchant: null }))
    expect(snap.merchant).toBeNull()
  })

  it('merchant 未展开（仅裸 id，非 depth≥1 形态）→ merchant=null（fail closed）', () => {
    const snap = buildEffectiveSnapshot(makeListing({ merchant: 20 }))
    expect(snap.merchant).toBeNull()
  })
})

describe('effective-supply-snapshot/resolveEffectiveSupply', () => {
  it('有效供给齐全 → eligible=true，且不查 payload', async () => {
    const r = await resolveEffectiveSupply(unusedPayloadPort(), makeListing(), asOf)
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('房源未设置供给商户 → NO_SUPPLY_MERCHANT', async () => {
    const r = await resolveEffectiveSupply(
      unusedPayloadPort(),
      makeListing({ merchant: null }),
      asOf,
    )
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.NO_SUPPLY_MERCHANT)
  })

  // 2026-08-19 反转：媒体数量不再参与前台可见性（见 effective-supply.ts 头部）。
  it('gallery 为空（甚至字段缺失）仍 eligible', async () => {
    const r = await resolveEffectiveSupply(
      unusedPayloadPort(),
      makeListing({ gallery: [] }),
      asOf,
    )
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('商户不合格（停用）→ MERCHANT_INELIGIBLE', async () => {
    const r = await resolveEffectiveSupply(
      unusedPayloadPort(),
      makeListing({ merchant: { ...makeListing().merchant as object, status: 'disabled' } }),
      asOf,
    )
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.MERCHANT_INELIGIBLE)
  })
})

describe('effective-supply-snapshot/resolveEffectiveSupplies', () => {
  it('逐条建快照精筛，不查 payload', async () => {
    const eligible = makeListing({ id: 1 })
    const noMerchant = makeListing({ id: 2, merchant: null })

    const results = await resolveEffectiveSupplies(
      unusedPayloadPort(),
      [eligible, noMerchant],
      asOf,
    )

    expect(results.get('1')).toMatchObject({ eligible: true })
    expect(results.get('2')?.eligible).toBe(false)
    expect(results.get('2')?.reasons).toContain(
      EFFECTIVE_SUPPLY_EXCLUSION_CODES.NO_SUPPLY_MERCHANT,
    )
  })

  it('listing.id 无法归一化时跳过该条（不产出结果）', async () => {
    const results = await resolveEffectiveSupplies(
      unusedPayloadPort(),
      [{ ...makeListing(), id: undefined }],
      asOf,
    )
    expect(results.size).toBe(0)
  })
})

/**
 * depth 归一化契约
 *
 * merchant 的 serviceCities 无论是 id 数组（depth 1）还是已展开对象数组
 * （depth 2），派生出的快照必须完全相同。前提一旦被破坏，房源可见性口径会在
 * 前台/预览/聚合/Dashboard 之间分叉。
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
  const gallery = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('serviceCities 为 id 数组或对象数组，快照一致', () => {
    const listingDepth2 = { id: 1, gallery, building: { id: 5, city: 100 }, merchant: merchantDepth2 }
    const listingDepth1 = { id: 1, gallery, building: { id: 5, city: 100 }, merchant: merchantDepth1 }

    const fromDepth2 = buildEffectiveSnapshot(listingDepth2)
    const fromDepth1 = buildEffectiveSnapshot(listingDepth1)

    expect(fromDepth1).toEqual(fromDepth2)
    expect(fromDepth1.merchant?.serviceCityIds).toEqual([100, 101])
  })

  it('building.city 为 id 或已展开对象，buildingCityId 一致', () => {
    const cityAsId = buildEffectiveSnapshot({
      id: 1,
      gallery,
      building: { id: 5, city: 100 },
      merchant: merchantDepth1,
    })
    const cityAsObject = buildEffectiveSnapshot({
      id: 1,
      gallery,
      building: { id: 5, city: { id: 100, name: '上海' } },
      merchant: merchantDepth1,
    })

    expect(cityAsId.buildingCityId).toBe(100)
    expect(cityAsObject.buildingCityId).toBe(100)
  })
})
