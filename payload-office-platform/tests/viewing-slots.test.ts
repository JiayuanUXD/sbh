/**
 * P2 Task 4 单测：待确认看房时段生成与校验
 *
 * 守护不变量：
 *   - 只生成未来 14 天内、落在服务时间内、30 分钟边界、持续 2 小时的时段
 *   - 每个时段 status 恒为 'pending-confirmation'（P2 不产生已确认预约）
 *   - 提交校验拒绝过期、非 30 分边界、非服务时段或非 2 小时的 slot
 *   - 时区固定 Asia/Shanghai
 */

import { describe, expect, it } from 'vitest'
import {
  buildViewingSlots,
  validateViewingPreference,
} from '@/domain/inquiry/viewing-slots'
import type { ServiceSchedule } from '@/domain/advisor-availability'

const WEEKDAY = [{ start: '09:00', end: '18:00' }]
const SCHEDULE: ServiceSchedule = {
  timezone: 'Asia/Shanghai',
  weekly: { 0: [], 1: WEEKDAY, 2: WEEKDAY, 3: WEEKDAY, 4: WEEKDAY, 5: WEEKDAY, 6: [] },
  holidays: [],
  openMessage: '当前服务中',
  closedMessage: '当前非服务时段',
}

// 2026-07-30 是周四
const NOW = '2026-07-30T00:00:00.000Z'

describe('buildViewingSlots', () => {
  it('只生成未来 14 天内落在服务时间的 2 小时时段', () => {
    const slots = buildViewingSlots(SCHEDULE, NOW)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((s) => s.durationMinutes === 120)).toBe(true)
    expect(slots.every((s) => s.status === 'pending-confirmation')).toBe(true)
  })

  it('所有时段起点在 30 分钟边界且不超过 14 天', () => {
    const slots = buildViewingSlots(SCHEDULE, NOW)
    const horizon = new Date(NOW).getTime() + 14 * 86_400_000
    for (const s of slots) {
      const startMs = new Date(s.startsAt).getTime()
      expect(startMs).toBeLessThanOrEqual(horizon)
      // 起止差 120 分钟
      expect(new Date(s.endsAt).getTime() - startMs).toBe(120 * 60_000)
    }
  })

  it('不生成周末时段', () => {
    const slots = buildViewingSlots(SCHEDULE, NOW)
    // 2026-08-01(六)/08-02(日) 不应出现
    const dates = slots.map((s) => s.startsAt.slice(0, 10))
    expect(dates).not.toContain('2026-08-01')
    expect(dates).not.toContain('2026-08-02')
  })
})

describe('validateViewingPreference', () => {
  it('接受服务时间内、30 分边界、2 小时、未来的 slot', () => {
    // 周五 2026-07-31 10:00-12:00 上海 = 02:00Z-04:00Z
    const pref = {
      startsAt: '2026-07-31T02:00:00.000Z',
      endsAt: '2026-07-31T04:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }
    expect(validateViewingPreference(pref, SCHEDULE, NOW)).toEqual({ ok: true })
  })

  it('拒绝过期 slot', () => {
    const expired = {
      startsAt: '2026-07-29T02:00:00.000Z', // NOW 之前
      endsAt: '2026-07-29T04:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }
    expect(validateViewingPreference(expired, SCHEDULE, NOW)).toEqual({
      ok: false,
      error: 'viewing_slot_invalid',
    })
  })

  it('拒绝非服务时段 slot（周日）', () => {
    const sunday = {
      startsAt: '2026-08-02T02:00:00.000Z',
      endsAt: '2026-08-02T04:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }
    expect(validateViewingPreference(sunday, SCHEDULE, NOW)).toEqual({
      ok: false,
      error: 'viewing_slot_invalid',
    })
  })

  it('拒绝非 2 小时时长', () => {
    const oneHour = {
      startsAt: '2026-07-31T02:00:00.000Z',
      endsAt: '2026-07-31T03:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }
    expect(validateViewingPreference(oneHour, SCHEDULE, NOW)).toEqual({
      ok: false,
      error: 'viewing_slot_invalid',
    })
  })

  it('拒绝超出服务时段末端的 slot（17:00-19:00 越过 18:00）', () => {
    // 周五 17:00-19:00 上海 = 09:00Z-11:00Z，末端越过 18:00
    const overrun = {
      startsAt: '2026-07-31T09:00:00.000Z',
      endsAt: '2026-07-31T11:00:00.000Z',
      timezone: 'Asia/Shanghai',
    }
    expect(validateViewingPreference(overrun, SCHEDULE, NOW)).toEqual({
      ok: false,
      error: 'viewing_slot_invalid',
    })
  })
})
