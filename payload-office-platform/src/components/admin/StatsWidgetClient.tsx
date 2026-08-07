'use client'

import { useEffect, useState } from 'react'

import type { DashboardStats } from '@/domain/analytics/dashboard-stats'
import DashboardOverview from './DashboardOverview'

const DASHBOARD_STATS_TIMEOUT_MS = 10_000

type DashboardStatsResponse = {
  ok: true
  stats: DashboardStats
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; stats: DashboardStats }
  | { status: 'error' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isDashboardStats(value: unknown): value is DashboardStats {
  if (!isRecord(value)) return false

  return (
    isNonNegativeSafeInteger(value.activeLeads) &&
    isNonNegativeSafeInteger(value.availableListings) &&
    isNonNegativeSafeInteger(value.buildings) &&
    isNonNegativeSafeInteger(value.featuredListings) &&
    isNonNegativeSafeInteger(value.leads) &&
    isNonNegativeSafeInteger(value.listings) &&
    isNonNegativeSafeInteger(value.listingsWithoutCover) &&
    isNonNegativeSafeInteger(value.newLeads)
  )
}

export function isDashboardStatsResponse(value: unknown): value is DashboardStatsResponse {
  return isRecord(value) && value.ok === true && isDashboardStats(value.stats)
}

export async function fetchDashboardStats(signal: AbortSignal): Promise<DashboardStats> {
  const response = await fetch('/api/dashboard-stats', {
    credentials: 'same-origin',
    signal,
  })
  const body: unknown = await response.json()

  if (!response.ok || !isDashboardStatsResponse(body)) {
    throw new Error('dashboard statistics request failed')
  }

  return body.stats
}

function DashboardStatsSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="正在加载运营数据"
      className="arco-admin-dashboard__loading"
      role="status"
    >
      <span className="arco-admin-dashboard__sr-only">正在加载运营数据</span>
      <div aria-hidden="true" className="arco-admin-dashboard__skeleton-heading" />
      <div aria-hidden="true" className="arco-admin-dashboard__skeleton-grid">
        {[0, 1, 2, 3].map((index) => (
          <div className="arco-admin-dashboard__skeleton-card" key={index} />
        ))}
      </div>
      <div aria-hidden="true" className="arco-admin-dashboard__skeleton-detail" />
    </section>
  )
}

function DashboardStatsError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="arco-admin-dashboard__error" role="alert">
      <p>运营数据暂时加载失败，请检查网络后重试。</p>
      <button onClick={onRetry} type="button">
        重新加载
      </button>
    </section>
  )
}

export default function StatsWidgetClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let isMounted = true
    const timeoutId = window.setTimeout(() => controller.abort(), DASHBOARD_STATS_TIMEOUT_MS)

    void fetchDashboardStats(controller.signal)
      .then((stats) => {
        if (isMounted) setState({ status: 'ready', stats })
      })
      .catch(() => {
        if (isMounted) setState({ status: 'error' })
      })
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [requestVersion])

  if (state.status === 'ready') return <DashboardOverview {...state.stats} />
  if (state.status === 'error') {
    return (
      <DashboardStatsError
        onRetry={() => {
          setState({ status: 'loading' })
          setRequestVersion((version) => version + 1)
        }}
      />
    )
  }

  return <DashboardStatsSkeleton />
}
