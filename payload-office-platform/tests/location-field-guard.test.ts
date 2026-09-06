import { describe, expect, it } from 'vitest'

import {
  pendingLocationChecks,
  toLocationIds,
  type LocationFieldSpec,
} from '@/domain/geography/location-field-guard'

/**
 * 地理字段变更检测纯函数单测（OPT-074 Task 1）
 *
 * 本文件守护的核心不变量：**值没变就不校验**。
 *
 * 这不是性能优化，是正确性要求。Payload 的 filterOptions 在保存时是硬校验
 * （payload/dist/fields/validations.js 的 validateFilterOptions），但它拿不到
 * originalDoc，分不清「用户这次选的新值」和「文档里躺着的旧值」。后果 2026-09-06
 * 已实测：停用一个正被引用的商圈，引用它的楼盘连改照片都会被拦下，报错还是
 * 看不懂的「该字段有以下无效的选择：11」。详见
 * specs/work-items/OPT-074-location-cascade-selector.md §2.2。
 */

const SPECS: LocationFieldSpec[] = [
  { field: 'city', type: 'city', label: '城市' },
  { field: 'district', type: 'district', parentField: 'city', label: '行政区' },
  { field: 'businessDistrict', type: 'business_area', parentField: 'district', label: '商圈' },
]

const MANY: LocationFieldSpec[] = [
  { field: 'featuredRegions', type: ['district', 'business_area'], many: true, label: '精选区域' },
]

describe('toLocationIds', () => {
  it('裸 id / populate 对象 / 数组 / 空值 统一成 id 数组', () => {
    expect(toLocationIds(3)).toEqual([3])
    expect(toLocationIds({ id: 3 })).toEqual([3])
    expect(toLocationIds([3, { id: 4 }])).toEqual([3, 4])
    expect(toLocationIds(null)).toEqual([])
    expect(toLocationIds(undefined)).toEqual([])
  })

  it('丢弃形状不认识的元素，不抛错', () => {
    expect(toLocationIds([3, {}, null, 'abc'])).toEqual([3, 'abc'])
  })
})

describe('pendingLocationChecks', () => {
  it('★ 值没变 → 不校验（filterOptions 做不到、导致记录改不动的正是这件事）', () => {
    expect(pendingLocationChecks(SPECS, { district: 3 }, { district: 3 })).toEqual([])
  })

  it('originalDoc 是 populate 对象、data 是裸 id，视为没变', () => {
    expect(
      pendingLocationChecks(SPECS, { district: 3 }, { district: { id: 3, name: '浦东新区' } }),
    ).toEqual([])
  })

  it('数字 id 与字符串 id 视为同一个（Payload 关系值两种形态都出现过）', () => {
    expect(pendingLocationChecks(SPECS, { district: '3' }, { district: 3 })).toEqual([])
  })

  it('值变了 → 校验新值', () => {
    expect(pendingLocationChecks(SPECS, { district: 5 }, { district: 3 })).toEqual([
      { spec: SPECS[1], id: 5 },
    ])
  })

  it('新建文档 → 所有已提交的值都要校验', () => {
    expect(pendingLocationChecks(SPECS, { city: 1, district: 3 }, null)).toEqual([
      { spec: SPECS[0], id: 1 },
      { spec: SPECS[1], id: 3 },
    ])
  })

  it('字段本次未提交（undefined）→ 跳过，不误伤 patch 式更新', () => {
    expect(pendingLocationChecks(SPECS, { name: '改个名' }, { district: 3 })).toEqual([])
  })

  it('值被清空（null）→ 不校验（是否允许为空由 required 管，不归本函数）', () => {
    expect(pendingLocationChecks(SPECS, { businessDistrict: null }, { businessDistrict: 9 })).toEqual(
      [],
    )
  })

  it('hasMany 新增一个 → 只校验新增的那个', () => {
    expect(
      pendingLocationChecks(MANY, { featuredRegions: [1, 2, 3] }, { featuredRegions: [1, 2] }),
    ).toEqual([{ spec: MANY[0], id: 3 }])
  })

  it('hasMany 只删不增 → 不校验', () => {
    expect(
      pendingLocationChecks(MANY, { featuredRegions: [1] }, { featuredRegions: [1, 2] }),
    ).toEqual([])
  })

  it('hasMany 新建 → 全部校验', () => {
    expect(pendingLocationChecks(MANY, { featuredRegions: [1, 2] }, null)).toEqual([
      { spec: MANY[0], id: 1 },
      { spec: MANY[0], id: 2 },
    ])
  })

  it('hasMany 的 originalDoc 是 populate 对象数组，仍能正确比对', () => {
    expect(
      pendingLocationChecks(
        MANY,
        { featuredRegions: [1, 2] },
        { featuredRegions: [{ id: 1, name: '静安区' }, { id: 2, name: '虹桥' }] },
      ),
    ).toEqual([])
  })

  it('originalDoc 为 undefined 与为 null 行为一致（都按新建处理）', () => {
    expect(pendingLocationChecks(SPECS, { city: 1 }, undefined)).toEqual([
      { spec: SPECS[0], id: 1 },
    ])
  })
})
