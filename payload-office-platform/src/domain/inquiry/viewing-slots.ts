/**
 * P2 Task 4：待确认看房时段生成与校验（纯函数）
 *
 * 守护不变量：
 *   - 只生成未来 14 天内、落在服务时间内、30 分钟边界、持续 2 小时的时段
 *   - status 恒 'pending-confirmation'；P2 不产生已确认预约
 *   - 校验在提交瞬间复核：过期 / 非 30 分边界 / 非服务时段 / 非 2 小时 -> viewing_slot_invalid
 *   - 时区来自 schedule；起止用 UTC ISO 存储
 *   - 复用 advisor-availability 的时区/时段纯函数，避免逻辑漂移
 */

import {
  parseHhmm,
  rangesForDate,
  toZonedParts,
  zonedDateTimeToIso,
  type ServiceSchedule,
} from '@/domain/advisor-availability'

/** 看房时段固定时长（分钟） */
export const VIEWING_SLOT_DURATION_MINUTES = 120
/** 生成时段的边界步进（分钟） */
const SLOT_STEP_MINUTES = 30
/** 生成时段的时间范围（天） */
const HORIZON_DAYS = 14

export type ViewingSlot = Readonly<{
  startsAt: string // UTC ISO
  endsAt: string // UTC ISO
  timezone: string
  durationMinutes: number
  status: 'pending-confirmation'
}>

export type ViewingPreferenceInput = Readonly<{
  startsAt: string
  endsAt: string
  timezone: string
}>

export type ValidateViewingResult =
  | { ok: true }
  | { ok: false; error: 'viewing_slot_invalid' }

/**
 * 生成未来 HORIZON_DAYS 天内所有合法看房时段。
 * 每天在其服务时段内，从 start 起以 30 分步进，凑满 2 小时且不越过 end。
 */
export function buildViewingSlots(schedule: ServiceSchedule, now: string): ViewingSlot[] {
  const tz = schedule.timezone
  const nowMs = new Date(now).getTime()
  const horizonMs = nowMs + HORIZON_DAYS * 86_400_000
  const slots: ViewingSlot[] = []
  for (let dayOffset = 0; dayOffset <= HORIZON_DAYS; dayOffset += 1) {
    const probe = toZonedParts(new Date(nowMs + dayOffset * 86_400_000).toISOString(), tz)
    const ranges = rangesForDate(schedule, probe.date, probe.weekday)
    for (const range of ranges) {
      const startMin = parseHhmm(range.start)
      const endMin = parseHhmm(range.end)
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue
      // 对齐到 30 分边界的起点，逐步凑满 2 小时且末端 <= 服务时段末端
      for (let m = startMin; m + VIEWING_SLOT_DURATION_MINUTES <= endMin; m += SLOT_STEP_MINUTES) {
        const startsAt = zonedDateTimeToIso(probe.date, m, tz)
        const startTs = new Date(startsAt).getTime()
        // 只保留未来且在 14 天窗口内的时段
        if (startTs <= nowMs || startTs > horizonMs) continue
        slots.push({
          startsAt,
          endsAt: new Date(startTs + VIEWING_SLOT_DURATION_MINUTES * 60_000).toISOString(),
          timezone: tz,
          durationMinutes: VIEWING_SLOT_DURATION_MINUTES,
          status: 'pending-confirmation',
        })
      }
    }
  }
  return slots
}

/**
 * 提交瞬间复核偏好时段是否仍合法：
 *   - 未来（startsAt > now）
 *   - 时长恰为 2 小时
 *   - 起点在 30 分边界
 *   - 整段落在当天服务时段内（末端不越过 end）
 */
export function validateViewingPreference(
  pref: ViewingPreferenceInput,
  schedule: ServiceSchedule,
  now: string,
): ValidateViewingResult {
  const invalid: ValidateViewingResult = { ok: false, error: 'viewing_slot_invalid' }
  const startTs = new Date(pref.startsAt).getTime()
  const endTs = new Date(pref.endsAt).getTime()
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return invalid
  // 未来
  if (startTs <= new Date(now).getTime()) return invalid
  // 时长恰 2 小时
  if (endTs - startTs !== VIEWING_SLOT_DURATION_MINUTES * 60_000) return invalid

  const tz = schedule.timezone
  const parts = toZonedParts(pref.startsAt, tz)
  // 30 分边界
  if (parts.minutes % SLOT_STEP_MINUTES !== 0) return invalid
  // 落在当天服务时段内（起点 >= start 且 起点+120 <= end）
  const ranges = rangesForDate(schedule, parts.date, parts.weekday)
  const fits = ranges.some((r) => {
    const s = parseHhmm(r.start)
    const e = parseHhmm(r.end)
    return (
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      parts.minutes >= s &&
      parts.minutes + VIEWING_SLOT_DURATION_MINUTES <= e
    )
  })
  return fits ? { ok: true } : invalid
}
