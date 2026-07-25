/**
 * 统一有效供给谓词（tasks.md M4.7 / design §3.6 有效供给 10 条 / R3）
 *
 * 「有效供给」= 允许在 C 端曝光、可进入推荐/跟进候选池的房源。design 列 10 条，
 * 按可判定层次拆成两层：
 *
 *   1) getEffectiveSupplyWhere(asOf) —— 查询层可直接表达的条件，返回 Payload where
 *      片段（fail-closed 正向谓词，只用 equals/exists，绝不用 not_equals 以免 NULL 漏网）：
 *        §1 未逻辑删除            deletedAt exists:false
 *        §2 已发布                publicationStatus = published
 *        §3 审核通过              reviewStatus = approved
 *        §4 未被供给可见性冻结    supplyVisibilityHold = normal
 *        §7 楼盘/城市/行政区启用  building.operationalStatus / city.status / district.status = active
 *      （§5「未被生效举报冻结」在 M6 举报域落地后并入；当前举报会改写 supplyVisibilityHold，
 *        故 §4 已覆盖大部分冻结场景。）
 *
 *   2) isListingEffectivelySupplied(snapshot, asOf) —— 需已解析关联数据才能判定的条件，
 *      逐条给出排除原因（供实时预览 / 诊断 / 审计一次性回显）：
 *        §6  有效媒体 ≥ 3                          INSUFFICIENT_MEDIA
 *        §8  商户关系落在有效期 [start, end)        RELATION_NOT_EFFECTIVE
 *        §9  商户启用 + 资质通过且未过期            MERCHANT_INELIGIBLE
 *        §10 商户服务城市覆盖楼盘城市              MERCHANT_INELIGIBLE
 *
 * 无 payload / React 依赖，可独立单测。查询层用 where 片段先粗筛，
 * 已解析的候选再过 isListingEffectivelySupplied 精筛（媒体/关系/商户）。
 */

import { isWithinValidity, type ValidityPeriod } from '@/domain/shared/validity'
import { checkMerchantEligibility } from '@/domain/supply/building-merchant-relation'

/** 有效媒体数量下限（design §6）。 */
export const MIN_EFFECTIVE_MEDIA = 3

/** 精筛层排除原因码（前端展示 / 诊断 / 审计）。 */
export const EFFECTIVE_SUPPLY_EXCLUSION_CODES = {
  /** 有效媒体不足 3 */
  INSUFFICIENT_MEDIA: 'INSUFFICIENT_MEDIA',
  /** 商户关系不在有效期内（尚未生效 / 已过期 / 无关系） */
  RELATION_NOT_EFFECTIVE: 'RELATION_NOT_EFFECTIVE',
  /** 商户不合格（停用 / 资质无效或过期 / 服务城市不覆盖楼盘城市） */
  MERCHANT_INELIGIBLE: 'MERCHANT_INELIGIBLE',
} as const

export type EffectiveSupplyExclusionCode =
  (typeof EFFECTIVE_SUPPLY_EXCLUSION_CODES)[keyof typeof EFFECTIVE_SUPPLY_EXCLUSION_CODES]

/**
 * 查询层可表达的有效供给正向谓词（fail-closed）。
 * @param _asOf 判定基准时刻（当前查询层条件与时刻无关，保留参数以便未来接入时间敏感条件）。
 */
export function getEffectiveSupplyWhere(_asOf: Date): Record<string, unknown> {
  return {
    deletedAt: { exists: false },
    publicationStatus: { equals: 'published' },
    reviewStatus: { equals: 'approved' },
    supplyVisibilityHold: { equals: 'normal' },
    'building.operationalStatus': { equals: 'active' },
    'building.city.status': { equals: 'active' },
    'building.district.status': { equals: 'active' },
  }
}

/** 精筛层入参：房源已解析的媒体 / 商户 / 关系快照。 */
export interface EffectiveSupplySnapshot {
  /** 有效媒体数量 */
  mediaCount: number
  merchant: {
    /** 商户启停状态 */
    status: unknown
    /** 商户资质状态 */
    qualificationStatus: unknown
    /** 资质到期时刻；null 视为无到期日 */
    qualificationExpiresAt: string | Date | null | undefined
    /** 商户服务城市 id 列表 */
    serviceCityIds: ReadonlyArray<number | string>
  }
  /** 楼盘所在城市 id */
  buildingCityId: number | string | null | undefined
  /** 楼盘-商户关系有效期；null 表示无有效关系 */
  relationPeriod: ValidityPeriod | null
}

export interface EffectiveSupplyResult {
  eligible: boolean
  reasons: EffectiveSupplyExclusionCode[]
}

/**
 * 已解析候选是否满足查询层无法表达的有效供给条件（媒体 §6 / 关系 §8 / 商户 §9-§10）。
 * 收集全部不满足原因，便于一次性提示。查询层条件（§1-§4、§7）由
 * getEffectiveSupplyWhere 在库侧保证，本函数不重复判定。
 */
export function isListingEffectivelySupplied(
  snapshot: EffectiveSupplySnapshot,
  asOf: Date,
): EffectiveSupplyResult {
  const reasons: EffectiveSupplyExclusionCode[] = []

  // §6 有效媒体 ≥ 3
  if (snapshot.mediaCount < MIN_EFFECTIVE_MEDIA) {
    reasons.push(EFFECTIVE_SUPPLY_EXCLUSION_CODES.INSUFFICIENT_MEDIA)
  }

  // §8 商户关系落在有效期内 [start, end)
  if (snapshot.relationPeriod === null || !isWithinValidity(asOf, snapshot.relationPeriod)) {
    reasons.push(EFFECTIVE_SUPPLY_EXCLUSION_CODES.RELATION_NOT_EFFECTIVE)
  }

  // §9-§10 商户启用 + 资质有效 + 服务城市覆盖楼盘城市
  const merchantCheck = checkMerchantEligibility({
    status: snapshot.merchant.status,
    qualificationStatus: snapshot.merchant.qualificationStatus,
    qualificationExpiresAt: snapshot.merchant.qualificationExpiresAt,
    serviceCityIds: snapshot.merchant.serviceCityIds,
    buildingCityId: snapshot.buildingCityId,
    now: asOf,
  })
  if (!merchantCheck.eligible) {
    reasons.push(EFFECTIVE_SUPPLY_EXCLUSION_CODES.MERCHANT_INELIGIBLE)
  }

  return { eligible: reasons.length === 0, reasons }
}
