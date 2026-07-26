/**
 * 房源-商户有效期关系纯函数（tasks.md M4.2 / design §3.3 供给关系 / R2, R4）
 *
 * 与楼盘-商户关系（building-merchant-relation.ts）同构:一条记录 = 某房源在某有效期内
 * 由某商户供给。[start, end) 语义,复用 shared/validity 的区间与门禁工具。
 *
 * M4.2 新增语义——快照继承 Building 默认商户:
 *   房源关系创建时若未显式指定商户,则继承所属楼盘“当前默认商户”的**快照**
 *   (resolveListingRelationMerchant)。快照一旦写入房源关系记录,后续 Building 默认
 *   关系变化**不得回写**既有 Listing 关系——这由“各自独立记录 + 快照值”天然保证,
 *   本层只负责在创建时解析出应写入的商户 id。
 *
 * 无 payload / React 依赖,可独立单测。载入楼盘默认商户 / 商户 / 既有关系等读库副作用
 * 在 listing-merchant-relation-protect.ts。
 */

import { findOverlappingIndexes, isValidPeriod, type ValidityPeriod } from '@/domain/shared/validity'
import { coversCity, isQualificationEffective } from './merchant'

/** 关系不满足准入的稳定原因码（与楼盘关系共用同一套语义）。 */
export const LISTING_RELATION_INELIGIBLE_CODES = {
  /** 商户已停用 */
  MERCHANT_DISABLED: 'MERCHANT_DISABLED',
  /** 商户资质未通过或已过期 */
  QUALIFICATION_INVALID: 'QUALIFICATION_INVALID',
  /** 商户服务城市未覆盖房源所在城市 */
  CITY_NOT_COVERED: 'CITY_NOT_COVERED',
} as const

export type ListingRelationIneligibleCode =
  (typeof LISTING_RELATION_INELIGIBLE_CODES)[keyof typeof LISTING_RELATION_INELIGIBLE_CODES]

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
 * effectiveFrom 必填;effectiveTo 为空/undefined → 无限期。
 * 起止均非法时刻抛错;不校验 end>start(交由 isValidPeriod / protect hook 决定报错码)。
 */
export function toListingRelationPeriod(
  effectiveFrom: string | Date | null | undefined,
  effectiveTo: string | Date | null | undefined,
): ValidityPeriod {
  if (effectiveFrom === null || effectiveFrom === undefined || effectiveFrom === '') {
    throw new Error('有效期起始时刻必填')
  }
  const startsAt = toIso(effectiveFrom)
  const endsAt =
    effectiveTo === null || effectiveTo === undefined || effectiveTo === '' ? null : toIso(effectiveTo)
  return { startsAt, endsAt }
}

/** 区间是否合法(起必填、止若有必须严格大于起)。复用 shared/validity。 */
export function isListingRelationPeriodValid(period: ValidityPeriod): boolean {
  return isValidPeriod(period)
}

/** checkMerchantEligibility 入参:商户与房源所在城市的已解析快照 + 判定基准时刻。 */
export interface ListingMerchantEligibilityInput {
  status: unknown
  qualificationStatus: unknown
  qualificationExpiresAt: string | Date | null | undefined
  serviceCityIds: ReadonlyArray<number | string>
  /** 房源所在城市 id(取自所属楼盘) */
  listingCityId: number | string | null | undefined
  now: Date
}

export interface ListingMerchantEligibilityResult {
  eligible: boolean
  reasons: ListingRelationIneligibleCode[]
}

/** 商户能否与目标房源建立有效供给关系。收集全部不满足原因。 */
export function checkListingMerchantEligibility(
  input: ListingMerchantEligibilityInput,
): ListingMerchantEligibilityResult {
  const reasons: ListingRelationIneligibleCode[] = []
  if (input.status !== 'active') {
    reasons.push(LISTING_RELATION_INELIGIBLE_CODES.MERCHANT_DISABLED)
  }
  if (
    !isQualificationEffective(input.qualificationStatus, input.qualificationExpiresAt, input.now)
  ) {
    reasons.push(LISTING_RELATION_INELIGIBLE_CODES.QUALIFICATION_INVALID)
  }
  if (!coversCity(input.serviceCityIds, input.listingCityId)) {
    reasons.push(LISTING_RELATION_INELIGIBLE_CODES.CITY_NOT_COVERED)
  }
  return { eligible: reasons.length === 0, reasons }
}

/** 候选区间与同房源既有关系区间比对,返回重叠索引列表。空列表可安全写入。 */
export function findListingRelationOverlap(
  candidate: ValidityPeriod,
  existing: ValidityPeriod[],
): number[] {
  return findOverlappingIndexes(candidate, existing)
}

/**
 * 解析房源关系创建时应写入的商户 id（快照继承 Building 默认商户）。
 *
 * 规则:
 *   - 显式指定商户 → 用显式值(允许覆盖楼盘默认)。
 *   - 未显式指定 → 继承所属楼盘“当前默认商户”的快照值。
 *   - 两者都缺 → null(protect hook 抛 MERCHANT_REQUIRED)。
 *
 * 关键:一旦解析出的 id 被写入房源关系记录,即成为该记录自身的快照,后续楼盘默认
 * 关系变化不再影响它。本函数只在创建时被调用一次。
 */
export function resolveListingRelationMerchant(input: {
  explicitMerchantId: number | string | null | undefined
  buildingDefaultMerchantId: number | string | null | undefined
}): number | string | null {
  const explicit = input.explicitMerchantId
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    return explicit
  }
  const inherited = input.buildingDefaultMerchantId
  if (inherited !== null && inherited !== undefined && inherited !== '') {
    return inherited
  }
  return null
}
