/**
 * 房源状态矩阵 fixture（tasks.md M4）
 *
 * 业务不变量（AGENTS.md §5.1）：
 *   - 房源至少包含三个互不替代的机器字段：
 *     - publication_status：草稿 / 已上架 / 已下架 / 已出租
 *     - review_status：未提交 / 待审核 / 审核通过 / 已驳回
 *     - supply_visibility_hold：正常 / 待复核
 *   - 禁止将三个状态拼成一个持久化组合状态
 *   - 审核通过不自动上架
 *   - 因楼盘 / 区域 / 商户停用而改写审核或发布状态：禁止
 *
 * M0 阶段：仅产出 fixture，不写 Collection。
 */

import type { Money } from '@/domain/shared/money'

export type PublicationStatus = 'draft' | 'published' | 'unpublished' | 'leased'

export type ReviewStatus = 'unsubmitted' | 'pending' | 'approved' | 'rejected'

export type SupplyVisibilityHold = 'normal' | 'pending_recheck'

export type ListingStateTuple = {
  publication: PublicationStatus
  review: ReviewStatus
  supplyHold: SupplyVisibilityHold
}

export type ListingFixture = ListingStateTuple & {
  id: string
  slug: string
  title: string
  buildingId: string
  city: 'shanghai' | 'beijing' | 'shenzhen' | 'hangzhou' | 'guangzhou'
  district: string
  /** 月租金价格 */
  price: Money
  /** 面积（平方米） */
  areaSqm: number
  /** 媒体完整度（≥ 3 张图才允许提交审核） */
  mediaCount: number
  /** 当前版本号（用于乐观并发控制，AGENTS.md §6） */
  version: number
  /** 是否逻辑删除 */
  deletedAt: string | null
  /** 商户关系 ID（M4.2 引入 Listing 商户有效期关系） */
  merchantRelationId?: string
}

/**
 * 房源状态矩阵：覆盖 publication × review × supply_hold 的关键组合
 *
 * 组合规则（AGENTS.md §5.1）：
 *   - 只有 review=approved + supply_hold=normal + 其他有效供给谓词通过 → publication=published 才合法
 *   - 审核通过不自动上架
 *   - 旧状态保留迁移期，不立即删除
 */
export const LISTINGS: Record<string, ListingFixture> = {
  // 1. 正常上架（合法有效供给）
  'listing-published-clean': {
    id: 'listing-published-clean',
    slug: 'jingan-center-published',
    title: '静安中心 100 平精装办公室',
    buildingId: 'building-jingan-center',
    city: 'shanghai',
    district: 'jingan',
    price: { amount: 8000, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 100,
    mediaCount: 5,
    version: 3,
    deletedAt: null,
    publication: 'published',
    review: 'approved',
    supplyHold: 'normal',
    merchantRelationId: 'merchant-relation-active',
  },
  // 2. 草稿（未提交审核）
  'listing-draft': {
    id: 'listing-draft',
    slug: 'draft-office-pudong',
    title: '浦东草稿房源',
    buildingId: 'building-pudong',
    city: 'shanghai',
    district: 'pudong',
    price: { amount: 12000, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 150,
    mediaCount: 2, // < 3，不允许提交审核
    version: 1,
    deletedAt: null,
    publication: 'draft',
    review: 'unsubmitted',
    supplyHold: 'normal',
  },
  // 3. 待审核（已提交，未通过）
  'listing-pending-review': {
    id: 'listing-pending-review',
    slug: 'pending-review-office',
    title: '待审核办公室',
    buildingId: 'building-cbd-beijing',
    city: 'beijing',
    district: 'cbd',
    price: { amount: 15000, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 200,
    mediaCount: 4,
    version: 2,
    deletedAt: null,
    publication: 'draft',
    review: 'pending',
    supplyHold: 'normal',
  },
  // 4. 审核通过但未上架（验证不变量：审核通过不自动上架）
  'listing-approved-not-published': {
    id: 'listing-approved-not-published',
    slug: 'approved-not-published',
    title: '已审核未上架办公室',
    buildingId: 'building-nanshan-shenzhen',
    city: 'shenzhen',
    district: 'nanshan',
    price: { amount: 9000, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 110,
    mediaCount: 5,
    version: 4,
    deletedAt: null,
    publication: 'draft',
    review: 'approved',
    supplyHold: 'normal',
  },
  // 5. 已驳回（不允许上架）
  'listing-rejected': {
    id: 'listing-rejected',
    slug: 'rejected-office',
    title: '已驳回办公室',
    buildingId: 'building-tianhe-guangzhou',
    city: 'guangzhou',
    district: 'tianhe',
    price: { amount: 7000, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 80,
    mediaCount: 3,
    version: 2,
    deletedAt: null,
    publication: 'draft',
    review: 'rejected',
    supplyHold: 'normal',
  },
  // 6. 已上架但被举报暂停（supply_hold=pending_recheck）
  'listing-published-pending-recheck': {
    id: 'listing-published-pending-recheck',
    slug: 'published-pending-recheck',
    title: '上架后被举报暂停办公室',
    buildingId: 'building-jingan-center',
    city: 'shanghai',
    district: 'jingan',
    price: { amount: 8500, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 105,
    mediaCount: 5,
    version: 5,
    deletedAt: null,
    publication: 'published',
    review: 'approved',
    supplyHold: 'pending_recheck',
  },
  // 7. 已下架（仍可见审核状态，验证三状态独立性）
  'listing-unpublished': {
    id: 'listing-unpublished',
    slug: 'unpublished-office',
    title: '已下架办公室',
    buildingId: 'building-cbd-beijing',
    city: 'beijing',
    district: 'cbd',
    price: { amount: 14000, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 180,
    mediaCount: 4,
    version: 6,
    deletedAt: null,
    publication: 'unpublished',
    review: 'approved',
    supplyHold: 'normal',
  },
  // 8. 已出租（仍可见审核状态）
  'listing-leased': {
    id: 'listing-leased',
    slug: 'leased-office',
    title: '已出租办公室',
    buildingId: 'building-jingan-center',
    city: 'shanghai',
    district: 'jingan',
    price: { amount: 7800, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 95,
    mediaCount: 5,
    version: 7,
    deletedAt: null,
    publication: 'leased',
    review: 'approved',
    supplyHold: 'normal',
  },
  // 9. 逻辑删除（统一有效供给谓词必须排除）
  'listing-deleted': {
    id: 'listing-deleted',
    slug: 'deleted-office',
    title: '已逻辑删除办公室',
    buildingId: 'building-pudong',
    city: 'shanghai',
    district: 'pudong',
    price: { amount: 11000, currency: 'CNY', period: 'month', unit: 'suite' },
    areaSqm: 130,
    mediaCount: 4,
    version: 3,
    deletedAt: '2026-06-01T00:00:00.000Z',
    publication: 'unpublished',
    review: 'approved',
    supplyHold: 'normal',
  },
}

/** 按状态元组列出房源 */
export function listListingsByState(state: ListingStateTuple): ListingFixture[] {
  return Object.values(LISTINGS).filter(
    (l) =>
      l.publication === state.publication &&
      l.review === state.review &&
      l.supplyHold === state.supplyHold,
  )
}

/**
 * 统一有效供给谓词（AGENTS.md §5.2）
 *
 * 最低条件：
 *   - Listing 未逻辑删除
 *   - 已上架且审核通过
 *   - 未处于待复核冻结
 *   - 媒体完整（≥ 3 张）
 *
 * 完整有效供给谓词还包含 Building / 城市 / 区域启用、商户关系有效等；
 * 此处只实现 Listing 自身维度，Building / Merchant 维度在 M3-M4 扩展。
 */
export function isListingEligibleForSupply(listing: ListingFixture): {
  ok: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  if (listing.deletedAt !== null) reasons.push('listing_deleted')
  if (listing.publication !== 'published') reasons.push(`publication_${listing.publication}`)
  if (listing.review !== 'approved') reasons.push(`review_${listing.review}`)
  if (listing.supplyHold !== 'normal') reasons.push(`supply_hold_${listing.supplyHold}`)
  if (listing.mediaCount < 3) reasons.push('media_incomplete')
  return { ok: reasons.length === 0, reasons }
}

/**
 * 合法状态转换校验（AGENTS.md §5.1）
 *
 * 禁止：
 *   - 审核通过自动上架（必须显式 publish）
 *   - 因楼盘/区域/商户停用而改写审核状态或发布状态
 */
export function isLegalStateTransition(
  from: ListingStateTuple,
  to: ListingStateTuple,
): { ok: boolean; reason?: string } {
  // 审核状态合法转换
  const reviewTransitions: Record<ReviewStatus, ReviewStatus[]> = {
    unsubmitted: ['pending', 'unsubmitted'],
    pending: ['approved', 'rejected', 'unsubmitted'], // 可撤回
    approved: ['approved', 'unsubmitted'], // 通过后可重新进入未提交（如内容变更）
    rejected: ['pending', 'rejected'], // 驳回后可重新提交
  }
  if (!reviewTransitions[from.review]?.includes(to.review)) {
    return { ok: false, reason: `review_illegal_transition:${from.review}->${to.review}` }
  }

  // 发布状态合法转换
  const pubTransitions: Record<PublicationStatus, PublicationStatus[]> = {
    draft: ['draft', 'published', 'unpublished'],
    published: ['published', 'unpublished', 'leased'],
    unpublished: ['unpublished', 'published', 'draft'],
    leased: ['leased', 'unpublished'], // 已出租可下架但不回 draft
  }
  if (!pubTransitions[from.publication]?.includes(to.publication)) {
    return { ok: false, reason: `publication_illegal_transition:${from.publication}->${to.publication}` }
  }

  // 业务不变量：审核通过不自动上架（从 approved 跳到 published 必须显式 publish 动作，不能因 review 变化触发）
  // 此 fixture 校验仅检查状态合法性，显式 publish 由领域服务强制
  if (from.review !== 'approved' && to.publication === 'published' && from.publication !== 'published') {
    return { ok: false, reason: 'publish_requires_approved_review' }
  }

  return { ok: true }
}
