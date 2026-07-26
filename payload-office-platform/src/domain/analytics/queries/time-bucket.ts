/**
 * 时间桶助手（tasks.md M7.3-M7.5 / R7）
 *
 * 职责：
 *   - 按 Asia/Shanghai 自然日生成 N 天的桶边界
 *   - 趋势查询使用这些桶做 per-day count
 *   - 所有桶使用 UTC ISO 表示，但边界按 Asia/Shanghai 切日
 *
 * 业务不变量：
 *   - 卡片 = 趋势桶之和（M7.6 一致性测试断言）
 *   - 时间边界按 Asia/Shanghai
 */

import { MetricBucket } from '../metric-types'

/** 北京时区偏移（分钟）。Asia/Shanghai = UTC+8。 */
const SHANGHAI_OFFSET_MIN = 8 * 60

/**
 * 把 Date 向下取整到 Asia/Shanghai 当日 00:00（返回 UTC Date）。
 *
 * 例如 2026-07-26T15:30:00Z（北京时间 23:30）→ 2026-07-26T16:00:00Z（北京时间次日 00:00）
 * 而 2026-07-26T14:00:00Z（北京时间 22:00）→ 2026-07-25T16:00:00Z（北京时间当日 00:00）。
 */
export function toShanghaiDayStart(input: Date): Date {
  const ms = input.getTime() + SHANGHAI_OFFSET_MIN * 60 * 1000
  const dayMs = Math.floor(ms / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
  return new Date(dayMs - SHANGHAI_OFFSET_MIN * 60 * 1000)
}

/**
 * 生成 N 天的桶边界（按 Asia/Shanghai 自然日）。
 *
 * 桶 i 覆盖 [dayStart - (n-1-i) days, dayStart - (n-2-i) days)，
 * 即桶 0 是 n 天前那一天，桶 n-1 是今天。
 *
 * @param asOf 基准时刻（通常 now）
 * @param n 桶数量（如 7 / 30）
 * @returns 桶数组 + 每个桶的 [start, end) UTC 区间
 */
export function buildDailyBuckets(
  asOf: Date,
  n: number,
): Array<{ label: string; start: Date; end: Date }> {
  const todayStart = toShanghaiDayStart(asOf)
  const dayMs = 24 * 60 * 60 * 1000
  const buckets: Array<{ label: string; start: Date; end: Date }> = []
  for (let i = 0; i < n; i++) {
    const offset = (n - 1 - i) * dayMs
    const start = new Date(todayStart.getTime() - offset)
    const end = new Date(start.getTime() + dayMs)
    // label 使用 Asia/Shanghai 当日日期 YYYY-MM-DD
    const label = formatShanghaiDate(start)
    buckets.push({ label, start, end })
  }
  return buckets
}

/**
 * 把 Date 格式化为 Asia/Shanghai 当日 YYYY-MM-DD。
 *
 * 不依赖 Intl（Node 18+ 已支持），用算术偏移避免 DST 问题（中国无 DST）。
 */
export function formatShanghaiDate(input: Date): string {
  const ms = input.getTime() + SHANGHAI_OFFSET_MIN * 60 * 1000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 把 buckets 转为 MetricBucket[]（value 初始 0）。
 *
 * 查询适配器逐桶 count 后填入 value。
 */
export function emptyBuckets(
  buckets: Array<{ label: string; start: Date; end: Date }>,
): MetricBucket[] {
  return buckets.map((b) => ({ label: b.label, value: 0 }))
}
