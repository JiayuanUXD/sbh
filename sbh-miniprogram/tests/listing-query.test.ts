import { describe, expect, it } from 'vitest'

import {
  applyListingPatch,
  nextPageQuery,
  normalizeListingQuery,
  parseListingQuery,
  serializeListingQuery,
} from '../miniprogram/domain/listing-query.js'
import type { ListingQueryPatch } from '../miniprogram/domain/listing-query.js'

describe('列表查询规范化', () => {
  it('没有 priceUnit 时移除价格范围并将价格排序降级为默认排序', () => {
    expect(normalizeListingQuery('district=jingan&priceMin=100&priceMax=200&sort=price-asc')).toBe(
      'district=jingan',
    )
  })

  it('保留有 priceUnit 的价格范围和价格排序，并移除城市覆盖', () => {
    expect(normalizeListingQuery('city=beijing&priceUnit=rmb-month&priceMin=100&priceMax=200&sort=price-desc')).toBe(
      'priceUnit=rmb-month&priceMin=100&priceMax=200&sort=price-desc',
    )
  })

  it('多个合法 priceUnit 冲突时只保留第一个，以保证价格条件只有一个单位', () => {
    expect(normalizeListingQuery('priceUnit=rmb-month&priceUnit=rmb-sqm-day&priceMin=100&sort=price-desc')).toBe(
      'priceUnit=rmb-month&priceMin=100&sort=price-desc',
    )
  })

  it('首个 priceUnit 非法时保留第一个合法值，并删除全部多余单位', () => {
    expect(normalizeListingQuery('priceUnit=unknown&priceUnit=rmb-month&priceUnit=rmb-sqm-day&priceMax=200')).toBe(
      'priceUnit=rmb-month&priceMax=200',
    )
  })

  it('对用户键和值重新编码', () => {
    expect(normalizeListingQuery('district=%E9%9D%99%E5%AE%89&q=%23office')).toBe(
      'district=%E9%9D%99%E5%AE%89&q=%23office',
    )
  })

  it('丢弃含未配对 surrogate 的项，其余外部查询继续规范化', () => {
    expect(normalizeListingQuery(`q=\uD800&district=jingan`)).toBe('district=jingan')
    expect(serializeListingQuery(parseListingQuery(`q=\uD800&district=jingan`))).toBe(
      'district=jingan',
    )
    expect(normalizeListingQuery(`\uD800=value&district=jingan`)).toBe('district=jingan')
  })

  it('patch 状态规范化会丢弃未配对 surrogate 关键词而不是在序列化时抛错', () => {
    const empty = parseListingQuery('')

    expect(serializeListingQuery(applyListingPatch(empty, { q: '\uD800' }))).toBe('')
    expect(serializeListingQuery(applyListingPatch(empty, { q: '\uDC00' }))).toBe('')
  })

  it('直接状态和 patch 数组规范化会丢弃含未配对 surrogate 的 district 项', () => {
    const empty = parseListingQuery('')
    const directState = {
      ...empty,
      district: ['\uD800', 'jingan', '\uDC00'],
    }

    expect(serializeListingQuery(directState)).toBe('district=jingan')
    expect(serializeListingQuery(applyListingPatch(empty, {
      district: ['\uD800', 'xuhui', '\uDC00'],
    }))).toBe('district=xuhui')
  })
})

describe('列表筛选 URL 状态', () => {
  it('以固定字段顺序序列化规范化后的筛选状态', () => {
    const query = parseListingQuery(
      'page=4&sort=newest&availableBefore=2026-08-01&priceUnit=rmb-month&priceMax=5000&priceMin=2000&areaMax=600&areaMin=100&type=coworking&type=traditional-office&district=xuhui&district=jingan&q=%20%E6%B1%9F%E6%99%AF%20',
    )

    expect(serializeListingQuery(query)).toBe(
      'q=%E6%B1%9F%E6%99%AF&district=xuhui&district=jingan&type=coworking&type=traditional-office&areaMin=100&areaMax=600&priceMin=2000&priceMax=5000&priceUnit=rmb-month&availableBefore=2026-08-01&sort=newest&page=4',
    )
  })

  it('去重数组并静默丢弃空关键词、非法枚举和非法数值', () => {
    const query = parseListingQuery(
      'q=%20%20&district=jingan&district=jingan&district=xuhui&type=coworking&type=coworking&type=unknown&areaMin=NaN&areaMax=Infinity&priceUnit=unknown&priceMin=100&priceMax=200&sort=unknown&page=0',
    )

    expect(serializeListingQuery(query)).toBe(
      'district=jingan&district=xuhui&type=coworking',
    )
  })

  it('复用原始规范化选择首个合法计价单位', () => {
    const query = parseListingQuery(
      'priceUnit=unknown&priceUnit=rmb-month&priceMin=100&sort=price-asc',
    )

    expect(serializeListingQuery(query)).toBe(
      'priceMin=100&priceUnit=rmb-month&sort=price-asc',
    )
  })

  it('将带计价单位的历史价格排序别名规范化为新排序值', () => {
    const ascending = parseListingQuery('priceUnit=rmb-month&sort=rent-asc')
    const descending = parseListingQuery('priceUnit=rmb-month&sort=rent-desc')

    expect(ascending.sort).toBe('price-asc')
    expect(descending.sort).toBe('price-desc')
    expect(serializeListingQuery(ascending)).toBe(
      'priceUnit=rmb-month&sort=price-asc',
    )
    expect(serializeListingQuery(descending)).toBe(
      'priceUnit=rmb-month&sort=price-desc',
    )
  })

  it('没有计价单位时将历史价格排序别名降级为推荐排序', () => {
    const ascending = parseListingQuery('sort=rent-asc')
    const descending = parseListingQuery('sort=rent-desc')

    expect(ascending.sort).toBe('recommended')
    expect(descending.sort).toBe('recommended')
    expect(serializeListingQuery(ascending)).toBe('')
    expect(serializeListingQuery(descending)).toBe('')
  })

  it('删除倒置区间，并在没有计价单位时删除价格范围和价格排序', () => {
    const query = parseListingQuery(
      'areaMin=600&areaMax=100&priceMin=5000&priceMax=2000&sort=price-asc&page=2',
    )

    expect(query.sort).toBe('recommended')
    expect(serializeListingQuery(query)).toBe('page=2')
  })

  const pageResetCases: readonly Readonly<{
    name: string
    patch: ListingQueryPatch
  }>[] = [
    { name: '关键词', patch: { q: '江景' } },
    { name: '区域', patch: { district: ['xuhui'] } },
    { name: '类型', patch: { type: ['coworking'] } },
    { name: '面积', patch: { areaMin: 300 } },
    { name: '价格', patch: { priceMin: 2000 } },
    { name: '计价单位', patch: { priceUnit: 'rmb-sqm-day' } },
    { name: '最晚入驻时间', patch: { availableBefore: '2026-08-01' } },
    { name: '排序', patch: { sort: 'newest' } },
  ]

  it.each(pageResetCases)('改变%s时删除 page', ({ patch }) => {
    const current = parseListingQuery(
      'district=jingan&type=traditional-office&areaMin=100&priceMin=1000&priceUnit=rmb-month&availableBefore=2026-07-01&sort=price-asc&page=3',
    )

    expect(applyListingPatch(current, patch).page).toBe(1)
    expect(serializeListingQuery(applyListingPatch(current, patch))).not.toContain('page=')
  })

  it('只有翻页动作保留 page 和既有筛选', () => {
    const current = parseListingQuery('district=jingan&priceUnit=rmb-month&page=3')

    expect(serializeListingQuery(nextPageQuery(current, 4)))
      .toBe('district=jingan&priceUnit=rmb-month&page=4')
  })

  it('清除全部结果条件时保留当前计价单位', () => {
    const current = parseListingQuery(
      'q=%E6%B1%9F%E6%99%AF&district=jingan&type=coworking&areaMin=300&priceMin=2000&priceMax=5000&priceUnit=rmb-month&availableBefore=2026-08-01&sort=price-asc&page=3',
    )

    expect(serializeListingQuery(applyListingPatch(current, {
      q: undefined,
      district: undefined,
      type: undefined,
      areaMin: undefined,
      areaMax: undefined,
      priceMin: undefined,
      priceMax: undefined,
      availableBefore: undefined,
      sort: 'recommended',
    }))).toBe('priceUnit=rmb-month')
  })
})
