'use client'

/**
 * Web Vitals 客户端采集（OPT-018）
 *
 * - 复用 OPT-010 的 collector 流水线（脱敏/去重/队列/适配器）
 * - 评级不依赖 web-vitals 库自带的 rating，统一走 thresholds.ts（单一事实源）
 * - web-vitals 库动态 import，避免 SSR 时拉入浏览器 API
 * - 返回 stop 函数：调用后忽略后续回调（测试与卸载用）
 *
 * 采集的指标：LCP / INP / CLS / TTFB / FCP，每个指标首次稳定上报一次。
 */

import type { Collector } from './collector'
import { rateWebVital, type WebVitalMetric } from '@/lib/observability/thresholds'

/** web-vitals 库需要暴露的订阅接口（便于测试注入 mock） */
export interface WebVitalsLib {
  onLCP: (cb: (metric: { name: string; value: number }) => void) => void
  onINP: (cb: (metric: { name: string; value: number }) => void) => void
  onCLS: (cb: (metric: { name: string; value: number }) => void) => void
  onTTFB: (cb: (metric: { name: string; value: number }) => void) => void
  onFCP: (cb: (metric: { name: string; value: number }) => void) => void
}

const VALID_METRICS: ReadonlySet<string> = new Set(['LCP', 'INP', 'CLS', 'TTFB', 'FCP'])

/**
 * 处理单条 web-vital 上报：校验指标名 -> 用 thresholds 评级 -> track。
 * 纯函数（副作用仅为注入的 collector.track），便于单测。
 */
export function handleVitalReport(
  collector: Collector,
  name: string,
  value: number,
): void {
  if (!VALID_METRICS.has(name)) return
  const metric = name as WebVitalMetric
  const rating = rateWebVital(metric, value)
  collector.track('web_vital', { metric, value, rating })
}

/**
 * 初始化 Web Vitals 采集。在 AnalyticsInit 挂载时调用一次。
 * @returns stop 函数，调用后忽略后续回调
 */
export async function initWebVitals(
  collector: Collector,
  lib?: WebVitalsLib,
): Promise<() => void> {
  let stopped = false
  const bindings: WebVitalsLib = lib ?? (await import('web-vitals'))
  const handler = (m: { name: string; value: number }) => {
    if (stopped) return
    handleVitalReport(collector, m.name, m.value)
  }
  bindings.onLCP(handler)
  bindings.onINP(handler)
  bindings.onCLS(handler)
  bindings.onTTFB(handler)
  bindings.onFCP(handler)
  return () => {
    stopped = true
  }
}
