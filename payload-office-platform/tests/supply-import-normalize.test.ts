import { describe, expect, it } from 'vitest'

import {
  normalizeAliasText,
  normalizeCityName,
  normalizeDistrictName,
  parseArea,
  parseRent,
  parseFloorNumber,
} from '@/domain/supply-import/normalize'

describe('normalizeAliasText', () => {
  it('折叠空白、全角转半角、英文小写', () => {
    expect(normalizeAliasText(' 浦　东 ')).toBe('浦东')
    expect(normalizeAliasText('ＳＯＨＯ')).toBe('soho')
  })
  it('非字符串返回空串', () => {
    expect(normalizeAliasText(null)).toBe('')
    expect(normalizeAliasText(42)).toBe('')
  })
})

describe('normalizeCityName', () => {
  it('剥离"市"后缀', () => {
    expect(normalizeCityName('上海市')).toBe('上海')
    expect(normalizeCityName('上海')).toBe('上海')
  })
  it('单字"市"原样保留——剥完是空串没有意义', () => {
    expect(normalizeCityName('市')).toBe('市')
  })
})

describe('normalizeDistrictName', () => {
  it('保留"区"后缀——浦东新区剥成"浦东新"匹配不到任何东西', () => {
    expect(normalizeDistrictName('浦东新区')).toBe('浦东新区')
  })
  it('剥离城市前缀', () => {
    expect(normalizeDistrictName('上海市黄浦区')).toBe('黄浦区')
  })
})

describe('parseArea', () => {
  it('接受带单位与千分位的写法', () => {
    expect(parseArea('280㎡')).toBe(280)
    expect(parseArea('280 平米')).toBe(280)
    expect(parseArea('1,280.5㎡')).toBe(1280.5)
  })
  it('拒绝零、负数与非数值', () => {
    expect(parseArea('0')).toBeNull()
    expect(parseArea('-5')).toBeNull()
    expect(parseArea('待定')).toBeNull()
  })
  it('区间写法判为无法识别，不静默取第一个数（最终评审 Minor 8）', () => {
    expect(parseArea('100-200㎡')).toBeNull()
    expect(parseArea('100~200㎡')).toBeNull()
    expect(parseArea('100～200㎡')).toBeNull()
    expect(parseArea('100至200㎡')).toBeNull()
    expect(parseArea('100 - 200㎡')).toBeNull()
  })
  it('负数与小数不被区间检测误伤', () => {
    expect(parseArea('-5㎡')).toBeNull() // 已经因负数判 null，不是因为被误判成区间
    expect(parseArea('280.5㎡')).toBe(280.5)
  })
})

describe('parseRent', () => {
  it('识别四种常见报价单位', () => {
    expect(parseRent('4.5元/㎡/天')).toEqual({ amount: 4.5, unit: 'rmb-sqm-day' })
    expect(parseRent('30000元/月')).toEqual({ amount: 30000, unit: 'rmb-month' })
    expect(parseRent('1200元/工位/月')).toEqual({ amount: 1200, unit: 'rmb-seat-month' })
    expect(parseRent('80万')).toEqual({ amount: 800000, unit: 'rmb-total' })
  })
  it('单位缺失返回 null——不猜默认单位', () => {
    expect(parseRent('4.5')).toBeNull()
  })
  it('含"万"但不是纯总价写法时返回 null——不把万当默认周期猜进去', () => {
    // 猜错的后果是前台价格差一万倍，而导入的房源是直接上架的
    expect(parseRent('1.5万/月')).toBeNull()
    expect(parseRent('80万元/年')).toBeNull()
  })
  it('纯总价的万写法不受影响', () => {
    expect(parseRent('80万')).toEqual({ amount: 800000, unit: 'rmb-total' })
    expect(parseRent('1,280万元')).toEqual({ amount: 12800000, unit: 'rmb-total' })
  })
  it('区间写法判为无法识别，不静默取第一个数（最终评审 Minor 8）', () => {
    expect(parseRent('12-15元/㎡/天')).toBeNull()
    expect(parseRent('8000~9000元/月')).toBeNull()
    expect(parseRent('8000～9000元/月')).toBeNull()
    expect(parseRent('8000至9000元/月')).toBeNull()
  })
  it('小数报价不被区间检测误伤', () => {
    expect(parseRent('4.5元/㎡/天')).toEqual({ amount: 4.5, unit: 'rmb-sqm-day' })
  })
})

describe('parseFloorNumber', () => {
  it('识别中文楼层写法', () => {
    expect(parseFloorNumber('12层')).toBe(12)
    expect(parseFloorNumber('12F')).toBe(12)
    expect(parseFloorNumber('B2')).toBe(-2)
  })
  it('非楼层返回 null', () => {
    expect(parseFloorNumber('中区')).toBeNull()
  })
})
