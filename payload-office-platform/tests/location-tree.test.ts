import { describe, expect, it } from 'vitest'

import {
  buildChildrenIndex,
  buildLocationForest,
  computeMatchedKeys,
  type FlatLocationNode,
} from '@/domain/geography/location-tree'

/**
 * 树组装 & 搜索过滤纯函数单测（tasks.md M2.2）
 *
 * 固定层级样例：
 *   上海(1,city)
 *     ├ 浦东(2,district)  ├ 陆家嘴(3,business_area)
 *     ├ 黄浦(4,district)
 *     └ 1号线(5,metro_line) └ 陆家嘴站(6,metro_station)
 *   北京(7,city)
 *     └ 朝阳(8,district)
 */
const NODES: FlatLocationNode[] = [
  n(1, '上海', 'city', null, 10),
  n(2, '浦东', 'district', 1, 20),
  n(3, '陆家嘴', 'business_area', 2, 5),
  n(4, '黄浦', 'district', 1, 10),
  n(5, '1号线', 'metro_line', 1, 30),
  n(6, '陆家嘴站', 'metro_station', 5, 1),
  n(7, '北京', 'city', null, 5),
  n(8, '朝阳', 'district', 7, 10),
]

function n(
  id: number,
  name: string,
  type: FlatLocationNode['type'],
  parentId: number | null,
  sortOrder: number,
  extra: Partial<FlatLocationNode> = {},
): FlatLocationNode {
  return {
    id,
    name,
    type,
    parentId,
    sortOrder,
    immutableCode: extra.immutableCode ?? `CODE-${id}`,
    status: extra.status ?? 'active',
    frontendVisible: extra.frontendVisible ?? false,
  }
}

describe('location-tree/buildChildrenIndex', () => {
  it('按 parentId 分组，同层按 sortOrder 升序、名称次级稳定', () => {
    const idx = buildChildrenIndex(NODES)
    // 根层：北京(sort5) 在 上海(sort10) 前
    expect(idx.get(null)!.map((x) => x.id)).toEqual([7, 1])
    // 上海子层：黄浦(10) < 浦东(20) < 1号线(30)
    expect(idx.get(1)!.map((x) => x.id)).toEqual([4, 2, 5])
  })

  it('同 sortOrder 时按名称 zh 排序', () => {
    const same: FlatLocationNode[] = [
      n(1, '上海', 'city', null, 10),
      n(2, 'B区', 'district', 1, 5),
      n(3, 'A区', 'district', 1, 5),
    ]
    const idx = buildChildrenIndex(same)
    expect(idx.get(1)!.map((x) => x.name)).toEqual(['A区', 'B区'])
  })
})

describe('location-tree/computeMatchedKeys', () => {
  it('空关键词返回 null（不过滤）', () => {
    expect(computeMatchedKeys(NODES, '')).toBeNull()
    expect(computeMatchedKeys(NODES, '   ')).toBeNull()
  })

  it('命中节点保留自身及全部祖先链', () => {
    const keep = computeMatchedKeys(NODES, '陆家嘴站')!
    // 陆家嘴站(6) → 1号线(5) → 上海(1)
    expect([...keep].sort((a, b) => Number(a) - Number(b))).toEqual([1, 5, 6])
  })

  it('按区域代码命中', () => {
    const keep = computeMatchedKeys(NODES, 'code-8')!
    // 朝阳(8) → 北京(7)
    expect([...keep].sort((a, b) => Number(a) - Number(b))).toEqual([7, 8])
  })

  it('大小写不敏感，多命中并集', () => {
    const keep = computeMatchedKeys(NODES, '陆家嘴')!
    // 陆家嘴(3)→浦东(2)→上海(1) 与 陆家嘴站(6)→1号线(5)→上海(1) 并集
    expect([...keep].sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 5, 6])
  })

  it('成环脏数据不死循环（16 层熔断）', () => {
    const cyclic: FlatLocationNode[] = [
      n(1, 'A', 'city', 2, 1),
      n(2, 'B', 'district', 1, 1),
    ]
    const keep = computeMatchedKeys(cyclic, 'A')!
    expect(keep.has(1)).toBe(true)
  })
})

describe('location-tree/buildLocationForest', () => {
  it('无关键词：组装完整森林，展开集为全部节点', () => {
    const { forest, expandedIds } = buildLocationForest(NODES)
    // 根层顺序 北京、上海
    expect(forest.map((f) => f.id)).toEqual([7, 1])
    // 上海子树：黄浦、浦东、1号线
    const sh = forest.find((f) => f.id === 1)!
    expect(sh.children.map((c) => c.id)).toEqual([4, 2, 5])
    // 浦东下挂陆家嘴
    const pudong = sh.children.find((c) => c.id === 2)!
    expect(pudong.children.map((c) => c.id)).toEqual([3])
    // 1号线下挂陆家嘴站
    const line = sh.children.find((c) => c.id === 5)!
    expect(line.children.map((c) => c.id)).toEqual([6])
    // 展开集含全部 8 个节点
    expect(expandedIds.sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('关键词：仅保留命中链，展开集为命中集', () => {
    const { forest, expandedIds } = buildLocationForest(NODES, '陆家嘴站')
    // 只剩 上海 → 1号线 → 陆家嘴站
    expect(forest.map((f) => f.id)).toEqual([1])
    const sh = forest[0]
    expect(sh.children.map((c) => c.id)).toEqual([5])
    expect(sh.children[0].children.map((c) => c.id)).toEqual([6])
    expect(expandedIds.sort((a, b) => Number(a) - Number(b))).toEqual([1, 5, 6])
  })

  it('关键词无命中：空森林', () => {
    const { forest, expandedIds } = buildLocationForest(NODES, '不存在的区域xyz')
    expect(forest).toEqual([])
    expect(expandedIds).toEqual([])
  })

  it('停用节点仍出现在树中（浏览不隐藏，仅新增候选过滤）', () => {
    const withDisabled: FlatLocationNode[] = [
      n(1, '上海', 'city', null, 10),
      n(2, '浦东', 'district', 1, 20, { status: 'disabled' }),
    ]
    const { forest } = buildLocationForest(withDisabled)
    expect(forest[0].children.map((c) => c.id)).toEqual([2])
  })
})
