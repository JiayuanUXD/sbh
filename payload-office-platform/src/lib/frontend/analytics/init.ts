'use client'

/**
 * 埋点客户端初始化（OPT-010）
 *
 * - 单例 collector：首次 track 或 AnalyticsInit 挂载时创建
 * - 适配器选择（见下方 selectAdapter）：生产且 Umami 配置齐备走 UmamiAdapter，
 *   生产未接入走 Noop，开发 ConsoleAdapter，SSR NoopAdapter
 * - 页面隐藏/卸载时 flush，避免事件丢失
 * - OPT-064 起还负责 page_engagement 的计时与三个上报触发点
 *
 * 业务代码：`import { track } from '@/lib/frontend/analytics'` 后调 track(name, props)
 */

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  createConsoleAdapter,
  createNoopAdapter,
  createUmamiAdapter,
  type AnalyticsAdapter,
} from './adapter'
import { createCollector, type Collector } from './collector'
import {
  attachEngagementListeners,
  createEngagementTracker,
  type EngagementTrack,
  type EngagementTracker,
} from './engagement'
import { resolveUmamiConfig } from './umami-config'
import { initWebVitals } from './web-vitals'
import {
  resolveCityPageObservation,
  safeTrackCityEvent,
  type CityPageObservationOption,
  type CityAnalyticsTrack,
} from './landing'

let collectorSingleton: Collector | null = null

/** 创建使用统一曝光去重配置的 collector，供客户端单例与测试边界复用。 */
export function createDefaultCollector(
  adapter: AnalyticsAdapter,
  now: () => number = () => Date.now(),
): Collector {
  return createCollector(adapter, {
    now,
    dedupe: { windows: { inquiry_open: 2000, landing_view: 2000 } },
  })
}

/**
 * 选择适配器。
 *
 * - SSR：Noop（事件安全丢弃）
 * - 生产 + Umami 配置齐备：Umami
 * - 生产但未接入 Umami：**Noop**。此前这里是 DataLayerAdapter，往
 *   `window.dataLayer` push——而 layout 里从没注过任何消费它的脚本，
 *   事件堆在数组里刷新即丢。「看起来在采集、其实什么也没发生」比明确不采集更糟。
 * - 开发：Console（本地调试看得见）
 */
function selectAdapter(): AnalyticsAdapter {
  if (typeof window === 'undefined') return createNoopAdapter()
  if (process.env.NODE_ENV !== 'production') return createConsoleAdapter()
  return resolveUmamiConfig() ? createUmamiAdapter() : createNoopAdapter()
}

/** 获取单例 collector（client 优先；SSR 返回 NoopAdapter 包装的实例，事件安全丢弃） */
export function getCollector(): Collector {
  if (collectorSingleton) return collectorSingleton
  const adapter = selectAdapter()
  adapter.init?.()
  collectorSingleton = createDefaultCollector(adapter)
  return collectorSingleton
}

/** 采集事件入口（业务代码用） */
export function track(name: string, props: Record<string, unknown> = {}): void {
  getCollector().track(name, props)
}

/** 页面隐藏/卸载时 flush */
export function flushAnalytics(): Promise<void> {
  return getCollector().flush()
}

/**
 * 埋点初始化组件：在根 layout 渲染一次，负责 flush 时机订阅。
 * 不渲染任何 UI。
 */
export function AnalyticsInit({
  cities = [],
  defaultCity = '',
  multiCityRoutingEnabled = true,
  tracker = track,
}: Readonly<{
  cities?: readonly CityPageObservationOption[]
  defaultCity?: string
  multiCityRoutingEnabled?: boolean
  tracker?: CityAnalyticsTrack
}>): null {
  const pathname = usePathname() || '/'
  const searchParams = useSearchParams()
  const lastObservationKeyRef = useRef<string | null>(null)
  const currentNavigationKeyRef = useRef<string | null>(null)

  // ── OPT-064 page_engagement ────────────────────────────────────────────────
  // 三个上报触发点与「活跃」的定义见 engagement.ts 头注释。
  const engagementRef = useRef<EngagementTracker | null>(null)
  if (engagementRef.current === null) {
    engagementRef.current = createEngagementTracker({ track: track as EngagementTrack })
  }

  // ⚠️ 这个 effect 必须排在下面 attach 那个之前：React 按声明顺序跑 effect，
  // 而 attachEngagementListeners 会立刻量一次首屏滚动深度——那时若还没 enter()，
  // 账本是 null，不足一屏的页面就永远量不到（它们从不触发 scroll 事件）。
  useEffect(() => {
    // App Router 的站内跳转既不触发 pagehide 也不触发 visibilitychange，
    // 所以「列表 → 详情 → 下一套」这条主路径上，这里是唯一的上报时机。
    engagementRef.current?.enter(pathname)
  }, [pathname])

  useEffect(() => {
    const engagement = engagementRef.current
    if (!engagement) return
    const detach = attachEngagementListeners(engagement)
    return () => {
      engagement.flush()
      detach()
    }
  }, [])

  useEffect(() => {
    const collector = getCollector()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void collector.flush()
    }
    const onHide = () => void collector.flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)

    // OPT-018: Web Vitals 采集（动态 import web-vitals，SSR 不触发）
    let cancelled = false
    let stopVitals: (() => void) | null = null
    void initWebVitals(collector).then((stop) => {
      if (cancelled) stop()
      else stopVitals = stop
    })

    return () => {
      cancelled = true
      stopVitals?.()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  useEffect(() => {
    const emitWhenVisible = () => {
      const observation = resolveCityPageObservation(pathname, cities, searchParams, {
        defaultCity,
        multiCityRoutingEnabled,
      })
      const navigationKey = observation
        ? `${pathname}|${observation.city}|${observation.page_type}`
        : `${pathname}|unobserved`
      if (currentNavigationKeyRef.current !== navigationKey) {
        currentNavigationKeyRef.current = navigationKey
        lastObservationKeyRef.current = null
      }
      if (document.visibilityState !== 'visible' || !observation) return
      const key = `${navigationKey}|${observation.status}`
      if (lastObservationKeyRef.current === key) return
      lastObservationKeyRef.current = key
      safeTrackCityEvent(tracker, 'city_page_view', observation)
    }
    emitWhenVisible()
    document.addEventListener('visibilitychange', emitWhenVisible)
    return () => document.removeEventListener('visibilitychange', emitWhenVisible)
  }, [cities, defaultCity, multiCityRoutingEnabled, pathname, searchParams, tracker])
  return null
}
