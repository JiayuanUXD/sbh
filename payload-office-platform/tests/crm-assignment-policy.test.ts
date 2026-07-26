import { describe, expect, it } from 'vitest'

import {
  checkAssignmentEligibility,
  ASSIGNMENT_REJECTION_CODES,
  type BrokerCapacity,
  type LeadAssignmentTarget,
} from '@/domain/crm/assignment-policy'
import { DAILY_CLAIM_LIMIT, ACTIVE_LEAD_CAP, RUNTIME_POLICY_VERSION } from '@/domain/crm/policy'

/**
 * M5.4 分配/认领额度校验纯逻辑单测（tasks.md M5.4 / R1 / R6 / R8）
 *
 * 校验维度:城市匹配、团队匹配(转派场景)、经纪人在职、每日认领 ≤20、活跃线索 ≤100。
 * 输出:是否放行 + 逐条拒绝原因 + 命中数值 + MVP-R1 参数快照(落库留痕)。
 * 纯逻辑不查库:经纪人容量/城市/团队由调用方预加载后传入。
 */

const CITY = 'shanghai'

function baseBroker(overrides: Partial<BrokerCapacity> = {}): BrokerCapacity {
  return {
    brokerId: 1,
    employmentStatus: 'active',
    serviceCityIds: [CITY],
    teamId: 't1',
    todayClaimCount: 0,
    activeLeadCount: 0,
    ...overrides,
  }
}

function baseLead(overrides: Partial<LeadAssignmentTarget> = {}): LeadAssignmentTarget {
  return { city: CITY, ...overrides }
}

describe('crm-assignment-policy/放行', () => {
  it('全部满足 → 放行,附命中数值与快照', () => {
    const r = checkAssignmentEligibility(baseBroker(), baseLead())
    expect(r.eligible).toBe(true)
    expect(r.rejections).toEqual([])
    expect(r.hits.todayClaimCount).toBe(0)
    expect(r.hits.activeLeadCount).toBe(0)
    expect(r.snapshot.runtimePolicyVersion).toBe(RUNTIME_POLICY_VERSION)
    expect(r.snapshot.dailyClaimLimit).toBe(DAILY_CLAIM_LIMIT)
    expect(r.snapshot.activeLeadCap).toBe(ACTIVE_LEAD_CAP)
  })

  it('恰好差一条到上限仍放行(19 认领 / 99 活跃)', () => {
    const r = checkAssignmentEligibility(
      baseBroker({ todayClaimCount: DAILY_CLAIM_LIMIT - 1, activeLeadCount: ACTIVE_LEAD_CAP - 1 }),
      baseLead(),
    )
    expect(r.eligible).toBe(true)
  })
})

describe('crm-assignment-policy/经纪人在职', () => {
  it('停用经纪人被拒', () => {
    const r = checkAssignmentEligibility(baseBroker({ employmentStatus: 'disabled' }), baseLead())
    expect(r.eligible).toBe(false)
    expect(r.rejections).toContain('broker_inactive')
  })
})

describe('crm-assignment-policy/城市匹配', () => {
  it('线索城市不在经纪人服务城市 → 拒', () => {
    const r = checkAssignmentEligibility(
      baseBroker({ serviceCityIds: ['beijing'] }),
      baseLead({ city: CITY }),
    )
    expect(r.eligible).toBe(false)
    expect(r.rejections).toContain('city_mismatch')
  })

  it('线索无城市 → 城市校验跳过(不拒)', () => {
    const r = checkAssignmentEligibility(baseBroker(), baseLead({ city: null }))
    expect(r.rejections).not.toContain('city_mismatch')
  })
})

describe('crm-assignment-policy/团队匹配(转派)', () => {
  it('要求团队但经纪人团队不符 → 拒', () => {
    const r = checkAssignmentEligibility(
      baseBroker({ teamId: 't1' }),
      baseLead({ requiredTeamId: 't2' }),
    )
    expect(r.eligible).toBe(false)
    expect(r.rejections).toContain('team_mismatch')
  })

  it('要求团队且相符 → 放行', () => {
    const r = checkAssignmentEligibility(
      baseBroker({ teamId: 't2' }),
      baseLead({ requiredTeamId: 't2' }),
    )
    expect(r.eligible).toBe(true)
  })
})

describe('crm-assignment-policy/每日认领上限', () => {
  it('达 20 条 → 拒,命中数值回显', () => {
    const r = checkAssignmentEligibility(
      baseBroker({ todayClaimCount: DAILY_CLAIM_LIMIT }),
      baseLead(),
    )
    expect(r.eligible).toBe(false)
    expect(r.rejections).toContain('daily_claim_limit')
    expect(r.hits.todayClaimCount).toBe(DAILY_CLAIM_LIMIT)
  })
})

describe('crm-assignment-policy/活跃线索上限', () => {
  it('达 100 条 → 拒,命中数值回显', () => {
    const r = checkAssignmentEligibility(
      baseBroker({ activeLeadCount: ACTIVE_LEAD_CAP }),
      baseLead(),
    )
    expect(r.eligible).toBe(false)
    expect(r.rejections).toContain('active_lead_cap')
    expect(r.hits.activeLeadCount).toBe(ACTIVE_LEAD_CAP)
  })
})

describe('crm-assignment-policy/多维叠加', () => {
  it('停用+超城市+超两项额度 → 全部拒绝原因都在', () => {
    const r = checkAssignmentEligibility(
      baseBroker({
        employmentStatus: 'disabled',
        serviceCityIds: ['beijing'],
        todayClaimCount: DAILY_CLAIM_LIMIT,
        activeLeadCount: ACTIVE_LEAD_CAP,
      }),
      baseLead({ city: CITY }),
    )
    expect(r.eligible).toBe(false)
    expect(new Set(r.rejections)).toEqual(
      new Set(['broker_inactive', 'city_mismatch', 'daily_claim_limit', 'active_lead_cap']),
    )
  })

  it('拒绝码集合与导出常量一致', () => {
    expect(ASSIGNMENT_REJECTION_CODES).toEqual([
      'broker_inactive',
      'city_mismatch',
      'team_mismatch',
      'daily_claim_limit',
      'active_lead_cap',
    ])
  })
})
