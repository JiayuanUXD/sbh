/**
 * 站内搜索把楼盘地址纳入匹配（用户会直接搜路名：南京西路、延安西路）。
 *
 * 地址是公开字段（楼盘卡片上就显示），不涉及隐私。命中地址的分数低于所有名称类字段
 * （楼盘名 / 标题 / 行政区 / 商圈 / 地铁），只用来补召回，不抢名称命中的排序。
 */

import { describe, expect, it } from 'vitest'

import { buildBuildingPageQuery } from '@/domain/public-catalog/building-query-sql'
import { buildListingPageQuery } from '@/domain/public-catalog/listing-query-sql'
import { createSearchContext } from '@/domain/public-catalog/types'

const ctx = createSearchContext('shanghai')
const baseInput = { sort: 'recommended', page: 1, pageSize: 24 } as const

describe('房源站内搜索：地址参与匹配', () => {
  const query = buildListingPageQuery({ ...baseInput }, ctx, { terms: ['南京西路'], mode: 'and' })

  it('命中条件与打分都包含 b.address', () => {
    expect(query.text).toContain('b.address ILIKE')
    // 条件里一处、打分里一处
    expect(query.text.match(/b\.address ILIKE/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('用户输入只走绑定参数，不进 SQL 文本', () => {
    expect(query.text).not.toContain('南京西路')
    expect(query.values).toContain('%南京西路%')
  })

  it('地址命中的分数低于地铁名称的 contains（25）', () => {
    expect(query.text).toMatch(/WHEN b\.address ILIKE \$\d+ THEN 20\s+ELSE 0/)
  })

  it('没有关键词时不引用地址', () => {
    expect(buildListingPageQuery({ ...baseInput }, ctx).text).not.toContain('b.address')
  })
})

describe('楼盘检索 q：地址参与匹配', () => {
  const query = buildBuildingPageQuery({ q: '南京西路', sort: 'stock-desc', page: 1, pageSize: 24 }, ctx, [])

  it('命中条件与打分都包含 b.address', () => {
    expect(query.text.match(/b\.address ILIKE/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('地址命中的分数低于地铁名称的 contains（25）', () => {
    expect(query.text).toMatch(/WHEN b\.address ILIKE \$\d+ THEN 20\s+ELSE 0/)
  })

  it('用户输入只走绑定参数', () => {
    expect(query.text).not.toContain('南京西路')
    expect(query.values).toContain('%南京西路%')
  })

  it('没有 q 时不引用地址', () => {
    const none = buildBuildingPageQuery({ sort: 'stock-desc', page: 1, pageSize: 24 }, ctx, [])
    expect(none.text).not.toContain('b.address')
  })
})
