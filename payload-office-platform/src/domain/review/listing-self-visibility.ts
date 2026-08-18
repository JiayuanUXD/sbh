/**
 * 房源编辑页「前台可见性」自身条件判定（OPT-030 §4）
 *
 * 运营的真实痛点是「填完、保存成功、审核通过，前台还是没有」——12 条有效供给
 * 判据（.agent/supply.md）在编辑时全部不可见。本模块把其中**房源自身**的 5 条
 * （发布状态 §2 / 审核状态 §3 / 供给可见性冻结 §4 / 举报暂停 §5 / 有效媒体 §6）
 * 拆成逐条可展示、可定位的结果，供编辑页常驻可见性卡片使用。
 *
 * 口径约束：
 *   - 判值与 getEffectiveSupplyWhere 的查询层谓词严格一致（published / approved /
 *     normal），本模块只做展示拆解，不另立判定；
 *   - 媒体下限复用 MIN_EFFECTIVE_MEDIA（与 checkListingCompleteness 的
 *     MIN_SUBMIT_MEDIA 对齐，提交审核与前台可见同一条 3 张线）；
 *   - 跨对象条件（商户关系 §8 / 商户资质与服务城市 §9-§10 / 楼盘·城市·行政区 §7 /
 *     服务城市覆盖 / 陈旧 §12）**刻意不纳入**——任务包 §2 已决定：避免每次渲染
 *     多查商户关系与资质。因此 visible=true 只代表「自身条件已齐」，不等于前台
 *     必然可见；卡片文案明确标注这一点。
 *
 * 无 payload / React 依赖，可独立单测。
 */

import { MIN_EFFECTIVE_MEDIA } from '@/domain/review/effective-supply'
import { PUBLICATION_STATUS_LABELS, type PublicationStatus } from '@/domain/review/publication-status'
import { REVIEW_STATUS_LABELS, type ReviewStatus } from '@/domain/review/review-status'

/** 判定入参：房源自身状态快照（含未保存的表单值，由调用方组装）。 */
export interface ListingSelfVisibilityInput {
  publicationStatus?: unknown
  reviewStatus?: unknown
  supplyVisibilityHold?: unknown
  /** 有效图片数（编辑页取表单 gallery 数组长度）。 */
  galleryCount?: number
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
    | 'gallery'
  /** 该条是否满足。 */
  ok: boolean
  /** 简短结论（如「已上架」「有效图片 2/3」）。 */
  label: string
  /** 不满足时的修复指引；满足时为空串。 */
  hint: string
  /**
   * 前端定位目标：Payload 编辑表单的 Tab 标题（Listings.ts tabs.label）。
   * reportPaused 无表单落点，由卡片直接链到举报列表。
   */
  locateTab: '审核与发布' | '展示内容' | null
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
  const galleryCount = input.galleryCount ?? 0

  const checks: SelfVisibilityCheck[] = [
    {
      key: 'publicationStatus',
      ok: input.publicationStatus === 'published',
      label: input.publicationStatus === 'published' ? '已上架' : `未上架（${publicationLabel(input.publicationStatus)}）`,
      hint:
        input.publicationStatus === 'published'
          ? ''
          : '审核通过后需在「审核与发布」走显式发布动作，审核通过不会自动上架',
      locateTab: '审核与发布',
      locateFieldLabel: '发布状态',
    },
    {
      key: 'reviewStatus',
      ok: input.reviewStatus === 'approved',
      label: input.reviewStatus === 'approved' ? '审核通过' : `未通过审核（${reviewLabel(input.reviewStatus)}）`,
      hint: input.reviewStatus === 'approved' ? '' : '房源需提交审核并通过后才能上架',
      locateTab: '审核与发布',
      locateFieldLabel: '审核状态',
    },
    {
      key: 'supplyVisibilityHold',
      ok: input.supplyVisibilityHold === 'normal',
      label: input.supplyVisibilityHold === 'normal' ? '可见性正常' : '可见性待复核',
      hint: input.supplyVisibilityHold === 'normal' ? '' : '该房源被标记为待复核（如商户停用触发），复核清除前前台不展示',
      locateTab: '审核与发布',
      locateFieldLabel: '供给可见性冻结',
    },
    {
      key: 'reportPaused',
      ok: !input.reportPaused,
      label: input.reportPaused ? '被举报暂停' : '未被举报暂停',
      hint: input.reportPaused ? '存在生效的举报暂停，处理举报后恢复展示' : '',
      locateTab: null,
    },
    {
      key: 'gallery',
      ok: galleryCount >= MIN_EFFECTIVE_MEDIA,
      label: `有效图片 ${galleryCount}/${MIN_EFFECTIVE_MEDIA}`,
      hint:
        galleryCount >= MIN_EFFECTIVE_MEDIA
          ? ''
          : `还差 ${MIN_EFFECTIVE_MEDIA - galleryCount} 张，前台有效供给要求至少 ${MIN_EFFECTIVE_MEDIA} 张有效图片`,
      locateTab: '展示内容',
      locateFieldLabel: '图片相册',
    },
  ]

  const primaryBlocker = checks.find((check) => !check.ok) ?? null

  return {
    selfVisible: primaryBlocker === null,
    checks,
    primaryBlocker,
  }
}
