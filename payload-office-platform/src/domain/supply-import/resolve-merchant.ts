/**
 * 导入链路的供给商户解析（OPT-041 D10 + OPT-045 §5.1）。
 *
 * 有效供给谓词 §8 要求 `listings.merchant` 非空（`effective-supply.ts`），
 * 否则从所有对外查询排除（`NO_SUPPLY_MERCHANT`）。解析优先级三级：
 *
 *   1. **模板「供给商户」列**填了名称 → `resolveMerchantByName`（OPT-045）；
 *   2. 留空 → **楼盘当前生效的供给商户**（`building-merchant-relations` 中 building
 *      匹配、且 `[effectiveFrom, effectiveTo)` 覆盖当前时点的那条关系，OPT-041 D10）；
 *   3. 楼盘也没有 → **本城市的平台自营商户**回落（OPT-045 §5.1）。
 *
 * 三级都拿不到才判错误行。OPT-041 只有第 2 级，导致「先导楼盘、再导房源」第二步
 * 全线报 NO_SUPPLY_MERCHANT_RELATION——楼盘模板当时也没有商户列。
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
import { isWithinValidity } from '@/domain/shared/validity'
import { normalizeAliasText } from '@/domain/supply-import/normalize'
import { formatSuggestion, suggestClosest } from '@/domain/supply-import/resolve-refs'

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
  /**
   * 楼盘没有生效关系，且该城市也没有可用的平台自营商户（OPT-045 §5.1）。
   *
   * 与 `NO_SUPPLY_MERCHANT_RELATION` 分开，是因为**该去改的地方不同**：
   * 前者让运营去配楼盘商户关系，后者要去商户管理里补这个城市的平台自营商户
   *（多半是漏建、或漏勾服务城市）。合成一个码会让文案只能二选一地说错话。
   */
  NO_PLATFORM_DEFAULT_MERCHANT: 'NO_PLATFORM_DEFAULT_MERCHANT',
  /** 模板「供给商户」列填了名称，但库里没有这个商户（OPT-045） */
  MERCHANT_NOT_FOUND: 'MERCHANT_NOT_FOUND',
  /** 模板「供给商户」列的名称在库里命中多个商户，无法确定用哪个（OPT-045） */
  MERCHANT_NAME_AMBIGUOUS: 'MERCHANT_NAME_AMBIGUOUS',
} as const

export type MerchantResolutionCode =
  (typeof MERCHANT_RESOLUTION_CODES)[keyof typeof MERCHANT_RESOLUTION_CODES]

export type ResolveBuildingMerchantResult =
  | {
      ok: true
      merchantId: number | string
      /**
       * 该商户来自平台自营回落而非楼盘关系（OPT-045）。
       *
       * **回落路径只写 `listings.merchant`，不补建 `building-merchant-relations`。**
       * 理由：合规止血开关 `merchant-stop-listings.ts` 查的就是
       * `listings.merchant`（OPT-034 起供给商户直接存在该字段，不再经关系表），
       * 所以 D3 那条验收——「停用杭州的平台自营商户 → 只冻结杭州导入的房源」——
       * 不依赖关系记录即成立。凭空补关系反而要处理重叠区间保护与 effectiveFrom，
       * 是白白多出来的可错状态。想要关系记录就用楼盘模板的「供给商户」列显式建。
       *
       * 本标志供写入层与批次汇总使用（让运营看得见「这批有多少条走了回落」）。
       */
      viaPlatformDefault?: boolean
    }
  | { ok: false; code: MerchantResolutionCode; message: string }

/**
 * 平台自营商户回落的入参（OPT-045 §5.1）。
 *
 * **必须由调用方在查库时就带上城市条件解析好**（`resolveDefaultSupplyMerchant`
 * 的 `cityId`），这里只消费结果——不在导入层重写一份 §10 判定。
 *
 * `merchantId` 为 null 表示「该城市没有可用的平台自营商户」，判错误行；
 * 整个 `fallback` 为 undefined 表示调用方没启用回落，维持 OPT-041 的旧行为。
 */
export interface PlatformDefaultFallback {
  merchantId: number | string | null | undefined
  /** 城市名，只用于拼错误文案；拿不到就留空，文案会退化成「该城市」。 */
  cityLabel?: string | null
}

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
  for (const relation of relations) {
    if (String(relation.buildingId) !== String(buildingId)) continue
    const period = toRelationPeriod(relation.effectiveFrom, relation.effectiveTo)
    if (!isRelationPeriodValid(period)) continue
    // 评审第 1 轮 Important 2：半开区间"含起不含止"判定复用既有
    // domain/shared/validity.ts 的 isWithinValidity，不再手写 start/end 比较——
    // 与 building-merchant-relation-protect.ts 等既有调用点同一份实现，不搞
    // 同义漂移。
    if (isWithinValidity(now, period)) return relation
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
  fallback?: PlatformDefaultFallback,
): ResolveBuildingMerchantResult {
  const current = findCurrentRelation(buildingId, relations, now)
  if (!current) {
    // OPT-045 §5.1：楼盘没有生效关系时回落到本城市的平台自营商户。
    //
    // 在此之前，「先导楼盘、再导房源」的第二步会全线报
    // NO_SUPPLY_MERCHANT_RELATION——因为楼盘模板也没有商户列，新导入的楼盘
    // 一条关系都没有。手工补要每楼盘一条、且那个集合当时还不在导航里（D4）。
    if (fallback !== undefined) {
      if (fallback.merchantId !== null && fallback.merchantId !== undefined) {
        return { ok: true, merchantId: fallback.merchantId, viaPlatformDefault: true }
      }
      return {
        ok: false,
        code: MERCHANT_RESOLUTION_CODES.NO_PLATFORM_DEFAULT_MERCHANT,
        message:
          `楼盘「${buildingLabel}」没有生效的供给商户，且${fallback.cityLabel ? `「${fallback.cityLabel}」` : '该城市'}` +
          '没有可用的平台自营商户。请在商户管理里为该城市补一个平台自营商户' +
          '（勾选「平台自营商户」、状态启用、资质有效，并在「服务城市」里勾上该城市），或先配置楼盘商户关系',
      }
    }
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
// 按名称解析供给商户（OPT-045：两张模板的「供给商户」列）
// ────────────────────────────────────────────────────────────

/** 候选商户的最小读模型：判定所需字段的扁平化投影。 */
export interface MerchantCandidate {
  id: number | string
  name: string
  status: unknown
  qualificationStatus: unknown
  qualificationExpiresAt: string | Date | null | undefined
  serviceCityIds: ReadonlyArray<number | string>
}

/**
 * 名称规范化：与地理别名同口径（全半角折叠 + 折叠空白 + 小写）。
 *
 * 复用 `normalizeAliasText` 而不是自己写 trim/lower——运营从后台复制商户名时
 * 常带全角空格或大小写差异，两处规范化规则漂了就会出现「明明一样却匹配不上」。
 */
function normalizeMerchantName(value: string): string {
  return normalizeAliasText(value)
}

/**
 * 按名称解析供给商户，并就地做 §9（合格）+ §10（服务城市覆盖）判定。
 *
 * **为什么填名称而不是 ID**：这一列只在「同一楼盘的房源要拆给不同商户」时才用，
 * 那时运营手上就是商户名，不是 ID。绝大多数情况靠「楼盘关系 → 平台自营回落」
 * 两级自动解析，这一列留空即可。
 *
 * 名称重复时判错误行而不是取第一个——商户重名本身就是需要人去处理的数据问题，
 * 静默取一个会让房源挂到错误的商户名下，且完全没有信号。
 */
export function resolveMerchantByName(
  text: string,
  candidates: readonly MerchantCandidate[],
  buildingCityId: number | string | null | undefined,
  now: Date,
): ResolveBuildingMerchantResult {
  const normalized = normalizeMerchantName(text)
  const hits = candidates.filter((c) => normalizeMerchantName(c.name) === normalized)

  if (hits.length === 0) {
    const suggestion = formatSuggestion(
      suggestClosest(normalized, candidates.map((c) => c.name)),
    )
    return {
      ok: false,
      code: MERCHANT_RESOLUTION_CODES.MERCHANT_NOT_FOUND,
      message: `未找到名为「${text}」的供给商户${suggestion ? `，${suggestion}` : ''}`,
    }
  }

  if (hits.length > 1) {
    return {
      ok: false,
      code: MERCHANT_RESOLUTION_CODES.MERCHANT_NAME_AMBIGUOUS,
      message: `有 ${hits.length} 个商户都叫「${text}」，无法确定用哪个；请先在商户管理里消除重名，或改用楼盘商户关系指定`,
    }
  }

  const hit = hits[0]
  const eligibility = checkMerchantEligibility({
    status: hit.status,
    qualificationStatus: hit.qualificationStatus,
    qualificationExpiresAt: hit.qualificationExpiresAt,
    serviceCityIds: hit.serviceCityIds,
    buildingCityId,
    now,
  })
  if (!eligibility.eligible) {
    const labels = eligibility.reasons.map((code) => INELIGIBLE_LABELS[code]).join('、')
    return {
      ok: false,
      code: MERCHANT_RESOLUTION_CODES.MERCHANT_INELIGIBLE,
      message: `供给商户「${hit.name}」不合格（${labels}），请先处理商户资质或改填其它商户`,
    }
  }

  return { ok: true, merchantId: hit.id }
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
