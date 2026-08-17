/**
 * 出售频道路由与可见性口径单测（批次 4）
 *
 * 守护不变量：
 *   - noindex 与 sitemap 判定永远一致（不一致会发出自相矛盾的抓取信号）
 *   - /sale 与 /[city]/sale 能被路由解析器识别，且携带筛选参数往返不丢
 *   - 城市 slug 不能叫 sale（否则 /sale 会被当成城市首页）
 */

import { describe, expect, it } from 'vitest'

import {
  saleChannelPath,
  shouldIndexSaleChannel,
  shouldListSaleChannelInSitemap,
} from '@/lib/frontend/sale-channel'
import {
  getCityPageType,
  legacyCanonicalPath,
  prefixedCanonicalPath,
  switchCityUrl,
} from '@/lib/frontend/city-routes'

describe('sale-channel/可见性口径', () => {
  it('有房源才进索引', () => {
    expect(shouldIndexSaleChannel(1)).toBe(true)
    expect(shouldIndexSaleChannel(42)).toBe(true)
    expect(shouldIndexSaleChannel(0)).toBe(false)
  })

  it('非法计数按不可索引处理（fail-closed）', () => {
    expect(shouldIndexSaleChannel(Number.NaN)).toBe(false)
    expect(shouldIndexSaleChannel(-1)).toBe(false)
    expect(shouldIndexSaleChannel(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('sitemap 与 index 判定永远一致', () => {
    for (const n of [0, 1, 5, -1, Number.NaN]) {
      expect(shouldListSaleChannelInSitemap(n)).toBe(shouldIndexSaleChannel(n))
    }
  })

  it('saleChannelPath 生成城市前缀与全站两种形态', () => {
    expect(saleChannelPath()).toBe('/sale')
    expect(saleChannelPath('shanghai')).toBe('/shanghai/sale')
  })
})

describe('sale-channel/路由解析', () => {
  it('识别全站与城市前缀的出售频道', () => {
    expect(getCityPageType('/sale')).toBe('sale')
    expect(getCityPageType('/shanghai/sale')).toBe('sale')
  })

  it('加城市前缀时保留筛选参数', () => {
    expect(prefixedCanonicalPath('/sale?areaMin=100', 'shanghai')).toBe(
      '/shanghai/sale?areaMin=100',
    )
  })

  it('去城市前缀时保留筛选参数', () => {
    expect(legacyCanonicalPath('/shanghai/sale?areaMin=100')).toBe('/sale?areaMin=100')
  })

  it('切换城市时停留在出售频道而不是跳回首页', () => {
    expect(switchCityUrl('/shanghai/sale?areaMin=100', 'suzhou')).toBe(
      '/suzhou/sale?areaMin=100',
    )
  })

  it('sale 是保留字，不会被当成城市 slug', () => {
    // 若 sale 未进保留字表，/sale 会被解析成「城市首页」而不是出售频道
    expect(getCityPageType('/sale')).not.toBe('home')
  })
})
