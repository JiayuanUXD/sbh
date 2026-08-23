import { describe, expect, it } from 'vitest'

import {
  MERCHANT_RESOLUTION_CODES,
  mapBuildingMerchantRelationDocs,
  resolveBuildingMerchant,
  type BuildingMerchantRelationInput,
} from '@/domain/supply-import/resolve-merchant'

const NOW = new Date('2026-08-22T00:00:00.000Z')

function eligibleRelation(overrides: Partial<BuildingMerchantRelationInput> = {}): BuildingMerchantRelationInput {
  return {
    buildingId: 100,
    merchantId: 500,
    merchantStatus: 'active',
    qualificationStatus: 'valid',
    qualificationExpiresAt: null,
    serviceCityIds: [1],
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
    ...overrides,
  }
}

describe('resolveBuildingMerchant', () => {
  it('楼盘有当前生效且合格的关系 → 返回该商户 id', () => {
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [eligibleRelation()], NOW)
    expect(result).toEqual({ ok: true, merchantId: 500 })
  })

  it('楼盘没有任何关系 → NO_SUPPLY_MERCHANT_RELATION，message 指楼盘不指房源', () => {
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe(MERCHANT_RESOLUTION_CODES.NO_SUPPLY_MERCHANT_RELATION)
    expect(result.ok === false && result.message).toContain('楼盘「环球金融中心」')
    expect(result.ok === false && result.message).toContain('没有生效的供给商户')
  })

  it('关系存在但尚未生效（effectiveFrom 在未来）→ 视同没有生效关系', () => {
    const future = eligibleRelation({ effectiveFrom: '2099-01-01T00:00:00.000Z' })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [future], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe(MERCHANT_RESOLUTION_CODES.NO_SUPPLY_MERCHANT_RELATION)
  })

  it('关系已失效（effectiveTo 早于当前时点）→ 视同没有生效关系', () => {
    const expired = eligibleRelation({
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: '2021-01-01T00:00:00.000Z',
    })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [expired], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe(MERCHANT_RESOLUTION_CODES.NO_SUPPLY_MERCHANT_RELATION)
  })

  it('effectiveTo 恰等于当前时点（半开区间不含止）→ 视同没有生效关系', () => {
    const boundary = eligibleRelation({
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: NOW.toISOString(),
    })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [boundary], NOW)
    expect(result.ok).toBe(false)
  })

  it('商户已停用 → MERCHANT_INELIGIBLE，message 点名"已停用"', () => {
    const disabled = eligibleRelation({ merchantStatus: 'disabled' })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [disabled], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe(MERCHANT_RESOLUTION_CODES.MERCHANT_INELIGIBLE)
    expect(result.ok === false && result.message).toContain('已停用')
  })

  it('资质已过期 → MERCHANT_INELIGIBLE，message 点名资质问题', () => {
    const expiredQual = eligibleRelation({
      qualificationStatus: 'valid',
      qualificationExpiresAt: '2020-01-01T00:00:00.000Z',
    })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [expiredQual], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('资质无效或已过期')
  })

  it('服务城市不覆盖楼盘城市 → MERCHANT_INELIGIBLE，message 点名服务城市', () => {
    const notCovered = eligibleRelation({ serviceCityIds: [999] })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [notCovered], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('服务城市未覆盖')
  })

  it('多重不合格原因一次性列出，不是报一个就停', () => {
    const allBad = eligibleRelation({ merchantStatus: 'disabled', serviceCityIds: [999] })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [allBad], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('已停用')
    expect(result.ok === false && result.message).toContain('服务城市未覆盖')
  })

  it('不是这栋楼的关系不参与判定——只按 buildingId 精确匹配', () => {
    const otherBuilding = eligibleRelation({ buildingId: 200 })
    const result = resolveBuildingMerchant('环球金融中心', 100, 1, [otherBuilding], NOW)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe(MERCHANT_RESOLUTION_CODES.NO_SUPPLY_MERCHANT_RELATION)
  })
})

describe('mapBuildingMerchantRelationDocs', () => {
  it('depth:1 展开的正常文档 → 映射出扁平输入', () => {
    const docs = [
      {
        building: { id: 100 },
        merchant: {
          id: 500,
          status: 'active',
          qualificationStatus: 'valid',
          qualificationExpiresAt: null,
          serviceCities: [{ id: 1 }, 2],
        },
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      },
    ]
    const mapped = mapBuildingMerchantRelationDocs(docs)
    expect(mapped).toEqual([
      {
        buildingId: 100,
        merchantId: 500,
        merchantStatus: 'active',
        qualificationStatus: 'valid',
        qualificationExpiresAt: null,
        serviceCityIds: [1, 2],
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      },
    ])
  })

  it('building 是裸 id（number）而不是展开对象也能取到', () => {
    const docs = [
      {
        building: 100,
        merchant: { id: 500, status: 'active', qualificationStatus: 'valid', qualificationExpiresAt: null, serviceCities: [] },
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      },
    ]
    expect(mapBuildingMerchantRelationDocs(docs)[0].buildingId).toBe(100)
  })

  it('merchant 未展开（仍是裸 id）的脏记录整条跳过——调用方必须传 depth:1', () => {
    const docs = [
      {
        building: 100,
        merchant: 500,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      },
    ]
    expect(mapBuildingMerchantRelationDocs(docs)).toEqual([])
  })

  it('building 缺失的脏记录整条跳过', () => {
    const docs = [
      {
        building: null,
        merchant: { id: 500, status: 'active', qualificationStatus: 'valid', qualificationExpiresAt: null },
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
      },
    ]
    expect(mapBuildingMerchantRelationDocs(docs)).toEqual([])
  })
})
