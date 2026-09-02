/**
 * `page_engagement` 计时与分桶（OPT-064）
 *
 * 计时账本刻意做成纯逻辑、时钟由调用方注入，所以这里不需要 fake timer，
 * 直接喂时间戳断言即可——那些用 `vi.advanceTimersByTime` 写的计时测试
 * 往往只证明了「定时器被调用了」，证明不了「算出来的数对不对」。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  ACTIVE_CAP_MS,
  IDLE_TIMEOUT_MS,
  computeScrollPercent,
  createEngagementAccountant,
  createEngagementTracker,
  isEngagementPageType,
  resolveEngagementPageType,
  toScrollBucket,
} from '@/lib/frontend/analytics/engagement'

describe('toScrollBucket', () => {
  it('向下取到最近的桶', () => {
    expect(toScrollBucket(0)).toBe(0)
    expect(toScrollBucket(24.9)).toBe(0)
    expect(toScrollBucket(25)).toBe(25)
    expect(toScrollBucket(74)).toBe(50)
    expect(toScrollBucket(89.9)).toBe(75)
    expect(toScrollBucket(90)).toBe(90)
    expect(toScrollBucket(100)).toBe(90)
  })

  it('非有限值退化为 0 而不是抛错', () => {
    expect(toScrollBucket(Number.NaN)).toBe(0)
    expect(toScrollBucket(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('computeScrollPercent', () => {
  it('滚到底记 100', () => {
    expect(computeScrollPercent({ scrollY: 1200, innerHeight: 800, scrollHeight: 2000 })).toBe(100)
  })

  it('首屏未动时按可见比例算', () => {
    expect(computeScrollPercent({ scrollY: 0, innerHeight: 800, scrollHeight: 2000 })).toBe(40)
  })

  it('内容不足一屏记 100，不是 0', () => {
    // 短页面「整页都在视野内」，记 0 会和「进来就没往下看」混为一谈，
    // 而这两件事的业务含义完全相反。
    expect(computeScrollPercent({ scrollY: 0, innerHeight: 900, scrollHeight: 600 })).toBe(100)
  })

  it('异常尺寸不抛错', () => {
    expect(computeScrollPercent({ scrollY: 0, innerHeight: Number.NaN, scrollHeight: 100 })).toBe(0)
  })
})

describe('resolveEngagementPageType', () => {
  it('命中六类统计页面', () => {
    expect(resolveEngagementPageType('/shanghai/listings')).toBe('listings')
    expect(resolveEngagementPageType('/shanghai/buildings')).toBe('buildings')
  })

  it('不在六类内返回 null（首页、新闻页等不计）', () => {
    expect(resolveEngagementPageType('/shanghai')).toBeNull()
    expect(resolveEngagementPageType('/totally-unknown-path')).toBeNull()
  })

  it('isEngagementPageType 对非字符串安全', () => {
    expect(isEngagementPageType(null)).toBe(false)
    expect(isEngagementPageType('home')).toBe(false)
    expect(isEngagementPageType('listing-detail')).toBe(true)
  })
})

describe('createEngagementAccountant', () => {
  it('可见期间按真实经过时间累计', () => {
    const a = createEngagementAccountant(1000)
    expect(a.activeMs(6000)).toBe(5000)
  })

  it('空闲超过 60 秒后停表，不再增长', () => {
    const a = createEngagementAccountant(0)
    // 从未交互：只从进入页面那一刻算 60 秒
    expect(a.activeMs(IDLE_TIMEOUT_MS)).toBe(IDLE_TIMEOUT_MS)
    expect(a.activeMs(IDLE_TIMEOUT_MS + 300_000)).toBe(IDLE_TIMEOUT_MS)
  })

  it('空闲很久后再交互，只补计 60 秒而不是整段空闲', () => {
    const a = createEngagementAccountant(0)
    // 静置 5 分钟后动一下
    a.noteInteraction(300_000)
    // 前一段只应计入 60 秒（空闲上界），不是 300 秒
    expect(a.activeMs(300_000)).toBe(IDLE_TIMEOUT_MS)
    // 交互后重新起表
    expect(a.activeMs(310_000)).toBe(IDLE_TIMEOUT_MS + 10_000)
  })

  it('切到后台暂停计时，切回来继续', () => {
    const a = createEngagementAccountant(0)
    a.setVisible(false, 5_000)
    // 后台待 100 秒，一毫秒都不该计入
    expect(a.activeMs(105_000)).toBe(5_000)
    a.setVisible(true, 105_000)
    expect(a.activeMs(110_000)).toBe(10_000)
  })

  it('活跃时长有 30 分钟上限', () => {
    const a = createEngagementAccountant(0)
    // 持续交互 2 小时
    for (let t = 0; t <= 7_200_000; t += 30_000) a.noteInteraction(t)
    expect(a.activeMs(7_200_000)).toBe(ACTIVE_CAP_MS)
  })

  it('takeIncrement 报的是增量，不是累计', () => {
    const a = createEngagementAccountant(0)
    const first = a.takeIncrement(10_000)
    expect(first?.activeMs).toBe(10_000)
    a.noteInteraction(10_000)
    const second = a.takeIncrement(15_000)
    // 第二次只报新增的 5 秒；报 15 秒就会把前 10 秒重复计入
    expect(second?.activeMs).toBe(5_000)
  })

  it('增量不足 1 秒时不上报（避免路由抖动产生一堆 0ms 记录）', () => {
    const a = createEngagementAccountant(0)
    a.takeIncrement(10_000)
    expect(a.takeIncrement(10_500)).toBeNull()
  })

  it('scroll_bucket 记的是到达过的最大值，回滚不倒退', () => {
    const a = createEngagementAccountant(0)
    a.noteScrollPercent(80)
    a.noteScrollPercent(30)
    expect(a.scrollBucket()).toBe(75)
  })
})

describe('createEngagementTracker', () => {
  function setup(startAt = 0) {
    let clock = startAt
    const track = vi.fn()
    const tracker = createEngagementTracker({ track, now: () => clock })
    return { track, tracker, tick: (ms: number) => { clock += ms }, at: (v: number) => { clock = v } }
  }

  it('不在统计范围的页面不起表也不上报', () => {
    const { track, tracker, tick } = setup()
    tracker.enter('/shanghai') // 首页不在六类内
    expect(tracker.currentPageType).toBeNull()
    tick(30_000)
    tracker.flush()
    expect(track).not.toHaveBeenCalled()
  })

  it('flush 上报当前页增量', () => {
    const { track, tracker, tick } = setup()
    tracker.enter('/shanghai/listings')
    tick(12_000)
    tracker.flush()
    expect(track).toHaveBeenCalledWith('page_engagement', {
      page_type: 'listings',
      active_ms: 12_000,
      scroll_bucket: 0,
    })
  })

  it('路由变化先报上一页再对新页重新起表', () => {
    const { track, tracker, tick } = setup()
    tracker.enter('/shanghai/listings')
    tick(8_000)
    // 站内跳转到详情页：这是主路径上唯一的上报时机
    tracker.enter('/shanghai/listings/some-slug')
    expect(track).toHaveBeenCalledTimes(1)
    expect(track.mock.calls[0][1]).toMatchObject({ page_type: 'listings', active_ms: 8_000 })

    tick(20_000)
    tracker.flush()
    expect(track).toHaveBeenCalledTimes(2)
    // 新页从 0 开始计，不带上一页的 8 秒
    expect(track.mock.calls[1][1]).toMatchObject({
      page_type: 'listing-detail',
      active_ms: 20_000,
    })
  })

  it('切走再切回，两段时长都不丢且不重复', () => {
    const { track, tracker, tick } = setup()
    tracker.enter('/shanghai/listings')
    tick(10_000)
    tracker.setVisible(false)
    tracker.flush() // 切后台立刻结账
    tick(120_000) // 后台停留，不计
    tracker.setVisible(true)
    tick(7_000)
    tracker.flush()

    expect(track).toHaveBeenCalledTimes(2)
    expect(track.mock.calls[0][1]).toMatchObject({ active_ms: 10_000 })
    expect(track.mock.calls[1][1]).toMatchObject({ active_ms: 7_000 })
    // 两条求和 = 17 秒真实活跃时长，后台那 120 秒没被计入
  })

  it('滚动深度随最大值上报', () => {
    const { track, tracker, tick } = setup()
    tracker.enter('/shanghai/listings/x')
    tracker.noteScrollPercent(55)
    tick(5_000)
    tracker.flush()
    expect(track.mock.calls[0][1]).toMatchObject({ scroll_bucket: 50 })
  })
})
