/**
 * P2 Task 3 单测：平台服务时间状态解析
 *
 * 守护不变量：
 *   - 时区固定 Asia/Shanghai（UTC+8）解析当前星期/时刻
 *   - 服务中/非服务时段按周时段判定；边界（开始时刻含、结束时刻不含）
 *   - 节假日例外优先于常规周配置
 *   - 非服务时返回 nextOpenAt（下一个开门时刻，ISO）
 *   - 只返回平台状态 state/nextOpenAt/message，不含个人顾问信息
 */

import { describe, expect, it } from 'vitest'
import {
  resolveServiceStatus,
  type ServiceSchedule,
} from '@/domain/advisor-availability/service-hours'

// 周一至周五 09:00-18:00，周末休息
const WEEKDAY_RANGES = [{ start: '09:00', end: '18:00' }]
const SCHEDULE: ServiceSchedule = {
  timezone: 'Asia/Shanghai',
  weekly: {
    0: [], // 周日
    1: WEEKDAY_RANGES,
    2: WEEKDAY_RANGES,
    3: WEEKDAY_RANGES,
    4: WEEKDAY_RANGES,
    5: WEEKDAY_RANGES,
    6: [], // 周六
  },
  holidays: [],
  openMessage: '当前服务中',
  closedMessage: '当前非服务时段',
}

// 国庆 2026-10-01 全天休息（例外优先）
const HOLIDAY_SCHEDULE: ServiceSchedule = {
  ...SCHEDULE,
  holidays: [{ date: '2026-10-01', ranges: [] }],
}

describe('resolveServiceStatus', () => {
  it('周一 09:00 开始时为服务中', () => {
    // 2026-08-03T01:00:00Z = 周一 09:00 Asia/Shanghai
    expect(resolveServiceStatus(SCHEDULE, '2026-08-03T01:00:00.000Z')).toMatchObject({
      state: 'open',
    })
  })

  it('结束时刻不含（18:00 已闭）', () => {
    // 2026-08-03T10:00:00Z = 周一 18:00 Asia/Shanghai
    expect(resolveServiceStatus(SCHEDULE, '2026-08-03T10:00:00.000Z')).toMatchObject({
      state: 'closed',
    })
  })

  it('周日为非服务时段', () => {
    // 2026-08-02 为周日
    expect(resolveServiceStatus(SCHEDULE, '2026-08-02T03:00:00.000Z').state).toBe('closed')
  })

  it('节假日优先于常规周配置', () => {
    // 2026-10-01 是周四（常规 09:00-18:00），但设为节假日全天休息
    expect(resolveServiceStatus(HOLIDAY_SCHEDULE, '2026-10-01T03:00:00.000Z')).toMatchObject({
      state: 'closed',
    })
  })

  it('非服务时返回下一个开门时刻', () => {
    // 周日 03:00Z（11:00 上海）休息 -> 下一个开门是周一 09:00 上海 = 2026-08-03T01:00Z
    const status = resolveServiceStatus(SCHEDULE, '2026-08-02T03:00:00.000Z')
    expect(status.state).toBe('closed')
    expect(status.nextOpenAt).toBe('2026-08-03T01:00:00.000Z')
  })

  it('服务中时 nextOpenAt 为 null', () => {
    const status = resolveServiceStatus(SCHEDULE, '2026-08-03T01:00:00.000Z')
    expect(status.nextOpenAt).toBeNull()
  })

  it('返回不含个人顾问字段', () => {
    const status = resolveServiceStatus(SCHEDULE, '2026-08-03T01:00:00.000Z')
    expect(Object.keys(status).sort()).toEqual(['message', 'nextOpenAt', 'state'])
  })
})
