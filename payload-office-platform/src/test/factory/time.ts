/**
 * 时间冻结与 Asia/Shanghai 边界测试 fixture
 *
 * 业务约束（AGENTS.md §5.6, §6.5）：
 *   - 数据库存储 UTC，产品显示和自然日统计使用 Asia/Shanghai
 *   - SLA 扫描固定同一 as_of 和 Asia/Shanghai 时间边界
 *
 * 测试场景：
 *   - 跨 UTC 日界（UTC 16:00 = 上海 00:00）
 *   - 月初 / 月末边界
 *   - 跨年边界
 *   - SLA 时限锚点：分配时限 7200s / 首次跟进 14400s / 公海回收 259200s / 30 天去重窗口 2592000s
 */

import { shanghaiDate, shanghaiDayEndUtc, shanghaiDayStartUtc } from '@/domain/shared/time'

export type FrozenClock = {
  /** UTC ISO 字符串 */
  utc: string
  /** 上海自然日 YYYY-MM-DD */
  shanghaiDay: string
  /** 上海自然日 00:00 上海对应 UTC（前一日 16:00 UTC） */
  shanghaiDayStartUtc: string
  /** 上海自然日 23:59:59.999 上海对应 UTC */
  shanghaiDayEndUtc: string
  /** 描述 */
  description: string
}

/**
 * 关键时间锚点 fixture
 *
 * 所有时刻都是 UTC，对应上海时区（UTC+8）的可读时间在 description 中说明。
 */
export const FROZEN_CLOCKS: Readonly<Record<string, FrozenClock>> = Object.freeze({
  // 上海 2026-03-15 18:30:00 → 用于一般场景
  'shanghai-2026-03-15-evening': {
    utc: '2026-03-15T10:30:00.000Z',
    shanghaiDay: '2026-03-15',
    shanghaiDayStartUtc: '2026-03-14T16:00:00.000Z',
    shanghaiDayEndUtc: '2026-03-15T15:59:59.999Z',
    description: '上海 2026-03-15 18:30:00',
  },
  // 上海自然日开始（UTC 前一日 16:00）
  'shanghai-day-start': {
    utc: '2026-03-15T16:00:00.000Z',
    shanghaiDay: '2026-03-16',
    shanghaiDayStartUtc: '2026-03-15T16:00:00.000Z',
    shanghaiDayEndUtc: '2026-03-16T15:59:59.999Z',
    description: '上海 2026-03-16 00:00:00（自然日开始）',
  },
  // 上海自然日结束前一秒
  'shanghai-day-end': {
    utc: '2026-03-16T15:59:59.000Z',
    shanghaiDay: '2026-03-16',
    shanghaiDayStartUtc: '2026-03-15T16:00:00.000Z',
    shanghaiDayEndUtc: '2026-03-16T15:59:59.999Z',
    description: '上海 2026-03-16 23:59:59（自然日结束前一秒）',
  },
  // 上海自然日结束下一秒（属于次日）
  'shanghai-next-day-start': {
    utc: '2026-03-16T16:00:00.000Z',
    shanghaiDay: '2026-03-17',
    shanghaiDayStartUtc: '2026-03-16T16:00:00.000Z',
    shanghaiDayEndUtc: '2026-03-17T15:59:59.999Z',
    description: '上海 2026-03-17 00:00:00（跨日）',
  },
  // 月初边界
  'month-start': {
    utc: '2026-04-30T16:00:00.000Z',
    shanghaiDay: '2026-05-01',
    shanghaiDayStartUtc: '2026-04-30T16:00:00.000Z',
    shanghaiDayEndUtc: '2026-05-01T15:59:59.999Z',
    description: '上海 2026-05-01 00:00:00（月初）',
  },
  // 跨年边界
  'year-start': {
    utc: '2025-12-31T16:00:00.000Z',
    shanghaiDay: '2026-01-01',
    shanghaiDayStartUtc: '2025-12-31T16:00:00.000Z',
    shanghaiDayEndUtc: '2026-01-01T15:59:59.999Z',
    description: '上海 2026-01-01 00:00:00（跨年）',
  },
})

/** 按 key 获取冻结时钟 */
export function getFrozenClock(key: keyof typeof FROZEN_CLOCKS): FrozenClock {
  return FROZEN_CLOCKS[key]
}

/** 生成 SLA 时限锚点：基于给定起始时刻，返回各时限的到期 UTC 时刻 */
export function generateSlaAnchors(startUtc: string): {
  start: string
  assignDeadline: string // 7200s = 2h
  firstFollowUpDeadline: string // 14400s = 4h
  publicSeaReclaimDeadline: string // 259200s = 72h
  duplicateWindowEnd: string // 2592000s = 30d
} {
  const start = new Date(startUtc).getTime()
  return {
    start: startUtc,
    assignDeadline: new Date(start + 7200 * 1000).toISOString(),
    firstFollowUpDeadline: new Date(start + 14400 * 1000).toISOString(),
    publicSeaReclaimDeadline: new Date(start + 259200 * 1000).toISOString(),
    duplicateWindowEnd: new Date(start + 2592000 * 1000).toISOString(),
  }
}

/**
 * MVP-R1 参数快照（AGENTS.md §5.4）
 *
 * 业务不变量：
 *   - 不得只读取当前默认值，也不得在本期通过字典或普通后台配置修改这些参数
 *   - 线索分配、认领、SLA 和回收必须保存这些参数快照
 */
export const MVP_R1_POLICY = Object.freeze({
  runtime_policy_version: 'MVP-R1',
  assign_deadline_seconds: 7200,
  first_follow_up_deadline_seconds: 14400,
  claim_protection_seconds: 86400,
  no_follow_up_reclaim_seconds: 259200,
  duplicate_window_seconds: 2592000,
  daily_claim_limit: 20,
  active_lead_limit: 100,
  follow_up_correction_window_seconds: 86400,
})

export type MvpR1Policy = typeof MVP_R1_POLICY

/** 校验：上海自然日边界推算一致 */
export function assertShanghaiDayInvariant(clock: FrozenClock): void {
  const d = new Date(clock.utc)
  if (shanghaiDate(d) !== clock.shanghaiDay) {
    throw new Error(
      `shanghaiDay mismatch: expected ${clock.shanghaiDay}, got ${shanghaiDate(d)}`,
    )
  }
  if (shanghaiDayStartUtc(d).toISOString() !== clock.shanghaiDayStartUtc) {
    throw new Error(
      `shanghaiDayStartUtc mismatch: expected ${clock.shanghaiDayStartUtc}, got ${shanghaiDayStartUtc(d).toISOString()}`,
    )
  }
  if (shanghaiDayEndUtc(d).toISOString() !== clock.shanghaiDayEndUtc) {
    throw new Error(
      `shanghaiDayEndUtc mismatch: expected ${clock.shanghaiDayEndUtc}, got ${shanghaiDayEndUtc(d).toISOString()}`,
    )
  }
}
