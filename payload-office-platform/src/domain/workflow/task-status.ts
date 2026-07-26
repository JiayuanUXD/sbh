/**
 * 待办状态机纯函数（tasks.md M6.4 / design §3.7 tasks / §4.3 待办状态机 / R6, R7, R8）
 *
 * 单一真源：待办状态枚举 + 中文标签 + 合法转换表 + 终态守卫。
 * 无 payload / React 依赖，可独立单测。跨文档校验（幂等键、版本号、权限门、
 * 自动闭环）在 task-protect.ts / task-service.ts / task-registry.ts。
 *
 * 状态机（design §4.3）：
 *   pending(待处理)   --start-->      in_progress(处理中)
 *   in_progress       --complete-->   completed(已完成)
 *   pending           --cancel-->     cancelled(已取消)
 *   in_progress       --cancel-->     cancelled(已取消)
 *
 * completed / cancelled 为终态，不允许再切换。
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *     （本模块仅定义状态机合法性，业务路径在 task-service 强制）
 *   - 逾期是计算属性，不新增持久化状态
 */

/** 待办状态。 */
export const TASK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待处理',
  in_progress: '处理中',
  completed: '已完成',
  cancelled: '已取消',
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === 'string' &&
    (TASK_STATUSES as readonly string[]).includes(value)
  )
}

/** 待办优先级（决定排序和处理紧急度）。 */
export const TASK_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低',
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    typeof value === 'string' &&
    (TASK_PRIORITIES as readonly string[]).includes(value)
  )
}

/**
 * 合法转换表：from → 允许的目标状态集合。缺项即非法。
 *
 * 设计意图（design §4.3）：
 *   - 主路径 pending → in_progress → completed
 *   - 任意非终态 → cancelled（来源取消 / 重复 / 误建）
 *   - completed / cancelled 为终态，无后续转换
 *   - 不允许 pending → completed 直跳：必须经过 in_progress
 *     （AGENTS.md §10：待办由来源业务事件完成，需先领取再完成）
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

/** 当前状态下是否允许切换到目标状态。 */
export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return (TRANSITIONS[from] as readonly TaskStatus[]).includes(to)
}

/** 当前状态下所有合法目标状态（供 UI 禁用非法按钮 / 测试枚举用）。 */
export function allowedTaskTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TRANSITIONS[from]
}

/** 是否为终态（completed / cancelled 后不再流转）。 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled'
}

/** 是否为活跃态（pending / in_progress：仍可领取 / 完成 / 取消）。 */
export function isActiveTaskStatus(status: TaskStatus): boolean {
  return status === 'pending' || status === 'in_progress'
}

/** 优先级排序权重（数值越小越紧急，用于排序）。 */
export const TASK_PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}
