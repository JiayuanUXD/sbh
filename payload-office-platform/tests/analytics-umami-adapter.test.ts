/**
 * UmamiAdapter 与接入配置解析（OPT-064）
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createUmamiAdapter } from '@/lib/frontend/analytics/adapter'
import { resolveUmamiConfig } from '@/lib/frontend/analytics/umami-config'
import { createQueue } from '@/lib/frontend/analytics/queue'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  Reflect.deleteProperty(globalThis, 'window')
  vi.useRealTimers()
})

function stubWindow(umami?: unknown): void {
  Reflect.set(globalThis, 'window', umami === undefined ? {} : { umami })
}

describe('createUmamiAdapter', () => {
  it('就绪时逐条转发给 window.umami.track', () => {
    const track = vi.fn()
    stubWindow({ track })
    createUmamiAdapter().send([
      { eventName: 'inquiry_open', props: { page_type: 'listing' }, timestamp: 1 },
      { eventName: 'correction_open', props: { target_type: 'listing' }, timestamp: 2 },
    ] as never)

    expect(track).toHaveBeenCalledTimes(2)
    expect(track).toHaveBeenNthCalledWith(1, 'inquiry_open', { page_type: 'listing' })
    expect(track).toHaveBeenNthCalledWith(2, 'correction_open', { target_type: 'listing' })
  })

  it('window.umami 不存在时抛错（交给队列重试，不是丢弃）', () => {
    stubWindow()
    expect(() => createUmamiAdapter().send([] as never)).toThrow(/not ready/)
  })

  it('window.umami 存在但 track 不是函数也算未就绪', () => {
    // 防御脚本被广告拦截器替换成空对象这类情形
    stubWindow({ track: 'nope' })
    expect(() => createUmamiAdapter().send([] as never)).toThrow(/not ready/)
  })

  it('SSR（无 window）抛错而不是崩', () => {
    Reflect.deleteProperty(globalThis, 'window')
    expect(() => createUmamiAdapter().send([] as never)).toThrow(/not ready/)
  })

  it('脚本晚到时事件不丢：首次失败后重试成功', async () => {
    vi.useFakeTimers()
    stubWindow() // 脚本还没加载
    const adapter = createUmamiAdapter()
    const queue = createQueue(adapter, { maxBatchSize: 1, baseBackoffMs: 10 })

    queue.enqueue({ eventName: 'landing_view', props: { page_type: 'entrust' }, timestamp: 1 } as never)
    await vi.advanceTimersByTimeAsync(0)
    // 首次投递失败，事件进入重试队列而不是被丢弃
    expect(queue.pendingRetryAttempt).toBe(1)

    // 脚本此时就绪
    const track = vi.fn()
    stubWindow({ track })
    await vi.advanceTimersByTimeAsync(20)

    expect(track).toHaveBeenCalledWith('landing_view', { page_type: 'entrust' })
    expect(queue.pendingRetryAttempt).toBeNull()
  })
})

describe('resolveUmamiConfig', () => {
  it('三项齐备时返回配置', () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = 'true'
    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example.com'
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'abc-123'
    expect(resolveUmamiConfig()).toEqual({
      src: 'https://umami.example.com',
      websiteId: 'abc-123',
      heatmap: false,
    })
  })

  it('去掉 src 末尾斜杠，避免拼出双斜杠', () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = '1'
    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example.com//'
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'abc-123'
    expect(resolveUmamiConfig()?.src).toBe('https://umami.example.com')
  })

  it('开关未开时返回 null（代码已合、Umami 未部署 = 安静的中间状态）', () => {
    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example.com'
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'abc-123'
    delete process.env.NEXT_PUBLIC_ANALYTICS_ENABLED
    expect(resolveUmamiConfig()).toBeNull()
  })

  it('开关开了但 src / websiteId 缺任一项也返回 null', () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = 'true'
    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example.com'
    delete process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
    expect(resolveUmamiConfig()).toBeNull()
  })

  it('只认 true / 1，不认 yes / on 这类近似值', () => {
    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example.com'
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'abc-123'
    for (const v of ['yes', 'on', 'TRUE', '']) {
      process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = v
      expect(resolveUmamiConfig(), `flag=${v}`).toBeNull()
    }
  })

  it('热图开关独立于总开关', () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = 'true'
    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example.com'
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'abc-123'
    process.env.NEXT_PUBLIC_UMAMI_HEATMAP = 'true'
    expect(resolveUmamiConfig()?.heatmap).toBe(true)
  })
})
