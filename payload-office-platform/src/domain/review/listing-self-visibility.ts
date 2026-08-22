/**
 * 房源编辑页「前台可见性」自身条件判定（OPT-030 §4）
 *
 * 运营的真实痛点是「填完、保存成功、审核通过，前台还是没有」——12 条有效供给
 * 判据（.agent/supply.md）在编辑时全部不可见。本模块把其中**房源自身**的 4 条
 * （发布状态 §2 / 审核状态 §3 / 供给可见性冻结 §4 / 举报暂停 §5）
 * 拆成逐条可展示、可定位的结果，供编辑页常驻可见性卡片使用。
 *
 * 口径约束：
 *   - 判值与 getEffectiveSupplyWhere 的查询层谓词严格一致（published / approved /
 *     normal），本模块只做展示拆解，不另立判定；
 *   - **图片数量不在此列**（2026-08-19 起前台可见性不再看图片数，见
 *     `effective-supply.ts` 头部）。「提交审核至少 3 张」是另一回事，由完整度
 *     引导（`ListingCompletenessCardClient`）展示，不该混进可见性卡片——混进来就会
 *     把「没图也能上前台」误报成「暂不可见」。
 *   - 跨对象条件（房源是否已设供给商户 §8（OPT-034 起即 `listings.merchant`
 *     是否有值，无需额外查询）/ 商户资质与服务城市 §9-§10 / 楼盘·城市·行政区 §7 /
 *     服务城市覆盖 / 陈旧 §12）**刻意不纳入**——任务包 §2 已决定：避免每次渲染
 *     多查商户资质。因此 visible=true 只代表「自身条件已齐」，不等于前台
 *     必然可见；卡片文案明确标注这一点。
 *
 * 无 payload / React 依赖，可独立单测。
 */

import { PUBLICATION_STATUS_LABELS, type PublicationStatus } from '@/domain/review/publication-status'
import { REVIEW_STATUS_LABELS, type ReviewStatus } from '@/domain/review/review-status'

/** 判定入参：房源自身状态快照（含未保存的表单值，由调用方组装）。 */
export interface ListingSelfVisibilityInput {
  publicationStatus?: unknown
  reviewStatus?: unknown
  supplyVisibilityHold?: unknown
  /** 是否被有效举报暂停供给（§5，需服务端查 listing-reports）。 */
  reportPaused: boolean
}

/** 单条检查结果。 */
export interface SelfVisibilityCheck {
  /** 检查项键（稳定，供测试与前端定位）。 */
  key:
    | 'publicationStatus'
    | 'reviewStatus'
    | 'supplyVisibilityHold'
    | 'reportPaused'
  /** 该条是否满足。 */
  ok: boolean
  /** 简短结论（如「已上架」「未被举报暂停」）。 */
  label: string
  /** 不满足时的修复指引；满足时为空串。 */
  hint: string
  /**
   * 前端定位目标：Payload 编辑表单的 Tab 标题（Listings.ts tabs.label）。
   * reportPaused 无表单落点，由卡片直接链到举报列表。
   *
   * ⚠️ 取值必须与 `Listings.ts` 里 **tab 的 label 逐字一致**——`locateCheck` 是按
   * 按钮文字匹配的（`btn.textContent.trim() === locateTab`），对不上就静默不动作。
   * OPT-032 把 5 个 tab 收成 2 个，「审核与发布」降级为 collapsible 分节，
   * 状态类检查的定位目标随之改为「房源信息」，再由 locateFieldLabel 滚到具体字段。
   */
  locateTab: '房源信息' | '展示内容' | null
  /**
   * 定位到 Tab 后进一步滚动高亮的字段标签（Listings.ts 字段 label）。
   * 与 locateTab 配套；locateTab 为 null 时无定位行为。
   */
  locateFieldLabel?: string
}

export interface ListingSelfVisibilityResult {
  /** 自身条件是否全部满足（不等于前台必然可见，跨对象条件未判）。 */
  selfVisible: boolean
  checks: SelfVisibilityCheck[]
  /** 首个不满足项（保存后 Toast 的主因）；全满足为 null。 */
  primaryBlocker: SelfVisibilityCheck | null
}

function publicationLabel(value: unknown): string {
  return typeof value === 'string' && value in PUBLICATION_STATUS_LABELS
    ? PUBLICATION_STATUS_LABELS[value as PublicationStatus]
    : '未设置'
}

function reviewLabel(value: unknown): string {
  return typeof value === 'string' && value in REVIEW_STATUS_LABELS
    ? REVIEW_STATUS_LABELS[value as ReviewStatus]
    : '未设置'
}

/**
 * 逐条判定房源自身可见性条件。检查顺序即展示顺序；primaryBlocker 取首个不满足项。
 */
export function deriveListingSelfVisibility(
  input: ListingSelfVisibilityInput,
): ListingSelfVisibilityResult {
  const checks: SelfVisibilityCheck[] = [
    {
      key: 'publicationStatus',
      ok: input.publicationStatus === 'published',
      label: input.publicationStatus === 'published' ? '已上架' : `未上架（${publicationLabel(input.publicationStatus)}）`,
      hint:
        input.publicationStatus === 'published'
          ? ''
          : '审核通过后需在「审核与发布」走显式发布动作，审核通过不会自动上架',
      locateTab: '房源信息',
      locateFieldLabel: '发布状态',
    },
    {
      key: 'reviewStatus',
      ok: input.reviewStatus === 'approved',
      label: input.reviewStatus === 'approved' ? '审核通过' : `未通过审核（${reviewLabel(input.reviewStatus)}）`,
      hint: input.reviewStatus === 'approved' ? '' : '房源需提交审核并通过后才能上架',
      locateTab: '房源信息',
      locateFieldLabel: '审核状态',
    },
    {
      key: 'supplyVisibilityHold',
      ok: input.supplyVisibilityHold === 'normal',
      label: input.supplyVisibilityHold === 'normal' ? '可见性正常' : '可见性待复核',
      hint: input.supplyVisibilityHold === 'normal' ? '' : '该房源被标记为待复核（如商户停用触发），复核清除前前台不展示',
      locateTab: '房源信息',
      locateFieldLabel: '供给可见性冻结',
    },
    {
      key: 'reportPaused',
      ok: !input.reportPaused,
      label: input.reportPaused ? '被举报暂停' : '未被举报暂停',
      hint: input.reportPaused ? '存在生效的举报暂停，处理举报后恢复展示' : '',
      locateTab: null,
    },
  ]

  const primaryBlocker = checks.find((check) => !check.ok) ?? null

  return {
    selfVisible: primaryBlocker === null,
    checks,
    primaryBlocker,
  }
}
