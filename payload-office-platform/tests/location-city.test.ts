import { describe, it, expect } from 'vitest'
import type { LocationType } from '@/domain/geography/location-hierarchy'
import {
  cityScopeWhere,
  resolveCityIdFromFlat,
  type CityResolvableNode,
} from '@/domain/geography/location-city'

/** 构造最小可解析节点（id / type / parentId） */
function node(
  id: number,
  type: LocationType,
  parentId: number | string | null,
): CityResolvableNode {
  return { id, type, parentId }
}

describe('cityScopeWhere', () => {
  it('数字 id：返回「城市自身或 city 字段指向该城市」的 or 条件', () => {
    expect(cityScopeWhere(5)).toEqual({
      or: [{ id: { equals: 5 } }, { city: { equals: 5 } }],
    })
  })

  it('字符串 id：同样构造 or 条件', () => {
    expect(cityScopeWhere('CITY-HZ')).toEqual({
      or: [{ id: { equals: 'CITY-HZ' } }, { city: { equals: 'CITY-HZ' } }],
    })
  })
})

describe('resolveCityIdFromFlat', () => {
  it('城市节点自身：返回自身 id', () => {
    const nodes = [node(1, 'city', null)]
    expect(resolveCityIdFromFlat(nodes, 1)).toBe(1)
  })

  it('行政区：上溯一层命中城市', () => {
    const nodes = [node(1, 'city', null), node(2, 'district', 1)]
    expect(resolveCityIdFromFlat(nodes, 2)).toBe(1)
  })

  it('商圈：上溯两层（商圈 -> 行政区 -> 城市）命中', () => {
    const nodes = [node(1, 'city', null), node(2, 'district', 1), node(3, 'business_area', 2)]
    expect(resolveCityIdFromFlat(nodes, 3)).toBe(1)
  })

  it('地铁线路：上溯一层命中城市', () => {
    const nodes = [node(1, 'city', null), node(4, 'metro_line', 1)]
    expect(resolveCityIdFromFlat(nodes, 4)).toBe(1)
  })

  it('地铁站：上溯两层（站 -> 线 -> 城市）命中', () => {
    const nodes = [node(1, 'city', null), node(4, 'metro_line', 1), node(5, 'metro_station', 4)]
    expect(resolveCityIdFromFlat(nodes, 5)).toBe(1)
  })

  it('startId 不在节点集合中：返回 null', () => {
    const nodes = [node(1, 'city', null)]
    expect(resolveCityIdFromFlat(nodes, 999)).toBeNull()
  })

  it('父级断链（parentId 指向不存在的节点）：返回 null', () => {
    const nodes = [node(2, 'district', 99)] // 99 不存在
    expect(resolveCityIdFromFlat(nodes, 2)).toBeNull()
  })

  it('非城市节点且 parentId 为 null（孤儿根）：返回 null', () => {
    const nodes = [node(2, 'district', null)]
    expect(resolveCityIdFromFlat(nodes, 2)).toBeNull()
  })

  it('病态成环节点（A.parent=B, B.parent=A，均非城市）：返回 null 且不死循环', () => {
    const nodes = [node(10, 'district', 11), node(11, 'district', 10)]
    expect(resolveCityIdFromFlat(nodes, 10)).toBeNull()
  })

  it('病态深度超过 8 的链（无城市）：返回 null 且不死循环', () => {
    // 构造 12 层深的行政区链（违反固定层级，纯病态数据），末尾无城市
    const nodes: CityResolvableNode[] = []
    for (let i = 1; i <= 12; i++) {
      nodes.push(node(i, 'district', i === 1 ? null : i - 1))
    }
    // 从最深节点起上溯，超过 8 层仍未命中城市 -> null
    expect(resolveCityIdFromFlat(nodes, 12)).toBeNull()
  })

  it('空节点集合：返回 null', () => {
    expect(resolveCityIdFromFlat([], 1)).toBeNull()
  })
})
