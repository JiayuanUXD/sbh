import { describe, expect, it } from 'vitest'

import { isValidServicePhone, normalizeServicePhone } from '@/lib/frontend/service-phone'

/**
 * OPT-094：顶栏客服电话。运营填的是给人看的写法（带横线 / 空格 / 区号括号），
 * `tel:` 链接只认数字与前导 +；两者从同一个字符串派生，不让运营填两遍。
 */
describe('normalizeServicePhone', () => {
  it('保留展示写法，tel: 只留数字与前导 +', () => {
    expect(normalizeServicePhone('400-820-1234')).toEqual({ display: '400-820-1234', href: 'tel:4008201234' })
    expect(normalizeServicePhone('021 6888 8888')).toEqual({ display: '021 6888 8888', href: 'tel:02168888888' })
    expect(normalizeServicePhone('+86 21 6888 8888')).toEqual({ display: '+86 21 6888 8888', href: 'tel:+862168888888' })
    expect(normalizeServicePhone('(021) 6888-8888')).toEqual({ display: '(021) 6888-8888', href: 'tel:02168888888' })
  })

  it('首尾空白去掉，空串 / null / 非字符串 → null', () => {
    expect(normalizeServicePhone('  400-820-1234  ')?.display).toBe('400-820-1234')
    expect(normalizeServicePhone('')).toBeNull()
    expect(normalizeServicePhone('   ')).toBeNull()
    expect(normalizeServicePhone(null)).toBeNull()
    expect(normalizeServicePhone(undefined)).toBeNull()
    expect(normalizeServicePhone(4008201234)).toBeNull()
  })

  it('含字母或其它符号、数字太少的串不认', () => {
    expect(normalizeServicePhone('400-820-1234 转 2')).toBeNull()
    expect(normalizeServicePhone('call me')).toBeNull()
    expect(normalizeServicePhone('123')).toBeNull()
    expect(normalizeServicePhone('+')).toBeNull()
  })
})

describe('isValidServicePhone', () => {
  it('空值算合法（字段可留空），非法串返回 false', () => {
    expect(isValidServicePhone(undefined)).toBe(true)
    expect(isValidServicePhone('')).toBe(true)
    expect(isValidServicePhone('400-820-1234')).toBe(true)
    expect(isValidServicePhone('abc')).toBe(false)
  })
})
