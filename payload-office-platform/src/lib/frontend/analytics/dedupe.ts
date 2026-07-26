/**
 * 事件去重（OPT-010）
 *
 * 曝光类事件（如 inquiry_open）可能在短时间内因浏览器抖动/重复触发多次，
 * 需按"事件名 + 属性指纹"在窗口内去重，避免虚高计数。
 *
 * 转化类事件（inquiry_submit / success / error）默认不去重--
 * 多次提交/多次出错是真实业务信号。
 */

import type { AnalyticsEventName } from './events'

export interface DedupeConfig {
  /** 事件名 -> 去重窗口 ms（0 或缺省 = 不去重） */
  windows?: Partial<Record<AnalyticsEventName, number>>
  /** 默认窗口（未在 windows 中显式配置的事件） */
  defaultWindowMs?: number
  /** 注入时钟（测试用），默认 Date.now */
  now?: () => number
}

export interface Deduper {
  /** 是否应丢弃该事件（窗口内重复） */
  shouldDrop: (name: AnalyticsEventName, serializedProps: string) => boolean
  /** 清空去重状态（测试用） */
  reset: () => void
}

/**
 * 创建去重器。
 * - 窗口 0 -> 永不去重
 * - 窗口 >0 -> 同 fingerprint 在窗口内只放行第一次
 */
export function createDeduper(config: DedupeConfig = {}): Deduper {
  const windows = config.windows ?? {}
  const defaultWindow = config.defaultWindowMs ?? 0
  const now = config.now ?? (() => Date.now())
  const lastSeen = new Map<string, number>()

  return {
    shouldDrop(name, serializedProps): boolean {
      const windowMs = windows[name] ?? defaultWindow
      if (windowMs <= 0) return false
      const key = `${name}|${serializedProps}`
      const last = lastSeen.get(key)
      const t = now()
      if (last !== undefined && t - last < windowMs) {
        return true
      }
      lastSeen.set(key, t)
      return false
    },
    reset() {
      lastSeen.clear()
    },
  }
}
