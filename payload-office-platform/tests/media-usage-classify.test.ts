import { describe, expect, it } from 'vitest'

import { classifyMediaUsage } from '@/domain/media/usage-classify'

const NONE = { listingPhoto: 0, article: 0, brand: 0, report: 0 }

describe('classifyMediaUsage', () => {
  it('被房源/楼盘引用 → listing-photo', () => {
    expect(classifyMediaUsage({ ...NONE, listingPhoto: 1 })).toBe('listing-photo')
  })

  it('被文章引用 → article', () => {
    expect(classifyMediaUsage({ ...NONE, article: 1 })).toBe('article')
  })

  it('被站点设置/页面/商圈/城市站引用 → brand', () => {
    expect(classifyMediaUsage({ ...NONE, brand: 1 })).toBe('brand')
  })

  it('举报截图 → other', () => {
    expect(classifyMediaUsage({ ...NONE, report: 1 })).toBe('other')
  })

  it('无人引用 → other', () => {
    expect(classifyMediaUsage(NONE)).toBe('other')
  })

  it('多处引用时按 listing-photo > article > brand > other 定优先级', () => {
    expect(classifyMediaUsage({ listingPhoto: 1, article: 1, brand: 1, report: 1 })).toBe('listing-photo')
    expect(classifyMediaUsage({ listingPhoto: 0, article: 1, brand: 1, report: 1 })).toBe('article')
    expect(classifyMediaUsage({ listingPhoto: 0, article: 0, brand: 1, report: 1 })).toBe('brand')
  })
})
