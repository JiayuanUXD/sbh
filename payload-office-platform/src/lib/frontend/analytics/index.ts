/**
 * 前端埋点采集模块（OPT-010）
 *
 * 可插拔适配器框架：事件名/属性白名单 + 隐私脱敏 + 曝光去重 + 队列重试。
 *
 * 业务用法：
 * ```ts
 * import { track } from '@/lib/frontend/analytics'
 * track('inquiry_open', { page_type: 'listing', target_type: 'listing', has_target: true })
 * ```
 *
 * 平台接入（GA4/GTM 等）：实现 AnalyticsAdapter，在 init.ts 替换适配器即可。
 */

export { track, flushAnalytics, AnalyticsInit, getCollector } from './init'
export { createCollector, type Collector, type CollectorOptions } from './collector'
export {
  validateEvent,
  assertSafeAnalyticsProps,
  serializeProps,
  ANALYTICS_EVENTS,
  type AnalyticsEventName,
} from './events'
export { createDeduper, type DedupeConfig, type Deduper } from './dedupe'
export { createQueue, type EventQueue, type QueueOptions } from './queue'
export {
  createNoopAdapter,
  createConsoleAdapter,
  createDataLayerAdapter,
  type AnalyticsAdapter,
  type TrackedEvent,
} from './adapter'
export {
  buildCityAnalyticsPayload,
  safeTrackCityEvent,
  type CityAnalyticsEventName,
  type CityAnalyticsProps,
  type CityAnalyticsTrack,
  type CityPageObservationOption,
  type CityServiceStatus,
} from './landing'
