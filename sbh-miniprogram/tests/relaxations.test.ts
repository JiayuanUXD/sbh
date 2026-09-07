import { describe, expect, it } from 'vitest'

import { parseListingQuery } from '../miniprogram/domain/listing-query.js'
import { buildRelaxationQueries, loadRelaxations } from '../miniprogram/domain/relaxations.js'
import type { MiniListingsData } from '../miniprogram/services/catalog-contracts.js'

function listings(totalDocs: number): MiniListingsData {
  return {
    items: [],
    pagination: {
      page: 1,
      pageSize: 24,
      totalDocs,
      totalPages: totalDocs > 0 ? 1 : 0,
      hasNextPage: false,
      hasPrevPage: false,
    },
    canonicalQuery: '',
    currentPriceUnit: null,
    filters: [],
  }
}

describe('零结果放宽建议', () => {
  it('只为已生效的收窄条件生成逐项放宽候选，并保留计价单位', () => {
    const query = parseListingQuery(
      'q=%E6%B1%9F%E6%99%AF&district=jingan&areaMin=500&priceMin=2000&priceMax=5000&priceUnit=rmb-sqm-day&availableBefore=2026-08-01&page=3',
    )

    expect(buildRelaxationQueries(query)).toEqual([
      expect.objectContaining({
        dimension: 'q',
        query: 'district=jingan&areaMin=500&priceMin=2000&priceMax=5000&priceUnit=rmb-sqm-day&availableBefore=2026-08-01',
      }),
      expect.objectContaining({
        dimension: 'district',
        query: 'q=%E6%B1%9F%E6%99%AF&areaMin=500&priceMin=2000&priceMax=5000&priceUnit=rmb-sqm-day&availableBefore=2026-08-01',
      }),
      expect.objectContaining({
        dimension: 'area',
        query: 'q=%E6%B1%9F%E6%99%AF&district=jingan&priceMin=2000&priceMax=5000&priceUnit=rmb-sqm-day&availableBefore=2026-08-01',
      }),
      expect.objectContaining({
        dimension: 'price',
        query: 'q=%E6%B1%9F%E6%99%AF&district=jingan&areaMin=500&priceUnit=rmb-sqm-day&availableBefore=2026-08-01',
      }),
      expect.objectContaining({
        dimension: 'availableBefore',
        query: 'q=%E6%B1%9F%E6%99%AF&district=jingan&areaMin=500&priceMin=2000&priceMax=5000&priceUnit=rmb-sqm-day',
      }),
    ])
  })

  it('最多发起三次真实计数请求，并忽略单项失败和零命中', async () => {
    const query = parseListingQuery('q=%E6%B1%9F%E6%99%AF&district=jingan&areaMin=500&priceUnit=rmb-sqm-day')
    const calls: string[] = []

    const suggestions = await loadRelaxations(query, async (candidate) => {
      calls.push(candidate)
      if (!candidate.includes('q=')) throw new Error('计数接口暂不可用')
      if (!candidate.includes('district=')) return listings(0)
      return listings(7)
    })

    expect(calls).toHaveLength(3)
    expect(suggestions).toEqual([expect.objectContaining({
      dimension: 'area',
      count: 7,
      query: 'q=%E6%B1%9F%E6%99%AF&district=jingan&priceUnit=rmb-sqm-day',
    })])
  })

  it('只给收窄条件生成最多三条放宽查询并保留计价单位', async () => {
    const query = parseListingQuery('q=%E6%B1%9F%E6%99%AF&district=jingan&areaMin=500&priceUnit=rmb-sqm-day')
    const suggestions = await loadRelaxations(query, async () => listings(1))

    expect(suggestions).toHaveLength(3)
    expect(suggestions.every((item) => item.query.includes('priceUnit=rmb-sqm-day'))).toBe(true)
  })
})
