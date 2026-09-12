/**
 * 顶栏功能开关（OPT-094）：站点设置 → 导航 → 顶栏功能 三个字段到视图的映射。
 *
 * 纯函数，脱离 payload 可测；`site-settings.ts` 的 `toView` 调它。
 *
 * 空值语义（迁移后存量行是 NULL）：
 *   - `memberEntryVisible`：NULL = **关**。本次任务就是要把登录入口关掉，NULL 当关
 *     意味着迁移跑完线上立即生效，运营不用再去点一次。
 *   - `servicePhoneVisible`：NULL = **开**。号码本身空就不显示，开关只在「有号码但暂时不想露」时用。
 */

import { normalizeServicePhone, type ServicePhone } from './service-phone'

export type HeaderFeatures = Readonly<{
  memberEntryVisible: boolean
  /** 顶栏要不要客服电话入口。关着时城市覆盖号也不显示——开关说的是「入口」，不是「用哪个号」 */
  servicePhoneVisible: boolean
  /** 全站默认客服电话（已归一化）；空 / 非法时为 null */
  servicePhone: ServicePhone | null
}>

export const HEADER_FEATURES_FALLBACK: HeaderFeatures = {
  memberEntryVisible: false,
  servicePhoneVisible: true,
  servicePhone: null,
}

export function resolveHeaderFeatures(
  doc: Readonly<{ memberEntryVisible?: unknown; servicePhoneVisible?: unknown; servicePhone?: unknown }> | null,
): HeaderFeatures {
  if (!doc) return HEADER_FEATURES_FALLBACK
  return {
    memberEntryVisible: doc.memberEntryVisible === true,
    servicePhoneVisible: doc.servicePhoneVisible !== false,
    servicePhone: normalizeServicePhone(doc.servicePhone),
  }
}

/** 顶栏实际显示的号码：入口开着时，当前城市覆盖 → 全站默认；两处都空为 null。 */
export function pickServicePhone(
  cityOverride: unknown,
  features: Pick<HeaderFeatures, 'servicePhoneVisible' | 'servicePhone'>,
): ServicePhone | null {
  if (!features.servicePhoneVisible) return null
  return normalizeServicePhone(cityOverride) ?? features.servicePhone
}
