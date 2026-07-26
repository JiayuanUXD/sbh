import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createQueue } from '@/lib/frontend/analytics/queue'
import type { AnalyticsAdapter, TrackedEvent } from '@/lib/frontend/analytics/adapter'

function makeEvent(name: 'inquiry_open' = 'inquiry_open', ts = 0): TrackedEvent {
  return { eventName: name, props: { page_type: 'listing' }, timestamp: ts }
}

describe('OPT-010 queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('攒满 maxBatchSize -> 立即 flush，adapter.send 收到整批', async () => {
    const send = vi.fn()
    const adapter: AnalyticsAdapter = { name: 'test', send }
    const queue = createQueue(adapter, { maxBatchSize: 2, flushIntervalMs: 9999 })
    queue.enqueue(makeEvent(undefined, 1))
    queue.enqueue(makeEvent(undefined, 2)) // 攒满 -> 触发 flush
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(2)
    expect(queue.bufferSize).toBe(0)
  })

  it('未攒满 -> 定时 flush（推进 interval 后发送）', async () => {
    const send = vi.fn()
    const adapter: AnalyticsAdapter = { name: 'test', send }
    const queue = createQueue(adapter, { maxBatchSize: 10, flushIntervalMs: 5000 })
    queue.enqueue(makeEvent(undefined, 1))
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(1)
  })

  it('send 抛错 -> 指数退避重试至 maxRetries 后放弃', async () => {
    const send = vi.fn(() => {
      throw new Error('network')
    })
    const adapter: AnalyticsAdapter = { name: 'fail', send }
    const queue = createQueue(adapter, {
      maxBatchSize: 1,
      maxRetries: 2,
      baseBackoffMs: 100,
      flushIntervalMs: 9999,
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    queue.enqueue(makeEvent(undefined, 1)) // 攒满 -> 首次 flush
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect(queue.pendingRetryAttempt).toBe(1)

    await vi.advanceTimersByTimeAsync(100) // 第 1 次重试（退避 100）
    expect(send).toHaveBeenCalledTimes(2)
    expect(queue.pendingRetryAttempt).toBe(2)

    await vi.advanceTimersByTimeAsync(200) // 第 2 次重试（退避 200），超过 maxRetries 放弃
    expect(send).toHaveBeenCalledTimes(3)
    expect(queue.pendingRetryAttempt).toBeNull()
    // 放弃时 console.error 上报，不抛错
    expect(errSpy).toHaveBeenCalled()
    const msg = JSON.stringify(errSpy.mock.calls[0])
    expect(msg).toContain('drop_after_retries')
    errSpy.mockRestore()
  })

  it('重试期间新事件继续入 buffer，不与失败 batch 混合', async () => {
    const calls: number[] = []
    let fail = true
    const send = vi.fn((events: readonly TrackedEvent[]) => {
      calls.push(events.length)
      if (fail) throw new Error('network')
    })
    const adapter: AnalyticsAdapter = { name: 'fail-then-ok', send }
    const queue = createQueue(adapter, {
      maxBatchSize: 2,
      maxRetries: 3,
      baseBackoffMs: 100,
      flushIntervalMs: 9999,
    })
    queue.enqueue(makeEvent(undefined, 1))
    await queue.flush() // [e1] 失败 -> pendingRetry attempt 1，schedule 重试 100ms
    expect(queue.pendingRetryAttempt).toBe(1)
    // 重试期间入队新事件（maxBatchSize=2，不会触发 flush）
    queue.enqueue(makeEvent(undefined, 2))
    expect(queue.bufferSize).toBe(1) // 新事件在 buffer，未与失败 batch 混合

    fail = false
    await vi.advanceTimersByTimeAsync(100) // 重试 flush -> 失败 batch [e1] 成功
    expect(queue.pendingRetryAttempt).toBeNull()
    // 重试只发送了失败 batch [e1]，新事件 [e2] 仍在 buffer
    expect(calls).toEqual([1, 1])
    expect(queue.bufferSize).toBe(1)
  })

  it('queue 永不向业务抛错（send 抛错被吞）', async () => {
    const send = vi.fn(() => {
      throw new Error('boom')
    })
    const adapter: AnalyticsAdapter = { name: 'fail', send }
    const queue = createQueue(adapter, { maxBatchSize: 1, maxRetries: 1, baseBackoffMs: 50 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => queue.enqueue(makeEvent(undefined, 1))).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(50) // 重试超限放弃
    expect(() => queue.flush()).not.toThrow()
  })
})
