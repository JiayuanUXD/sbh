/**
 * 房源审核提交快照与任务状态编排（tasks.md M4.4 / design §3.5 listing_reviews / R4, R8）
 *
 * 承接 review-status.ts 之上的「跨文档」纯逻辑：
 *   - 从房源文档冻结**不可变提交快照**（归一关系为 id，剥离易变/无关字段）。
 *   - 计算**确定性快照哈希**（sha256，键排序后序列化 → 与键顺序无关）。
 *   - 审核任务生命周期 task_status（design §4.3：待处理 → 处理中 → 已完成/已取消）。
 *   - 驳回必须填写原因的守卫。
 *
 * 无 payload / React 依赖，可独立单测。审核状态轴（not_submitted/pending/approved/
 * rejected）仍由 review-status.ts 单源；本模块只负责快照与任务状态。
 */

import { createHash } from 'node:crypto'

import { InvalidOperationError } from '@/domain/shared/errors'
import type { ReviewDecision } from '@/domain/review/review-status'

/**
 * 审核任务生命周期状态（design §4.3 待办通用流转，落到审核任务）：
 *   pending 待处理（待领取）→ processing 处理中（已领取）→ resolved 已完成（通过/驳回）
 *   pending/processing → cancelled 已取消（提交后撤回）
 */
export const REVIEW_TASK_STATUSES = ['pending', 'processing', 'resolved', 'cancelled'] as const
export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number]

export const REVIEW_TASK_STATUS_LABELS: Record<ReviewTaskStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已完成',
  cancelled: '已取消',
}

export function isReviewTaskStatus(value: unknown): value is ReviewTaskStatus {
  return typeof value === 'string' && (REVIEW_TASK_STATUSES as readonly string[]).includes(value)
}

/**
 * 审核动作落到审核记录的任务状态：
 *   submit     → pending    新建待领取任务
 *   withdraw   → cancelled  作者撤回，任务作废
 *   approve    → resolved   审核完成（通过）
 *   reject     → resolved   审核完成（驳回）
 *   fast_track → resolved   免审直发：房源已进入 approved，没有待办留给审核台
 * 领取动作（pending → processing）不在此表，由审核台 claim 单独驱动。
 *
 * fast_track 记 resolved 而不是 pending，否则审核队列里会挂着一条永远等不到人处理
 * 的任务——房源其实已经上架了。
 */
export function taskStatusForDecision(decision: ReviewDecision): ReviewTaskStatus {
  switch (decision) {
    case 'submit':
      return 'pending'
    case 'withdraw':
      return 'cancelled'
    case 'approve':
    case 'reject':
    case 'fast_track':
      return 'resolved'
  }
}

/**
 * 驳回必须填写原因（design：审核台驳回强制原因）。其余动作不强制。
 * 供 endpoint 与 protect hook 复用，集中原因门槛。
 */
export function assertReasonForDecision(decision: ReviewDecision, reason: unknown): void {
  if (decision !== 'reject') return
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new InvalidOperationError({
      domain: 'review',
      code: 'REVIEW_REASON_REQUIRED',
      message: '驳回必须填写原因',
    })
  }
}

/** 结构化价格快照（对应 Listings price group）。 */
export interface SnapshotPrice {
  amount?: number
  currency?: string
  period?: string
  unit?: string
}

/**
 * 不可变提交快照：审核发生时冻结房源关键事实，后续房源被编辑也不影响历史审核对比。
 * 关系字段统一归一为 id（number|string），剥离 populated 对象与易变展示字段。
 */
export interface ListingReviewSnapshot {
  listing: number | string
  listingVersion: number
  title?: unknown
  slug?: unknown
  listingType?: unknown
  building?: number | string | null
  businessType?: unknown
  decorationStatus?: unknown
  price?: SnapshotPrice
  area?: unknown
  floor?: unknown
  minimumLeaseMonths?: unknown
  paymentTerms?: unknown
  availableFrom?: unknown
  /**
   * 产权年限（出售专属提交必填）。
   *
   * 一直漏在快照外：`getSubmitRequiredFields('sale')` 把它列为必填，而快照不带，
   * 于是每一套出售房源的完整度都恒报「请选择产权年限」——哪怕表单里已经选了。
   * D 项的完整度引导直接展示这份 missing，漏字段会变成一条洗不掉的假提示，故补上。
   */
  propertyRightYears?: unknown
  description?: unknown
  contactBroker?: number | string | null
  merchant?: number | string | null
  galleryCount: number
}

/** 关系值归一：id 或 populated 对象 → id（number|string），无值 → null。 */
function toId(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

/** 剥出结构化价格（仅保留四要素，避免带入无关字段）。 */
function toPrice(value: unknown): SnapshotPrice | undefined {
  if (!value || typeof value !== 'object') return undefined
  const p = value as SnapshotPrice
  return { amount: p.amount, currency: p.currency, period: p.period, unit: p.unit }
}

/** 从房源文档构造不可变提交快照。 */
export function buildListingSnapshot(doc: Record<string, unknown>): ListingReviewSnapshot {
  const listingId = toId(doc.id)
  const gallery = Array.isArray(doc.gallery) ? doc.gallery : []
  return {
    listing: listingId ?? '',
    listingVersion: typeof doc.version === 'number' ? doc.version : 1,
    title: doc.title,
    slug: doc.slug,
    listingType: doc.listingType,
    building: toId(doc.building),
    businessType: doc.businessType,
    decorationStatus: doc.decorationStatus,
    price: toPrice(doc.price),
    area: doc.area,
    floor: doc.floor,
    minimumLeaseMonths: doc.minimumLeaseMonths,
    paymentTerms: doc.paymentTerms,
    availableFrom: doc.availableFrom,
    // 嵌在 saleTerms group 里，不在顶层（详见 listing-completeness.ts 同名字段处注释）
    propertyRightYears: (doc.saleTerms as Record<string, unknown> | undefined)?.propertyRightYears,
    description: doc.description,
    contactBroker: toId(doc.contactBroker),
    merchant: toId(doc.merchant),
    galleryCount: gallery.length,
  }
}

/** 稳定序列化：递归按键排序，保证哈希与键顺序无关。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  )
  return `{${entries.join(',')}}`
}

/** 计算确定性快照哈希（sha256 十六进制，64 位）。 */
export function computeSnapshotHash(snapshot: ListingReviewSnapshot): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex')
}
