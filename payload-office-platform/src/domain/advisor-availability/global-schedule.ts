/**
 * P2 Task 3/4：把 AdvisorServiceHours global doc 映射为 ServiceSchedule
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 3/4
 *
 * 守护不变量：
 *   - 纯映射，类型安全收窄；非法行静默跳过，缺省回退安全默认
 *   - 被 AdvisorAvailability 组件与 /api/inquiries 路由复用，避免逻辑漂移
 */

import type { ServiceSchedule, TimeRange, Weekday } from './service-hours'

export function mapGlobalToSchedule(doc: Record<string, unknown>): ServiceSchedule {
  const timezone = typeof doc.timezone === 'string' && doc.timezone ? doc.timezone : 'Asia/Shanghai'
  const weekly: Record<Weekday, TimeRange[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
  const rawHours = Array.isArray(doc.weeklyHours) ? doc.weeklyHours : []
  for (const row of rawHours) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const day = Number(r.day) as Weekday
    if (!Number.isInteger(day) || day < 0 || day > 6) continue
    if (typeof r.start !== 'string' || typeof r.end !== 'string') continue
    weekly[day].push({ start: r.start, end: r.end })
  }
  const rawHolidays = Array.isArray(doc.holidays) ? doc.holidays : []
  const holidays = rawHolidays
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map((h) => ({
      date: typeof h.date === 'string' ? h.date : '',
      ranges: Array.isArray(h.ranges)
        ? h.ranges
            .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
            .map((r) => ({ start: String(r.start ?? ''), end: String(r.end ?? '') }))
        : [],
    }))
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
  return {
    timezone,
    weekly: weekly as ServiceSchedule['weekly'],
    holidays,
    openMessage: typeof doc.openMessage === 'string' ? doc.openMessage : '当前服务中',
    closedMessage: typeof doc.closedMessage === 'string' ? doc.closedMessage : '当前非服务时段',
  }
}
