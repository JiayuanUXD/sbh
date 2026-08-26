/**
 * OPT-053：精选区域重排（首页热门商圈 bento 与首屏 chips 共用）
 *
 * 被守护的三条判断，每一条都对应一种「看起来能用、实际有害」的实现：
 *
 *   1. **空配置必须原样返回**。七城 profile 目前全空，若空数组也走排序逻辑，
 *      这一项上线当天就会改变所有城市的首页顺序，而没人配置过任何东西。
 *   2. **只重排、不过滤**。过滤会让没选中的商圈从首页消失——运营配三个精选区域
 *      就把其余全藏起来，属于悄悄减少库存曝光，与 ExcludedUnitsBar 那条诚实
 *      口径直接相反。
 *   3. **未命中项保持原相对次序**。它们的顺序本身有含义（按楼盘 recommendedOrder
 *      聚合而来），打乱等于把运营在楼盘侧的排序工作作废。
 */
import { describe, expect, it } from 'vitest'

import { orderByFeaturedRegions } from '@/lib/frontend/featured-regions'

const items = [
  { slug: 'jingan', name: '静安' },
  { slug: 'lujiazui', name: '陆家嘴' },
  { slug: 'xuhui', name: '徐汇' },
  { slug: 'hongqiao', name: '虹桥' },
]

describe('orderByFeaturedRegions', () => {
  it('精选区域为空时原样返回（同一个数组引用，绝不重排）', () => {
    expect(orderByFeaturedRegions(items, [])).toBe(items)
  })

  it('空列表不炸', () => {
    expect(orderByFeaturedRegions([], [{ slug: 'lujiazui' }])).toEqual([])
  })

  it('选中的按运营给定顺序置顶', () => {
    const out = orderByFeaturedRegions(items, [{ slug: 'hongqiao' }, { slug: 'lujiazui' }])
    expect(out.map((i) => i.slug)).toEqual(['hongqiao', 'lujiazui', 'jingan', 'xuhui'])
  })

  it('只重排不过滤：没被选中的一个都不能少', () => {
    const out = orderByFeaturedRegions(items, [{ slug: 'lujiazui' }])
    expect(out).toHaveLength(items.length)
    expect(new Set(out.map((i) => i.slug))).toEqual(new Set(items.map((i) => i.slug)))
  })

  it('未命中项保持原相对次序', () => {
    const out = orderByFeaturedRegions(items, [{ slug: 'xuhui' }])
    // 剔掉被提到前面的 xuhui，其余必须仍是 jingan → lujiazui → hongqiao
    expect(out.slice(1).map((i) => i.slug)).toEqual(['jingan', 'lujiazui', 'hongqiao'])
  })

  it('配置里含库中不存在的 slug 时忽略它，不产生空位', () => {
    const out = orderByFeaturedRegions(items, [{ slug: 'not-in-city' }, { slug: 'xuhui' }])
    expect(out.map((i) => i.slug)).toEqual(['xuhui', 'jingan', 'lujiazui', 'hongqiao'])
  })

  it('配置里重复同一个 slug 时按首次出现定位，不重复渲染该项', () => {
    const out = orderByFeaturedRegions(items, [
      { slug: 'hongqiao' },
      { slug: 'jingan' },
      { slug: 'hongqiao' },
    ])
    expect(out.map((i) => i.slug)).toEqual(['hongqiao', 'jingan', 'lujiazui', 'xuhui'])
    expect(out).toHaveLength(items.length)
  })
})
