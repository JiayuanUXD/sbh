/**
 * P2 Task 4 fix：读取平台服务时间 global，供前台客户端组件复用。
 *
 * 设计依据：devex-review #2 - 消除 ViewingSlotPicker 客户端默认 schedule
 * 与服务端 AdvisorServiceHours global 的分歧。
 *
 * 守护不变量：
 *   - 服务端读取，序列化为普通对象传给客户端组件
 *   - global 不可用时回退到安全默认（周一至五 09:00-18:00），不阻断
 *   - 纯数据，不含 PII
 */

import { getPayload } from 'payload'
import config from '@/payload.config'
import {
  mapGlobalToSchedule,
  type ServiceSchedule,
  type TimeRange,
  type Weekday,
} from '@/domain/advisor-availability'

/** 安全默认（与 AdvisorServiceHours global 的 defaultValue 对齐） */
const FALLBACK_SCHEDULE: ServiceSchedule = {
  timezone: 'Asia/Shanghai',
  weekly: {
    0: [],
    1: [{ start: '09:00', end: '18:00' }],
    2: [{ start: '09:00', end: '18:00' }],
    3: [{ start: '09:00', end: '18:00' }],
    4: [{ start: '09:00', end: '18:00' }],
    5: [{ start: '09:00', end: '18:00' }],
    6: [],
  } as Record<Weekday, TimeRange[]>,
  holidays: [],
  openMessage: '当前服务中',
  closedMessage: '当前非服务时段',
}

/**
 * 读取平台服务时间 schedule。global 未保存时返回其 defaultValue（周一至五 9-18）；
 * global 不可用（DB 错误等）时回退到 FALLBACK_SCHEDULE。
 */
export async function getServiceSchedule(): Promise<ServiceSchedule> {
  try {
    const payload = await getPayload({ config })
    const doc = await payload.findGlobal({
      slug: 'advisor-service-hours',
      depth: 1,
      overrideAccess: true,
    })
    return mapGlobalToSchedule(doc as unknown as Record<string, unknown>)
  } catch {
    return FALLBACK_SCHEDULE
  }
}
