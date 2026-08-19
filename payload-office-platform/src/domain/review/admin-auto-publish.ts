/**
 * 平台管理员保存即发布（OPT-033 C）
 *
 * 免审直发从「有人点一下」改成「平台管理员保存房源时自动发生」。这里只做**判定**，
 * 不碰 IO，便于单测；写库与审计由 hook 执行。
 *
 * 三条口径：
 *   1. 只有平台管理员（内置角色 ADM）触发，其它角色照常走人工审核；
 *   2. **绕过完整度校验**——管理员哪怕只填了一个字段也照样上架。
 *
 *      这条是 2026-08-19 用户明确推翻先前决定后改的。原口径是「不绕过」，理由是
 *      放行不达标房源会造出「后台显示已发布、前台看不到」的幽灵——前台有效供给
 *      精筛（图片≥3、商户关系在有效期、商户合格）实时判定，不达标会被静默排除，
 *      而发布状态不会跟着变。
 *
 *      推翻时这个代价已经摆在明面上并被接受：管理员要的是「我说发就发」，前台可见
 *      与否是另一回事。**精筛没有一起绕过**，所以幽灵房源确实会存在——不是疏忽。
 *
 *      完整度仍然照算，只是不再拦截：`missing` 照常返回，供表单提示「已发布，但缺
 *      少 X，前台暂不可见」。判定与提示因此共用同一份口径，不会各说各话。
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

export interface AdminAutoPublishDecision {
  /** 是否自动上架。false 时房源照常保存，只是不动两轴。 */
  publish: boolean
  /** 不上架的原因；publish 为 true 时是 null。 */
  skipReason: AdminAutoPublishSkipReason | null
  /**
   * 完整度缺失项。**不再决定放不放行**，只用于提示。
   *
   * publish=true 时也可能非空——那正是「已发布但前台看不到」的场景，表单据此
   * 提示管理员还差什么。skipReason 非 null 时为空数组。
   */
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

  // 照算不照拦：管理员一律放行，缺什么留给提示层说。
  const completeness = checkListingCompleteness(input.snapshot, 'submit')

  return { publish: true, skipReason: null, missing: completeness.missing }
}
