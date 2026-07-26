/**
 * 埋点适配器（OPT-010）
 *
 * 可插拔适配器框架：业务代码只调 collector.track，
 * 由 collector 经 sanitize/dedupe/queue 后交给适配器发送。
 *
 * 内置三个适配器：
 * - NoopAdapter：默认，丢弃所有事件（未配置平台时安全降级）
 * - ConsoleAdapter：开发调试，console.debug
 * - DataLayerAdapter：写 window.dataLayer，兼容 GTM
 *
 * 不内置真实 GA4/GTM SDK（用户确认：建可插拔框架，平台接入时实现新 adapter）。
 */

import type { AnalyticsEventName } from './events'

type AllowedValue = string | number | boolean

export interface TrackedEvent {
  eventName: AnalyticsEventName
  props: Record<string, AllowedValue>
  /** 采集时间戳（ms） */
  timestamp: number
}

export interface AnalyticsAdapter {
  name: string
  /** 初始化（注册到 window 等），幂等。仅 client 调用 */
  init?: () => void
  /**
   * 发送一批事件。抛错表示失败，队列会按策略重试。
   * 不抛错表示已接收（即便内部最终投递失败，也由适配器自行兜底）。
   */
  send: (events: readonly TrackedEvent[]) => void
}

/** 空操作适配器：未配置平台时安全降级 */
export function createNoopAdapter(): AnalyticsAdapter {
  return {
    name: 'noop',
    send() {
      /* 丢弃 */
    },
  }
}

/** 控制台适配器：开发调试 */
export function createConsoleAdapter(): AnalyticsAdapter {
  return {
    name: 'console',
    send(events) {
      if (typeof console === 'undefined' || typeof console.debug !== 'function') return
      for (const e of events) {
        console.debug('[analytics]', e.eventName, e.props)
      }
    },
  }
}

/** GTM dataLayer 适配器：写 window.dataLayer */
export function createDataLayerAdapter(): AnalyticsAdapter {
  return {
    name: 'dataLayer',
    init() {
      if (typeof window === 'undefined') return
      const w = window as typeof window & { dataLayer?: unknown[] }
      if (!Array.isArray(w.dataLayer)) {
        w.dataLayer = []
      }
    },
    send(events) {
      if (typeof window === 'undefined') return
      const w = window as typeof window & { dataLayer?: unknown[] }
      if (!Array.isArray(w.dataLayer)) return
      for (const e of events) {
        w.dataLayer.push({ event: e.eventName, ...e.props, _ts: e.timestamp })
      }
    },
  }
}
