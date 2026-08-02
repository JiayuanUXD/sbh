'use client'

import React, { useSyncExternalStore, useState } from 'react'
import BuildingListCard from '@/components/frontend/BuildingListCard'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'

/**
 * 楼盘网格 + 视图切换（列表 / 网格）
 *
 * 复用 listing-view 的 localStorage key，保持与房源页视图偏好一致。
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

export default function BuildingGrid({
  docs,
}: Readonly<{ docs: readonly BuildingSummaryViewModel[] }>) {
  const storedView = useSyncExternalStore(subscribeView, readClientView, readServerView)
  const [override, setOverride] = useState<'grid' | 'list' | null>(null)
  const view = override ?? storedView

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
        {docs.map((building) => (
          <BuildingListCard key={building.id} building={building} view={view} />
        ))}
      </div>
    </div>
  )
}
