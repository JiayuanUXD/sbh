/**
 * 平台管理员保存即发布（OPT-033 C）
 *
 * 免审直发从「有人点一下」改成「平台管理员保存房源时自动发生」。这里只做**判定**，
 * 不碰 IO，便于单测；写库与审计由 hook 执行。
 *
 * 三条口径（用户已拍板）：
 *   1. 只有平台管理员（内置角色 ADM）触发，其它角色照常走人工审核；
 *   2. **不绕过完整度校验**——不达标就正常存草稿，不上架、也不报错。
 *      放行不达标房源会造出「后台显示已发布、前台 404」的幽灵：前台有效供给精筛
 *      按图片数等条件实时判定，不达标会被静默撤下，而发布状态不会跟着变；
 *   3. 走既有状态机（`fast_track`），不绕过它。所以 pending 状态下不会自动上架
 *      ——已经进了审核队列的房源应当由审核人裁决，否则会出现「审核中却已通过」
 *      这种自相矛盾的轨迹。
 *
 * 审计上用 `fast_track` 而不是 `approve`：两者都让房源变成 approved，但只有前者
 * 能表达「没有第二个人复核过」。审计流里也用独立的 `listing.review_fast_track`。
 */

import {
  checkListingCompleteness,
  type ListingCompletenessSnapshot,
  type MissingItem,
} from '@/domain/review/listing-completeness'
import { canTransitionReview, isReviewStatus } from '@/domain/review/review-status'

/** 内置平台管理员角色码（见 src/test/factory/roles.ts BUILTIN_ROLES.ADM）。 */
export const PLATFORM_ADMIN_ROLE_CODE = 'ADM'

export interface AdminAutoPublishInput {
  /** 当前操作人的角色码集合（PermissionContext.roleCodes）。 */
  roleCodes: readonly string[]
  /** 本次写入后的审核状态。 */
  reviewStatus: unknown
  /** 完整度快照；关联型判定由调用方解析后传入。 */
  snapshot: ListingCompletenessSnapshot
}

export type AdminAutoPublishSkipReason =
  | 'not-admin'
  | 'illegal-transition'
  | 'incomplete'

export interface AdminAutoPublishDecision {
  /** 是否自动上架。false 时房源照常保存，只是不动两轴。 */
  publish: boolean
  /** 不上架的原因；publish 为 true 时是 null。 */
  skipReason: AdminAutoPublishSkipReason | null
  /** incomplete 时的缺失项，供可见性卡片/提示复用；其余情形为空数组。 */
  missing: MissingItem[]
}

const SKIP = (reason: AdminAutoPublishSkipReason, missing: MissingItem[] = []) =>
  ({ publish: false, skipReason: reason, missing }) as const

/** 判定一次保存是否应当自动上架。纯函数，无 IO。 */
export function decideAdminAutoPublish(
  input: AdminAutoPublishInput,
): AdminAutoPublishDecision {
  if (!input.roleCodes.includes(PLATFORM_ADMIN_ROLE_CODE)) return SKIP('not-admin')

  // 状态机说了算：not_submitted / rejected 才允许 fast_track。
  // approved 已经通过、pending 在队列里等人裁决，都不该被保存动作顶掉。
  const current = input.reviewStatus
  if (!isReviewStatus(current) || !canTransitionReview(current, 'fast_track')) {
    return SKIP('illegal-transition')
  }

  const completeness = checkListingCompleteness(input.snapshot, 'submit')
  if (!completeness.complete) return SKIP('incomplete', completeness.missing)

  return { publish: true, skipReason: null, missing: [] }
}
