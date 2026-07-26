/**
 * 房源发布状态机 + 供给可见性冻结纯函数（tasks.md M4.6 / M4.8 / design §3.4）
 *
 * 发布轴（publication_status）独立于审核轴（review_status）：
 *   草稿 draft --publish-->  已发布 published   （前置：审核通过 + 有效供给谓词，endpoint 校验）
 *   已发布 published --unpublish--> 已下架 unpublished（须记录下架原因，endpoint 强制）
 *   已下架 unpublished --publish--> 已发布 published（重新上架，同样过前置门）
 *   草稿/已发布/已下架 --mark_leased--> 已租 leased（自动撤销推荐 + 收回前台可见，endpoint 处理副作用）
 *
 * 审核通过不隐式发布：approve 只改 review_status；上架必须由具 listing:publish
 * 权限者显式执行（design §3.5 / R3）。已租为终态。
 *
 * 供给可见性冻结（supply_visibility_hold，M4.8）：商户停用批量置关联房源为
 * pending_recheck；商户重新启用不自动清除；运营人工复核清除后重新上架仍需发布权限。
 * 该字段作为有效供给谓词第 4 条（supply_visibility_hold=normal）的开关，
 * 不改写 publication_status / review_status（R3 不隐式改写关联房源状态）。
 */

/** 发布状态。 */
export const PUBLICATION_STATUSES = ['draft', 'published', 'unpublished', 'leased'] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: '草稿',
  published: '已发布',
  unpublished: '已下架',
  leased: '已租',
}

export function isPublicationStatus(value: unknown): value is PublicationStatus {
  return typeof value === 'string' && (PUBLICATION_STATUSES as readonly string[]).includes(value)
}

/** 发布动作。 */
export const PUBLISH_ACTIONS = ['publish', 'unpublish', 'mark_leased'] as const
export type PublishAction = (typeof PUBLISH_ACTIONS)[number]

export const PUBLISH_ACTION_LABELS: Record<PublishAction, string> = {
  publish: '发布',
  unpublish: '下架',
  mark_leased: '标记成交',
}

export function isPublishAction(value: unknown): value is PublishAction {
  return typeof value === 'string' && (PUBLISH_ACTIONS as readonly string[]).includes(value)
}

/** 合法转移表：from → 动作 → to。缺项即非法。 */
const TRANSITIONS: Record<PublicationStatus, Partial<Record<PublishAction, PublicationStatus>>> = {
  draft: { publish: 'published', mark_leased: 'leased' },
  published: { unpublish: 'unpublished', mark_leased: 'leased' },
  unpublished: { publish: 'published', mark_leased: 'leased' },
  leased: {},
}

export function canTransitionPublication(from: PublicationStatus, action: PublishAction): boolean {
  return TRANSITIONS[from]?.[action] !== undefined
}

export function nextPublicationStatus(
  from: PublicationStatus,
  action: PublishAction,
): PublicationStatus | null {
  return TRANSITIONS[from]?.[action] ?? null
}

/** 供给可见性冻结态。 */
export const SUPPLY_VISIBILITY_HOLDS = ['normal', 'pending_recheck'] as const
export type SupplyVisibilityHold = (typeof SUPPLY_VISIBILITY_HOLDS)[number]

export const SUPPLY_VISIBILITY_HOLD_LABELS: Record<SupplyVisibilityHold, string> = {
  normal: '正常',
  pending_recheck: '待复核',
}

export function isSupplyVisibilityHold(value: unknown): value is SupplyVisibilityHold {
  return typeof value === 'string' && (SUPPLY_VISIBILITY_HOLDS as readonly string[]).includes(value)
}

/**
 * 历史 status（available/reserved/leased/archived）→ publication_status 映射。
 * 关键约束（design §3.4 / M4.1）：历史房源未经审核，不得自动视为已发布。
 * available/reserved 一律落到 draft（草稿），需重新走审核发布流程才可上架；
 * leased 保留成交态；archived 视为已下架；未知值保守落 draft。
 */
export function mapLegacyStatusToPublication(legacy: unknown): PublicationStatus {
  switch (legacy) {
    case 'leased':
      return 'leased'
    case 'archived':
      return 'unpublished'
    case 'available':
    case 'reserved':
    default:
      return 'draft'
  }
}
