/**
 * 线索阶段状态机纯函数（tasks.md M5.6 / design §4.2 / R6）
 *
 * 单一真源：线索阶段枚举 + 中文标签 + 合法转换表 + 终态 / 流失原因守卫 +
 * 旧 status→新 stage 映射（5.2 迁移用）。无 payload / React 依赖,可独立单测。
 * 跨文档校验（版本号、权限门、写库 + 事件 + 审计同事务）在 lead-transition.ts。
 *
 * 状态机（design §4.2）：
 *   new 新建 → pending_assignment 待分配 → following 跟进中 → qualified 有效商机
 *     → viewing 带看 → negotiation 谈判 → converted 已转化
 *   任意非终态 → lost 已流失（负向操作,须填原因）
 *
 * converted / lost 为终态,不允许再流转（含不能从 lost 复活）。
 * 公海(public_pool)是归属状态(ownership_status),不属于阶段,不在此状态机内。
 */

/** 线索阶段。顺序即 design §4.2 主链。 */
export const LEAD_STAGES = [
  'new',
  'pending_assignment',
  'following',
  'qualified',
  'viewing',
  'negotiation',
  'converted',
  'lost',
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: '新建',
  pending_assignment: '待分配',
  following: '跟进中',
  qualified: '有效商机',
  viewing: '带看',
  negotiation: '谈判',
  converted: '已转化',
  lost: '已流失',
}

export function isLeadStage(value: unknown): value is LeadStage {
  return typeof value === 'string' && (LEAD_STAGES as readonly string[]).includes(value)
}

/**
 * 合法转换表：from → 允许的目标阶段集合。缺项即非法。
 *
 * 设计意图（design §4.2 / R6）：
 *   - 主链严格逐级推进,不跳级、不逆流（qualified 不回 following）。
 *   - 任意非终态均可直接 lost（线索流失,须填原因）。
 *   - converted / lost 为终态,无后继。
 */
const TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  new: ['pending_assignment', 'lost'],
  pending_assignment: ['following', 'lost'],
  following: ['qualified', 'lost'],
  qualified: ['viewing', 'lost'],
  viewing: ['negotiation', 'lost'],
  negotiation: ['converted', 'lost'],
  converted: [],
  lost: [],
}

/** 当前阶段下是否允许切换到目标阶段。 */
export function canTransitionStage(from: LeadStage, to: LeadStage): boolean {
  return (TRANSITIONS[from] as readonly LeadStage[]).includes(to)
}

/** 当前阶段下所有合法目标阶段（供 UI 禁用非法按钮 / 测试枚举用）。 */
export function allowedStageTransitions(from: LeadStage): readonly LeadStage[] {
  return TRANSITIONS[from]
}

/** 是否为终态（converted / lost 后不再流转）。 */
export function isTerminalStage(stage: LeadStage): boolean {
  return stage === 'converted' || stage === 'lost'
}

/**
 * 目标阶段是否必须填写原因。
 *
 * 流失(lost)为负向操作,必须填原因（design §4.2 / R6 / 验收门）。
 * 正向阶段推进不强制原因。
 */
export function requiresLossReason(to: LeadStage): boolean {
  return to === 'lost'
}

/**
 * 旧简化 status → 新 stage 映射（5.2 迁移）。
 *
 * 旧 Leads.status 枚举:new / contacted / visited / won / lost。
 * 无法明确映射的旧值返回 null,交由迁移脚本输出「转人工复核清单」,不臆测。
 */
const LEGACY_STATUS_TO_STAGE: Record<string, LeadStage> = {
  new: 'new',
  contacted: 'following',
  visited: 'viewing',
  won: 'converted',
  lost: 'lost',
}

export function mapLegacyStatusToStage(legacyStatus: string): LeadStage | null {
  return LEGACY_STATUS_TO_STAGE[legacyStatus] ?? null
}
