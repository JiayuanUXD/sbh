import { describe, expect, it } from 'vitest'

import {
  cascadeNodeEligibility,
  eligibleCascadeKeys,
} from '@/domain/geography/location-cascade-eligibility'
import type { FlatLocationNode } from '@/domain/geography/location-tree'

const node = (over: Partial<FlatLocationNode>): FlatLocationNode => ({
  id: 1,
  name: '节点',
  type: 'business_area',
  immutableCode: 'X',
  parentId: null,
  status: 'active',
  sortOrder: 0,
  frontendVisible: true,
  ...over,
})

/**
 * OPT-093 补：精选区域的级联框此前不看 `frontendVisible`，运营能选到「前台不可见」的
 * 商圈，保存时被 profile-protect 拒掉——toast 几秒就没、字段无红字、保存按钮还变灰，
 * 退出再进值就「消失」了。线上两个同名「虹桥」里闵行那个正是不可见的。
 */
describe('cascadeNodeEligibility', () => {
  it('默认只把停用节点标为不可选（楼盘归属等场景不看前台可见性）', () => {
    expect(cascadeNodeEligibility(node({ frontendVisible: false }), {})).toEqual({ selectable: true, reason: null })
    expect(cascadeNodeEligibility(node({ status: 'disabled' }), {})).toEqual({
      selectable: false,
      reason: 'disabled',
    })
  })

  it('frontendVisibleOnly 下前台不可见的节点不可选，且理由可区分', () => {
    expect(cascadeNodeEligibility(node({ frontendVisible: false }), { frontendVisibleOnly: true })).toEqual({
      selectable: false,
      reason: 'hidden',
    })
    // 停用优先于不可见：停用节点本来也不可见，给运营看的理由应是「已停用」
    expect(
      cascadeNodeEligibility(node({ status: 'disabled', frontendVisible: false }), { frontendVisibleOnly: true }),
    ).toEqual({ selectable: false, reason: 'disabled' })
  })
})

describe('eligibleCascadeKeys', () => {
  it('从一组 id 里剔掉不可选节点，未知 id 一并剔除', () => {
    const byId = new Map<string, FlatLocationNode>([
      ['1', node({ id: 1 })],
      ['2', node({ id: 2, frontendVisible: false })],
      ['3', node({ id: 3, status: 'disabled' })],
    ])
    expect(eligibleCascadeKeys(['1', '2', '3', '9'], byId, { frontendVisibleOnly: true })).toEqual(['1'])
    expect(eligibleCascadeKeys(['1', '2', '3', '9'], byId, {})).toEqual(['1', '2'])
  })
})
