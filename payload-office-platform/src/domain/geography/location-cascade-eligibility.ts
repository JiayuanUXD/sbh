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

export type CascadeSelectionReconciliation = Readonly<{
  /** 过滤掉不可选与未知 id 之后的选择，顺序同输入 */
  keys: string[]
  /** 与当前值（同样按顺序比）是否有实质差异；false 时调用方不该再写入 */
  changed: boolean
}>

/**
 * onChange 兜底的完整版：过滤之外还回答「和当前值比有没有实质变化」。
 *
 * 搜索模式下 Arco 的搜索面板只认 `disabled`、不认 `disableCheckbox`，不可见节点的点击会
 * 原样进 onChange（2026-09-12 线上复现）。过滤掉之后若与当前值一样，就不该再 setValue——
 * useField 的 setValue 会把表单置脏，「保存」亮起来却无事可存。
 *
 * 顺序也参与比较：多选标签是有序的，Arco 的 onSort 会以同一批 id 换序的形式进来。
 */
export function reconcileCascadeSelection(
  nextKeys: readonly string[],
  currentKeys: readonly string[],
  byId: ReadonlyMap<string, FlatLocationNode>,
  options: CascadeEligibilityOptions,
): CascadeSelectionReconciliation {
  const keys = eligibleCascadeKeys(nextKeys, byId, options)
  const changed = keys.length !== currentKeys.length || keys.some((k, i) => k !== currentKeys[i])
  return { keys, changed }
}
