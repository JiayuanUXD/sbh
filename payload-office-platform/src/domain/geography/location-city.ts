/**
 * 城市解析纯函数 + 查询辅助（Task 2）
 *
 * 与 location-tree.ts 同属纯函数层：不依赖 payload / req，便于单测与前端复用。
 *
 * 语义约定（配合 Locations 的 city 反范式字段，勿各处手写）：
 *   - 非 city 节点：city = 所属城市 id
 *   - city 节点自身：city 留空，不自引用
 *   - 「某城市的全部节点（含城市自身）」统一走 cityScopeWhere()，
 *     条件为 { or: [{ id: equals cityId }, { city: equals cityId }] }
 */

import type { Where } from 'payload'
import type { LocationType } from './location-hierarchy'

/** 供城市解析的最小节点视图；FlatLocationNode（location-tree.ts）结构可赋值给本类型 */
export type CityResolvableNode = {
  id: number | string
  type: LocationType
  parentId: number | string | null
}

/**
 * 「某城市的全部节点（含城市节点自身）」的统一查询条件。
 * 城市自身以 id 命中；其余节点以反范式 city 字段命中。
 */
export function cityScopeWhere(cityId: number | string): Where {
  return {
    or: [{ id: { equals: cityId } }, { city: { equals: cityId } }],
  }
}

/**
 * 从摊平节点数组解析某节点的归属城市 id（纯函数）。
 * 城市节点自身返回自身 id；其余沿 parentId 上溯命中 city；断链 / 孤儿根 / 成环
 * / 深度超过 8 的病态数据一律返回 null（不抛错、不死循环）。
 */
export function resolveCityIdFromFlat(
  nodes: readonly CityResolvableNode[],
  startId: number | string,
): number | string | null {
  const byId = new Map<number | string, CityResolvableNode>()
  for (const n of nodes) byId.set(n.id, n)

  let currentId: number | string | null = startId
  // 固定层级最深 3 层（城市>行政区>商圈 / 城市>线路>站），8 为防御性上限，
  // 覆盖成环 / 异常深链等病态数据，保证有限步内终止。
  for (let depth = 0; depth < 8 && currentId !== null; depth++) {
    const node = byId.get(currentId)
    if (!node) return null
    if (node.type === 'city') return node.id
    currentId = node.parentId
  }
  return null
}