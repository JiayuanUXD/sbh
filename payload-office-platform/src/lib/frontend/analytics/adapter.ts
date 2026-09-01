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

/** Umami 全局对象的最小形状；只声明本模块用得到的部分。 */
interface UmamiGlobal {
  track: (eventName: string, eventData?: Record<string, AllowedValue>) => void
}

function readUmami(): UmamiGlobal | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as typeof window & { umami?: unknown }).umami
  if (!candidate || typeof candidate !== 'object') return null
  const track = (candidate as { track?: unknown }).track
  return typeof track === 'function' ? (candidate as UmamiGlobal) : null
}

/**
 * Umami 适配器：把事件交给自托管 Umami 的 `window.umami.track()`。
 *
 * ## 为什么未就绪时要抛错，而不是默默丢弃
 *
 * Umami 的 `script.js` 是 `defer` 加载的，而首屏就可能触发埋点（`landing_view`、
 * `city_page_view` 都在挂载时发）。这段窗口里 `window.umami` 还不存在。
 *
 * 抛错会让 `queue.ts` 把整批事件转入 `pendingRetry`，按 1s / 2s / 4s 指数退避重试
 * ——脚本通常在第一次重试前就绪，事件不丢。默默丢弃则会**稳定地**漏掉每个用户的
 * 首屏事件，而这恰恰是漏斗第一步。
 *
 * 三次重试后仍未就绪（脚本被拦截、域名不可达），队列自己放弃并打一条
 * `drop_after_retries`。这是可接受的终局：埋点不该拖累业务。
 */
export function createUmamiAdapter(): AnalyticsAdapter {
  return {
    name: 'umami',
    send(events) {
      const umami = readUmami()
      if (!umami) {
        // 交给队列重试；见上方注释
        throw new Error('umami tracker not ready')
      }
      for (const e of events) {
        umami.track(e.eventName, e.props)
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
