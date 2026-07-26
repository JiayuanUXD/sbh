/**
 * 楼盘-商户有效期关系纯函数（tasks.md M3.3 / design §3.3 供给关系 / R2, R3）
 *
 * 职责：关系写入前的纯判定层——
 *   1. 区间提取与合法化（[start, end) 语义，复用 shared/validity）
 *   2. 商户准入门禁：启用 + 资质有效 + 服务城市覆盖楼盘城市
 *      （merchant-protect 头注释预告的「M3.3 关系建立时判定」落点）
 *   3. 同一楼盘的有效期不重叠检测（design §3.3「防止同一对象有效期重叠」的应用层等价）
 *
 * 无 payload / React 依赖，可独立单测。载入楼盘城市 / 商户 / 既有关系等读库副作用
 * 在 building-merchant-relation-protect.ts。
 *
 * 数据库侧：PostgreSQL 用 EXCLUDE USING gist 区间排斥约束兜底（单独手写迁移）；
 * SQLite 无此约束，靠 protect hook 调用本模块的 findRelationOverlap 做事务内等价校验。
 */

import {
  findOverlappingIndexes,
  isValidPeriod,
  type ValidityPeriod,
} from '@/domain/shared/validity'
import { coversCity, isQualificationEffective } from './merchant'

/** 关系不满足准入的稳定原因码（前端展示 / 诊断 / 审计）。 */
export const RELATION_INELIGIBLE_CODES = {
  /** 商户已停用 */
  MERCHANT_DISABLED: 'MERCHANT_DISABLED',
  /** 商户资质未通过或已过期 */
  QUALIFICATION_INVALID: 'QUALIFICATION_INVALID',
  /** 商户服务城市未覆盖楼盘所在城市 */
  CITY_NOT_COVERED: 'CITY_NOT_COVERED',
} as const

export type RelationIneligibleCode =
  (typeof RELATION_INELIGIBLE_CODES)[keyof typeof RELATION_INELIGIBLE_CODES]

/** 关系起止时刻（含起、不含止）。effectiveTo 为空表示无限期。 */
function toIso(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  const t = d.getTime()
  if (Number.isNaN(t)) {
    throw new Error(`非法时刻：${String(value)}`)
  }
  return d.toISOString()
}

/**
 * 由 effectiveFrom / effectiveTo 构造有效期区间。
 * effectiveFrom 必填（起始时刻）；effectiveTo 为空/undefined → 无限期。
 * 起止均非法时刻抛错；不校验 end>start（交由 isValidPeriod / protect hook 决定报错码）。
 */
export function toRelationPeriod(
  effectiveFrom: string | Date | null | undefined,
  effectiveTo: string | Date | null | undefined,
): ValidityPeriod {
  if (effectiveFrom === null || effectiveFrom === undefined || effectiveFrom === '') {
    throw new Error('有效期起始时刻必填')
  }
  const startsAt = toIso(effectiveFrom)
  const endsAt =
    effectiveTo === null || effectiveTo === undefined || effectiveTo === ''
      ? null
      : toIso(effectiveTo)
  return { startsAt, endsAt }
}

/** 区间是否合法（起必填、止若有必须严格大于起）。复用 shared/validity。 */
export function isRelationPeriodValid(period: ValidityPeriod): boolean {
  return isValidPeriod(period)
}

/** checkMerchantEligibility 入参：商户与楼盘的已解析快照 + 判定基准时刻。 */
export interface MerchantEligibilityInput {
  /** 商户启停状态 */
  status: unknown
  /** 商户资质状态 */
  qualificationStatus: unknown
  /** 资质到期时刻；null/undefined 视为无到期日 */
  qualificationExpiresAt: string | Date | null | undefined
  /** 商户服务城市 id 列表 */
  serviceCityIds: ReadonlyArray<number | string>
  /** 楼盘所在城市 id */
  buildingCityId: number | string | null | undefined
  /** 判定基准时刻 */
  now: Date
}

export interface MerchantEligibilityResult {
  eligible: boolean
  reasons: RelationIneligibleCode[]
}

/**
 * 商户能否与目标楼盘建立有效供给关系（供给谓词 §9/§10 的关系建立门禁）。
 * 收集全部不满足原因，便于前端一次性提示。
 */
export function checkMerchantEligibility(
  input: MerchantEligibilityInput,
): MerchantEligibilityResult {
  const reasons: RelationIneligibleCode[] = []

  if (input.status !== 'active') {
    reasons.push(RELATION_INELIGIBLE_CODES.MERCHANT_DISABLED)
  }
  if (!isQualificationEffective(input.qualificationStatus, input.qualificationExpiresAt, input.now)) {
    reasons.push(RELATION_INELIGIBLE_CODES.QUALIFICATION_INVALID)
  }
  if (!coversCity(input.serviceCityIds, input.buildingCityId)) {
    reasons.push(RELATION_INELIGIBLE_CODES.CITY_NOT_COVERED)
  }

  return { eligible: reasons.length === 0, reasons }
}

/**
 * 候选区间与同楼盘的既有关系区间比对，返回重叠的索引列表。
 * 空列表表示无冲突，可安全写入。语义同 [start, end)：相邻边界接续不算重叠。
 */
export function findRelationOverlap(
  candidate: ValidityPeriod,
  existing: ValidityPeriod[],
): number[] {
  return findOverlappingIndexes(candidate, existing)
}
