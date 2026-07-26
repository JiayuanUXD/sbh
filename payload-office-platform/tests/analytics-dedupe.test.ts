import { describe, expect, it } from 'vitest'
import { createDeduper } from '@/lib/frontend/analytics/dedupe'

describe('OPT-010 dedupe', () => {
  it('窗口 0 -> 永不去重', () => {
    const now = jest_now([1000, 1000, 1000])
    const d = createDeduper({ defaultWindowMs: 0, now })
    expect(d.shouldDrop('inquiry_submit', 'a=1')).toBe(false)
    expect(d.shouldDrop('inquiry_submit', 'a=1')).toBe(false)
    expect(d.shouldDrop('inquiry_submit', 'a=1')).toBe(false)
  })

  it('窗口内同指纹 -> 第二次起丢弃', () => {
    const ticks = [1000, 1500, 1999]
    const now = jest_now(ticks)
    const d = createDeduper({ windows: { inquiry_open: 2000 }, now })
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(false) // 1000 首次
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(true) // 1500 窗口内
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(true) // 1999 仍在窗口
  })

  it('窗口外 -> 放行并重置窗口', () => {
    const ticks = [1000, 3001]
    const now = jest_now(ticks)
    const d = createDeduper({ windows: { inquiry_open: 2000 }, now })
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(false) // 1000
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(false) // 3001 超出窗口
  })

  it('不同属性指纹 -> 不去重', () => {
    const now = jest_now([1000, 1000])
    const d = createDeduper({ windows: { inquiry_open: 2000 }, now })
    expect(d.shouldDrop('inquiry_open', 'page_type=listing')).toBe(false)
    expect(d.shouldDrop('inquiry_open', 'page_type=building')).toBe(false)
  })

  it('不同事件名同属性 -> 不去重（指纹含事件名）', () => {
    const now = jest_now([1000, 1000])
    const d = createDeduper({ defaultWindowMs: 2000, now })
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(false)
    expect(d.shouldDrop('inquiry_submit', 'a=1')).toBe(false)
  })

  it('未配置窗口的事件 -> 用 defaultWindowMs', () => {
    const now = jest_now([1000, 1500])
    const d = createDeduper({ defaultWindowMs: 2000, now })
    expect(d.shouldDrop('inquiry_submit', 'a=1')).toBe(false)
    expect(d.shouldDrop('inquiry_submit', 'a=1')).toBe(true)
  })

  it('reset 后窗口清空', () => {
    const now = jest_now([1000, 1000])
    const d = createDeduper({ windows: { inquiry_open: 2000 }, now })
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(false)
    d.reset()
    expect(d.shouldDrop('inquiry_open', 'a=1')).toBe(false)
  })
})

/** 按调用顺序返回时间戳的假时钟 */
function jest_now(ticks: number[]): () => number {
  let i = 0
  return () => ticks[i++] ?? ticks[ticks.length - 1]
}
