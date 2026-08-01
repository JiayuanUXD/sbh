import type { ReactNode } from 'react'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { mapGlobalToSchedule, resolveServiceStatus } from '@/domain/advisor-availability'

/**
 * 平台级顾问卡片
 *
 * 设计依据：评审 P0-3。把纯文字「服务中/非服务时段」升级为含头像/姓名/角色/状态点的
 * 决策卡片，对齐 58 商办详情页右侧常驻顾问卡片模式。
 *
 * 守护不变量（沿用 AdvisorAvailability）：
 *   - 只展示平台级服务状态，不显示个人顾问手机号 / 排班 / 在线状态
 *   - 「商办顾问」为平台虚拟身份，不含可识别个人信息
 *   - global 不可用时静默降级（不渲染），不阻断页面
 *   - 时区固定 Asia/Shanghai
 */
type AdvisorCardProps = Readonly<{
  /** 卡片右侧 CTA，通常由父级传入 InquiryModal 触发按钮 */
  cta?: ReactNode
}>

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

async function fetchAdvisorStatus() {
  try {
    const payload = await getPayload({ config })
    const doc = await payload.findGlobal({
      slug: 'advisor-service-hours',
      depth: 1,
      overrideAccess: true,
    })
    const schedule = mapGlobalToSchedule(doc as unknown as Record<string, unknown>)
    return resolveServiceStatus(schedule, new Date().toISOString())
  } catch {
    return null
  }
}

export default async function AdvisorCard({ cta }: AdvisorCardProps) {
  const status = await fetchAdvisorStatus()
  if (!status) return null

  const isOpen = status.state === 'open'
  const statusText = isOpen
    ? status.message
    : status.nextOpenAt
      ? `${status.message}，预计 ${formatNextOpenAt(status.nextOpenAt)} 恢复`
      : status.message

  return (
    <section className="advisor-card" data-state={status.state} aria-label="平台顾问">
      <div className="advisor-card__avatar" aria-hidden="true">
        {/* 平台虚拟身份，不展示个人顾问照片 */}
        <span className="advisor-card__avatar-text">顾问</span>
      </div>
      <div className="advisor-card__body">
        <div className="advisor-card__name-row">
          <span className="advisor-card__name">商办顾问</span>
          <span
            className={`advisor-card__status ${
              isOpen ? 'advisor-card__status--open' : 'advisor-card__status--closed'
            }`}
          >
            <span className="advisor-card__status-dot" aria-hidden="true" />
            {isOpen ? '服务中' : '非服务时段'}
          </span>
        </div>
        <p className="advisor-card__status-detail">{statusText}</p>
        <p className="advisor-card__hint">平台商办顾问，按服务时段响应咨询</p>
      </div>
      {cta && <div className="advisor-card__cta">{cta}</div>}
    </section>
  )
}
