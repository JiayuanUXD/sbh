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
  deriveOpenGroupId,
  findActiveLeaf,
  findActiveParentKeys,
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
const COLLAPSED_WIDTH = '48px'
const DESKTOP_BREAKPOINT = 1024

const WARNING_BADGE_KEYS = new Set([
  'listingReviews',
  'listingReports',
  'leads',
  'formSubmissions',
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

export default function AdminNavigationClient({
  entries,
}: AdminNavigationClientProps) {
  const pathname = usePathname()
  const { config } = useConfig()
  const { navOpen, navRef, setNavOpen } = useNav()
  useWindowInfo() // 保持 hook 调用以维持上下文响应
  const [badges, setBadges] = useState<AdminNavigationBadgeCounts>({})
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    // 初始展开集：包含当前激活路径所属的组（激活的是扁平叶时为空，扁平叶没有面板可展）
    const s = new Set<string>()
    for (const key of findActiveParentKeys(entries, pathname)) {
      s.add(key)
    }
    return s
  })
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [windowWidth, setWindowWidth] = useState<number>(0)
  const badgeFailureReported = useRef(false)
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
    setOpenKeys((prev) => toggleGroupInSet(prev, key))
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
        <span className="admin-navigation__group-label">{group.label}</span>
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
  if (!leaf.badgeKey) return null

  const badge = formatBadgeCount(badges[leaf.badgeKey] ?? 0)
  if (!badge) return null

  return (
    <span
      aria-label={`${leaf.label}待处理 ${badge} 项`}
      className={[
        'admin-navigation__badge',
        WARNING_BADGE_KEYS.has(leaf.badgeKey) ? 'admin-navigation__badge--warning' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {badge}
    </span>
  )
}

function reportBadgeFailure(reported: { current: boolean }): void {
  if (reported.current) return
  reported.current = true
  toast.error('导航数量暂时无法加载，菜单仍可正常使用')
}
