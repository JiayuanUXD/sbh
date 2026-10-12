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

import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import config from '@/payload.config'
import {
  mapGlobalToSchedule,
  type ServiceSchedule,
  type TimeRange,
  type Weekday,
} from '@/domain/advisor-availability'

export const ADVISOR_SERVICE_HOURS_TAG = 'public:advisor-service-hours'
export const ADVISOR_SERVICE_HOURS_REVALIDATE_SECONDS = 300

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

async function readServiceSchedule(): Promise<ServiceSchedule> {
  const payload = await getPayload({ config })
  const doc = await payload.findGlobal({
    slug: 'advisor-service-hours',
    depth: 1,
    overrideAccess: true,
  })
  return mapGlobalToSchedule(doc as unknown as Record<string, unknown>)
}

const cachedServiceSchedule = unstable_cache(readServiceSchedule, ['advisor-service-hours'], {
  tags: [ADVISOR_SERVICE_HOURS_TAG],
  revalidate: ADVISOR_SERVICE_HOURS_REVALIDATE_SECONDS,
})

/**
 * 读取平台服务时间 schedule。global 未保存时返回其 defaultValue（周一至五 9-18）；
 * global 不可用（DB 错误等）时回退到 FALLBACK_SCHEDULE。
 *
 * 通过 `unstable_cache`（300s）缓存，避免房源/楼盘详情页每次请求直查数据库；
 * 在无 Next 增量缓存上下文（如单测/脚本）时自动降级直读。
 */
export async function getServiceSchedule(): Promise<ServiceSchedule> {
  try {
    return await cachedServiceSchedule()
  } catch (error) {
    if (error instanceof Error && error.message.includes('incrementalCache missing')) {
      try {
        return await readServiceSchedule()
      } catch {
        return FALLBACK_SCHEDULE
      }
    }
    return FALLBACK_SCHEDULE
  }
}

