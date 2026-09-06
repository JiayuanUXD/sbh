import { describe, expect, it } from 'vitest'
import { normalizeFeaturedDistrictCount } from '@/domain/city-site-profile/schema'

describe('normalizeFeaturedDistrictCount', () => {
  it('只有 3 才是 3——字符串与数字两种入参都认', () => {
    expect(normalizeFeaturedDistrictCount('3')).toBe(3)
    expect(normalizeFeaturedDistrictCount(3)).toBe(3)
  })

  it('缺失 / 非法 / 未知档位一律回落到 5（现状）', () => {
    expect(normalizeFeaturedDistrictCount('5')).toBe(5)
    expect(normalizeFeaturedDistrictCount(5)).toBe(5)
    expect(normalizeFeaturedDistrictCount(undefined)).toBe(5)
    expect(normalizeFeaturedDistrictCount(null)).toBe(5)
    expect(normalizeFeaturedDistrictCount('7')).toBe(5)
    expect(normalizeFeaturedDistrictCount(0)).toBe(5)
    expect(normalizeFeaturedDistrictCount({})).toBe(5)
  })
})
