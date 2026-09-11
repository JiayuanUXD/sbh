'use client'

import {
  Link,
  toast,
  useConfig,
  useNav,
  useWindowInfo,
} from '@payloadcms/ui'
import {
  IconApps,
  IconCaretRight,
  IconDashboard,
  IconEdit,
  IconFile,
  IconHome,
  IconInteraction,
  IconLocation,
  IconMenuFold,
  IconMenuUnfold,
  IconNotification,
  IconSafe,
  IconSettings,
  IconUser,
  IconUserGroup,
} from '@arco-design/web-react/icon'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  loadAdminNavigationBadges,
  type AdminNavigationBadgeCounts,
} from '@/domain/admin-navigation/navigation-badge-request'
import { formatBadgeCount } from '@/domain/admin-navigation/navigation-badges'
import {
  defaultOpenGroupIds,
  deriveOpenGroupId,
  initialCollapsedForMount,
  initialOpenGroupsForMount,
  findActiveLeaf,
  findActiveParentKeys,
  groupHasWarningBadge,
  parseStoredOpenGroups,
  sumGroupBadges,
  toggleGroupInSet,
} from '@/domain/admin-navigation/navigation-state'
import type {
  ResolvedAdminNavEntry,
  ResolvedAdminNavFlatLeaf,
  ResolvedAdminNavGroup,
  ResolvedAdminNavLeaf,
} from '@/domain/admin-navigation/resolve-navigation'
import type { AdminNavIconKey } from '@/domain/admin-navigation/navigation-types'

type AdminNavigationClientProps = {
  entries: readonly ResolvedAdminNavEntry[]
}

const COLLAPSE_STORAGE_KEY = 'sbh-admin-nav-collapsed'
const OPEN_GROUPS_STORAGE_KEY = 'sbh-admin-nav-open-groups'
const COLLAPSED_WIDTH = '48px'
const DESKTOP_BREAKPOINT = 1024

/**
 * 本模块在浏览器里是否已经完成过一次挂载。
 *
 * Payload 每次后台路由跳转都会把本组件整个重新挂载（DOM 节点被替换，2026-09-11
 * 实测），而 localStorage 里的展开集与折叠态此前只在挂载后的定时器里读回——于是
 * 用户展开着的其它组每次点击二级项都会「收起再展开」一次（220ms 面板过渡放大成
 * 肉眼可见的跳动），折叠过侧栏的用户还会看到侧栏宽度跳一下。
 *
 * 首屏水合的那次挂载必须与服务端 HTML 逐字相同，只能给激活组；之后的重挂载没有
 * 水合约束，初始化时就同步读回存储值。用模块级变量区分两者：整页刷新会重置它，
 * 客户端导航不会。它只在效果里置真，所以 StrictMode 双调用初始化函数不受影响。
 */
let hydratedOnce = false

// 「工作队列」类角标：数字代表等着人处理的事，用警示色；
// 纯提醒类（notifications / tasks）用常规蓝色。
const WARNING_BADGE_KEYS: ReadonlySet<string> = new Set([
  'listingReviews',
  'listingReports',
  'leads',
  'formSubmissions',
  'supplySubmissions',
  'informationCorrections',
])

const GROUP_ICONS: Record<AdminNavIconKey, ReactNode> = {
  dashboard: <IconDashboard />,
  inbox: <IconNotification />,
  building: <IconHome />,
  location: <IconLocation />,
  shield: <IconSafe />,
  user: <IconUser />,
  shop: <IconInteraction />,
  team: <IconUserGroup />,
  file: <IconFile />,
  form: <IconEdit />,
  settings: <IconSettings />,
}

function iconFor(key: string): ReactNode {
  return GROUP_ICONS[key as AdminNavIconKey] ?? <IconApps />
}

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 挂载后的初始展开集：读得回存储值就用它（并上当前激活组，免得用户从深层链接
 * 进来时所在的组是收着的）；读不回（首次进入 / 坏数据 / 存储不可用）用默认集。
 */
function resolveInitialOpenGroups(
  entries: readonly ResolvedAdminNavEntry[],
  pathname: string,
): Set<string> {
  const stored = readStoredOpenGroups(entries)
  if (!stored) return defaultOpenGroupIds(entries, pathname)

  for (const key of findActiveParentKeys(entries, pathname)) {
    stored.add(key)
  }
  return stored
}

function readStoredOpenGroups(
  entries: readonly ResolvedAdminNavEntry[],
): Set<string> | null {
  if (typeof window === 'undefined') return null
  try {
    return parseStoredOpenGroups(
      window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY),
      entries,
    )
  } catch {
    // 隐私模式下 localStorage 访问本身会抛：当作首次进入，导航照常可用
    return null
  }
}

function persistOpenGroups(openKeys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(
      OPEN_GROUPS_STORAGE_KEY,
      JSON.stringify([...openKeys]),
    )
  } catch {
    // ignore storage errors
  }
}

function leafBadgeText(
  badges: AdminNavigationBadgeCounts,
  leaf: ResolvedAdminNavLeaf,
): string | null {
  if (!leaf.badgeKey) return null
  return formatBadgeCount(badges[leaf.badgeKey] ?? 0)
}

function isWarningLeaf(leaf: ResolvedAdminNavLeaf): boolean {
  return Boolean(leaf.badgeKey && WARNING_BADGE_KEYS.has(leaf.badgeKey))
}

function leafBadgeLabel(label: string, text: string): string {
  return `${label}待处理 ${text} 项`
}

/** 组头是汇总数字，措辞与叶子分开：否则「待处理」组会读成「待处理待处理 5 项」。 */
function groupBadgeLabel(label: string, text: string): string {
  return `${label}共 ${text} 项待处理`
}

export default function AdminNavigationClient({
  entries,
}: AdminNavigationClientProps) {
  const pathname = usePathname()
  const { config } = useConfig()
  const { navOpen, navRef, setNavOpen } = useNav()
  useWindowInfo() // 保持 hook 调用以维持上下文响应
  const [badges, setBadges] = useState<AdminNavigationBadgeCounts>({})
  // 首屏水合只能给激活组（见 hydratedOnce 注释）；客户端导航后的重挂载直接读回存储值
  const hydrating = !hydratedOnce
  const [openKeys, setOpenKeys] = useState<Set<string>>(() =>
    initialOpenGroupsForMount({
      hydrating,
      entries,
      pathname,
      readStored: () => readStoredOpenGroups(entries),
    }),
  )
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    initialCollapsedForMount({ hydrating, readStored: getInitialCollapsed }),
  )
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null)
  // mounted / windowWidth 决定 isDesktop，进而决定折叠态是否生效：重挂载时也要同步给出，
  // 否则折叠用户的侧栏会先按展开宽度渲染一帧
  const [mounted, setMounted] = useState(!hydrating)
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    hydrating || typeof window === 'undefined' ? 0 : window.innerWidth,
  )
  const badgeFailureReported = useRef(false)
  // 用 ref 冻结首屏的树与路径供挂载时的定时器使用：那个效果只该跑一次，
  // 把 entries / pathname 写进它的依赖会让每次路由变化都重读一遍存储、
  // 把用户中途的开合覆盖掉。
  const initialOpenGroupsRef = useRef(() => resolveInitialOpenGroups(entries, pathname))
  const activeLeafId = findActiveLeaf(entries, pathname)?.id ?? null
  const activeGroupId = deriveOpenGroupId(entries, pathname)
  const apiRoute = config.routes.api.replace(/\/$/, '')

  // 桌面端断点：>= 1024px 时侧边栏常驻（CSS 媒体查询强制可见），启用折叠功能
  const isDesktop = mounted && windowWidth >= DESKTOP_BREAKPOINT

  // 标记 mounted + 监听窗口大小变化
  // 注意：初始化不要放进 requestAnimationFrame——后台/未合成帧的标签页 rAF 不会触发，
  // mounted 将永远为 false，桌面态逻辑（含强制 navOpen）全部失效。
  // 用 setTimeout(0) 而非同步 setState：避免效果内级联渲染（lint 规则），
  // 且定时器在后台标签页依然会执行。
  useEffect(() => {
    const updateWidth = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', updateWidth)
    const initialTimer = window.setTimeout(() => {
      updateWidth()
      setMounted(true)
      setCollapsed(getInitialCollapsed())
      // 展开集与折叠态在同一处读：首次渲染必须与服务端输出逐字相同，
      // 在渲染期同步读 localStorage 会直接造成 hydration 不一致。
      // 重挂载时初始化已经同步读过，这里再读一次得到相同集合，不会引起可见变化。
      setOpenKeys(initialOpenGroupsRef.current())
      hydratedOnce = true
    }, 0)
    return () => {
      window.clearTimeout(initialTimer)
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  // 桌面态（≥1024px 侧边栏常驻）强制 Payload 的 navOpen 为 true：
  // Payload NavProvider 在视口 ≤ 1440px（断点 l）时会自动 setNavOpen(false)，
  // aside.nav 随之带上 inert 属性，整棵导航子树不可点击——而我们的 CSS 在
  // ≥1024px 又强制导航可见，造成 1024–1440px 区间「看得见、点不动」。
  useEffect(() => {
    if (isDesktop && !navOpen) {
      setNavOpen(true)
    }
  }, [isDesktop, navOpen, setNavOpen])

  // 同一不变量的 DOM 兜底：桌面态下 aside.nav 上不允许存在 inert。
  //
  // 只靠上面的 setNavOpen 不够——它要求「NavProvider 先置 false、本组件的效果再置回
  // true」这一时序每次都成立。拖动窗口跨 1440 断点时 resize 事件连续触发、Payload 会
  // 反复改自己的状态，只要有一轮我们的回置没跑到，inert 就留在 DOM 上，表现正是
  // 「拖窄之后点不动、刷新才好」（刷新时走的是加载路径，由上面的效果覆盖）。
  //
  // MutationObserver 把不变量钉在 DOM 上，与 React 的渲染时序解耦：属性一出现就摘掉。
  // 移动态（< 1024px）不介入——那里导航是模态，关闭时带 inert 是正确行为。
  useEffect(() => {
    if (!isDesktop) return
    const nav = navRef?.current?.closest('aside') ?? document.querySelector('aside.nav')
    if (!nav) return

    const stripInert = () => {
      if (nav.hasAttribute('inert')) nav.removeAttribute('inert')
    }

    stripInert()
    const observer = new MutationObserver(stripInert)
    observer.observe(nav, { attributeFilter: ['inert'] })
    return () => observer.disconnect()
  }, [isDesktop, navRef])

  // 折叠状态持久化
  useEffect(() => {
    if (!mounted) return
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [collapsed, mounted])

  // 核心：通过 CSS 变量 --nav-width 控制 Payload grid 布局的导航列宽
  // 折叠时设为 48px，展开/移动端时移除让 CSS 媒体查询的默认值 (220px) 生效
  const effectiveCollapsed = isDesktop && collapsed
  useEffect(() => {
    const root = document.documentElement
    if (effectiveCollapsed) {
      root.style.setProperty('--nav-width', COLLAPSED_WIDTH)
    } else {
      root.style.removeProperty('--nav-width')
    }
    // 在 body 上标记类名供子元素 CSS 使用
    document.body.classList.toggle('admin-nav-collapsed', effectiveCollapsed)
    return () => {
      root.style.removeProperty('--nav-width')
      document.body.classList.remove('admin-nav-collapsed')
    }
  }, [effectiveCollapsed])

  // 路由变化时：在渲染阶段增量将新激活路径所属的组加入展开集
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    const activeParentKeys = findActiveParentKeys(entries, pathname)
    if (activeParentKeys.length > 0) {
      setOpenKeys((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const key of activeParentKeys) {
          if (!next.has(key)) {
            next.add(key)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    const loadBadges = async () => {
      const result = await loadAdminNavigationBadges({
        signal: controller.signal,
        url: `${apiRoute}/admin-navigation`,
      })

      if (controller.signal.aborted) return
      if (result.status === 'success') {
        setBadges(result.badges)
      } else if (result.status === 'error') {
        reportBadgeFailure(badgeFailureReported)
      }
    }

    void loadBadges()
    return () => controller.abort()
  }, [apiRoute])

  const handleToggleKey = (key: string) => {
    if (effectiveCollapsed) return
    // 多展开模式：切换点击的分组，不影响其他分组
    const next = toggleGroupInSet(openKeys, key)
    setOpenKeys(next)
    // 只有用户主动开合才落盘。路由变化时并入激活组是系统行为，
    // 一并写回会把「用户特意收起了这个组」的意图慢慢冲掉。
    persistOpenGroups(next)
  }

  return (
    <div
      aria-label="后台主导航"
      className={`admin-navigation${effectiveCollapsed ? ' admin-navigation--collapsed' : ''}`}
    >
      <ul className="admin-navigation__groups">
        {entries.map((entry) =>
          entry.kind === 'leaf' ? (
            <NavigationFlatLeaf
              active={entry.id === activeLeafId}
              badges={badges}
              collapsed={effectiveCollapsed}
              key={entry.id}
              leaf={entry}
            />
          ) : (
            <NavigationGroup
              activeLeafId={activeLeafId}
              badges={badges}
              collapsed={effectiveCollapsed}
              group={entry}
              hovered={effectiveCollapsed && entry.id === hoveredGroupId}
              isActiveGroup={entry.id === activeGroupId}
              isOpen={!effectiveCollapsed && openKeys.has(entry.id)}
              key={entry.id}
              onHoverEnd={() =>
                setHoveredGroupId((prev) => (prev === entry.id ? null : prev))
              }
              onHoverStart={() => setHoveredGroupId(entry.id)}
              onToggleKey={handleToggleKey}
            />
          ),
        )}
      </ul>

      {/* 底部收起/展开按钮（仅桌面端显示） */}
      {isDesktop && (
        <button
          aria-label={collapsed ? '展开导航' : '收起导航'}
          className="admin-navigation__toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? '展开导航' : '收起导航'}
          type="button"
        >
          {collapsed ? <IconMenuUnfold /> : <IconMenuFold />}
        </button>
      )}
    </div>
  )
}

function NavigationGroup({
  activeLeafId,
  badges,
  collapsed,
  group,
  hovered,
  isActiveGroup,
  isOpen,
  onHoverEnd,
  onHoverStart,
  onToggleKey,
}: {
  activeLeafId: string | null
  badges: AdminNavigationBadgeCounts
  collapsed: boolean
  group: ResolvedAdminNavGroup
  hovered: boolean
  isActiveGroup: boolean
  isOpen: boolean
  onHoverEnd: () => void
  onHoverStart: () => void
  onToggleKey: (key: string) => void
}) {
  const panelId = `admin-navigation-group-${group.id}`
  const groupBadge = formatBadgeCount(sumGroupBadges(group, badges))
  const groupBadgeWarning = groupHasWarningBadge(group, badges, WARNING_BADGE_KEYS)

  return (
    <li
      className={`admin-navigation__group${isOpen ? ' admin-navigation__group--open' : ''}${isActiveGroup ? ' admin-navigation__group--active' : ''}`}
      onMouseEnter={collapsed ? onHoverStart : undefined}
      onMouseLeave={collapsed ? onHoverEnd : undefined}
    >
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className={[
          'admin-navigation__group-toggle',
          isActiveGroup ? 'admin-navigation__group-toggle--active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => onToggleKey(group.id)}
        title={collapsed ? group.label : undefined}
        type="button"
      >
        <span className="admin-navigation__group-icon" aria-hidden="true">
          {iconFor(group.icon)}
        </span>
        {/* 收起态（48px）没有文字可挂角标，汇总数字挂到图标右上角 */}
        {collapsed && groupBadge ? (
          <RailBadge
            ariaLabel={groupBadgeLabel(group.label, groupBadge)}
            text={groupBadge}
            warning={groupBadgeWarning}
          />
        ) : null}
        <span className="admin-navigation__group-label">{group.label}</span>
        {/* 汇总角标只在该组收起时出现：展开后每片叶子各自显示，
            再挂一份组头角标等于把同一批事情数两遍。 */}
        {!collapsed && !isOpen && groupBadge ? (
          <span
            aria-label={groupBadgeLabel(group.label, groupBadge)}
            className={[
              'admin-navigation__group-badge',
              groupBadgeWarning ? 'admin-navigation__group-badge--warning' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {groupBadge}
          </span>
        ) : null}
        <IconCaretRight aria-hidden="true" className="admin-navigation__chevron" />
      </button>

      {/* 展开模式：内联面板 */}
      {!collapsed && (
        <div
          className={`admin-navigation__group-panel${isOpen ? ' admin-navigation__group-panel--open' : ''}`}
          id={panelId}
        >
          <ul className="admin-navigation__items">
            {group.children.map((leaf) => (
              <li className="admin-navigation__item" key={leaf.id}>
                <NavigationLeaf
                  active={leaf.id === activeLeafId}
                  badges={badges}
                  leaf={leaf}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 折叠模式：浮层面板 */}
      {collapsed && hovered && (
        <div className="admin-navigation__flyout" role="menu">
          <div className="admin-navigation__flyout-title">{group.label}</div>
          <ul className="admin-navigation__flyout-items">
            {group.children.map((leaf) => (
              <li className="admin-navigation__flyout-item" key={leaf.id}>
                <NavigationLeaf
                  active={leaf.id === activeLeafId}
                  badges={badges}
                  leaf={leaf}
                  onNavigate={onHoverEnd}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

/**
 * 扁平叶：解析层把只剩一片叶子的组降下来的顶级链接。
 *
 * 刻意**不渲染 toggle 按钮**——组头按钮既是视觉上的「可展开」暗示，也是 e2e
 * 数组数的依据（`.admin-navigation__group-toggle` 的数量 = 组数）。扁平叶点了直接跳转，
 * 没有可展开的东西，给它一个按钮会同时骗到用户和测试。
 */
function NavigationFlatLeaf({
  active,
  badges,
  collapsed,
  leaf,
}: {
  active: boolean
  badges: AdminNavigationBadgeCounts
  collapsed: boolean
  leaf: ResolvedAdminNavFlatLeaf
}) {
  const badge = leafBadgeText(badges, leaf)

  return (
    <li className="admin-navigation__group admin-navigation__group--flat">
      <Link
        aria-current={active ? 'page' : undefined}
        className={[
          'admin-navigation__link',
          'admin-navigation__link--flat',
          active ? 'admin-navigation__link--active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        href={leaf.href}
        prefetch={false}
        title={collapsed ? leaf.label : undefined}
      >
        <span className="admin-navigation__group-icon" aria-hidden="true">
          {iconFor(leaf.icon)}
        </span>
        {/* 收起态：行内角标被 CSS 隐藏（40px 方块塞不下），改挂图标右上角 */}
        {collapsed && badge ? (
          <RailBadge
            ariaLabel={leafBadgeLabel(leaf.label, badge)}
            text={badge}
            warning={isWarningLeaf(leaf)}
          />
        ) : null}
        <span className="admin-navigation__link-label">{leaf.label}</span>
        <LeafBadge badges={badges} leaf={leaf} />
      </Link>
    </li>
  )
}

function NavigationLeaf({
  active,
  badges,
  leaf,
  onNavigate,
}: {
  active: boolean
  badges: AdminNavigationBadgeCounts
  leaf: ResolvedAdminNavLeaf
  onNavigate?: () => void
}) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={[
        'admin-navigation__link',
        active ? 'admin-navigation__link--active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      href={leaf.href}
      onClick={onNavigate}
      prefetch={false}
    >
      <span className="admin-navigation__link-label">{leaf.label}</span>
      <LeafBadge badges={badges} leaf={leaf} />
    </Link>
  )
}

function LeafBadge({
  badges,
  leaf,
}: {
  badges: AdminNavigationBadgeCounts
  leaf: ResolvedAdminNavLeaf
}) {
  const badge = leafBadgeText(badges, leaf)
  if (!badge) return null

  return (
    <span
      aria-label={leafBadgeLabel(leaf.label, badge)}
      className={[
        'admin-navigation__badge',
        isWarningLeaf(leaf) ? 'admin-navigation__badge--warning' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {badge}
    </span>
  )
}

/**
 * 收起态（48px）图标右上角的角标。
 *
 * 刻意用独立类名而不是复用 `__badge`：收起态下 `__badge` 是被显式隐藏的
 * （40px 方块塞不下「图标 + 间距 + 角标」，见 AdminNavigation.scss），
 * 复用类名会把那条隐藏规则一起继承过来，角标就永远不显示。
 */
function RailBadge({
  ariaLabel,
  text,
  warning,
}: {
  ariaLabel: string
  text: string
  warning: boolean
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={[
        'admin-navigation__rail-badge',
        warning ? 'admin-navigation__rail-badge--warning' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {text}
    </span>
  )
}

function reportBadgeFailure(reported: { current: boolean }): void {
  if (reported.current) return
  reported.current = true
  toast.error('导航数量暂时无法加载，菜单仍可正常使用')
}
