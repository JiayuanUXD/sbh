/**
 * CRM 归属动作与归属状态纯逻辑（tasks.md M5.4/M5.8 / design §3.6 lead_ownership_history / R6, R8）
 *
 * 归属状态(ownership_status)独立于线索阶段(lead-stage.ts):一条线索处于哪个阶段与它归谁
 * 是两个正交维度。归属历史(lead_ownership_history)追加式不可改写——分配 / 认领 / 转派 /
 * 进入公海 / 回收各写一条记录,记录当时的 from/to 归属人与原因,不覆盖既往。
 *
 * 本模块只做枚举 + 动作→结果归属状态的纯推导 + 负向动作原因守卫,不查库、不写库。
 * 跨文档校验(经纪人容量、城市/团队匹配)在 assignment-policy.ts;写库+事件+审计在领域服务。
 */

/** 归属动作(顺序即业务呈现顺序)。 */
export const OWNERSHIP_ACTIONS = [
  'assign',
  'claim',
  'transfer',
  'to_public_pool',
  'reclaim',
] as const
export type OwnershipAction = (typeof OWNERSHIP_ACTIONS)[number]

export const OWNERSHIP_ACTION_LABELS: Record<OwnershipAction, string> = {
  assign: '分配',
  claim: '认领',
  transfer: '转派',
  to_public_pool: '进入公海',
  reclaim: '回收',
}

export function isOwnershipAction(value: unknown): value is OwnershipAction {
  return typeof value === 'string' && (OWNERSHIP_ACTIONS as readonly string[]).includes(value)
}

/** 归属状态(design §3.6:unassigned | assigned | public_pool)。 */
export const OWNERSHIP_STATUSES = ['unassigned', 'assigned', 'public_pool'] as const
export type OwnershipStatus = (typeof OWNERSHIP_STATUSES)[number]

export const OWNERSHIP_STATUS_LABELS: Record<OwnershipStatus, string> = {
  unassigned: '未分配',
  assigned: '已分配',
  public_pool: '公海',
}

export function isOwnershipStatus(value: unknown): value is OwnershipStatus {
  return typeof value === 'string' && (OWNERSHIP_STATUSES as readonly string[]).includes(value)
}

/**
 * 动作执行成功后线索应处于的归属状态。
 *
 *   - 分配 / 认领 / 转派 → assigned（有明确负责人）。
 *   - 进入公海 / 回收 → public_pool（回到可认领池）。
 */
export function ownershipStatusAfterAction(action: OwnershipAction): OwnershipStatus {
  switch (action) {
    case 'assign':
    case 'claim':
    case 'transfer':
      return 'assigned'
    case 'to_public_pool':
    case 'reclaim':
      return 'public_pool'
  }
}

/**
 * 该动作是否必须填写原因。
 *
 * 进入公海 / 回收是负向操作(线索脱离原负责人),必须留痕原因(R8 审计);
 * 分配 / 认领 / 转派为正向指派,不强制原因。
 */
export function requiresReason(action: OwnershipAction): boolean {
  return action === 'to_public_pool' || action === 'reclaim'
}
