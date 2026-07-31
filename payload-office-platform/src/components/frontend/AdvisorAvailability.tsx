/**
 * P2 Task 3：平台顾问服务状态展示（服务端组件）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 3
 *
 * 守护不变量：
 *   - 只显示平台级服务状态（服务中 / 非服务时段 + 下次恢复时间）
 *   - 不显示个人顾问手机号、精确排班、在线状态或个人信息
 *   - global 不可用（未配置 / DB 错误）时静默降级（不渲染），不阻断页面
 *   - 时区固定 Asia/Shanghai
 */

import { getPayload } from 'payload'
import config from '@/payload.config'
import {
  resolveServiceStatus,
  type ServiceSchedule,
  type TimeRange,
  type Weekday,
} from '@/domain/advisor-availability'

/** 把 Payload global doc 映射为 ServiceSchedule（类型安全转换） */
function toServiceSchedule(doc: Record<string, unknown>): ServiceSchedule | null {
  try {
    const timezone = typeof doc.timezone === 'string' ? doc.timezone : 'Asia/Shanghai'
    const rawHours = Array.isArray(doc.weeklyHours) ? doc.weeklyHours : []
    const weekly: Record<Weekday, TimeRange[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
    for (const row of rawHours) {
      if (!row || typeof row !== 'object') continue
      const day = Number((row as Record<string, unknown>).day) as Weekday
      if (!Number.isInteger(day) || day < 0 || day > 6) continue
      const start = (row as Record<string, unknown>).start
      const end = (row as Record<string, unknown>).end
      if (typeof start !== 'string' || typeof end !== 'string') continue
      weekly[day].push({ start, end })
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
  } catch {
    return null
  }
}

/** 把 nextOpenAt ISO 格式化为可读中文时间（Asia/Shanghai） */
function formatNextOpenAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

export default async function AdvisorAvailability() {
  try {
    const payload = await getPayload({ config })
    const doc = await payload.findGlobal({ slug: 'advisor-service-hours', depth: 1, overrideAccess: true })
    const schedule = toServiceSchedule(doc as unknown as Record<string, unknown>)
    if (!schedule) return null
    const status = resolveServiceStatus(schedule, new Date().toISOString())
    return (
      <div className="advisor-availability" data-state={status.state}>
        {status.state === 'open' ? (
          <span className="advisor-availability__status advisor-availability__status--open">
            {status.message}
          </span>
        ) : (
          <span className="advisor-availability__status advisor-availability__status--closed">
            {status.message}
            {status.nextOpenAt && (
              <>,&nbsp;预计 {formatNextOpenAt(status.nextOpenAt)} 恢复</>
            )}
          </span>
        )}
      </div>
    )
  } catch {
    // global 未配置或 DB 不可用：静默降级，不阻断页面
    return null
  }
}
