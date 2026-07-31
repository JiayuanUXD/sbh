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
import { mapGlobalToSchedule, resolveServiceStatus } from '@/domain/advisor-availability'

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
    const schedule = mapGlobalToSchedule(doc as unknown as Record<string, unknown>)
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
