import { describe, it, expect } from 'vitest'

import {
  buildChildrenIndex,
  groupCityDirectChildren,
  type FlatLocationNode,
} from '@/domain/geography/location-tree'

const node = (id: number, opts: Partial<FlatLocationNode>): FlatLocationNode => ({
  id,
  name: String(id),
  type: 'district',
  immutableCode: `C${id}`,
  parentId: null,
  status: 'active',
  sortOrder: 0,
  frontendVisible: true,
  ...opts,
})

// 上海 + 2 行政区 + 1 地铁线路 + 1 商圈（商圈挂在行政区下，非城市直属）
const CITY = node(10, { name: '上海', type: 'city', immutableCode: 'SH' })
const NETFLIX = node(1, { name: '黄浦区', parentId: 10, immutableCode: 'SH-HP', sortOrder: 2 })
const PUTUO = node(2, { name: '普陀区', parentId: 10, immutableCode: 'SH-PT', sortOrder: 1 })
const LINE11 = node(3, { name: '11号线', type: 'metro_line', parentId: 10, sortOrder: 1 })
const OTHER = node(4, { name: '苏州', type: 'city', immutableCode: 'SZ' })
const AREA = node(5, { name: '南京西路', type: 'business_area', parentId: 1 })

describe('location-tree/城市直属子节点按类型分组（Task 7 只读树）', () => {
  it('把城市直属子节点按类型分组，只保留合法子类型（行政区/地铁线路）', () => {
    const groups = groupCityDirectChildren([CITY, NETFLIX, PUTUO, LINE11, OTHER, AREA], 10)
    expect(groups).toHaveLength(2)
    const [d, l] = groups
    expect(d.type).toBe('district')
    expect(l.type).toBe('metro_line')
    // 商圈挂在行政区下、苏州是另一座城市，都不算上海直属子节点
    expect(d.members.map((n) => n.id)).toEqual([2, 1]) // sortOrder 升序：普陀(1) 黄浦(2)
    expect(l.members.map((n) => n.id)).toEqual([3])
  })

  it('城市无直属子节点时返回空数组', () => {
    expect(groupCityDirectChildren([CITY], 10)).toEqual([])
  })

  it('分组顺序固定为行政区 → 地铁线路（与虚拟分组节点渲染一致）', () => {
    const lineOnly = groupCityDirectChildren([CITY, LINE11], 10)
    expect(lineOnly.map((g) => g.type)).toEqual(['metro_line'])
    const both = groupCityDirectChildren([CITY, LINE11, NETFLIX], 10)
    expect(both.map((g) => g.type)).toEqual(['district', 'metro_line'])
  })

  it('buildChildrenIndex 同层按 sortOrder 升序、再按名称稳定排序', () => {
    const idx = buildChildrenIndex([CITY, NETFLIX, PUTUO])
    const cityChildren = idx.get(10)!
    expect(cityChildren.map((n) => n.id)).toEqual([2, 1]) // 普陀 sortOrder1 在前
  })
})