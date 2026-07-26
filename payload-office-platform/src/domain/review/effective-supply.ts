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
 *      （§5「未被生效举报冻结」由 M6.2 listingReportPauseWhere / getPausedListingIds 提供，
 *        举报是独立 collection（listing-reports），需通过 targetListing 关联查询被举报的
 *        listing IDs，调用方在查询 listings 时使用 id: { not_in: pausedIds } 排除。）
 *
 *   2) isListingEffectivelySupplied(snapshot, asOf) —— 需已解析关联数据才能判定的条件，
 *      逐条给出排除原因（供实时预览 / 诊断 / 审计一次性回显）：
 *        §6  有效媒体 ≥ 3                          INSUFFICIENT_MEDIA
 *        §8  商户关系落在有效期 [start, end)        RELATION_NOT_EFFECTIVE
 *        §9  商户启用 + 资质通过且未过期            MERCHANT_INELIGIBLE
 *        §10 商户服务城市覆盖楼盘城市              MERCHANT_INELIGIBLE
 *
 *   3) 举报暂停谓词（M6.2 新增，§5）：
 *        - listingReportPauseWhere()        返回 listing-reports 的 where 条件
 *        - getPausedListingIds(payload)     查询 listing-reports，返回被暂停的 listing IDs
 *        - isListingPaused(pausedIds, id)   判断 listing 是否在暂停列表中
 *        - extractPausedListingIds(reports) 从已查询的 reports 数组提取 listing IDs（便于测试）
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

// ────────────────────────────────────────────────────────────
// M6.2 举报暂停谓词（design §5 第 5 条：未被有效举报暂停）
// ────────────────────────────────────────────────────────────

/**
 * Payload Local API 查询端口（最小化接口，便于测试 mock）。
 *
 * 仅暴露 find 方法，用于查询 listing-reports 中 supplyPaused=true 的记录。
 * 真实环境由 Payload req.payload 提供；测试用 mock 实现。
 */
export interface PayloadQueryPort {
  find: (params: {
    collection: string
    where: Record<string, unknown>
    /** 关联深度：0 表示只返回 ID；缺省由实现决定 */
    depth?: number
    /** 返回条数上限 */
    limit?: number
    /** 是否绕过 access（用于内部查询） */
    overrideAccess?: boolean
  }) => Promise<{
    docs: Array<{ targetListing?: string | number | { id: string | number } | null }>
  }>
}

/** 举报记录的最小读模型（用于 extractPausedListingIds）。 */
export interface PausedReportLike {
  /** 被举报房源 ID 或完整对象 */
  targetListing?: string | number | { id: string | number } | null
}

/**
 * listing-reports 的"已暂停供给"where 片段（design §5 第 5 条）。
 *
 * 返回正向谓词 `supplyPaused: { equals: true }`：fail-closed，
 * 只匹配显式标记为暂停的举报。调用方在查询 listing-reports 时使用此 where，
 * 拿到 docs 后通过 extractPausedListingIds 提取 listing IDs。
 *
 * 注意：举报是独立 collection，不是 listings 字段。调用方需要：
 *   ```ts
 *   const pausedIds = await getPausedListingIds(payload)
 *   const listings = await payload.find({
 *     collection: 'listings',
 *     where: { id: { not_in: pausedIds }, ...getEffectiveSupplyWhere(asOf) },
 *   })
 *   ```
 */
export function listingReportPauseWhere(): Record<string, unknown> {
  return {
    supplyPaused: { equals: true },
  }
}

/**
 * 从已查询的 reports 数组提取 targetListing ID 列表（去重）。
 *
 * 处理 targetListing 的两种形态：
 *   - number | string（Payload depth=0 时返回 ID）
 *   - { id: string | number }（Payload depth≥1 时返回完整对象）
 *
 * 同步纯函数，便于单测；getPausedListingIds 内部调用此函数。
 */
export function extractPausedListingIds(
  reports: ReadonlyArray<PausedReportLike>,
): Array<string | number> {
  const ids = new Set<string | number>()
  for (const r of reports) {
    const tl = r?.targetListing
    if (tl === null || tl === undefined) continue
    if (typeof tl === 'string' || typeof tl === 'number') {
      ids.add(tl)
      continue
    }
    if (typeof tl === 'object' && 'id' in tl && tl.id !== null && tl.id !== undefined) {
      ids.add(tl.id)
    }
  }
  return [...ids]
}

/**
 * 查询 listing-reports 中 supplyPaused=true 的所有举报，返回 targetListing IDs。
 *
 * 调用方在查询 listings 时使用 `id: { not_in: pausedIds }` 排除这些房源。
 *
 * 实现细节：
 *   - 使用 listingReportPauseWhere() 作为查询条件
 *   - depth=0 只返回 ID（避免加载完整文档）
 *   - overrideAccess=true 绕过 read 权限（C 端公开查询不应受客服权限限制）
 *   - limit=1000 兜底（超过的暂停举报属于异常情况，需人工介入）
 */
export async function getPausedListingIds(
  payload: PayloadQueryPort,
): Promise<Array<string | number>> {
  const result = await payload.find({
    collection: 'listing-reports',
    where: listingReportPauseWhere(),
    depth: 0,
    limit: 1000,
    overrideAccess: true,
  })
  return extractPausedListingIds(result.docs)
}

/**
 * 判断指定 listing 是否在暂停列表中。
 *
 * 用于已查询 listings 候选后再过滤（如实时预览场景），避免在数据库层
 * 用 not_in 大列表过滤。
 *
 * 入参 pausedIds 应来自 getPausedListingIds 结果。
 */
export function isListingPaused(
  pausedIds: ReadonlyArray<string | number>,
  listingId: string | number,
): boolean {
  for (const id of pausedIds) {
    if (typeof id === 'string' && typeof listingId === 'string') {
      if (id === listingId) return true
      continue
    }
    if (typeof id === 'number' && typeof listingId === 'number') {
      if (id === listingId) return true
      continue
    }
    // 跨类型比较：转字符串后比较（兼容 number ID 与 string ID 混用场景）
    if (String(id) === String(listingId)) return true
  }
  return false
}
