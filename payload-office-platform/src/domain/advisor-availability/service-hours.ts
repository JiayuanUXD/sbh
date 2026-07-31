/**
 * P2 Task 3：平台服务时间状态解析（纯函数）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 3
 *
 * 守护不变量：
 *   - 时区固定 Asia/Shanghai，用 Intl 解析当前星期/时刻（无外部依赖）
 *   - 时段边界：start 含、end 不含（[start, end)）
 *   - 节假日例外（按日期匹配）优先于常规周配置
 *   - 非服务时计算 nextOpenAt（向后最多扫 14 天，找下一个开门时刻的 ISO）
 *   - 只返回平台级 state/nextOpenAt/message，不含个人顾问信息
 *   - 纯函数，可独立单测（now 由调用方传入 ISO）
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** 时段 'HH:MM'（24 小时制），start 含、end 不含 */
export type TimeRange = Readonly<{ start: string; end: string }>

export type WeeklySchedule = Readonly<Record<Weekday, readonly TimeRange[]>>

/** 例外日：ranges 为空表示全天休息；非空则覆盖当天常规时段 */
export type HolidayException = Readonly<{ date: string; ranges: readonly TimeRange[] }>

export type ServiceSchedule = Readonly<{
  timezone: string
  weekly: WeeklySchedule
  holidays: readonly HolidayException[]
  openMessage: string
  closedMessage: string
}>

export type ServiceStatus = Readonly<{
  state: 'open' | 'closed'
  nextOpenAt: string | null
  message: string
}>

/** 上海时区某时刻的日历分解 */
export type ZonedParts = Readonly<{
  date: string // YYYY-MM-DD
  weekday: Weekday
  minutes: number // 自 00:00 起的分钟数
}>

/** 'HH:MM' -> 分钟数；非法返回 NaN */
export function parseHhmm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return NaN
  return Number(m[1]) * 60 + Number(m[2])
}

/** 用 Intl 把 ISO 时刻分解到指定时区的 date/weekday/minutes */
export function toZonedParts(iso: string, timeZone: string): ZonedParts {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  const weekdayMap: Record<string, Weekday> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const weekday = weekdayMap[get('weekday')] ?? 0
  return { date, weekday, minutes }
}

/** 取某日期在 schedule 下的有效时段（例外优先） */
export function rangesForDate(schedule: ServiceSchedule, date: string, weekday: Weekday): readonly TimeRange[] {
  const holiday = schedule.holidays.find((h) => h.date === date)
  if (holiday) return holiday.ranges
  return schedule.weekly[weekday] ?? []
}

/** 判断分钟数是否落在任一时段 [start, end) */
function isWithin(ranges: readonly TimeRange[], minutes: number): boolean {
  return ranges.some((r) => {
    const start = parseHhmm(r.start)
    const end = parseHhmm(r.end)
    return Number.isFinite(start) && Number.isFinite(end) && minutes >= start && minutes < end
  })
}

/**
 * 解析平台服务状态。now 为 ISO 时刻，timezone 默认取 schedule.timezone。
 */
export function resolveServiceStatus(
  schedule: ServiceSchedule,
  now: string,
): ServiceStatus {
  const tz = schedule.timezone
  const parts = toZonedParts(now, tz)
  const todayRanges = rangesForDate(schedule, parts.date, parts.weekday)

  if (isWithin(todayRanges, parts.minutes)) {
    return { state: 'open', nextOpenAt: null, message: schedule.openMessage }
  }
  const nextOpenAt = findNextOpen(schedule, now, tz)
  return { state: 'closed', nextOpenAt, message: schedule.closedMessage }
}

/**
 * 从 now 向后最多扫 14 天，找下一个开门时刻。
 * 当天剩余时段与后续每天的首个时段都考虑；找不到返回 null。
 */
function findNextOpen(schedule: ServiceSchedule, now: string, tz: string): string | null {
  const parts = toZonedParts(now, tz)
  // 当天：找 start > 当前分钟的最早时段
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const probe = addDaysZoned(now, tz, dayOffset)
    const ranges = [...rangesForDate(schedule, probe.date, probe.weekday)]
      .map((r) => parseHhmm(r.start))
      .filter((m) => Number.isFinite(m))
      .sort((a, b) => a - b)
    for (const startMin of ranges) {
      if (dayOffset === 0 && startMin <= parts.minutes) continue
      return zonedDateTimeToIso(probe.date, startMin, tz)
    }
  }
  return null
}

/** now 加 n 天后在 tz 下的 date/weekday（分钟数忽略） */
function addDaysZoned(now: string, tz: string, days: number): ZonedParts {
  const base = new Date(now)
  const shifted = new Date(base.getTime() + days * 86_400_000)
  return toZonedParts(shifted.toISOString(), tz)
}

/**
 * 把「tz 下的 date + 分钟数」转回 UTC ISO。Asia/Shanghai 恒 UTC+8（无 DST），
 * 用固定偏移换算；若未来支持其他时区需改用偏移探测。
 */
export function zonedDateTimeToIso(date: string, minutes: number, tz: string): string {
  const offsetMinutes = tzOffsetMinutes(tz)
  const [y, mo, d] = date.split('-').map(Number)
  const hh = Math.floor(minutes / 60)
  const mm = minutes % 60
  // 目标本地时刻对应的 UTC 毫秒 = Date.UTC(本地) - 偏移
  const utcMs = Date.UTC(y, mo - 1, d, hh, mm) - offsetMinutes * 60_000
  return new Date(utcMs).toISOString()
}

/** 时区固定偏移（分钟）。当前仅支持 Asia/Shanghai(+480)。 */
function tzOffsetMinutes(tz: string): number {
  if (tz === 'Asia/Shanghai') return 480
  // 兜底：用 Intl 探测（对无 DST 时区稳定）
  const probe = new Date('2026-01-01T00:00:00.000Z')
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
  const name = fmt.formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+8'
  const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(name)
  if (!m) return 480
  return Number(m[1]) * 60 + (m[1].startsWith('-') ? -Number(m[2] ?? 0) : Number(m[2] ?? 0))
}
