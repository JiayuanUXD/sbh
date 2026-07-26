/**
 * 组织结构枚举：团队状态 + 经纪人在职状态（tasks.md M2.5 / design §3.3 / R1,R2,R6）
 *
 * 纯函数模块：不依赖 payload/React，单测独立覆盖。
 * 团队与经纪人的启停都用 active/disabled 二态，与商户/区域保持一致的停用语义。
 */

export const TEAM_STATUSES = ['active', 'disabled'] as const
export type TeamStatus = (typeof TEAM_STATUSES)[number]

export const TEAM_STATUS_LABELS: Record<TeamStatus, string> = {
  active: '启用',
  disabled: '停用',
}

export function isTeamStatus(value: unknown): value is TeamStatus {
  return typeof value === 'string' && (TEAM_STATUSES as readonly string[]).includes(value)
}

/**
 * 经纪人在职状态。停用（disabled）前必须完成未完成线索转派（tasks.md M2.5）。
 * MVP 不区分「离职」与「停用」，统一为 disabled；后续如需离职归档再扩展。
 */
export const EMPLOYMENT_STATUSES = ['active', 'disabled'] as const
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number]

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: '在职',
  disabled: '停用',
}

export function isEmploymentStatus(value: unknown): value is EmploymentStatus {
  return typeof value === 'string' && (EMPLOYMENT_STATUSES as readonly string[]).includes(value)
}
