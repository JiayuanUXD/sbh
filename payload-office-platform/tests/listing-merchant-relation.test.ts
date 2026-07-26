import { describe, expect, it } from 'vitest'

import {
  LISTING_RELATION_INELIGIBLE_CODES,
  checkListingMerchantEligibility,
  findListingRelationOverlap,
  isListingRelationPeriodValid,
  resolveListingRelationMerchant,
  toListingRelationPeriod,
} from '@/domain/supply/listing-merchant-relation'
import type { ValidityPeriod } from '@/domain/shared/validity'

/**
 * M4.2 房源-商户有效期关系纯函数单测（design §3.3 / R2, R4）
 *
 * 纯判定层：区间提取、资质+服务城市门禁、同房源重叠检测,
 * 以及创建时“继承 Building 默认商户快照”的商户解析规则。
 * 读库副作用（载入楼盘城市/默认商户、商户、既有关系）在 protect hook,另有单测。
 */

const NOW = new Date('2026-07-25T00:00:00.000Z')

describe('toListingRelationPeriod', () => {
  it('effectiveFrom + effectiveTo → 起止 ISO 字符串', () => {
    const p = toListingRelationPeriod('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')
    expect(p.startsAt).toBe('2026-01-01T00:00:00.000Z')
    expect(p.endsAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('effectiveTo 为空 → 无限期 endsAt=null', () => {
    const p = toListingRelationPeriod('2026-01-01T00:00:00.000Z', null)
    expect(p.endsAt).toBeNull()
  })

  it('接受 Date 输入并归一为 ISO', () => {
    const p = toListingRelationPeriod(new Date('2026-01-01T00:00:00.000Z'), undefined)
    expect(p.startsAt).toBe('2026-01-01T00:00:00.000Z')
    expect(p.endsAt).toBeNull()
  })

  it('effectiveFrom 缺失 → 抛错（起始必填）', () => {
    expect(() => toListingRelationPeriod(null, null)).toThrow()
  })

  it('非法时刻 → 抛错', () => {
    expect(() => toListingRelationPeriod('not-a-date', null)).toThrow()
  })
})

describe('isListingRelationPeriodValid', () => {
  it('止严格大于起 → 合法', () => {
    expect(
      isListingRelationPeriodValid({
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-06-01T00:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('无限期 → 合法', () => {
    expect(
      isListingRelationPeriodValid({ startsAt: '2026-01-01T00:00:00.000Z', endsAt: null }),
    ).toBe(true)
  })

  it('止不大于起 → 非法', () => {
    expect(
      isListingRelationPeriodValid({
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false)
  })
})

describe('checkListingMerchantEligibility', () => {
  const base = {
    status: 'active' as const,
    qualificationStatus: 'valid' as const,
    qualificationExpiresAt: '2026-12-31T00:00:00.000Z',
    serviceCityIds: [10, 20],
    listingCityId: 10,
    now: NOW,
  }

  it('启用 + 资质有效 + 服务城市覆盖 → eligible', () => {
    const r = checkListingMerchantEligibility(base)
    expect(r.eligible).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('商户停用 → MERCHANT_DISABLED', () => {
    const r = checkListingMerchantEligibility({ ...base, status: 'disabled' })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(LISTING_RELATION_INELIGIBLE_CODES.MERCHANT_DISABLED)
  })

  it('资质未通过 → QUALIFICATION_INVALID', () => {
    const r = checkListingMerchantEligibility({ ...base, qualificationStatus: 'pending' })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(LISTING_RELATION_INELIGIBLE_CODES.QUALIFICATION_INVALID)
  })

  it('资质已过期 → QUALIFICATION_INVALID', () => {
    const r = checkListingMerchantEligibility({
      ...base,
      qualificationExpiresAt: '2026-01-01T00:00:00.000Z',
    })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(LISTING_RELATION_INELIGIBLE_CODES.QUALIFICATION_INVALID)
  })

  it('服务城市不覆盖房源城市 → CITY_NOT_COVERED', () => {
    const r = checkListingMerchantEligibility({ ...base, listingCityId: 99 })
    expect(r.eligible).toBe(false)
    expect(r.reasons).toContain(LISTING_RELATION_INELIGIBLE_CODES.CITY_NOT_COVERED)
  })

  it('多项不满足 → 收集全部原因', () => {
    const r = checkListingMerchantEligibility({
      ...base,
      status: 'disabled',
      listingCityId: 99,
    })
    expect(r.reasons).toContain(LISTING_RELATION_INELIGIBLE_CODES.MERCHANT_DISABLED)
    expect(r.reasons).toContain(LISTING_RELATION_INELIGIBLE_CODES.CITY_NOT_COVERED)
  })
})

describe('findListingRelationOverlap', () => {
  const A: ValidityPeriod = {
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-06-01T00:00:00.000Z',
  }
  const B: ValidityPeriod = {
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
  }

  it('相邻区间 [start,end) 边界接续不重叠', () => {
    expect(findListingRelationOverlap(B, [A])).toEqual([])
  })

  it('交叠区间 → 返回命中索引', () => {
    const overlapping: ValidityPeriod = {
      startsAt: '2026-05-01T00:00:00.000Z',
      endsAt: '2026-07-01T00:00:00.000Z',
    }
    expect(findListingRelationOverlap(overlapping, [A, B])).toEqual([0, 1])
  })

  it('无限期与后续任意区间重叠', () => {
    const openEnded: ValidityPeriod = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: null }
    expect(findListingRelationOverlap(openEnded, [B])).toEqual([0])
  })

  it('空既有列表 → 无重叠', () => {
    expect(findListingRelationOverlap(A, [])).toEqual([])
  })
})

describe('resolveListingRelationMerchant（快照继承 Building 默认商户）', () => {
  it('显式指定商户 → 用显式值', () => {
    expect(
      resolveListingRelationMerchant({
        explicitMerchantId: 7,
        buildingDefaultMerchantId: 3,
      }),
    ).toBe(7)
  })

  it('未显式指定 → 继承楼盘默认商户快照', () => {
    expect(
      resolveListingRelationMerchant({
        explicitMerchantId: null,
        buildingDefaultMerchantId: 3,
      }),
    ).toBe(3)
  })

  it('显式为空字符串 → 视为未指定,回退楼盘默认', () => {
    expect(
      resolveListingRelationMerchant({
        explicitMerchantId: '',
        buildingDefaultMerchantId: 3,
      }),
    ).toBe(3)
  })

  it('显式与楼盘默认都缺 → null（交由 protect 抛 MERCHANT_REQUIRED）', () => {
    expect(
      resolveListingRelationMerchant({
        explicitMerchantId: null,
        buildingDefaultMerchantId: undefined,
      }),
    ).toBeNull()
  })

  it('显式值可覆盖楼盘默认（允许房源级另指商户）', () => {
    expect(
      resolveListingRelationMerchant({
        explicitMerchantId: 'm-override',
        buildingDefaultMerchantId: 'm-default',
      }),
    ).toBe('m-override')
  })
})
