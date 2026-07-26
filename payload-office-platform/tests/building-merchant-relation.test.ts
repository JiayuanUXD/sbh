import { describe, expect, it } from 'vitest'

import {
  RELATION_INELIGIBLE_CODES,
  checkMerchantEligibility,
  findRelationOverlap,
  toRelationPeriod,
} from '@/domain/supply/building-merchant-relation'
import type { ValidityPeriod } from '@/domain/shared/validity'

/**
 * M3.3 楼盘-商户有效期关系纯函数单测（design §3.3 / R2, R3）
 *
 * 纯判定层：区间提取、资质+服务城市门禁、同楼盘重叠检测。
 * 读库副作用（载入楼盘城市、商户、既有关系）在 protect hook，另有单测。
 */

const NOW = new Date('2026-07-25T00:00:00.000Z')

describe('toRelationPeriod', () => {
  it('effectiveFrom + effectiveTo → 起止 ISO 字符串', () => {
    const p = toRelationPeriod('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')
    expect(p.startsAt).toBe('2026-01-01T00:00:00.000Z')
    expect(p.endsAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('effectiveTo 为空 → 无限期 endsAt=null', () => {
    const p = toRelationPeriod('2026-01-01T00:00:00.000Z', null)
    expect(p.endsAt).toBeNull()
  })

  it('接受 Date 输入并归一为 ISO', () => {
    const p = toRelationPeriod(new Date('2026-01-01T00:00:00.000Z'), undefined)
    expect(p.startsAt).toBe('2026-01-01T00:00:00.000Z')
    expect(p.endsAt).toBeNull()
  })

  it('effectiveFrom 缺失 → 抛错（起始必填）', () => {
    expect(() => toRelationPeriod(null, null)).toThrow()
  })

  it('非法时刻 → 抛错', () => {
    expect(() => toRelationPeriod('not-a-date', null)).toThrow()
  })
})

describe('checkMerchantEligibility', () => {
  const base = {
    status: 'active' as const,
    qualificationStatus: 'valid' as const,
    qualificationExpiresAt: '2026-12-31T00:00:00.000Z',
    serviceCityIds: [10, 20],
    buildingCityId: 10,
    now: NOW,
  }

  it('启用 + 资质有效 + 服务城市覆盖 → eligible', () => {
    const r = checkMerchantEligibility(base)
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('商户停用 → MERCHANT_DISABLED', () => {
    const r = checkMerchantEligibility({ ...base, status: 'disabled' })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(RELATION_INELIGIBLE_CODES.MERCHANT_DISABLED)
  })

  it('资质未通过 → QUALIFICATION_INVALID', () => {
    const r = checkMerchantEligibility({ ...base, qualificationStatus: 'pending' })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(RELATION_INELIGIBLE_CODES.QUALIFICATION_INVALID)
  })

  it('资质已过期 → QUALIFICATION_INVALID', () => {
    const r = checkMerchantEligibility({
      ...base,
      qualificationExpiresAt: '2026-01-01T00:00:00.000Z',
    })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(RELATION_INELIGIBLE_CODES.QUALIFICATION_INVALID)
  })

  it('服务城市不覆盖楼盘城市 → CITY_NOT_COVERED', () => {
    const r = checkMerchantEligibility({ ...base, buildingCityId: 99 })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(RELATION_INELIGIBLE_CODES.CITY_NOT_COVERED)
  })

  it('多项不满足 → 收集全部原因', () => {
    const r = checkMerchantEligibility({
      ...base,
      status: 'disabled',
      buildingCityId: 99,
    })
    expect(r.reasons).toContain(RELATION_INELIGIBLE_CODES.MERCHANT_DISABLED)
    expect(r.reasons).toContain(RELATION_INELIGIBLE_CODES.CITY_NOT_COVERED)
  })
})

describe('findRelationOverlap', () => {
  const A: ValidityPeriod = {
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-06-01T00:00:00.000Z',
  }
  const B: ValidityPeriod = {
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
  }

  it('相邻区间 [start,end) 边界接续不重叠', () => {
    expect(findRelationOverlap(B, [A])).toEqual([])
  })

  it('交叠区间 → 返回命中索引', () => {
    const overlapping: ValidityPeriod = {
      startsAt: '2026-05-01T00:00:00.000Z',
      endsAt: '2026-07-01T00:00:00.000Z',
    }
    expect(findRelationOverlap(overlapping, [A, B])).toEqual([0, 1])
  })

  it('无限期与后续任意区间重叠', () => {
    const openEnded: ValidityPeriod = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: null }
    expect(findRelationOverlap(openEnded, [B])).toEqual([0])
  })

  it('空既有列表 → 无重叠', () => {
    expect(findRelationOverlap(A, [])).toEqual([])
  })
})
