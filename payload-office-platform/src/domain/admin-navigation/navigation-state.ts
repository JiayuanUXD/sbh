import type {
  ResolvedAdminNavEntry,
  ResolvedAdminNavLeaf,
} from './resolve-navigation'

/** 把一条解析结果摊成它包含的叶子：组给出 children，扁平叶给出它自己。 */
function leavesOf(entry: ResolvedAdminNavEntry): readonly ResolvedAdminNavLeaf[] {
  return entry.kind === 'group' ? entry.children : [entry]
}

export function findActiveLeaf(
  entries: readonly ResolvedAdminNavEntry[],
  pathname: string,
): ResolvedAdminNavLeaf | null {
  let activeLeaf: ResolvedAdminNavLeaf | null = null

  for (const entry of entries) {
    for (const leaf of leavesOf(entry)) {
      if (
        isMatchingPathname(pathname, leaf.href) &&
        (!activeLeaf || leaf.href.length > activeLeaf.href.length)
      ) {
        activeLeaf = leaf
      }
    }
  }

  return activeLeaf
}

/**
 * 当前路径所在的**组** id；激活的是扁平叶时返回 null。
 *
 * 扁平叶没有组头、也不参与展开/收起，所以它「所属的组」这个概念在渲染上不存在——
 * 返回它原来的组 id 会让客户端去展开一个根本没渲染出来的面板。
 */
export function deriveOpenGroupId(
  entries: readonly ResolvedAdminNavEntry[],
  pathname: string,
): string | null {
  const activeLeaf = findActiveLeaf(entries, pathname)
  if (!activeLeaf) return null

  return (
    entries.find(
      (entry) =>
        entry.kind === 'group' && entry.children.some((leaf) => leaf.id === activeLeaf.id),
    )?.id ?? null
  )
}

export function toggleOpenGroup(
  currentGroupId: string | null,
  requestedGroupId: string,
): string | null {
  return currentGroupId === requestedGroupId ? null : requestedGroupId
}

/**
 * 当前 pathname 下激活节点的父层级 key 列表。
 *
 * 导航只剩两级，所以结果要么是 `[组 id]`，要么是 `[]`（激活的是扁平叶或没有激活项）。
 * 保留数组形态是因为调用方拿它去并入「展开集」，空数组正好表示「没有需要展开的东西」。
 */
export function findActiveParentKeys(
  entries: readonly ResolvedAdminNavEntry[],
  pathname: string,
): string[] {
  const groupId = deriveOpenGroupId(entries, pathname)

  return groupId ? [groupId] : []
}

/**
 * 在多展开模式下切换单个组的展开状态（不影响其他组）。
 * 返回新的 Set（不可变更新）。
 */
export function toggleGroupInSet(
  currentOpen: ReadonlySet<string>,
  groupId: string,
): Set<string> {
  const next = new Set(currentOpen)
  if (next.has(groupId)) {
    next.delete(groupId)
  } else {
    next.add(groupId)
  }
  return next
}

export function shouldCloseNavAfterLeafClick(
  smallBreak: boolean | undefined,
): boolean {
  return smallBreak === true
}

function isMatchingPathname(pathname: string, href: string): boolean {
  const normalizedPathname = normalizePath(pathname)
  const normalizedHref = normalizePath(href)

  if (normalizedPathname === normalizedHref) return true
  if (normalizedHref === '/admin') return false

  return normalizedPathname.startsWith(`${normalizedHref}/`)
}

function normalizePath(path: string): string {
  const withoutQueryOrHash = path.split(/[?#]/, 1)[0] ?? path
  if (withoutQueryOrHash.length <= 1) return withoutQueryOrHash
  return withoutQueryOrHash.replace(/\/+$/, '')
}
