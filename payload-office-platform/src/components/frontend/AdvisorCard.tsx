import type { ReactNode } from 'react'
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'
import { pickServicePhone } from '@/lib/frontend/header-features'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { generatePhoneQrSvg, toSvgDataUri } from '@/lib/frontend/phone-qr'
import type { ServicePhone } from '@/lib/frontend/service-phone'
import { PhoneIcon } from '@/components/frontend/ui/icons'

/**
 * 平台级顾问卡片
 *
 * 设计依据：评审 P0-3、客服电话融合方案（方案 A）与 OPT-127（电话高亮 + 右侧扫码拨打）。
 *
 * 守护不变量（沿用 AdvisorAvailability 与 OPT-094）：
 *   - 只展示平台级官方客服电话，不显示个人顾问手机号 / 排班 / 在线状态
 *   - 「商办顾问」为平台虚拟身份，不含可识别个人信息
 *   - 官方客服电话按「城市覆盖号 → 全站默认号」取值，受后台开关控制
 *   - 去除“客服电话”前缀标签，直接高亮电话号码；右侧提供 `tel:` 拨号二维码及悬停放大气泡
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
  const qrSvg = phone ? await generatePhoneQrSvg(phone.href) : null
  const qrDataUri = qrSvg ? toSvgDataUri(qrSvg) : null

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
            className="advisor-card__phone advisor-card__phone--highlight"
            aria-label={`拨打顾问电话 ${phone.display}`}
          >
            <PhoneIcon size={15} className="advisor-card__phone-icon" aria-hidden="true" />
            <span className="sf-num advisor-card__phone-number">{phone.display}</span>
          </a>
        )}
      </div>
      {phone && qrDataUri && (
        <div className="advisor-card__qr" tabIndex={0} aria-label="手机扫码直接拨打电话">
          <div className="advisor-card__qr-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL 无法过 next/image 优化 */}
            <img
              src={qrDataUri}
              width={44}
              height={44}
              alt="扫码拨号二维码"
              className="advisor-card__qr-img"
            />
            <span className="advisor-card__qr-label">扫码拨打</span>
          </div>
          <div className="advisor-card__qr-popover" role="tooltip">
            <span className="advisor-card__qr-popover-title">手机扫码拨打</span>
            <div className="advisor-card__qr-popover-box">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL 无法过 next/image 优化 */}
              <img
                src={qrDataUri}
                width={120}
                height={120}
                alt={`扫码拨打 ${phone.display}`}
                className="advisor-card__qr-popover-img"
              />
            </div>
            <span className="sf-num advisor-card__qr-popover-phone">{phone.display}</span>
            <span className="advisor-card__qr-popover-hint">微信或系统相机扫一扫</span>
          </div>
        </div>
      )}
      {cta && <div className="advisor-card__cta">{cta}</div>}
    </section>
  )
}
