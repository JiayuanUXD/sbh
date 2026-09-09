import { describe, expect, it } from 'vitest'
import { BUILDING_SPEC_FIELDS } from '@/lib/frontend/detail-spec/fields'

/**
 * OPT-082 零变化守卫。
 *
 * registry 的默认可见集合，必须逐字等于改造前 `BuildingSpecPanel` /
 * `ListingOverviewPanel` 里那份硬编码行清单（组序、行序、标签全部对齐）。
 *
 * 本仓库两次「接线造成的静默内容删除」（楼盘详情页丢 6 条、房源详情页丢 5 条）
 * 都发生在这种「把清单从一处搬到另一处」的重构里，两次都是靠事后对账才发现。
 * 这条用例是唯一能在重构当场挡住它的东西——改动过程中任何一次手滑（漏一行、
 * 换一个标签、把两组的顺序对调）都会先撞到这里，而不是撞到用户。
 */
const BUILDING_EXPECTED: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'structure',
    ['物业类型', '楼盘等级', '竣工年份', '总建筑面积', '总楼层', '标准层面积', '层高 / 净高', '得房率'],
  ],
  ['mep', ['客梯 / 货梯', '空调', '供电', '网络', '门禁', '电梯分区', '服务时间']],
  ['cost', ['物业费', '物业公司', '开发商', '停车位', '停车费']],
  ['qualification', ['认证', '可注册', '最小可租面积']],
]

describe('BUILDING_SPEC_FIELDS 零变化守卫', () => {
  it('默认可见项按组归并后，逐字等于改造前的硬编码行清单', () => {
    const visible = BUILDING_SPEC_FIELDS.filter((field) => field.defaultVisible)
    const actual = BUILDING_EXPECTED.map(([groupId]) => [
      groupId,
      visible.filter((field) => field.group === groupId).map((field) => field.label),
    ])
    expect(actual).toEqual(BUILDING_EXPECTED.map(([groupId, labels]) => [groupId, [...labels]]))
  })

  it('共 23 项，且 key 唯一', () => {
    expect(BUILDING_SPEC_FIELDS).toHaveLength(23)
    expect(new Set(BUILDING_SPEC_FIELDS.map((field) => field.key)).size).toBe(23)
  })

  it('楼盘侧全部默认可见（候选池 = 现状清单，无富余项）', () => {
    expect(BUILDING_SPEC_FIELDS.every((field) => field.defaultVisible)).toBe(true)
  })
})
