/**
 * 级联选择的「可选性」判定（纯函数，LocationCascadeField 与其单测共用）。
 *
 * 组件默认只把**停用**节点标为不可选——楼盘归属这类场景刻意不看 `frontendVisible`
 * （生产商圈 279/294 都是 false，它是前台展示开关，不是后台可用性开关）。
 *
 * 但「精选区域」不同：`profile-protect.ts` 要求精选区域必须前台可见，否则保存直接拒。
 * 此前级联框对这条规则一无所知，运营能选到不可见商圈、保存 422、toast 几秒消失、
 * 退出再进值「消失」。`frontendVisibleOnly` 让组件把这条规则提前到选择时。
 */

import type { FlatLocationNode } from './location-tree'

export type CascadeEligibilityOptions = Readonly<{
  /** 前台不可见的节点也不可选（精选区域用） */
  frontendVisibleOnly?: boolean
}>

export type CascadeEligibility = Readonly<{
  selectable: boolean
  /** 不可选的原因：停用优先于不可见（停用节点本来也不会前台可见） */
  reason: 'disabled' | 'hidden' | null
}>

export function cascadeNodeEligibility(
  node: Pick<FlatLocationNode, 'status' | 'frontendVisible'>,
  options: CascadeEligibilityOptions,
): CascadeEligibility {
  if (node.status === 'disabled') return { selectable: false, reason: 'disabled' }
  if (options.frontendVisibleOnly && !node.frontendVisible) return { selectable: false, reason: 'hidden' }
  return { selectable: true, reason: null }
}

/** 过滤掉不可选与未知的 id，保持原顺序。组件在 onChange 里用它兜底。 */
export function eligibleCascadeKeys(
  keys: readonly string[],
  byId: ReadonlyMap<string, FlatLocationNode>,
  options: CascadeEligibilityOptions,
): string[] {
  return keys.filter((key) => {
    const node = byId.get(key)
    return node !== undefined && cascadeNodeEligibility(node, options).selectable
  })
}
