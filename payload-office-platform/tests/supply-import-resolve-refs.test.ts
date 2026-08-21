import { describe, expect, it } from 'vitest'

import {
  resolveLocation,
  resolveBuilding,
  suggestClosest,
  type BuildingCandidate,
  type ResolveTables,
} from '@/domain/supply-import/resolve-refs'

const tables: ResolveTables = {
  locations: {
    city: [{ id: 1, name: '上海', kind: 'city', parentId: null }],
    district: [
      { id: 11, name: '浦东新区', kind: 'district', parentId: 1 },
      { id: 12, name: '黄浦区', kind: 'district', parentId: 1 },
    ],
    business_area: [],
    metro_station: [],
  },
  aliases: {
    city: new Map(),
    district: new Map([['浦东', 11]]),
    business_area: new Map(),
    metro_station: new Map(),
  },
}

describe('resolveLocation', () => {
  it('规范化后精确命中名称', () => {
    const r = resolveLocation({ kind: 'district', text: ' 黄浦区 ', parentId: 1 }, tables)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.id).toBe(12)
  })

  it('命中别名表', () => {
    const r = resolveLocation({ kind: 'district', text: '浦东', parentId: 1 }, tables)
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.id).toBe(11)
  })

  it('未命中时报错并给候选建议，但绝不自动采用', () => {
    const r = resolveLocation({ kind: 'district', text: '黄浦', parentId: 1 }, tables)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('LOCATION_NOT_FOUND')
    expect(r.ok === false && r.suggestion).toContain('黄浦区')
  })

  it('父级不匹配时判错——区域必须属于所填城市', () => {
    const r = resolveLocation({ kind: 'district', text: '浦东新区', parentId: 999 }, tables)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('LOCATION_PARENT_MISMATCH')
  })
})

const buildings: readonly BuildingCandidate[] = [
  { id: 100, name: '星展银行大厦', slug: 'xing-zhan-yin-hang-da-sha', externalId: 'B-001', cityId: 1 },
  { id: 101, name: '星展大厦', slug: 'xing-zhan-da-sha', externalId: 'B-002', cityId: 1 },
  { id: 102, name: '环球金融中心', slug: 'huan-qiu-jin-rong-zhong-xin', externalId: null, cityId: 1 },
  { id: 103, name: '环球金融中心', slug: 'huan-qiu-jin-rong-zhong-xin-2', externalId: null, cityId: 1 },
]

describe('resolveBuilding', () => {
  it('优先按外部编号精确命中', () => {
    const r = resolveBuilding('B-002', buildings)
    expect(r.ok && r.value.id).toBe(101)
  })

  it('其次按 slug 命中', () => {
    const r = resolveBuilding('xing-zhan-da-sha', buildings)
    expect(r.ok && r.value.id).toBe(101)
  })

  it('名称精确命中（规范化后）', () => {
    const r = resolveBuilding(' 星展银行大厦 ', buildings)
    expect(r.ok && r.value.id).toBe(100)
  })

  it('同名多条时报错要求消歧，绝不挑一个', () => {
    const r = resolveBuilding('环球金融中心', buildings)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('BUILDING_AMBIGUOUS')
    // 消息里要给出可用于消歧的 slug
    expect(r.ok === false && r.message).toContain('huan-qiu-jin-rong-zhong-xin-2')
  })

  it('相似但不相等时不匹配，只给建议', () => {
    const r = resolveBuilding('星展银行大夏', buildings)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('BUILDING_NOT_FOUND')
    expect(r.ok === false && r.suggestion).toContain('星展银行大厦')
  })
})

describe('suggestClosest', () => {
  it('按编辑距离升序返回，并按 limit 截断', () => {
    // '浦东新' → '浦东新' 距离 0；→ '浦东新区' 距离 1/4=0.25；→ '浦东' 距离 1/3≈0.33
    // 三者都在阈值内，limit=2 时只留最近的两个，且顺序不能乱
    expect(suggestClosest('浦东新', ['浦东', '浦东新区', '浦东新'], 2)).toEqual(['浦东新', '浦东新区'])
  })

  it('相差太远的候选被过滤掉，不产生噪音建议', () => {
    // '黄浦' 对 '浦东新区' 的编辑距离是 4，比值 1.0——推荐它只会误导运营
    expect(suggestClosest('黄浦', ['黄浦区', '浦东新区', '静安区'], 3)).toEqual(['黄浦区'])
  })

  it('全都差太远时返回空数组', () => {
    expect(suggestClosest('abcdefg', ['黄浦区'], 3)).toEqual([])
  })
})
