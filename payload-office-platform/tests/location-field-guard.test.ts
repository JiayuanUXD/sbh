import { describe, expect, it } from 'vitest'

import {
  createLocationFieldGuard,
  pendingLocationChecks,
  toLocationIds,
  type LocationFieldSpec,
} from '@/domain/geography/location-field-guard'
import { DomainError } from '@/domain/shared/errors'

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

// ——————————————————————————————————————————————————————————————
// hook 工厂
// ——————————————————————————————————————————————————————————————

type Node = {
  id: number
  name: string
  type: string
  parent?: number | null
  status?: string
}

/**
 * 上海(1) > 长宁区(2) > 虹桥(3)
 * 上海(1) > 黄浦区(4) > 外滩(5)
 * 北京(6) > 朝阳区(7)
 * 停用商圈：静安寺(8, disabled) 挂在长宁区(2) 下
 */
const NODES: Node[] = [
  { id: 1, name: '上海', type: 'city', parent: null, status: 'active' },
  { id: 2, name: '长宁区', type: 'district', parent: 1, status: 'active' },
  { id: 3, name: '虹桥', type: 'business_area', parent: 2, status: 'active' },
  { id: 4, name: '黄浦区', type: 'district', parent: 1, status: 'active' },
  { id: 5, name: '外滩', type: 'business_area', parent: 4, status: 'active' },
  { id: 6, name: '北京', type: 'city', parent: null, status: 'active' },
  { id: 7, name: '朝阳区', type: 'district', parent: 6, status: 'active' },
  { id: 8, name: '静安寺', type: 'business_area', parent: 2, status: 'disabled' },
]

function makeReq(nodes: Node[] = NODES) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const state = { findCalls: 0 }
  return {
    _state: state,
    payload: {
      find: async ({ where }: { where: { id: { in: Array<number | string> } } }) => {
        state.findCalls += 1
        const docs = where.id.in
          .map((id) => byId.get(Number(id)))
          .filter((n): n is Node => Boolean(n))
          .map((n) => ({
            id: n.id,
            name: n.name,
            type: n.type,
            parent: n.parent ?? null,
            status: n.status,
          }))
        return { docs }
      },
    },
  } as never
}

const findCallsOf = (req: unknown): number =>
  (req as { _state: { findCalls: number } })._state.findCalls

const BUILDING_SPECS: LocationFieldSpec[] = [
  { field: 'city', type: 'city', label: '城市' },
  { field: 'district', type: 'district', parentField: 'city', label: '行政区' },
  { field: 'businessDistrict', type: 'business_area', parentField: 'district', label: '商圈' },
]

const invoke = (
  specs: readonly LocationFieldSpec[],
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
  req: unknown = makeReq(),
  slug = 'buildings',
) =>
  createLocationFieldGuard(specs)({
    data,
    originalDoc,
    operation: originalDoc ? 'update' : 'create',
    req,
    collection: { slug },
    context: {},
  } as never)

const run = (
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
  req: unknown = makeReq(),
) => invoke(BUILDING_SPECS, data, originalDoc, req)

describe('createLocationFieldGuard', () => {
  it('★ 回归：值没变时，即使节点已停用也放行（OPT-074 §2.2 隐患的修复证明）', async () => {
    await expect(
      run({ summary: '改个摘要', businessDistrict: 8 }, { businessDistrict: 8, district: 2 }),
    ).resolves.toBeTruthy()
  })

  it('主动改选一个已停用的商圈 → 拦住，且错误信息说人话', async () => {
    await expect(
      run({ district: 2, businessDistrict: 8 }, { district: 2, businessDistrict: 3 }),
    ).rejects.toThrow(/静安寺.*已停用/)
  })

  it('跨城混搭（上海 + 朝阳区）→ 拦住', async () => {
    await expect(run({ city: 1, district: 7 }, null)).rejects.toThrow(/朝阳区/)
  })

  it('跨区商圈（长宁区 + 外滩）→ 拦住，错误信息点名两方', async () => {
    await expect(run({ city: 1, district: 2, businessDistrict: 5 }, null)).rejects.toThrow(
      /外滩.*长宁区/,
    )
  })

  it('类型不符（行政区位置塞了个商圈）→ 拦住', async () => {
    await expect(run({ city: 1, district: 3 }, null)).rejects.toThrow(/行政区只能选择行政区/)
  })

  it('指向不存在的节点 → 拦住', async () => {
    await expect(run({ city: 1, district: 999 }, null)).rejects.toThrow(DomainError)
  })

  it('合法组合（上海 + 长宁区 + 虹桥）→ 放行', async () => {
    await expect(run({ city: 1, district: 2, businessDistrict: 3 }, null)).resolves.toBeTruthy()
  })

  it('父字段本次没改时，用 originalDoc 的父值做校验', async () => {
    await expect(run({ businessDistrict: 5 }, { city: 1, district: 2 })).rejects.toThrow(/外滩/)
    await expect(run({ businessDistrict: 3 }, { city: 1, district: 2 })).resolves.toBeTruthy()
  })

  it('父字段为空时跳过父子校验（楼盘 city 非必填）', async () => {
    await expect(run({ district: 2 }, { city: null })).resolves.toBeTruthy()
  })

  it('没有待校验项时完全不打库', async () => {
    const req = makeReq()
    await run({ summary: '只改摘要' }, { district: 2 }, req)
    expect(findCallsOf(req)).toBe(0)
  })

  it('多个待校验项合并成一次查询', async () => {
    const req = makeReq()
    await run({ city: 1, district: 2, businessDistrict: 3 }, null, req)
    expect(findCallsOf(req)).toBe(1)
  })

  it('多类型 spec：允许的任一类型都放行，停用的仍然拦（Leads 意向区域用法）', async () => {
    const specs: LocationFieldSpec[] = [
      { field: 'district', type: ['city', 'district', 'business_area'], label: '意向区域' },
    ]
    const call = (id: number) => invoke(specs, { district: id }, null, makeReq(), 'leads')
    await expect(call(1)).resolves.toBeTruthy() // 城市
    await expect(call(2)).resolves.toBeTruthy() // 行政区
    await expect(call(3)).resolves.toBeTruthy() // 商圈
    await expect(call(8)).rejects.toThrow(/已停用/) // 停用商圈
  })

  it('多类型 spec 的类型错误信息列出全部允许类型', async () => {
    const specs: LocationFieldSpec[] = [
      { field: 'featuredRegions', type: ['district', 'business_area'], many: true, label: '精选区域' },
    ]
    await expect(
      invoke(specs, { featuredRegions: [1] }, null, makeReq(), 'city-site-profiles'),
    ).rejects.toThrow(/只能选择行政区 \/ 商圈/)
  })

  it('hasMany 只校验新增元素：老元素已停用也不拦', async () => {
    const specs: LocationFieldSpec[] = [
      { field: 'featuredRegions', type: ['district', 'business_area'], many: true, label: '精选区域' },
    ]
    await expect(
      invoke(
        specs,
        { featuredRegions: [8, 3] },
        { featuredRegions: [8] },
        makeReq(),
        'city-site-profiles',
      ),
    ).resolves.toBeTruthy()
  })
})
