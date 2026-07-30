import { describe, expect, it } from 'vitest'
import {
  computeUsableArea,
  convertPrice,
  deriveSeatRange,
} from '@/domain/public-catalog/detail-values'

describe('detail values', () => {
  it('只在面积和得房率可信时计算套内参考面积', () => {
    expect(computeUsableArea(132, 70)).toEqual({ amount: 92.4, estimated: true })
    expect(computeUsableArea(132, null)).toBeNull()
    expect(computeUsableArea(-1, 70)).toBeNull()
    expect(computeUsableArea(132, 101)).toBeNull()
  })

  it('保留明确的工位区间而不将其标为估算', () => {
    expect(deriveSeatRange({
      seatMin: 8,
      seatMax: 16,
      suggestedSeats: 12,
      area: 100,
    })).toEqual({ min: 8, max: 16, estimated: false })
  })

  it('元/工位/月不生成元/㎡/天换算', () => {
    expect(convertPrice({
      amount: 1800,
      currency: 'CNY',
      period: 'month',
      unit: 'seat',
      area: 100,
      seats: 20,
    })).toEqual([])
  })

  it('极端有限输入产生溢出时不返回非有限换算价格', () => {
    expect(convertPrice({
      amount: Number.MAX_VALUE,
      currency: 'CNY',
      period: 'month',
      unit: 'total',
      area: 0.1,
      seats: null,
    })).toEqual([])
  })
})
