/**
 * 地理节点树组装 & 搜索过滤（纯函数层，tasks.md M2.2）
 *
 * 从摊平的节点数组按 parentId 组装固定层级森林，并支持关键词过滤：
 *   - 命中节点（名称或区域代码包含关键词）保留自身及其全部祖先，保证树链不断
 *   - 同层按 sortOrder 升序、再按名称（zh）稳定排序
 *
 * 纯函数：不依赖 React / payload，输入摊平节点，输出 id 森林 + 建议展开集，便于单测。
 * 渲染（标题、徽标、动作）留在 LocationTreeViewClient。
 */

import type { LocationType } from './location-hierarchy'

/** 摊平的地理节点（可序列化，服务端产出、客户端消费） */
export type FlatLocationNode = {
  id: number | string
  name: string
  type: LocationType
  immutableCode: string
  parentId: number | string | null
  status: 'active' | 'disabled'
  sortOrder: number
  frontendVisible: boolean
}

/** id 森林节点：只含 id 与子树，标题由渲染层按 id 查表补齐 */
export type LocationTreeItem = {
  id: number | string
  children: LocationTreeItem[]
}

export type LocationForest = {
  forest: LocationTreeItem[]
  /** 建议默认展开的 id 集：无关键词时为全部；有关键词时为命中链 */
  expandedIds: Array<number | string>
}

/** 按 parentId 分组并同层排序（sortOrder 升序 → 名称 zh 次级稳定） */
export function buildChildrenIndex(
  nodes: readonly FlatLocationNode[],
): Map<number | string | null, FlatLocationNode[]> {
  const index = new Map<number | string | null, FlatLocationNode[]>()
  for (const n of nodes) {
    const arr = index.get(n.parentId) ?? []
    arr.push(n)
    index.set(n.parentId, arr)
  }
  for (const arr of index.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh'))
  }
  return index
}

/**
 * 计算关键词命中链集合：命中节点自身 + 其所有祖先。
 * 空关键词返回 null（表示不过滤）。
 */
export function computeMatchedKeys(
  nodes: readonly FlatLocationNode[],
  keyword: string,
): Set<number | string> | null {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return null

  const byId = new Map<number | string, FlatLocationNode>()
  for (const n of nodes) byId.set(n.id, n)

  const keep = new Set<number | string>()
  for (const n of nodes) {
    if (n.name.toLowerCase().includes(kw) || n.immutableCode.toLowerCase().includes(kw)) {
      let cur: FlatLocationNode | undefined = n
      // 上溯祖先链，最多层级有限（城市>行政区>商圈 / 城市>线路>站），设 16 层熔断防脏数据成环
      let guard = 0
      while (cur && guard < 16) {
        keep.add(cur.id)
        cur = cur.parentId == null ? undefined : byId.get(cur.parentId)
        guard += 1
      }
    }
  }
  return keep
}

/**
 * 组装固定层级 id 森林 + 建议展开集。
 * @param keyword 关键词；非空时仅保留命中链
 */
export function buildLocationForest(
  nodes: readonly FlatLocationNode[],
  keyword = '',
): LocationForest {
  const childrenIndex = buildChildrenIndex(nodes)
  const matched = computeMatchedKeys(nodes, keyword)

  const build = (parentId: number | string | null): LocationTreeItem[] => {
    const children = childrenIndex.get(parentId) ?? []
    return children
      .filter((n) => !matched || matched.has(n.id))
      .map((n) => ({ id: n.id, children: build(n.id) }))
  }

  const forest = build(null)

  // 只收集实际有子节点的 id 作为展开集：
  // - 有关键词时：命中链中所有非叶子节点（有 children 的）
  // - 无关键词时：所有有 children 的非叶子节点
  // 注意：不能把叶子节点（children=[]）加入 expandedKeys，
  // 否则 Arco Tree 会给叶子节点错误添加 arco-tree-node-disabled 类，导致文字变灰。
  const collectExpandable = (items: LocationTreeItem[]): Array<number | string> => {
    const ids: Array<number | string> = []
    for (const item of items) {
      if (item.children.length > 0) {
        ids.push(item.id)
        ids.push(...collectExpandable(item.children))
      }
    }
    return ids
  }

  const expandedIds = collectExpandable(forest)

  return { forest, expandedIds }
}
