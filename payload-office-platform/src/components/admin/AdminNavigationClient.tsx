'use client'

import {
  Link,
  toast,
  useConfig,
  useNav,
  useWindowInfo,
} from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  loadAdminNavigationBadges,
  type AdminNavigationBadgeCounts,
} from '@/domain/admin-navigation/navigation-badge-request'
import { formatBadgeCount } from '@/domain/admin-navigation/navigation-badges'
import {
  deriveOpenGroupId,
  findActiveLeaf,
  shouldCloseNavAfterLeafClick,
  toggleOpenGroup,
} from '@/domain/admin-navigation/navigation-state'
import type {
  ResolvedAdminNavGroup,
  ResolvedAdminNavLeaf,
  ResolvedAdminNavSubgroup,
} from '@/domain/admin-navigation/resolve-navigation'
import type { AdminNavigationBadgeKey } from '@/domain/admin-navigation/navigation-types'

type AdminNavigationClientProps = {
  groups: readonly ResolvedAdminNavGroup[]
}

const WARNING_BADGE_KEYS = new Set<AdminNavigationBadgeKey>([
  'listingReviews',
  'listingReports',
  'leads',
  'formSubmissions',
])

export default function AdminNavigationClient({
  groups,
}: AdminNavigationClientProps) {
  const pathname = usePathname()
  const { config } = useConfig()
  const { setNavOpen } = useNav()
  const {
    breakpoints: { s: smallBreak },
  } = useWindowInfo()
  const [badges, setBadges] = useState<AdminNavigationBadgeCounts>({})
  const [manualGroupState, setManualGroupState] = useState<{
    groupId: string | null
    pathname: string
  } | null>(null)
  const badgeFailureReported = useRef(false)
  const activeLeafId = findActiveLeaf(groups, pathname)?.id ?? null
  const apiRoute = config.routes.api.replace(/\/$/, '')
  const routeGroupId = deriveOpenGroupId(groups, pathname)
  const openGroupId =
    manualGroupState?.pathname === pathname
      ? manualGroupState.groupId
      : routeGroupId

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

  const closeMobileNavAfterLeafClick = () => {
    if (shouldCloseNavAfterLeafClick(smallBreak)) {
      setNavOpen(false)
    }
  }

  return (
    <div aria-label="后台主导航" className="admin-navigation">
      <ul className="admin-navigation__groups">
        {groups.map((group) => {
          const isOpen = group.id === openGroupId
          const panelId = `admin-navigation-group-${group.id}`

          return (
            <li className="admin-navigation__group" key={group.id}>
              <button
                aria-controls={panelId}
                aria-expanded={isOpen}
                className="admin-navigation__group-toggle"
                onClick={() =>
                  setManualGroupState({
                    groupId: toggleOpenGroup(openGroupId, group.id),
                    pathname,
                  })
                }
                type="button"
              >
                <span>{group.label}</span>
                <span
                  aria-hidden="true"
                  className="admin-navigation__chevron"
                >
                  ⌄
                </span>
              </button>

              <div
                className="admin-navigation__group-panel"
                hidden={!isOpen}
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
                          onNavigate={closeMobileNavAfterLeafClick}
                        />
                      ) : (
                        <NavigationLeaf
                          active={item.id === activeLeafId}
                          badges={badges}
                          leaf={item}
                          onNavigate={closeMobileNavAfterLeafClick}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NavigationSubgroup({
  activeLeafId,
  badges,
  subgroup,
  onNavigate,
}: {
  activeLeafId: string | null
  badges: AdminNavigationBadgeCounts
  subgroup: ResolvedAdminNavSubgroup
  onNavigate: () => void
}) {
  const [openSubgroupId, setOpenSubgroupId] = useState<string | null>(null)
  const isOpen = openSubgroupId === subgroup.id
  const panelId = `admin-navigation-subgroup-${subgroup.id}`

  return (
    <div className="admin-navigation__subgroup">
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className="admin-navigation__subgroup-toggle"
        onClick={() =>
          setOpenSubgroupId((current) =>
            toggleOpenGroup(current, subgroup.id),
          )
        }
        type="button"
      >
        <span>{subgroup.label}</span>
        <span aria-hidden="true" className="admin-navigation__chevron">
          ⌄
        </span>
      </button>

      <ul
        className="admin-navigation__subgroup-items"
        hidden={!isOpen}
        id={panelId}
      >
        {subgroup.children.map((leaf) => (
          <li className="admin-navigation__subgroup-item" key={leaf.id}>
            <NavigationLeaf
              active={leaf.id === activeLeafId}
              badges={badges}
              leaf={leaf}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </div>
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
  onNavigate: () => void
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
