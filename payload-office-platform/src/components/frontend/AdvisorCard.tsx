import type { ReactNode } from 'react'
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'
import { pickServicePhone } from '@/lib/frontend/header-features'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import type { ServicePhone } from '@/lib/frontend/service-phone'
import { PhoneIcon } from '@/components/frontend/ui/icons'

/**
 * 平台级顾问卡片
 *
 * 设计依据：评审 P0-3 与客服电话融合方案（方案 A 极简版）。
 *
 * 守护不变量（沿用 AdvisorAvailability 与 OPT-094）：
 *   - 只展示平台级官方客服电话，不显示个人顾问手机号 / 排班 / 在线状态
 *   - 「商办顾问」为平台虚拟身份，不含可识别个人信息
 *   - 官方客服电话按「城市覆盖号 → 全站默认号」取值，受后台开关控制
 *   - 去除所有冗余提示文案（如“当前服务中”、“预计恢复时间”、“按服务时段响应咨询”等），
 *     保持界面清爽克制，避免给用户造成非工作时间不可咨询的心理壁垒
 */
type AdvisorCardProps = Readonly<{
  /** 卡片右侧/底部 CTA，通常由父级传入 InquiryModal 触发按钮（可选） */
  cta?: ReactNode
  /** 显式指定客服电话；若未传则按 citySlug 或全站站点配置自动解析 */
  phone?: ServicePhone | null
  /** 城市 slug，用于按城市获取对应的覆盖客服电话 */
  citySlug?: string
}>

async function fetchServicePhone(citySlug?: string): Promise<ServicePhone | null> {
  try {
    const siteSettings = await getCachedSiteSettings()
    const features = siteSettings.headerFeatures
    if (!features.servicePhoneVisible) return null

    let cityOverride: string | null | undefined
    if (citySlug) {
      const city = await resolveCityContext(citySlug)
      cityOverride = city?.profile?.servicePhone
    }
    return pickServicePhone(cityOverride, features)
  } catch {
    return null
  }
}

export default async function AdvisorCard({ cta, phone: phoneProp, citySlug }: AdvisorCardProps) {
  const phone = phoneProp !== undefined ? phoneProp : await fetchServicePhone(citySlug)

  return (
    <section className="advisor-card" aria-label="平台顾问">
      <div className="advisor-card__avatar" aria-hidden="true">
        {/* 平台虚拟身份，不展示个人顾问照片 */}
        <span className="advisor-card__avatar-text">顾问</span>
      </div>
      <div className="advisor-card__body">
        <div className="advisor-card__name-row">
          <span className="advisor-card__name">商办顾问</span>
        </div>
        {phone && (
          <a
            href={phone.href}
            className="advisor-card__phone"
            aria-label={`拨打客服电话 ${phone.display}`}
          >
            <PhoneIcon size={14} className="advisor-card__phone-icon" aria-hidden="true" />
            <span className="advisor-card__phone-prefix">客服电话</span>
            <span className="sf-num advisor-card__phone-number">{phone.display}</span>
          </a>
        )}
      </div>
      {cta && <div className="advisor-card__cta">{cta}</div>}
    </section>
  )
}
