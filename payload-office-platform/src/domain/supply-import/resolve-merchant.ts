/**
 * 房源商户解析（OPT-041 D10，规格 §11）。
 *
 * 房源模板九列没有商户列（规格 §5.1），但有效供给谓词 §8 要求 `listings.merchant`
 * 非空（`effective-supply.ts`），否则从所有对外查询排除（`NO_SUPPLY_MERCHANT`）。
 * 唯一来源是**楼盘当前生效的供给商户**——`building-merchant-relations` 中 building
 * 匹配、且 `[effectiveFrom, effectiveTo)` 覆盖当前时点的那条关系。
 *
 * 校验前移到预检层：楼盘没有生效商户、或商户不合格（停用 / 资质过期 / 服务城市不覆盖），
 * 在预检阶段就判错误行——失败必须发生在任何东西上架之前（理由同 rent-total 那条）。
 * 写入层（import-task.ts）用同一份判定在写入前再跑一次，作为规格要求的"兜底守卫"，
 * 防止预检与执行之间关系失效（比如运营在两次点击之间把商户停用了）。
 *
 * 复用既有域函数 `toRelationPeriod` / `isRelationPeriodValid` / `checkMerchantEligibility`
 * （`domain/supply/building-merchant-relation.ts`），不另写一份资质判定。
 */

import {
  checkMerchantEligibility,
  isRelationPeriodValid,
  toRelationPeriod,
  RELATION_INELIGIBLE_CODES,
  type RelationIneligibleCode,
} from '@/domain/supply/building-merchant-relation'

/** 一条楼盘-商户关系的最小读模型：判定所需字段的扁平化投影，不绑定 Payload 类型。 */
export interface BuildingMerchantRelationInput {
  buildingId: number | string
  merchantId: number | string
  merchantStatus: unknown
  qualificationStatus: unknown
  qualificationExpiresAt: string | Date | null | undefined
  serviceCityIds: ReadonlyArray<number | string>
  effectiveFrom: string | Date
  effectiveTo: string | Date | null | undefined
}

export const MERCHANT_RESOLUTION_CODES = {
  /** 楼盘没有任何 [effectiveFrom, effectiveTo) 覆盖当前时点的关系 */
  NO_SUPPLY_MERCHANT_RELATION: 'NO_SUPPLY_MERCHANT_RELATION',
  /** 楼盘当前生效关系指向的商户不合格（停用 / 资质无效或过期 / 服务城市不覆盖） */
  MERCHANT_INELIGIBLE: 'MERCHANT_INELIGIBLE',
} as const

export type MerchantResolutionCode =
  (typeof MERCHANT_RESOLUTION_CODES)[keyof typeof MERCHANT_RESOLUTION_CODES]

export type ResolveBuildingMerchantResult =
  | { ok: true; merchantId: number | string }
  | { ok: false; code: MerchantResolutionCode; message: string }

/** 不合格原因码 → 中文短语，拼进错误 message，让运营一眼看出该去改哪一类问题。 */
const INELIGIBLE_LABELS: Record<RelationIneligibleCode, string> = {
  [RELATION_INELIGIBLE_CODES.MERCHANT_DISABLED]: '已停用',
  [RELATION_INELIGIBLE_CODES.QUALIFICATION_INVALID]: '资质无效或已过期',
  [RELATION_INELIGIBLE_CODES.CITY_NOT_COVERED]: '服务城市未覆盖该楼盘所在城市',
}

/**
 * 楼盘在 `now` 时点生效的关系。同楼盘的重叠区间由
 * `building-merchant-relation-protect.ts` 在写入关系时已经拦住，正常情况下至多命中
 * 一条；万一命中多条（脏数据），取遍历到的第一条，不在这里引入新的裁决逻辑。
 * 区间不合法（`isRelationPeriodValid` 为假）的关系整条跳过，不参与判定。
 */
function findCurrentRelation(
  buildingId: number | string,
  relations: readonly BuildingMerchantRelationInput[],
  now: Date,
): BuildingMerchantRelationInput | null {
  const t = now.getTime()
  for (const relation of relations) {
    if (String(relation.buildingId) !== String(buildingId)) continue
    const period = toRelationPeriod(relation.effectiveFrom, relation.effectiveTo)
    if (!isRelationPeriodValid(period)) continue
    const start = new Date(period.startsAt).getTime()
    const end = period.endsAt === null ? Number.POSITIVE_INFINITY : new Date(period.endsAt).getTime()
    if (t >= start && t < end) return relation
  }
  return null
}

/**
 * 解析楼盘当前应继承的供给商户 id，或给出可操作的错误。
 *
 * @param buildingLabel 错误 message 里指代楼盘的文案（预检层传楼盘名，写入层没有
 *   现成的名字可用时可以传 `楼盘（编号 xxx）` 这类占位——message 指错楼盘而不是房源
 *   本身即达到规格要求，不强制要求是名称。
 */
export function resolveBuildingMerchant(
  buildingLabel: string,
  buildingId: number | string,
  buildingCityId: number | string | null | undefined,
  relations: readonly BuildingMerchantRelationInput[],
  now: Date,
): ResolveBuildingMerchantResult {
  const current = findCurrentRelation(buildingId, relations, now)
  if (!current) {
    return {
      ok: false,
      code: MERCHANT_RESOLUTION_CODES.NO_SUPPLY_MERCHANT_RELATION,
      message: `楼盘「${buildingLabel}」当前没有生效的供给商户，请先在楼盘商户关系中配置后再导入`,
    }
  }

  const eligibility = checkMerchantEligibility({
    status: current.merchantStatus,
    qualificationStatus: current.qualificationStatus,
    qualificationExpiresAt: current.qualificationExpiresAt,
    serviceCityIds: current.serviceCityIds,
    buildingCityId,
    now,
  })
  if (!eligibility.eligible) {
    const labels = eligibility.reasons.map((code) => INELIGIBLE_LABELS[code]).join('、')
    return {
      ok: false,
      code: MERCHANT_RESOLUTION_CODES.MERCHANT_INELIGIBLE,
      message: `楼盘「${buildingLabel}」当前生效的供给商户不合格（${labels}），请先处理商户资质或更换供给商户后再导入`,
    }
  }

  return { ok: true, merchantId: current.merchantId }
}

// ────────────────────────────────────────────────────────────
// Payload 查询结果 → BuildingMerchantRelationInput 的映射（IO 无关的纯映射，
// 供 endpoint 层 / 写入层各自查库后调用，避免两处各写一份同样的字段搬运）
// ────────────────────────────────────────────────────────────

/** `building-merchant-relations` 集合 `depth:1`（merchant 已展开）查询结果的最小读模型。 */
export interface RawBuildingMerchantRelationDoc {
  building: number | string | { id: number | string } | null | undefined
  merchant:
    | number
    | string
    | {
        id: number | string
        status?: unknown
        qualificationStatus?: unknown
        qualificationExpiresAt?: unknown
        serviceCities?: unknown
      }
    | null
    | undefined
  effectiveFrom: string | Date
  effectiveTo?: string | Date | null
}

function extractId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

/**
 * 把 `payload.find({ collection: 'building-merchant-relations', depth: 1 })` 的
 * 原始文档数组映射成 `resolveBuildingMerchant` 需要的扁平输入。`merchant` 未展开
 * （仍是裸 id，说明调用方漏传 depth:1）或缺 `building` 的脏记录整条跳过。
 */
export function mapBuildingMerchantRelationDocs(
  docs: readonly RawBuildingMerchantRelationDoc[],
): BuildingMerchantRelationInput[] {
  const mapped: BuildingMerchantRelationInput[] = []
  for (const doc of docs) {
    const buildingId = extractId(doc.building)
    const merchant = doc.merchant
    if (buildingId === null || typeof merchant !== 'object' || merchant === null) continue
    const merchantId = extractId(merchant)
    if (merchantId === null) continue

    const serviceCitiesRaw = merchant.serviceCities
    const serviceCityIds = Array.isArray(serviceCitiesRaw)
      ? serviceCitiesRaw
          .map((entry) => extractId(entry))
          .filter((id): id is number | string => id !== null)
      : []

    mapped.push({
      buildingId,
      merchantId,
      merchantStatus: merchant.status,
      qualificationStatus: merchant.qualificationStatus,
      qualificationExpiresAt: merchant.qualificationExpiresAt as string | Date | null | undefined,
      serviceCityIds,
      effectiveFrom: doc.effectiveFrom,
      effectiveTo: doc.effectiveTo ?? null,
    })
  }
  return mapped
}
