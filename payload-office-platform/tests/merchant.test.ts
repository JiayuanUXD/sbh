import { describe, expect, it } from 'vitest'

import {
  MERCHANT_TYPES,
  QUALIFICATION_STATUSES,
  coversCity,
  isMerchantStatus,
  isMerchantType,
  isQualificationEffective,
  isQualificationStatus,
} from '@/domain/supply/merchant'

describe('merchant/枚举守卫', () => {
  it('isMerchantType 认可四种固定类型', () => {
    for (const t of MERCHANT_TYPES) expect(isMerchantType(t)).toBe(true)
    expect(isMerchantType('LANDLORD')).toBe(false)
    expect(isMerchantType(null)).toBe(false)
  })

  it('isMerchantStatus 仅认可 active/disabled', () => {
    expect(isMerchantStatus('active')).toBe(true)
    expect(isMerchantStatus('disabled')).toBe(true)
    expect(isMerchantStatus('frozen')).toBe(false)
  })

  it('isQualificationStatus 认可三态', () => {
    for (const s of QUALIFICATION_STATUSES) expect(isQualificationStatus(s)).toBe(true)
    expect(isQualificationStatus('expired')).toBe(false)
  })
})

describe('merchant/资质有效性 isQualificationEffective', () => {
  const now = new Date('2026-07-25T00:00:00Z')

  it('状态非 valid → 恒无效', () => {
    expect(isQualificationEffective('pending', null, now)).toBe(false)
    expect(isQualificationEffective('rejected', '2099-01-01', now)).toBe(false)
  })

  it('valid 且无到期日 → 有效', () => {
    expect(isQualificationEffective('valid', null, now)).toBe(true)
    expect(isQualificationEffective('valid', undefined, now)).toBe(true)
  })

  it('valid 且未过期 → 有效', () => {
    expect(isQualificationEffective('valid', '2026-12-31T00:00:00Z', now)).toBe(true)
  })

  it('到期时刻当刻仍有效（边界含）', () => {
    expect(isQualificationEffective('valid', '2026-07-25T00:00:00Z', now)).toBe(true)
  })

  it('已过期 → 无效', () => {
    expect(isQualificationEffective('valid', '2026-07-24T23:59:59Z', now)).toBe(false)
  })

  it('非法到期日 → 无效', () => {
    expect(isQualificationEffective('valid', 'not-a-date', now)).toBe(false)
  })

  it('接受 Date 类型到期日', () => {
    expect(isQualificationEffective('valid', new Date('2026-12-31T00:00:00Z'), now)).toBe(true)
  })
})

describe('merchant/服务城市覆盖 coversCity', () => {
  it('命中（数字/字符串混合按字符串比较）', () => {
    expect(coversCity([1, 2, 3], 2)).toBe(true)
    expect(coversCity(['1', '2'], 2)).toBe(true)
    expect(coversCity([1, 2], '2')).toBe(true)
  })

  it('未命中 → false', () => {
    expect(coversCity([1, 2], 9)).toBe(false)
    expect(coversCity([], 1)).toBe(false)
  })

  it('目标城市为空 → false', () => {
    expect(coversCity([1, 2], null)).toBe(false)
    expect(coversCity([1, 2], undefined)).toBe(false)
  })
})
