/**
 * 房源完整度计算（tasks.md M7.4 / R4）
 *
 * 完整度 = 已填写字段的权重之和 / 总权重。低于 80% 视为「待维护」。
 *
 * 权重分布（与 listing schema 一一对应，可在不破坏已有指标口径下扩展）：
 *   - 基本信息（25%）：title / slug / listingType / building / businessType / decorationStatus
 *   - 租赁参数（25%）：price.amount / price.currency / price.period / price.unit / area / minimumLeaseMonths
 *   - 媒体展示（30%）：coverImage（10%）+ gallery ≥ 3 张（20%）
 *   - 内容补充（20%）：highlights ≥ 1 条（10%）+ description 非空（10%）
 *
 * 业务不变量：
 *   - 完整度∈[0, 1]
 *   - 任何关键字段缺失都会显著拉低完整度（确保 80% 阈值可识别「待维护」房源）
 *   - 不依赖 Payload，纯函数便于单测
 *
 * 注意：
 *   - 当前以 gallery 数组长度为准；M5 接入完整度字段后可替换此模块
 *   - description 是 RichText，此处仅判定是否有内容（string 或 lexical 节点数组）
 */

/** 完整度阈值（低于此值视为待维护） */
export const COMPLETENESS_THRESHOLD = 0.8

/** 各字段权重 */
export const COMPLETENESS_WEIGHTS = {
  // 基本信息（25%）
  title: 0.05,
  slug: 0.05,
  listingType: 0.05,
  building: 0.05,
  businessType: 0.025,
  decorationStatus: 0.025,
  // 租赁参数（25%）
  priceAmount: 0.07,
  priceCurrency: 0.02,
  pricePeriod: 0.02,
  priceUnit: 0.02,
  area: 0.07,
  minimumLeaseMonths: 0.05,
  // 媒体展示（30%）
  coverImage: 0.1,
  galleryCount: 0.2, // gallery ≥ 3 张才计满
  // 内容补充（20%）
  highlights: 0.1, // ≥ 1 条
  description: 0.1,
} as const

/** 完整度计算结果 */
export interface CompletenessResult {
  /** 完整度 [0, 1] */
  score: number
  /** 是否低于阈值（< 0.8） */
  belowThreshold: boolean
}

/**
 * 计算 Listing 完整度。
 *
 * 入参为 Payload Listing 文档（已读取），函数仅做字段存在性 + 基本有效性判定。
 *
 * @param doc Listing 文档（任何形态：完整对象 / 测试 mock）
 * @param minGallerySize 媒体下限（默认 3，与有效供给一致）
 */
export function computeListingCompleteness(
  doc: Record<string, unknown>,
  minGallerySize = 3,
): CompletenessResult {
  let score = 0

  // 基本信息
  if (isNonEmptyString(doc.title)) score += COMPLETENESS_WEIGHTS.title
  if (isNonEmptyString(doc.slug)) score += COMPLETENESS_WEIGHTS.slug
  if (isNonEmptyString(doc.listingType)) score += COMPLETENESS_WEIGHTS.listingType
  if (hasRef(doc.building)) score += COMPLETENESS_WEIGHTS.building
  if (isNonEmptyString(doc.businessType)) score += COMPLETENESS_WEIGHTS.businessType
  if (isNonEmptyString(doc.decorationStatus)) score += COMPLETENESS_WEIGHTS.decorationStatus

  // 租赁参数
  const price = doc.price
  if (isPlainObject(price)) {
    if (isPositiveNumber((price as Record<string, unknown>).amount)) {
      score += COMPLETENESS_WEIGHTS.priceAmount
    }
    if (isNonEmptyString((price as Record<string, unknown>).currency)) {
      score += COMPLETENESS_WEIGHTS.priceCurrency
    }
    if (isNonEmptyString((price as Record<string, unknown>).period)) {
      score += COMPLETENESS_WEIGHTS.pricePeriod
    }
    if (isNonEmptyString((price as Record<string, unknown>).unit)) {
      score += COMPLETENESS_WEIGHTS.priceUnit
    }
  }
  if (isPositiveNumber(doc.area)) score += COMPLETENESS_WEIGHTS.area
  if (isPositiveNumber(doc.minimumLeaseMonths)) {
    score += COMPLETENESS_WEIGHTS.minimumLeaseMonths
  }

  // 媒体展示
  if (hasRef(doc.coverImage)) score += COMPLETENESS_WEIGHTS.coverImage
  const gallerySize = arrayLength(doc.gallery)
  if (gallerySize >= minGallerySize) {
    score += COMPLETENESS_WEIGHTS.galleryCount
  } else if (gallerySize > 0) {
    // 部分填充：按比例计分（如 2/3 → 0.133）
    score += (gallerySize / minGallerySize) * COMPLETENESS_WEIGHTS.galleryCount
  }

  // 内容补充
  if (arrayLength(doc.highlights) > 0) score += COMPLETENESS_WEIGHTS.highlights
  if (hasRichTextContent(doc.description)) score += COMPLETENESS_WEIGHTS.description

  // 浮点数误差保护
  const rounded = Math.round(score * 1000) / 1000
  return {
    score: rounded,
    belowThreshold: rounded < COMPLETENESS_THRESHOLD,
  }
}

// ────────────────────────────────────────────────────────────
// 内部辅助
// ────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function isPositiveNumber(v: unknown): boolean {
  return typeof v === 'number' && v > 0 && Number.isFinite(v)
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasRef(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'number' && v > 0) return true
  if (typeof v === 'string' && v.length > 0) return true
  if (typeof v === 'object' && 'id' in (v as Record<string, unknown>)) {
    const id = (v as { id: unknown }).id
    return id !== null && id !== undefined
  }
  return false
}

function arrayLength(v: unknown): number {
  if (Array.isArray(v)) return v.length
  return 0
}

function hasRichTextContent(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  // Lexical 节点数组
  if (Array.isArray(v)) {
    return v.length > 0
  }
  // Lexical 根对象 { root: { children: [...] } }
  if (typeof v === 'object') {
    const root = (v as { root?: unknown }).root
    if (root && typeof root === 'object') {
      const children = (root as { children?: unknown }).children
      if (Array.isArray(children) && children.length > 0) return true
    }
  }
  return false
}
