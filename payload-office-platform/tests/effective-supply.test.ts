import { describe, expect, it } from 'vitest'

import {
  getEffectiveSupplyWhere,
  isListingEffectivelySupplied,
  EFFECTIVE_SUPPLY_EXCLUSION_CODES,
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

  // --- businessType 维度（出售模式批次 2）---------------------------------
  //
  // 谓词回答的是「这套房源合不合格」，租售是另一个问题。参数化而非写死默认，
  // 让每个调用点显式声明意图：租赁列表传 lease、出售频道传 sale、楼盘详情页
  // 不传（自己分组需要全集）、在租面积聚合传 lease。

  it('不传 businessType 时不引入该键，且空对象 / undefined 等价（回归锁定）', () => {
    // 谓词本身的内容由上面「包含查询层可表达的 fail-closed 正向谓词」覆盖；
    // 这里只锁住一件事：新增可选参数没有改变默认行为。20 多处既有调用依赖它。
    const base = getEffectiveSupplyWhere(asOf)
    expect(base).not.toHaveProperty('businessType')
    expect(getEffectiveSupplyWhere(asOf, {})).toEqual(base)
    expect(getEffectiveSupplyWhere(asOf, { businessType: undefined })).toEqual(base)
  })

  it("businessType='lease' 只留租赁", () => {
    const where = getEffectiveSupplyWhere(asOf, { businessType: 'lease' })
    expect(where.businessType).toEqual({ equals: 'lease' })
  })

  it("businessType='sale' 只留出售", () => {
    const where = getEffectiveSupplyWhere(asOf, { businessType: 'sale' })
    expect(where.businessType).toEqual({ equals: 'sale' })
  })

  it('加了 businessType 也不引入 not_equals（fail-closed 不被破坏）', () => {
    for (const businessType of ['lease', 'sale'] as const) {
      const json = JSON.stringify(getEffectiveSupplyWhere(asOf, { businessType }))
      expect(json).not.toContain('not_equals')
    }
  })

  it('businessType 不影响其余谓词', () => {
    const base = getEffectiveSupplyWhere(asOf)
    const scoped = getEffectiveSupplyWhere(asOf, { businessType: 'sale' })
    for (const key of Object.keys(base)) {
      expect(scoped[key]).toEqual(base[key])
    }
  })
})

function fullyEligibleSnapshot(): EffectiveSupplySnapshot {
  return {
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

  // 2026-08-19 反转：媒体数量不再参与前台可见性。保留本用例而不是删掉，
  // 是为了锁住「无图也 eligible」——以后谁再把图片条件加回精筛，这里会红。
  it('无图（gallery 为空）仍然 eligible，不再产生媒体类排除码', () => {
    const r = isListingEffectivelySupplied(fullyEligibleSnapshot(), asOf)
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
    expect(Object.keys(EFFECTIVE_SUPPLY_EXCLUSION_CODES)).not.toContain('INSUFFICIENT_MEDIA')
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
    snap.merchant.status = 'disabled'
    snap.relationPeriod = null
    const r = isListingEffectivelySupplied(snap, asOf)
    expect(r.eligible).toBe(false)
    expect(r.reasons.length).toBeGreaterThanOrEqual(2)
  })
})
