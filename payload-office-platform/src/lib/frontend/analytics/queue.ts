/**
 * 事件队列与重试（OPT-010）
 *
 * - 攒批：达到 maxBatchSize 立即 flush，否则定时 flush
 * - 重试：adapter.send 抛错时按指数退避重试，超过 maxRetries 放弃
 * - 不阻断业务：所有错误捕获并 console.error，永不抛出
 *
 * 重试期间失败 batch 单独保存（pendingRetry），新事件继续入 buffer，
 * 避免:1) 失败 batch 阻塞新事件;2) 失败 batch 与新事件混合后部分重发导致重复。
 */

import type { AnalyticsAdapter, TrackedEvent } from './adapter'

export interface QueueOptions {
  /** 攒满多少条立即 flush */
  maxBatchSize?: number
  /** 定时 flush 间隔 ms */
  flushIntervalMs?: number
  /** 最大重试次数（首次失败后重试 N 次） */
  maxRetries?: number
  /** 退避基数 ms，第 n 次重试延迟 = base * 2^(n-1) */
  baseBackoffMs?: number
}

export interface EventQueue {
  enqueue: (event: TrackedEvent) => void
  flush: () => Promise<void>
  /** 测试观察：当前 buffer 条数 */
  readonly bufferSize: number
  /** 测试观察：当前重试中的 batch 信息 */
  readonly pendingRetryAttempt: number | null
}

export function createQueue(
  adapter: AnalyticsAdapter,
  options: QueueOptions = {},
): EventQueue {
  const maxBatchSize = options.maxBatchSize ?? 10
  const flushIntervalMs = options.flushIntervalMs ?? 5000
  const maxRetries = options.maxRetries ?? 3
  const baseBackoffMs = options.baseBackoffMs ?? 1000

  let buffer: TrackedEvent[] = []
  let pendingRetry: { events: TrackedEvent[]; attempt: number } | null = null
  let inFlight = false
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function clearFlushTimer(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  function scheduleFlush(delay: number): void {
    // 强制覆盖：重试调度需替换旧的定时 flush，否则旧 timer 会阻塞重试
    clearFlushTimer()
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, delay)
  }

  async function flush(): Promise<void> {
    if (inFlight) return
    // 优先重试失败 batch；否则取 buffer 前 maxBatchSize 条
    const batch = pendingRetry?.events ?? buffer.slice(0, maxBatchSize)
    if (batch.length === 0) {
      pendingRetry = null
      return
    }
    if (!pendingRetry) {
      buffer = buffer.slice(batch.length)
    }
    inFlight = true
    try {
      adapter.send(batch)
      pendingRetry = null
    } catch (e) {
      const attempt = (pendingRetry?.attempt ?? 0) + 1
      if (attempt > maxRetries) {
        // 放弃：永不阻断业务，仅记录
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('[analytics-queue] drop_after_retries', {
            count: batch.length,
            attempt,
            error: e instanceof Error ? e.message : String(e),
          })
        }
        pendingRetry = null
      } else {
        pendingRetry = { events: batch, attempt }
        const delay = baseBackoffMs * Math.pow(2, attempt - 1)
        inFlight = false
        scheduleFlush(delay)
        return
      }
    }
    inFlight = false
    if (buffer.length > 0) {
      scheduleFlush(flushIntervalMs)
    }
  }

  return {
    enqueue(event: TrackedEvent): void {
      buffer.push(event)
      if (buffer.length >= maxBatchSize) {
        clearFlushTimer()
        void flush()
      } else if (flushTimer === null && pendingRetry === null) {
        scheduleFlush(flushIntervalMs)
      }
    },
    flush,
    get bufferSize(): number {
      return buffer.length
    },
    get pendingRetryAttempt(): number | null {
      return pendingRetry?.attempt ?? null
    },
  }
}
