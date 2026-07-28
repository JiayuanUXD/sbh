'use client'

import { Link, toast, useConfig, useNav } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

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
import type { AdminNavigationBadgeKey } from '@/domain/admin-navigation/navigation-types'

type AdminNavigationClientProps = {
  groups: readonly ResolvedAdminNavGroup[]
}

type BadgeCounts = Partial<Record<AdminNavigationBadgeKey, number>>

const BADGE_KEYS = [
  'tasks',
  'notifications',
  'listingReviews',
  'listingReports',
  'leads',
  'formSubmissions',
] as const satisfies readonly AdminNavigationBadgeKey[]

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
  const [badges, setBadges] = useState<BadgeCounts>({})
  const [openGroupId, setOpenGroupId] = useState<string | null>(() =>
    deriveOpenGroupId(groups, pathname),
  )
  const badgeRequestStarted = useRef(false)
  const badgeFailureReported = useRef(false)
  const activeLeafId = findActiveLeaf(groups, pathname)?.id ?? null
  const apiRoute = config.routes.api.replace(/\/$/, '')

  useEffect(() => {
    setOpenGroupId(deriveOpenGroupId(groups, pathname))
  }, [groups, pathname])

  useEffect(() => {
    if (badgeRequestStarted.current) return
    badgeRequestStarted.current = true

    const loadBadges = async () => {
      try {
        const response = await fetch(`${apiRoute}/admin-navigation`, {
          credentials: 'include',
        })

        if (response.status === 401) return

        const data: unknown = await response.json()
        const parsedBadges = parseBadgeCounts(data)
        if (!response.ok || !parsedBadges) {
          reportBadgeFailure(badgeFailureReported)
          return
        }

        setBadges(parsedBadges)
      } catch {
        reportBadgeFailure(badgeFailureReported)
      }
    }

    void loadBadges()
  }, [apiRoute])

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
                  setOpenGroupId((current) =>
                    toggleOpenGroup(current, group.id),
                  )
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
                          onNavigate={() => setNavOpen(false)}
                        />
                      ) : (
                        <NavigationLeaf
                          active={item.id === activeLeafId}
                          badges={badges}
                          leaf={item}
                          onNavigate={() => setNavOpen(false)}
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
  badges: BadgeCounts
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
  badges: BadgeCounts
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

function parseBadgeCounts(value: unknown): BadgeCounts | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.badges)) {
    return null
  }

  const badges: BadgeCounts = {}
  for (const key of BADGE_KEYS) {
    const count = value.badges[key]
    if (count === undefined) continue
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      return null
    }
    badges[key] = count
  }

  return badges
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function reportBadgeFailure(reported: { current: boolean }): void {
  if (reported.current) return
  reported.current = true
  toast.error('导航数量暂时无法加载，菜单仍可正常使用')
}
