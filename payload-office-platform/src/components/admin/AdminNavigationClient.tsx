'use client'

import {
  Link,
  toast,
  useConfig,
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
  IconMenuFold,
  IconMenuUnfold,
  IconSafe,
  IconSettings,
  IconUser,
  IconUserGroup,
} from '@arco-design/web-react/icon'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  loadAdminNavigationBadges,
  type AdminNavigationBadgeCounts,
} from '@/domain/admin-navigation/navigation-badge-request'
import { formatBadgeCount } from '@/domain/admin-navigation/navigation-badges'
import {
  deriveOpenGroupId,
  findActiveLeaf,
  toggleOpenGroup,
} from '@/domain/admin-navigation/navigation-state'
import type {
  ResolvedAdminNavGroup,
  ResolvedAdminNavLeaf,
  ResolvedAdminNavSubgroup,
} from '@/domain/admin-navigation/resolve-navigation'
import type { AdminNavIconKey } from '@/domain/admin-navigation/navigation-types'

type AdminNavigationClientProps = {
  groups: readonly ResolvedAdminNavGroup[]
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
  building: <IconHome />,
  shield: <IconSafe />,
  user: <IconUser />,
  shop: <IconInteraction />,
  team: <IconUserGroup />,
  file: <IconFile />,
  form: <IconEdit />,
  settings: <IconSettings />,
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
  groups,
}: AdminNavigationClientProps) {
  const pathname = usePathname()
  const { config } = useConfig()
  useWindowInfo() // 保持 hook 调用以维持上下文响应
  const [badges, setBadges] = useState<AdminNavigationBadgeCounts>({})
  const [manualGroupState, setManualGroupState] = useState<{
    groupId: string | null
    pathname: string
  } | null>(null)
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [windowWidth, setWindowWidth] = useState<number>(0)
  const badgeFailureReported = useRef(false)
  const activeLeafId = findActiveLeaf(groups, pathname)?.id ?? null
  const activeGroupId = deriveOpenGroupId(groups, pathname)
  const apiRoute = config.routes.api.replace(/\/$/, '')

  // 桌面端断点：>= 1024px 时侧边栏常驻（CSS 媒体查询强制可见），启用折叠功能
  const isDesktop = mounted && windowWidth >= DESKTOP_BREAKPOINT

  // 标记 mounted + 监听窗口大小变化
  useEffect(() => {
    const updateWidth = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', updateWidth)
    const initialFrame = window.requestAnimationFrame(() => {
      updateWidth()
      setMounted(true)
      setCollapsed(getInitialCollapsed())
    })
    return () => {
      window.cancelAnimationFrame(initialFrame)
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

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

  const openGroupId = useMemo(() => {
    if (effectiveCollapsed) {
      return null
    }
    return manualGroupState?.pathname === pathname
      ? manualGroupState.groupId
      : activeGroupId
  }, [effectiveCollapsed, manualGroupState, pathname, activeGroupId])

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

  const handleGroupClick = (groupId: string) => {
    if (effectiveCollapsed) return
    setManualGroupState({
      groupId: toggleOpenGroup(openGroupId, groupId),
      pathname,
    })
  }

  return (
    <div
      aria-label="后台主导航"
      className={`admin-navigation${effectiveCollapsed ? ' admin-navigation--collapsed' : ''}`}
    >
      <ul className="admin-navigation__groups">
        {groups.map((group) => {
          const isOpen = group.id === openGroupId
          const isActiveGroup = group.id === activeGroupId
          const isHovered = effectiveCollapsed && group.id === hoveredGroupId
          const panelId = `admin-navigation-group-${group.id}`
          const icon = GROUP_ICONS[group.icon as AdminNavIconKey] ?? <IconApps />

          return (
            <li
              className={`admin-navigation__group${isOpen ? ' admin-navigation__group--open' : ''}${isActiveGroup ? ' admin-navigation__group--active' : ''}`}
              key={group.id}
              onMouseEnter={
                effectiveCollapsed
                  ? () => setHoveredGroupId(group.id)
                  : undefined
              }
              onMouseLeave={
                effectiveCollapsed
                  ? () => setHoveredGroupId((prev) => (prev === group.id ? null : prev))
                  : undefined
              }
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
                onClick={() => handleGroupClick(group.id)}
                title={effectiveCollapsed ? group.label : undefined}
                type="button"
              >
                <span className="admin-navigation__group-icon" aria-hidden="true">
                  {icon}
                </span>
                <span className="admin-navigation__group-label">{group.label}</span>
                <IconCaretRight
                  aria-hidden="true"
                  className="admin-navigation__chevron"
                />
              </button>

              {/* 展开模式：内联面板 */}
              {!effectiveCollapsed && (
                <div
                  className={`admin-navigation__group-panel${isOpen ? ' admin-navigation__group-panel--open' : ''}`}
                  id={panelId}
                >
                  <ul className="admin-navigation__items">
                    {group.children.map((item) => (
                      <li className="admin-navigation__item" key={item.id}>
                        {'children' in item ? (
                          <NavigationSubgroup
                            activeLeafId={activeLeafId}
                            badges={badges}
                            subgroup={item}
                          />
                        ) : (
                          <NavigationLeaf
                            active={item.id === activeLeafId}
                            badges={badges}
                            leaf={item}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 折叠模式：浮层面板 */}
              {effectiveCollapsed && isHovered && (
                <div className="admin-navigation__flyout" role="menu">
                  <div className="admin-navigation__flyout-title">{group.label}</div>
                  <ul className="admin-navigation__flyout-items">
                    {group.children.map((item) => (
                      <li className="admin-navigation__flyout-item" key={item.id}>
                        {'children' in item ? (
                          <NavigationSubgroup
                            activeLeafId={activeLeafId}
                            badges={badges}
                            collapsed
                            subgroup={item}
                            onNavigate={() => setHoveredGroupId(null)}
                          />
                        ) : (
                          <NavigationLeaf
                            active={item.id === activeLeafId}
                            badges={badges}
                            leaf={item}
                            onNavigate={() => setHoveredGroupId(null)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
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

function NavigationSubgroup({
  activeLeafId,
  badges,
  collapsed = false,
  subgroup,
  onNavigate,
}: {
  activeLeafId: string | null
  badges: AdminNavigationBadgeCounts
  collapsed?: boolean
  subgroup: ResolvedAdminNavSubgroup
  onNavigate?: () => void
}) {
  const [openSubgroupId, setOpenSubgroupId] = useState<string | null>(null)
  const isOpen = openSubgroupId === subgroup.id
  const panelId = `admin-navigation-subgroup-${subgroup.id}`
  const isActive = useMemo(
    () => subgroup.children.some((leaf) => leaf.id === activeLeafId),
    [subgroup.children, activeLeafId],
  )

  return (
    <div className={`admin-navigation__subgroup${isOpen ? ' admin-navigation__subgroup--open' : ''}`}>
      <button
        aria-controls={collapsed ? undefined : panelId}
        aria-expanded={isOpen}
        className={[
          'admin-navigation__subgroup-toggle',
          isActive ? 'admin-navigation__subgroup-toggle--active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() =>
          setOpenSubgroupId((current) =>
            toggleOpenGroup(current, subgroup.id),
          )
        }
        type="button"
      >
        <span className="admin-navigation__subgroup-label">{subgroup.label}</span>
        {!collapsed && (
          <IconCaretRight
            aria-hidden="true"
            className="admin-navigation__chevron admin-navigation__chevron--sub"
          />
        )}
      </button>

      {!collapsed && (
        <div
          className={`admin-navigation__subgroup-panel${isOpen ? ' admin-navigation__subgroup-panel--open' : ''}`}
          id={panelId}
        >
          <ul className="admin-navigation__subgroup-items">
            {subgroup.children.map((leaf) => (
              <li className="admin-navigation__subgroup-item" key={leaf.id}>
                <NavigationLeaf
                  active={leaf.id === activeLeafId}
                  badges={badges}
                  leaf={leaf}
                  onNavigate={onNavigate}
                  subgroup
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {collapsed && isOpen && (
        <ul className="admin-navigation__flyout-items admin-navigation__flyout-items--sub">
          {subgroup.children.map((leaf) => (
            <li className="admin-navigation__flyout-item" key={leaf.id}>
              <NavigationLeaf
                active={leaf.id === activeLeafId}
                badges={badges}
                leaf={leaf}
                onNavigate={() => {
                  setOpenSubgroupId(null)
                  onNavigate?.()
                }}
                subgroup
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NavigationLeaf({
  active,
  badges,
  leaf,
  onNavigate,
  subgroup = false,
}: {
  active: boolean
  badges: AdminNavigationBadgeCounts
  leaf: ResolvedAdminNavLeaf
  onNavigate?: () => void
  subgroup?: boolean
}) {
  const badge = leaf.badgeKey
    ? formatBadgeCount(badges[leaf.badgeKey] ?? 0)
    : null
  const isWarningBadge =
    leaf.badgeKey !== undefined && WARNING_BADGE_KEYS.has(leaf.badgeKey)

  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={[
        'admin-navigation__link',
        active ? 'admin-navigation__link--active' : '',
        subgroup ? 'admin-navigation__link--sub' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      href={leaf.href}
      onClick={onNavigate}
      prefetch={false}
    >
      <span className="admin-navigation__link-label">{leaf.label}</span>
      {badge ? (
        <span
          aria-label={`${leaf.label}待处理 ${badge} 项`}
          className={[
            'admin-navigation__badge',
            isWarningBadge ? 'admin-navigation__badge--warning' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  )
}

function reportBadgeFailure(reported: { current: boolean }): void {
  if (reported.current) return
  reported.current = true
  toast.error('导航数量暂时无法加载，菜单仍可正常使用')
}
