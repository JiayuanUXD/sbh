import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createCollector } from '@/lib/frontend/analytics/collector'
import type { AnalyticsAdapter } from '@/lib/frontend/analytics/adapter'

describe('OPT-010 collector 集成', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('未知事件 -> 丢弃，不入队', async () => {
    const send = vi.fn()
    const adapter: AnalyticsAdapter = { name: 't', send }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = createCollector(adapter, { maxBatchSize: 1, flushIntervalMs: 9999 })
    c.track('inquiry_bogus', { page_type: 'listing' })
    await c.flush()
    expect(send).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('inquiry_open 窗口内重复 -> 去重，只发送一次', async () => {
    const send = vi.fn()
    const adapter: AnalyticsAdapter = { name: 't', send }
    const c = createCollector(adapter, {
      maxBatchSize: 10,
      flushIntervalMs: 9999,
      dedupe: { windows: { inquiry_open: 2000 } },
    })
    c.track('inquiry_open', { page_type: 'listing', target_type: 'listing', has_target: true })
    c.track('inquiry_open', { page_type: 'listing', target_type: 'listing', has_target: true })
    c.track('inquiry_open', { page_type: 'listing', target_type: 'listing', has_target: true })
    await c.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(1)
  })

  it('白名单外属性 -> 入队前剥离', async () => {
    const send = vi.fn()
    const adapter: AnalyticsAdapter = { name: 't', send }
    const c = createCollector(adapter, { maxBatchSize: 1, flushIntervalMs: 9999 })
    c.track('inquiry_submit', {
      page_type: 'listing',
      target_type: 'listing',
      name: '张三', // PII，必须剥离
      phone: '13800000000', // PII，必须剥离
    })
    await c.flush()
    const sent = send.mock.calls[0][0][0]
    expect(sent.props).toEqual({ page_type: 'listing', target_type: 'listing' })
    expect(sent.props).not.toHaveProperty('name')
    expect(sent.props).not.toHaveProperty('phone')
  })

  it('非曝光事件不去重（多次 submit 均发送）', async () => {
    const send = vi.fn()
    const adapter: AnalyticsAdapter = { name: 't', send }
    const c = createCollector(adapter, { maxBatchSize: 10, flushIntervalMs: 9999 })
    c.track('inquiry_submit', { page_type: 'listing', target_type: 'listing' })
    c.track('inquiry_submit', { page_type: 'listing', target_type: 'listing' })
    await c.flush()
    expect(send.mock.calls[0][0]).toHaveLength(2)
  })

  it('正常事件带时间戳入队', async () => {
    const send = vi.fn()
    const adapter: AnalyticsAdapter = { name: 't', send }
    const c = createCollector(adapter, { maxBatchSize: 1, flushIntervalMs: 9999, now: () => 12345 })
    c.track('inquiry_success', { page_type: 'listing', target_type: 'listing', idempotent: false })
    await c.flush()
    const sent = send.mock.calls[0][0][0]
    expect(sent.eventName).toBe('inquiry_success')
    expect(sent.timestamp).toBe(12345)
  })
})
