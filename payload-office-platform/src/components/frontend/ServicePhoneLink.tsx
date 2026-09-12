import React from 'react'
import { PhoneIcon } from '@/components/frontend/ui/icons'
import type { ServicePhone } from '@/lib/frontend/service-phone'

/**
 * 顶栏客服电话入口（OPT-094）。
 *
 * 两种形态：
 *   - `header`：放在页头右侧动作区。≥1024 显示「图标 + 号码」，之下只留图标
 *     （号码文本由 CSS 收起，DOM 仍在——读屏与 aria-label 都拿得到号码）；
 *   - `drawer`：移动抽屉里的平铺一行「客服电话 400-…」。
 *
 * 号码取值（城市覆盖 → 全站默认）不在这里做，见 `header-features.ts#pickServicePhone`；
 * 本组件只负责把已经定下来的号码画出来。无状态、无 hook，服务端直出。
 */
export default function ServicePhoneLink({
  phone,
  variant,
  onNavigate,
}: Readonly<{
  phone: ServicePhone
  variant: 'header' | 'drawer'
  onNavigate?: () => void
}>) {
  if (variant === 'drawer') {
    return (
      <a href={phone.href} className="mobile-drawer__link service-phone-drawer" onClick={onNavigate}>
        <PhoneIcon size={18} className="service-phone-drawer__icon" />
        <span>客服电话 {phone.display}</span>
      </a>
    )
  }
  return (
    <a href={phone.href} className="service-phone" aria-label={`拨打客服电话 ${phone.display}`}>
      <PhoneIcon size={20} className="service-phone__icon" />
      <span className="service-phone__number">{phone.display}</span>
    </a>
  )
}
