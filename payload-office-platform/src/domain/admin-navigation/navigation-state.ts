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
