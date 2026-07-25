/**
 * 商户主数据纯函数（tasks.md M2.4 / design §3.3 / 有效供给谓词 §9-§10）
 *
 * 职责：类型/状态/资质状态的固定枚举与标签单一真源，
 * 以及供给谓词依赖的两个判定：资质有效性、服务城市覆盖。
 *
 * 无 payload / React 依赖，可独立单测。需要读库的校验（服务城市是否为
 * 启用城市节点）在 merchant-protect.ts。
 */

/** 商户类型：业主 / 中介 / 灵活办公品牌 / 渠道（design §3.3，固定枚举） */
export const MERCHANT_TYPES = ['OWNER', 'AGENCY', 'FLEX_OFFICE_BRAND', 'CHANNEL'] as const
export type MerchantType = (typeof MERCHANT_TYPES)[number]

export const MERCHANT_TYPE_LABELS: Record<MerchantType, string> = {
  OWNER: '业主',
  AGENCY: '中介',
  FLEX_OFFICE_BRAND: '灵活办公品牌',
  CHANNEL: '渠道',
}

/** 商户启停状态 */
export const MERCHANT_STATUSES = ['active', 'disabled'] as const
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number]

export const MERCHANT_STATUS_LABELS: Record<MerchantStatus, string> = {
  active: '启用',
  disabled: '停用',
}

/**
 * 资质状态：待审核 / 已通过 / 已驳回。
 * 「已过期」不作为独立状态，由 status=valid + expiresAt 组合在谓词层判定，
 * 避免过期后需要定时任务改写状态（design §9「资质通过且未过期」）。
 */
export const QUALIFICATION_STATUSES = ['pending', 'valid', 'rejected'] as const
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number]

export const QUALIFICATION_STATUS_LABELS: Record<QualificationStatus, string> = {
  pending: '待审核',
  valid: '已通过',
  rejected: '已驳回',
}

export function isMerchantType(value: unknown): value is MerchantType {
  return typeof value === 'string' && (MERCHANT_TYPES as readonly string[]).includes(value)
}

export function isMerchantStatus(value: unknown): value is MerchantStatus {
  return typeof value === 'string' && (MERCHANT_STATUSES as readonly string[]).includes(value)
}

export function isQualificationStatus(value: unknown): value is QualificationStatus {
  return (
    typeof value === 'string' && (QUALIFICATION_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * 资质是否有效（供给谓词 §9：商户启用、资质通过且未过期）。
 *
 * @param expiresAt 资质到期时刻；null 视为无到期日 → 只要状态为 valid 即有效。
 *                  边界语义：到期时刻当天仍有效，严格晚于到期时刻才失效（now < expiresAt || now == expiresAt 有效）。
 * @param now 判定基准时刻。
 */
export function isQualificationEffective(
  status: unknown,
  expiresAt: string | Date | null | undefined,
  now: Date,
): boolean {
  if (status !== 'valid') return false
  if (expiresAt === null || expiresAt === undefined) return true
  const exp = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime()
  if (Number.isNaN(exp)) return false
  // 到期时刻本身仍算有效，超过才失效
  return now.getTime() <= exp
}

/**
 * 服务城市是否覆盖目标城市（供给谓词 §10：服务城市覆盖楼盘城市）。
 * 只做集合包含判断；「城市是否启用」由调用方或 protect hook 保证。
 */
export function coversCity(
  serviceCityIds: ReadonlyArray<number | string>,
  targetCityId: number | string | null | undefined,
): boolean {
  if (targetCityId === null || targetCityId === undefined) return false
  return serviceCityIds.some((id) => String(id) === String(targetCityId))
}
