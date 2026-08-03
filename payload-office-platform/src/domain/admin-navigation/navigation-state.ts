import type {
  ResolvedAdminNavGroup,
  ResolvedAdminNavLeaf,
} from './resolve-navigation'

export function findActiveLeaf(
  groups: readonly ResolvedAdminNavGroup[],
  pathname: string,
): ResolvedAdminNavLeaf | null {
  let activeLeaf: ResolvedAdminNavLeaf | null = null

  for (const group of groups) {
    for (const item of group.children) {
      const leaves = 'children' in item ? item.children : [item]

      for (const leaf of leaves) {
        if (
          isMatchingPathname(pathname, leaf.href) &&
          (!activeLeaf || leaf.href.length > activeLeaf.href.length)
        ) {
          activeLeaf = leaf
        }
      }
    }
  }

  return activeLeaf
}

export function deriveOpenGroupId(
  groups: readonly ResolvedAdminNavGroup[],
  pathname: string,
): string | null {
  const activeLeaf = findActiveLeaf(groups, pathname)
  if (!activeLeaf) return null

  return (
    groups.find((group) =>
      group.children.some((item) =>
        'children' in item
          ? item.children.some((leaf) => leaf.id === activeLeaf.id)
          : item.id === activeLeaf.id,
      ),
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
 * 获取当前 pathname 下激活节点的全部父层级 key 列表（包含父 Group ID 及 父 Subgroup ID）。
 */
export function findActiveParentKeys(
  groups: readonly ResolvedAdminNavGroup[],
  pathname: string,
): string[] {
  const activeLeaf = findActiveLeaf(groups, pathname)
  if (!activeLeaf) return []

  for (const group of groups) {
    for (const item of group.children) {
      if ('children' in item) {
        if (item.children.some((leaf) => leaf.id === activeLeaf.id)) {
          return [group.id, item.id]
        }
      } else {
        if (item.id === activeLeaf.id) {
          return [group.id]
        }
      }
    }
  }

  return []
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
