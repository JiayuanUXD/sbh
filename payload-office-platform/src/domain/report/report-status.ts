/**
 * 房源举报状态机纯函数（tasks.md M6.1 / design §3.5 listing_reports / R5）
 *
 * 单一真源：举报处理状态枚举 + 中文标签 + 合法转换表 + 终态 / 结论守卫。
 * 无 payload / React 依赖，可独立单测。跨文档校验（版本号、权限门、供给副作用）
 * 在 report-transition.ts / report-supply-effect.ts / report-protect.ts。
 *
 * 状态机（design §3.5 + R5）：
 *   pending-triage 分诊 --assign-->     assigned 已领取
 *   assigned        --verify-->        verifying 核实中
 *   verifying       --await-info-->   awaiting-info 等待资料
 *   awaiting-info   --resume-->        verifying 核实中
 *   verifying       --submit-review--> submitted-review 提交复核
 *   awaiting-info   --submit-review-->  submitted-review 提交复核
 *   submitted-review --reject-review--> verifying 退回核实
 *   submitted-review --close-->         closed 关闭
 *   pending-triage / assigned / verifying --close--> closed 提前关闭
 *
 * closed 为终态，不允许再切换。结论（sustained/dismissed/partial）仅在 closed 时填写。
 */

/** 举报处理状态。 */
export const REPORT_STATUSES = [
  'pending-triage',
  'assigned',
  'verifying',
  'awaiting-info',
  'submitted-review',
  'closed',
] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  'pending-triage': '待分诊',
  assigned: '已领取',
  verifying: '核实中',
  'awaiting-info': '等待资料',
  'submitted-review': '提交复核',
  closed: '已关闭',
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value)
}

/** 举报结论（仅 closed 时填写）。 */
export const REPORT_CONCLUSIONS = ['sustained', 'dismissed', 'partial'] as const
export type ReportConclusion = (typeof REPORT_CONCLUSIONS)[number]

export const REPORT_CONCLUSION_LABELS: Record<ReportConclusion, string> = {
  sustained: '举报成立',
  dismissed: '举报不成立',
  partial: '部分成立',
}

export function isReportConclusion(value: unknown): value is ReportConclusion {
  return typeof value === 'string' && (REPORT_CONCLUSIONS as readonly string[]).includes(value)
}

/** 举报原因码（design §3.5 reason_code）。 */
export const REPORT_REASONS = [
  'false-info',
  'price-anomaly',
  'leased-not-delisted',
  'policy-violation',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  'false-info': '虚假信息',
  'price-anomaly': '价格异常',
  'leased-not-delisted': '已出租未下架',
  'policy-violation': '违规内容',
  other: '其他',
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value)
}

/**
 * 合法转换表：from → 允许的目标状态集合。缺项即非法。
 *
 * 设计意图（R5）：
 *   - 主路径 pending-triage → assigned → verifying → submitted-review → closed
 *   - awaiting-info 可与 verifying 互转（资料未齐 ↔ 资料到位）
 *   - submitted-review 可退回 verifying（复核不通过需补充调查）
 *   - 任意非终态均可直接 closed（误报 / 重复 / 撤销）
 *   - closed 为终态，无后续转换
 */
const TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  'pending-triage': ['assigned', 'closed'],
  assigned: ['verifying', 'closed'],
  verifying: ['awaiting-info', 'submitted-review', 'closed'],
  'awaiting-info': ['verifying', 'submitted-review'],
  'submitted-review': ['verifying', 'closed'],
  closed: [],
}

/** 当前状态下是否允许切换到目标状态。 */
export function canTransitionReport(from: ReportStatus, to: ReportStatus): boolean {
  return (TRANSITIONS[from] as readonly ReportStatus[]).includes(to)
}

/** 当前状态下所有合法目标状态（供 UI 禁用非法按钮 / 测试枚举用）。 */
export function allowedReportTransitions(from: ReportStatus): readonly ReportStatus[] {
  return TRANSITIONS[from]
}

/** 是否为终态（closed 后不再流转）。 */
export function isTerminalStatus(status: ReportStatus): boolean {
  return status === 'closed'
}

/**
 * 关闭是否必须填写结论。
 *
 * closed 必须有 conclusion（sustained/dismissed/partial）和 conclusionReason。
 * 其余状态不强制结论（design §3.5 resolution + resolution_reason）。
 */
export function requiresConclusion(status: ReportStatus): boolean {
  return status === 'closed'
}
