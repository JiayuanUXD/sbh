import { describe, expect, it } from 'vitest'
import { normalizeAvgResponseHours } from '@/domain/city-site-profile/schema'

describe('normalizeAvgResponseHours', () => {
  it('合法数字原样通过并保留一位小数', () => {
    expect(normalizeAvgResponseHours(2.4)).toBe(2.4)
    expect(normalizeAvgResponseHours(2.44)).toBe(2.4)
    expect(normalizeAvgResponseHours(0.5)).toBe(0.5)
    expect(normalizeAvgResponseHours(72)).toBe(72)
  })
  it('缺失 / 非数 / 越界 / 非正数返回 null（首页不展示该格）', () => {
    expect(normalizeAvgResponseHours(undefined)).toBeNull()
    expect(normalizeAvgResponseHours(null)).toBeNull()
    expect(normalizeAvgResponseHours('2.4')).toBeNull()
    expect(normalizeAvgResponseHours(NaN)).toBeNull()
    expect(normalizeAvgResponseHours(0)).toBeNull()
    expect(normalizeAvgResponseHours(-1)).toBeNull()
    expect(normalizeAvgResponseHours(72.1)).toBeNull()
  })
})
