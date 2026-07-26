import { describe, it, expect, vi } from 'vitest'
import type { Collector } from '../src/lib/frontend/analytics/collector'
import { handleVitalReport, initWebVitals, type WebVitalsLib } from '../src/lib/frontend/analytics/web-vitals'

function makeCollector(): Collector & { calls: Array<{ name: string; props: Record<string, unknown> }> } {
  const calls: Array<{ name: string; props: Record<string, unknown> }> = []
  return {
    calls,
    track: (name: string, props: Record<string, unknown>) => calls.push({ name, props }),
    flush: () => Promise.resolve(),
  } as unknown as Collector & { calls: Array<{ name: string; props: Record<string, unknown> }> }
}

function makeMockLib(): WebVitalsLib & { handlers: Array<(m: { name: string; value: number }) => void> } {
  const handlers: Array<(m: { name: string; value: number }) => void> = []
  const register = () => (cb: (m: { name: string; value: number }) => void) => handlers.push(cb)
  return {
    handlers,
    onLCP: register(),
    onINP: register(),
    onCLS: register(),
    onTTFB: register(),
    onFCP: register(),
  }
}

describe('handleVitalReport', () => {
  it('对每个有效指标按 thresholds 评级并 track', () => {
    const c = makeCollector()
    handleVitalReport(c, 'LCP', 2400)
    handleVitalReport(c, 'INP', 480)
    handleVitalReport(c, 'CLS', 0.3)
    expect(c.calls).toEqual([
      { name: 'web_vital', props: { metric: 'LCP', value: 2400, rating: 'good' } },
      { name: 'web_vital', props: { metric: 'INP', value: 480, rating: 'needs-improvement' } },
      { name: 'web_vital', props: { metric: 'CLS', value: 0.3, rating: 'poor' } },
    ])
  })

  it('未知指标名不 track', () => {
    const c = makeCollector()
    handleVitalReport(c, 'UNKNOWN', 100)
    handleVitalReport(c, '', 0)
    expect(c.calls).toHaveLength(0)
  })
})

describe('initWebVitals', () => {
  it('向 5 个 on* 注册 handler，handler 触发时 track', async () => {
    const c = makeCollector()
    const lib = makeMockLib()
    await initWebVitals(c, lib)
    // 5 个订阅各注册了一个 handler
    expect(lib.handlers).toHaveLength(5)
    lib.handlers[0]({ name: 'LCP', value: 3000 })
    expect(c.calls).toEqual([
      { name: 'web_vital', props: { metric: 'LCP', value: 3000, rating: 'needs-improvement' } },
    ])
  })

  it('stop 后 handler 不再 track', async () => {
    const c = makeCollector()
    const lib = makeMockLib()
    const stop = await initWebVitals(c, lib)
    stop()
    lib.handlers[0]({ name: 'LCP', value: 3000 })
    expect(c.calls).toHaveLength(0)
  })
})
