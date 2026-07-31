/**
 * P2 Task 4：偏好看房时段选择器（客户端）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 4
 *
 * 守护不变量：
 *   - 标题固定"偏好看房时间（待顾问确认）"，明确非已确认预约
 *   - 客户端用默认服务时间（周一至五 09:00-18:00）生成候选，仅为交互；
 *     服务端用 AdvisorServiceHours 复核有效性（提交瞬间时段失效则 422）
 *   - 只产生偏好，不锁位；可清除选择（选填）
 *   - 时区固定 Asia/Shanghai
 */

'use client'

import { useMemo, useState } from 'react'
import {
  buildViewingSlots,
  type ViewingSlot,
} from '@/domain/inquiry/viewing-slots'
import type { ServiceSchedule } from '@/domain/advisor-availability'

export type SelectedViewingPreference = Readonly<{
  startsAt: string
  endsAt: string
  timezone: string
}>

/** 客户端默认服务时间（仅生成候选；服务端以 global 为准复核） */
const DEFAULT_SCHEDULE: ServiceSchedule = {
  timezone: 'Asia/Shanghai',
  weekly: {
    0: [],
    1: [{ start: '09:00', end: '18:00' }],
    2: [{ start: '09:00', end: '18:00' }],
    3: [{ start: '09:00', end: '18:00' }],
    4: [{ start: '09:00', end: '18:00' }],
    5: [{ start: '09:00', end: '18:00' }],
    6: [],
  },
  holidays: [],
  openMessage: '',
  closedMessage: '',
}

function groupByDate(slots: readonly ViewingSlot[], tz: string): Map<string, ViewingSlot[]> {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  })
  const map = new Map<string, ViewingSlot[]>()
  for (const slot of slots) {
    const label = fmt.format(new Date(slot.startsAt))
    const list = map.get(label) ?? []
    list.push(slot)
    map.set(label, list)
  }
  return map
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

export default function ViewingSlotPicker({
  value,
  onChange,
  nowIso,
}: Readonly<{
  value: SelectedViewingPreference | null
  onChange: (next: SelectedViewingPreference | null) => void
  /** 注入当前时间（测试可控）；默认取运行时 now */
  nowIso?: string
}>) {
  const tz = DEFAULT_SCHEDULE.timezone
  const grouped = useMemo(() => {
    const now = nowIso ?? new Date().toISOString()
    const slots = buildViewingSlots(DEFAULT_SCHEDULE, now)
    return groupByDate(slots, tz)
  }, [nowIso, tz])

  const dates = [...grouped.keys()]
  const [activeDate, setActiveDate] = useState<string>(dates[0] ?? '')
  const activeSlots = grouped.get(activeDate) ?? []

  return (
    <fieldset className="viewing-slot-picker">
      <legend className="viewing-slot-picker__legend">偏好看房时间（待顾问确认）</legend>
      <p className="viewing-slot-picker__hint">
        选择一个偏好时段，顾问会与您确认；这不是已确认的预约。可不选。
      </p>

      <div className="viewing-slot-picker__dates" role="tablist" aria-label="看房日期">
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={activeDate === d}
            data-active={activeDate === d}
            className="viewing-slot-picker__date"
            onClick={() => setActiveDate(d)}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="viewing-slot-picker__slots" role="group" aria-label="可选时段">
        {activeSlots.map((slot) => {
          const selected = value?.startsAt === slot.startsAt
          return (
            <button
              key={slot.startsAt}
              type="button"
              aria-pressed={selected}
              data-active={selected}
              className="viewing-slot-picker__slot"
              onClick={() =>
                onChange(
                  selected
                    ? null
                    : { startsAt: slot.startsAt, endsAt: slot.endsAt, timezone: slot.timezone },
                )
              }
            >
              {formatTime(slot.startsAt, tz)}–{formatTime(slot.endsAt, tz)}
            </button>
          )
        })}
      </div>

      {value && (
        <button
          type="button"
          className="viewing-slot-picker__clear"
          onClick={() => onChange(null)}
        >
          清除时段选择
        </button>
      )}
    </fieldset>
  )
}
