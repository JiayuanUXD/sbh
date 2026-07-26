/**
 * 事件收集器（OPT-010）
 *
 * 组合 validate -> dedupe -> queue -> adapter 的处理流水线。
 * 业务代码只调 collector.track(name, props)，无需关心脱敏/去重/重试。
 */

import type { AnalyticsAdapter, TrackedEvent } from './adapter'
import { createDeduper, type DedupeConfig } from './dedupe'
import { validateEvent, serializeProps } from './events'
import { createQueue, type QueueOptions } from './queue'

export interface CollectorOptions extends QueueOptions {
  /** 去重配置 */
  dedupe?: DedupeConfig
  /** 时钟注入（测试用） */
  now?: () => number
}

export interface Collector {
  /** 采集事件：未知事件/窗口内重复会被静默丢弃 */
  track: (name: string, props: Record<string, unknown>) => void
  /** 手动 flush（页面隐藏/卸载时） */
  flush: () => Promise<void>
}

export function createCollector(
  adapter: AnalyticsAdapter,
  options: CollectorOptions = {},
): Collector {
  const { dedupe: dedupeConfig, now = () => Date.now(), ...queueOpts } = options
  const deduper = createDeduper({ ...dedupeConfig, now })
  const queue = createQueue(adapter, queueOpts)

  return {
    track(name, props) {
      const validated = validateEvent(name, props)
      if (!validated.ok) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function' && process.env.NODE_ENV !== 'production') {
          console.warn('[analytics] event_dropped', validated.reason)
        }
        return
      }
      const fingerprint = serializeProps(validated.sanitized)
      if (deduper.shouldDrop(validated.eventName, fingerprint)) return
      const event: TrackedEvent = {
        eventName: validated.eventName,
        props: validated.sanitized,
        timestamp: now(),
      }
      queue.enqueue(event)
    },
    flush: queue.flush,
  }
}
