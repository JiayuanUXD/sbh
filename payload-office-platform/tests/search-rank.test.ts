import { describe, expect, it } from 'vitest'

import { scoreListingMatch, scoreListingMatchAll } from '@/domain/search/rank'

describe('scoreListingMatch', () => {
  it('标题全等 / 前缀 / 包含分别是 100 / 80 / 60', () => {
    expect(scoreListingMatch({ title: '陆家嘴整层' }, '陆家嘴整层')).toBe(100)
    expect(scoreListingMatch({ title: '陆家嘴整层' }, '陆家嘴')).toBe(80)
    expect(scoreListingMatch({ title: '整层陆家嘴' }, '陆家嘴')).toBe(60)
  })

  it('楼盘名全等 / 前缀 / 包含分别是 90 / 70 / 50', () => {
    expect(scoreListingMatch({ buildingName: '上海中心' }, '上海中心')).toBe(90)
    expect(scoreListingMatch({ buildingName: '上海中心大厦' }, '上海中心')).toBe(70)
    expect(scoreListingMatch({ buildingName: '陆家嘴上海中心' }, '上海中心')).toBe(50)
  })

  it('行政区与地铁名权重更低', () => {
    expect(scoreListingMatch({ districtName: '浦东新区' }, '浦东新区')).toBe(40)
    expect(scoreListingMatch({ metroName: '陆家嘴' }, '陆家嘴')).toBe(35)
  })

  it('多字段命中取最高分，不叠加', () => {
    expect(scoreListingMatch({ title: '上海中心', buildingName: '上海中心' }, '上海中心')).toBe(100)
    expect(scoreListingMatch({ title: 'A', buildingName: '上海中心' }, '上海中心')).toBe(90)
  })

  it('大小写不敏感', () => {
    expect(scoreListingMatch({ title: 'IFC Tower' }, 'ifc')).toBe(80)
  })

  it('无命中返回 0', () => {
    expect(scoreListingMatch({ title: '陆家嘴' }, '静安')).toBe(0)
    expect(scoreListingMatch({}, '静安')).toBe(0)
  })
})

describe('scoreListingMatchAll', () => {
  it('多词累加得分并统计命中词数', () => {
    expect(scoreListingMatchAll({ title: '陆家嘴整层', districtName: '浦东新区' }, ['陆家嘴', '浦东'])).toEqual({
      score: 115,
      matched: 2,
    })
  })

  it('未命中的词不计分也不计入 matched', () => {
    expect(scoreListingMatchAll({ title: '陆家嘴整层' }, ['陆家嘴', '静安'])).toEqual({
      score: 80,
      matched: 1,
    })
  })

  it('全部未命中返回 0 / 0', () => {
    expect(scoreListingMatchAll({ title: '陆家嘴' }, ['静安', '徐汇'])).toEqual({ score: 0, matched: 0 })
  })
})
