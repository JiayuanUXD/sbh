'use client'

import React, { useSyncExternalStore, useState } from 'react'
import ListingCard from '@/components/frontend/ListingCard'
import type { ListingCardViewModel } from '@/domain/public-catalog'

/**
 * 房源网格 + 视图切换（列表 / 网格）
 *
 * - 列表视图（默认）：横向卡片，左图右文，信息密度高（参考阿里商办）
 * - 网格视图：竖向卡片，4:3 媒体
 * - 视图偏好持久化到 localStorage（key: listing-view），通过 useSyncExternalStore 读取
 */
const VIEW_STORAGE_KEY = 'listing-view'
const DEFAULT_VIEW: 'grid' | 'list' = 'list'

function subscribeView(callback: () => void) {
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

function readClientView(): 'grid' | 'list' {
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return saved === 'grid' || saved === 'list' ? saved : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

function readServerView(): 'grid' | 'list' {
  return DEFAULT_VIEW
}

export default function ListingGrid({
  docs,
  citySlug,
}: Readonly<{ docs: readonly ListingCardViewModel[]; citySlug?: string }>) {
  const storedView = useSyncExternalStore(subscribeView, readClientView, readServerView)
  const [override, setOverride] = useState<'grid' | 'list' | null>(null)
  const view = override ?? storedView

  // F-011: "必看好房"徽章上限 ≤20%，避免通胀。按渲染顺序取前 budget 个 featured。
  const featuredBadgeIds = new Set<number>()
  const badgeBudget = Math.max(1, Math.floor(docs.length * 0.2))
  for (const d of docs) {
    if (d.isFeatured && featuredBadgeIds.size < badgeBudget) featuredBadgeIds.add(d.id)
  }

  function changeView(next: 'grid' | 'list') {
    if (next === view) return
    setOverride(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
      window.dispatchEvent(new StorageEvent('storage', { key: VIEW_STORAGE_KEY, newValue: next }))
    } catch {
      // localStorage 不可用：override 仍生效（仅本次会话）
    }
  }

  return (
    <div className="listings-grid">
      <div className="view-switcher" role="group" aria-label="视图切换">
        <button
          type="button"
          className={`view-switcher__btn${view === 'list' ? ' is-active' : ''}`}
          onClick={() => changeView('list')}
          aria-pressed={view === 'list'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span>列表</span>
        </button>
        <button
          type="button"
          className={`view-switcher__btn${view === 'grid' ? ' is-active' : ''}`}
          onClick={() => changeView('grid')}
          aria-pressed={view === 'grid'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>网格</span>
        </button>
      </div>

      <div className={`card-grid card-grid--${view}`}>
        {docs.map((listing) => (
          <ListingCard key={listing.id} listing={listing} view={view} showFeaturedTag={featuredBadgeIds.has(listing.id)} citySlug={citySlug} />
        ))}
      </div>
    </div>
  )
}
