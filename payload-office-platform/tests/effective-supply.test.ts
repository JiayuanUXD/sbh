import { describe, expect, it } from 'vitest'

import {
  getEffectiveSupplyWhere,
  isListingEffectivelySupplied,
  EFFECTIVE_SUPPLY_EXCLUSION_CODES,
  MIN_EFFECTIVE_MEDIA,
  type EffectiveSupplySnapshot,
} from '@/domain/review/effective-supply'

/**
 * M4.7 统一有效供给谓词单测（design §3.6 有效供给 10 条 / R3）
 *
 * 两层设计：
 *   1) getEffectiveSupplyWhere —— 查询层可表达的条件（逻辑未删、已发布、审核通过、
 *      未冻结、楼盘/城市/行政区启用），返回 Payload where 片段（fail-closed 正向谓词）。
 *   2) isListingEffectivelySupplied —— 需已解析数据才能判定的条件（有效媒体≥3、
 *      商户关系落在有效期、商户启用+资质有效+服务城市覆盖），逐条给出排除原因。
 */

const asOf = new Date('2026-07-26T00:00:00.000Z')

describe('effective-supply/getEffectiveSupplyWhere', () => {
  it('包含查询层可表达的 fail-closed 正向谓词', () => {
    const where = getEffectiveSupplyWhere(asOf)
    expect(where.deletedAt).toEqual({ exists: false })
    expect(where.publicationStatus).toEqual({ equals: 'published' })
    expect(where.reviewStatus).toEqual({ equals: 'approved' })
    expect(where.supplyVisibilityHold).toEqual({ equals: 'normal' })
    expect(where['building.operationalStatus']).toEqual({ equals: 'active' })
    expect(where['building.city.status']).toEqual({ equals: 'active' })
    expect(where['building.district.status']).toEqual({ equals: 'active' })
  })

  it('不使用 not_equals（避免 NULL 漏网）', () => {
    const json = JSON.stringify(getEffectiveSupplyWhere(asOf))
    expect(json).not.toContain('not_equals')
  })
})

describe('effective-supply/常量', () => {
  it('有效媒体下限为 3', () => {
    expect(MIN_EFFECTIVE_MEDIA).toBe(3)
  })
})

function fullyEligibleSnapshot(): EffectiveSupplySnapshot {
  return {
    mediaCount: 3,
    merchant: {
      status: 'active',
      qualificationStatus: 'valid',
      qualificationExpiresAt: null,
      serviceCityIds: ['city-1'],
    },
    buildingCityId: 'city-1',
    relationPeriod: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: null },
  }
}

describe('effective-supply/isListingEffectivelySupplied', () => {
  it('全部满足 → eligible=true, reasons 空', () => {
    const r = isListingEffectivelySupplied(fullyEligibleSnapshot(), asOf)
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('媒体不足 3 → INSUFFICIENT_MEDIA', () => {
    const snap = { ...fullyEligibleSnapshot(), mediaCount: 2 }
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.INSUFFICIENT_MEDIA)
  })

  it('商户停用 → MERCHANT_DISABLED', () => {
    const snap = fullyEligibleSnapshot()
    snap.merchant.status = 'disabled'
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.MERCHANT_INELIGIBLE)
  })

  it('资质过期 → 商户不合格', () => {
    const snap = fullyEligibleSnapshot()
    snap.merchant.qualificationExpiresAt = '2026-06-01T00:00:00.000Z'
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.MERCHANT_INELIGIBLE)
  })

  it('服务城市不覆盖楼盘城市 → 商户不合格', () => {
    const snap = fullyEligibleSnapshot()
    snap.buildingCityId = 'city-2'
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.MERCHANT_INELIGIBLE)
  })

  it('关系尚未生效(asOf 早于 startsAt) → RELATION_NOT_EFFECTIVE', () => {
    const snap = fullyEligibleSnapshot()
    snap.relationPeriod = { startsAt: '2026-12-01T00:00:00.000Z', endsAt: null }
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE)
  })

  it('关系已过期(asOf 晚于 endsAt) → RELATION_NOT_EFFECTIVE', () => {
    const snap = fullyEligibleSnapshot()
    snap.relationPeriod = {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-06-01T00:00:00.000Z',
    }
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE)
  })

  it('无商户关系(缺关系期) → RELATION_NOT_EFFECTIVE', () => {
    const snap = fullyEligibleSnapshot()
    snap.relationPeriod = null
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE)
  })

  it('多重不满足 → 收集全部原因', () => {
    const snap = fullyEligibleSnapshot()
    snap.mediaCount = 0
    snap.merchant.status = 'disabled'
    snap.relationPeriod = null
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.eligible).toBe(false)
    expect(r.reasons.length).toBeGreaterThanOrEqual(3)
  })
})
