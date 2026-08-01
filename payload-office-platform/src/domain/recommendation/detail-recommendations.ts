/**
 * 可解释情境推荐 - 确定性打分（P2 Task 5）
 *
 * 设计原则：
 *   - 只使用当前页面实体与显式筛选上下文，不建立跨会话用户画像
 *   - 不读取 cookie、localStorage、用户 ID、手机号或 Lead
 *   - 每条推荐输出 reasonCodes，可在前端展示可读理由
 *   - 最多返回 6 条，每条至少一个 reasonCode
 *   - 同分使用不可变 listing ID 升序收束，确保确定性
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 候选房源的打分所需字段（从 ListingCardViewModel + building 信息投影） */
export interface RecommendationCandidate {
  id: number
  listingType: string
  businessType: 'lease' | 'sale'
  area: number | null
  priceAmount: number | null
  priceUnit: string | null
  /** 楼盘所在行政区 ID */
  buildingDistrictId: number | null
  /** 楼盘所在商圈 ID */
  buildingBusinessDistrictId: number | null
}

/** 推荐上下文：从当前详情页实体提取，不含任何用户身份信息 */
export interface RecommendationContext {
  currentListingId: number
  listingType: string
  businessType: 'lease' | 'sale'
  area: number | null
  priceAmount: number | null
  priceUnit: string | null
  buildingDistrictId: number | null
  buildingBusinessDistrictId: number | null
}

/** 推荐结果 */
export interface RecommendationResult {
  candidate: RecommendationCandidate
  score: number
  reasonCodes: readonly ReasonCode[]
}

/** 可解释理由编码 */
export type ReasonCode =
  | 'same-business-area'
  | 'same-listing-type'
  | 'same-price-unit'
  | 'similar-area'
  | 'similar-price'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 固定权重（不可配置，确保确定性） */
const WEIGHTS = {
  sameBusinessArea: 40,
  sameListingType: 25,
  samePriceUnit: 20,
  similarArea: 10,
  similarPrice: 5,
} as const

/** 面积相似阈值：差异在 ±50% 内视为相近 */
const AREA_SIMILARITY_RATIO = 0.5

/** 价格相似阈值：差异在 ±30% 内视为相近 */
const PRICE_SIMILARITY_RATIO = 0.3

/** 最大返回条数 */
const MAX_RESULTS = 6

// ---------------------------------------------------------------------------
// Privacy guard: 禁止的 context 字段
// ---------------------------------------------------------------------------

const FORBIDDEN_CONTEXT_KEYS = new Set([
  'userId',
  'phone',
  'email',
  'cookie',
  'localStorage',
  'sessionStorage',
  'sessionHistory',
  'browsingHistory',
  'leadId',
  'token',
  'fingerprint',
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 对候选房源进行确定性打分排序。
 *
 * @param candidates - 有效供给候选列表（已排除失效房源）
 * @param context - 当前详情页上下文（不含用户身份）
 * @returns 按分数降序、同分 ID 升序的推荐结果（最多 6 条，每条至少 1 个 reasonCode）
 */
export function rankDetailRecommendations(
  candidates: readonly RecommendationCandidate[],
  context: RecommendationContext,
): RecommendationResult[] {
  if (candidates.length === 0) return []

  const scored: RecommendationResult[] = []

  for (const c of candidates) {
    // 排除当前房源自身
    if (c.id === context.currentListingId) continue

    const reasonCodes: ReasonCode[] = []
    let score = 0

    // 同商圈
    if (
      context.buildingBusinessDistrictId != null &&
      c.buildingBusinessDistrictId != null &&
      c.buildingBusinessDistrictId === context.buildingBusinessDistrictId
    ) {
      score += WEIGHTS.sameBusinessArea
      reasonCodes.push('same-business-area')
    }

    // 同类型
    if (c.listingType === context.listingType) {
      score += WEIGHTS.sameListingType
      reasonCodes.push('same-listing-type')
    }

    // 同价格单位
    if (
      context.priceUnit != null &&
      c.priceUnit != null &&
      c.priceUnit === context.priceUnit
    ) {
      score += WEIGHTS.samePriceUnit
      reasonCodes.push('same-price-unit')
    }

    // 相近面积
    if (
      context.area != null &&
      context.area > 0 &&
      c.area != null &&
      c.area > 0
    ) {
      const ratio = Math.abs(c.area - context.area) / context.area
      if (ratio <= AREA_SIMILARITY_RATIO) {
        score += WEIGHTS.similarArea
        reasonCodes.push('similar-area')
      }
    }

    // 相近价格
    if (
      context.priceAmount != null &&
      context.priceAmount > 0 &&
      c.priceAmount != null &&
      c.priceAmount > 0 &&
      context.priceUnit != null &&
      c.priceUnit === context.priceUnit // 只有同单位才可比
    ) {
      const ratio = Math.abs(c.priceAmount - context.priceAmount) / context.priceAmount
      if (ratio <= PRICE_SIMILARITY_RATIO) {
        score += WEIGHTS.similarPrice
        reasonCodes.push('similar-price')
      }
    }

    // 至少一个 reasonCode 才入选
    if (reasonCodes.length > 0) {
      scored.push({ candidate: c, score, reasonCodes })
    }
  }

  // 排序：分数降序 → 同分 ID 升序（确定性收束）
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.candidate.id - b.candidate.id
  })

  return scored.slice(0, MAX_RESULTS)
}

/**
 * 解析并校验推荐上下文：拒绝任何包含用户身份/跨会话信息的输入。
 *
 * @param raw - 原始输入对象
 * @returns 校验结果
 */
export function parseRecommendationContext(
  raw: Record<string, unknown>,
): { ok: true; value: RecommendationContext } | { ok: false; error: 'invalid_context' } {
  // 检查禁止字段
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_CONTEXT_KEYS.has(key)) {
      return { ok: false, error: 'invalid_context' }
    }
  }

  // 校验必需字段存在且类型正确
  if (typeof raw.currentListingId !== 'number') return { ok: false, error: 'invalid_context' }
  if (typeof raw.listingType !== 'string') return { ok: false, error: 'invalid_context' }
  if (raw.businessType !== 'lease' && raw.businessType !== 'sale') {
    return { ok: false, error: 'invalid_context' }
  }

  return {
    ok: true,
    value: {
      currentListingId: raw.currentListingId as number,
      listingType: raw.listingType as string,
      businessType: raw.businessType as 'lease' | 'sale',
      area: typeof raw.area === 'number' ? raw.area : null,
      priceAmount: typeof raw.priceAmount === 'number' ? raw.priceAmount : null,
      priceUnit: typeof raw.priceUnit === 'string' ? raw.priceUnit : null,
      buildingDistrictId: typeof raw.buildingDistrictId === 'number' ? raw.buildingDistrictId : null,
      buildingBusinessDistrictId:
        typeof raw.buildingBusinessDistrictId === 'number' ? raw.buildingBusinessDistrictId : null,
    },
  }
}
