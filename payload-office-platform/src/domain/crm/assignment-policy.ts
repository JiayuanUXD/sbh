/**
 * CRM 分配/认领额度校验纯逻辑（tasks.md M5.4 / R1 / R6 / R8）
 *
 * 分配(运营指派)、认领(经纪人自取)、转派均须通过这一组校验:
 *   - 经纪人在职(employmentStatus === 'active')。
 *   - 城市匹配:线索城市须在经纪人服务城市内(线索无城市则跳过)。
 *   - 团队匹配:转派场景要求目标团队时,经纪人团队须相符。
 *   - 每日认领 ≤ DAILY_CLAIM_LIMIT(20,自然日北京时间,由调用方统计传入)。
 *   - 活跃线索 ≤ ACTIVE_LEAD_CAP(100,未进终态且归属本人)。
 *
 * 输出逐条拒绝原因 + 命中数值 + MVP-R1 参数快照,供领域服务落库留痕(design §3.6)。
 * 纯逻辑不查库:经纪人容量与线索目标由调用方预加载后传入。
 */

import {
  DAILY_CLAIM_LIMIT,
  ACTIVE_LEAD_CAP,
  snapshotRuntimePolicy,
  type RuntimePolicySnapshot,
} from './policy'
import type { EmploymentStatus } from '@/domain/auth/org'

/** 拒绝码(顺序即校验/呈现顺序)。 */
export const ASSIGNMENT_REJECTION_CODES = [
  'broker_inactive',
  'city_mismatch',
  'team_mismatch',
  'daily_claim_limit',
  'active_lead_cap',
] as const
export type AssignmentRejectionCode = (typeof ASSIGNMENT_REJECTION_CODES)[number]

/** 目标经纪人容量快照(调用方预加载:在职状态、服务城市、团队、当日认领数、活跃线索数)。 */
export type BrokerCapacity = {
  brokerId: number | string
  employmentStatus: EmploymentStatus
  serviceCityIds: readonly (number | string)[]
  teamId: number | string | null
  todayClaimCount: number
  activeLeadCount: number
}

/** 待分配线索的匹配约束。 */
export type LeadAssignmentTarget = {
  /** 线索城市;为空则跳过城市校验。 */
  city?: number | string | null
  /** 转派场景要求的目标团队;为空则跳过团队校验。 */
  requiredTeamId?: number | string | null
}

export type AssignmentEligibility = {
  eligible: boolean
  rejections: AssignmentRejectionCode[]
  /** 命中数值,便于 UI 提示与落库(实际命中的当日认领/活跃数)。 */
  hits: {
    todayClaimCount: number
    activeLeadCount: number
  }
  /** MVP-R1 参数快照,分配/认领成功时随线索落库。 */
  snapshot: RuntimePolicySnapshot
}

/**
 * 校验目标经纪人是否可承接该线索。收集全部拒绝原因(不短路),便于一次性回显。
 */
export function checkAssignmentEligibility(
  broker: BrokerCapacity,
  lead: LeadAssignmentTarget,
): AssignmentEligibility {
  const rejections: AssignmentRejectionCode[] = []

  if (broker.employmentStatus !== 'active') {
    rejections.push('broker_inactive')
  }

  if (lead.city != null && !broker.serviceCityIds.includes(lead.city)) {
    rejections.push('city_mismatch')
  }

  if (lead.requiredTeamId != null && broker.teamId !== lead.requiredTeamId) {
    rejections.push('team_mismatch')
  }

  if (broker.todayClaimCount >= DAILY_CLAIM_LIMIT) {
    rejections.push('daily_claim_limit')
  }

  if (broker.activeLeadCount >= ACTIVE_LEAD_CAP) {
    rejections.push('active_lead_cap')
  }

  return {
    eligible: rejections.length === 0,
    rejections,
    hits: {
      todayClaimCount: broker.todayClaimCount,
      activeLeadCount: broker.activeLeadCount,
    },
    snapshot: snapshotRuntimePolicy(),
  }
}
