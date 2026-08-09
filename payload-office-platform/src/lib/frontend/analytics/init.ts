'use client'

/**
 * 埋点客户端初始化（OPT-010）
 *
 * - 单例 collector：首次 track 或 AnalyticsInit 挂载时创建
 * - 适配器选择：生产 DataLayerAdapter（写 window.dataLayer，GTM 接入后消费），
 *   开发 ConsoleAdapter，SSR/测试 NoopAdapter
 * - 页面隐藏/卸载时 flush，避免事件丢失
 *
 * 业务代码：`import { track } from '@/lib/frontend/analytics'` 后调 track(name, props)
 */

import { useEffect } from 'react'
import {
  createConsoleAdapter,
  createDataLayerAdapter,
  createNoopAdapter,
  type AnalyticsAdapter,
} from './adapter'
import { createCollector, type Collector } from './collector'
import { initWebVitals } from './web-vitals'

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

/** 获取单例 collector（client 优先；SSR 返回 NoopAdapter 包装的实例，事件安全丢弃） */
export function getCollector(): Collector {
  if (collectorSingleton) return collectorSingleton
  const adapter =
    typeof window === 'undefined'
      ? createNoopAdapter()
      : process.env.NODE_ENV === 'production'
        ? createDataLayerAdapter()
        : createConsoleAdapter()
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
export function AnalyticsInit(): null {
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
  return null
}
