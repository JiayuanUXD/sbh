import type { AdminNavigationBadgeCounts } from './navigation-badge-request'
import type {
  ResolvedAdminNavEntry,
  ResolvedAdminNavGroup,
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

/**
 * 组头汇总角标的数字：组内各子叶角标计数之和。
 *
 * 缺席的 key 一律按 0 计——角标计数是逐条查询、允许单条失败的（见
 * `collectAdminNavigationBadges`），而且 Task 3 之前 `supplySubmissions` /
 * `informationCorrections` 根本不会被查。把缺席当成异常会让整个组头的数字消失，
 * 而用户真正关心的是「至少有多少件事等着我」。
 */
export function sumGroupBadges(
  group: ResolvedAdminNavGroup,
  counts: AdminNavigationBadgeCounts,
): number {
  let total = 0
  for (const leaf of group.children) {
    if (!leaf.badgeKey) continue
    total += counts[leaf.badgeKey] ?? 0
  }
  return total
}

/**
 * 组头角标是否该用警示色：组内存在「工作队列」类子叶且其计数大于 0。
 *
 * 计数为 0 的 warning key 不算——组头折叠后只剩一个数字，
 * 「0 件待办也标红」会让警示色失去意义。
 */
export function groupHasWarningBadge(
  group: ResolvedAdminNavGroup,
  counts: AdminNavigationBadgeCounts,
  warningKeys: ReadonlySet<string>,
): boolean {
  return group.children.some((leaf) => {
    const badgeKey = leaf.badgeKey
    if (!badgeKey) return false
    return warningKeys.has(badgeKey) && (counts[badgeKey] ?? 0) > 0
  })
}

/** 首次进入后台时默认展开的组：待处理 + 房源与楼盘（日常最高频的两个入口）。 */
export const DEFAULT_OPEN_GROUP_IDS = ['inbox', 'supply'] as const

/**
 * 首次进入（localStorage 里没有可用值）时的展开集。
 *
 * 默认集要与**当前这棵树**求交：组会因权限被筛掉，也会因只剩一片叶子被解析层
 * 扁平化成顶级链接（两种情况下它都没有可展开的面板）。再并上当前激活组，
 * 免得用户从深层链接进来时看不到自己所在的位置。
 */
export function defaultOpenGroupIds(
  entries: readonly ResolvedAdminNavEntry[],
  pathname: string,
): Set<string> {
  const groupIds = collectGroupIds(entries)
  const open = new Set<string>(
    DEFAULT_OPEN_GROUP_IDS.filter((groupId) => groupIds.has(groupId)),
  )

  for (const key of findActiveParentKeys(entries, pathname)) {
    open.add(key)
  }

  return open
}

/**
 * 把 localStorage 里存的展开集解析成当前树上真实存在的组 id 集合。
 *
 * 返回 `null` 表示「没有可用的存储值」（首次进入或数据损坏），调用方据此回落到
 * 默认展开集；返回**空集**表示「用户确实把所有组都收起来了」，必须照办——
 * 两者混为一谈的话，用户每次刷新都会看到自己刚关掉的组又展开。
 *
 * 参数是 `unknown` 而不是 `string | null`：`localStorage.getItem` 的返回值来自
 * 用户可随手编辑的存储，任何类型假设都只是假设。
 */
export function parseStoredOpenGroups(
  raw: unknown,
  entries: readonly ResolvedAdminNavEntry[],
): Set<string> | null {
  if (typeof raw !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!Array.isArray(parsed)) return null
  // Array.isArray 把 unknown 窄化成 any[]，这里立刻收回 unknown[]，
  // 免得下面每个元素都是隐式 any。
  const items: readonly unknown[] = parsed

  // 逐项过滤而不是整体作废：残留的旧组 id（改版/权限变化）属于正常演进，
  // 因为一个陌生 id 就把用户的整份展开偏好丢掉是过度反应。
  const groupIds = collectGroupIds(entries)
  return new Set(
    items.filter(
      (item): item is string => typeof item === 'string' && groupIds.has(item),
    ),
  )
}

/** 当前树上「有面板可展开」的 id 集合——扁平叶不在其中。 */
function collectGroupIds(entries: readonly ResolvedAdminNavEntry[]): Set<string> {
  return new Set(
    entries.filter((entry) => entry.kind === 'group').map((entry) => entry.id),
  )
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
