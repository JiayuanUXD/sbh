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
import { createDataLayerAdapter, createConsoleAdapter, createNoopAdapter } from './adapter'
import { createCollector, type Collector } from './collector'

let collectorSingleton: Collector | null = null

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
  collectorSingleton = createCollector(adapter, {
    // inquiry_open 为曝光类，2s 内同属性去重防抖
    dedupe: { windows: { inquiry_open: 2000 } },
  })
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
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])
  return null
}
