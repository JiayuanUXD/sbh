import { describe, expect, it } from 'vitest'
import { buildBuildingSpecGroups } from '@/components/frontend/detail/BuildingSpecPanel'
import type { AmenityGroupViewModel, FactGroupViewModel, FactValue } from '@/domain/public-catalog'

/**
 * `buildBuildingSpecGroups` 是楼盘参数面板（OPT-037 Task 6）的纯函数分组
 * 逻辑——按标签从 `building.factGroups` 查值、两个既有字段拼一行（层高/
 * 净高、客梯/货梯）、从 `amenityGroups` 派生 LEED、拼「竣工年份」。
 * 断点截图只能验证渲染结果，这里补上真正的分支覆盖：值存在 / 缺失渲染
 * null（不隐藏行）/ 组合行两值都在·只缺一半·都缺三种情形 / LEED 命中与
 * 找不到 / 竣工时间年份提取。
 */

function fact(label: string, value: string | null, estimated = false): FactValue {
  return { label, value, estimated, critical: false }
}

const BASE_FACT_GROUPS: readonly FactGroupViewModel[] = [
  {
    id: 'identity',
    title: '身份与注册',
    facts: [fact('楼宇等级', '甲级'), fact('注册能力', '支持注册')],
  },
  {
    id: 'building',
    title: '建筑信息',
    facts: [
      fact('竣工时间', '2013-01-01T00:00:00.000Z'),
      fact('总建筑面积', '108,000 ㎡'),
      fact('总楼层', '46 层'),
      fact('标准层面积', '2,400 ㎡'),
      fact('标准层高', '4.2 m'),
      fact('净层高', null),
    ],
  },
  {
    id: 'transport',
    title: '电梯与停车',
    facts: [fact('客梯', '18 部'), fact('货梯', null), fact('停车位', '620 个'), fact('停车费', null)],
  },
  {
    id: 'property',
    title: '开发物业',
    facts: [fact('物业公司', '嘉里物业'), fact('物业费', '28 元/㎡/月')],
  },
  {
    id: 'services',
    title: '楼宇服务',
    facts: [fact('空调', 'VAV + VRV 分户'), fact('供电', null), fact('网络', null)],
  },
]

const AMENITY_GROUPS_WITH_LEED: readonly AmenityGroupViewModel[] = [
  { id: 'certifications', title: '认证', items: ['LEED 金级', '绿色建筑三星'] },
]

const AMENITY_GROUPS_NO_LEED: readonly AmenityGroupViewModel[] = [
  { id: 'certifications', title: '认证', items: ['绿色建筑三星'] },
]

describe('buildBuildingSpecGroups', () => {
  it('值存在时原样传给对应行', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      320,
    )
    const structureGroup = groups.find((g) => g.id === 'structure')
    expect(structureGroup?.rows.find((r) => r.label === '楼盘等级')?.value).toBe('甲级')
    expect(structureGroup?.rows.find((r) => r.label === '总建筑面积')?.value).toBe('108,000 ㎡')
  })

  it('factGroups 里查不到值时，行的 value 为 null（交给 SpecTable 渲染 —），不隐藏该行', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      null,
    )
    const mepGroup = groups.find((g) => g.id === 'mep')
    const supplyRow = mepGroup?.rows.find((r) => r.label === '供电')
    expect(supplyRow).toBeDefined()
    expect(supplyRow?.value).toBeNull()
  })

  it('竣工时间事实值（ISO 字符串）转成年份 + "年" 后缀', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      null,
    )
    const structureGroup = groups.find((g) => g.id === 'structure')
    expect(structureGroup?.rows.find((r) => r.label === '竣工年份')?.value).toBe('2013 年')
  })

  it('组合行：两个字段都在 → "A / B"', () => {
    const groups = buildBuildingSpecGroups(
      {
        factGroups: [
          ...BASE_FACT_GROUPS.filter((g) => g.id !== 'transport'),
          {
            id: 'transport',
            title: '电梯与停车',
            facts: [fact('客梯', '18 部'), fact('货梯', '2 部'), fact('停车位', '620 个'), fact('停车费', null)],
          },
        ],
        amenityGroups: AMENITY_GROUPS_WITH_LEED,
      },
      null,
    )
    const mepGroup = groups.find((g) => g.id === 'mep')
    expect(mepGroup?.rows.find((r) => r.label === '客梯 / 货梯')?.value).toBe('18 部 / 2 部')
  })

  it('组合行：只缺一半 → 缺的一半渲染 —，不是整行消失', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      null,
    )
    const structureGroup = groups.find((g) => g.id === 'structure')
    // 「净层高」为 null，「标准层高」为 "4.2 m"
    expect(structureGroup?.rows.find((r) => r.label === '层高 / 净高')?.value).toBe('4.2 m / —')
  })

  it('组合行：两个字段都缺 → 整行 value 为 null（渲染 —）', () => {
    const factGroupsBothMissing: readonly FactGroupViewModel[] = [
      ...BASE_FACT_GROUPS.filter((g) => g.id !== 'transport'),
      {
        id: 'transport',
        title: '电梯与停车',
        facts: [fact('客梯', null), fact('货梯', null), fact('停车位', '620 个'), fact('停车费', null)],
      },
    ]
    const groups = buildBuildingSpecGroups(
      { factGroups: factGroupsBothMissing, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      null,
    )
    const mepGroup = groups.find((g) => g.id === 'mep')
    expect(mepGroup?.rows.find((r) => r.label === '客梯 / 货梯')?.value).toBeNull()
  })

  it('LEED 命中：认证列表里有一条含 "LEED" 的名称，原样展示', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      null,
    )
    const qualificationGroup = groups.find((g) => g.id === 'qualification')
    expect(qualificationGroup?.rows.find((r) => r.label === 'LEED 认证')?.value).toBe('LEED 金级')
  })

  it('LEED 未命中：认证列表里没有含 "LEED" 的名称，渲染 —（不编造）', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_NO_LEED },
      null,
    )
    const qualificationGroup = groups.find((g) => g.id === 'qualification')
    expect(qualificationGroup?.rows.find((r) => r.label === 'LEED 认证')?.value).toBeNull()
  })

  it('最小可租面积：调用方传入数值时拼 "㎡" 后缀，传 null 时渲染 —', () => {
    const withArea = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      320,
    )
    const withoutArea = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      null,
    )
    const qualGroupWithArea = withArea.find((g) => g.id === 'qualification')
    const qualGroupWithoutArea = withoutArea.find((g) => g.id === 'qualification')
    expect(qualGroupWithArea?.rows.find((r) => r.label === '最小可租面积')?.value).toBe('320 ㎡')
    expect(qualGroupWithoutArea?.rows.find((r) => r.label === '最小可租面积')?.value).toBeNull()
  })

  it('整组字段全缺时该组仍存在（不整组隐藏）', () => {
    const factGroupsMepAllMissing: readonly FactGroupViewModel[] = [
      ...BASE_FACT_GROUPS.filter((g) => g.id !== 'transport' && g.id !== 'services'),
      {
        id: 'transport',
        title: '电梯与停车',
        facts: [fact('客梯', null), fact('货梯', null), fact('停车位', '620 个'), fact('停车费', null)],
      },
      {
        id: 'services',
        title: '楼宇服务',
        facts: [fact('空调', null), fact('供电', null), fact('网络', null)],
      },
    ]
    const groups = buildBuildingSpecGroups(
      { factGroups: factGroupsMepAllMissing, amenityGroups: AMENITY_GROUPS_WITH_LEED },
      null,
    )
    const mepGroup = groups.find((g) => g.id === 'mep')
    expect(mepGroup).toBeDefined()
    expect(mepGroup?.rows.every((r) => r.value === null)).toBe(true)
  })
})
