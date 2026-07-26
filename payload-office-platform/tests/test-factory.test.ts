import { describe, expect, it } from 'vitest'
import {
  BUILTIN_ROLES,
  assertBuiltinRolesInvariant,
  getBuiltinRole,
  listBuiltinRoles,
  type BuiltinRoleCode,
} from '@/test/factory/roles'
import {
  MERCHANTS,
  canEstablishSupplyRelation,
  listMerchantsByQualification,
  listMerchantsByStatus,
} from '@/test/factory/merchants'
import {
  LISTINGS,
  isLegalStateTransition,
  isListingEligibleForSupply,
  listListingsByState,
  type ListingStateTuple,
} from '@/test/factory/listings'
import {
  TEAMS,
  USERS,
  listTeamMembers,
  listUsersByRole,
} from '@/test/factory/teams'
import {
  FROZEN_CLOCKS,
  MVP_R1_POLICY,
  assertShanghaiDayInvariant,
  generateSlaAnchors,
  getFrozenClock,
} from '@/test/factory/time'
import {
  BUILDING_MERCHANT_RELATIONS,
  assertFixtureExpectationsInvariant,
  simulatePgExclude,
} from '@/test/factory/validity'

describe('factory/roles', () => {
  it('5 个内置角色齐备且 builtin=true', () => {
    assertBuiltinRolesInvariant()
    const codes = Object.keys(BUILTIN_ROLES) as BuiltinRoleCode[]
    expect(codes).toEqual(['ADM', 'OPS', 'MGR', 'BRK', 'CSR'])
    expect(codes).toHaveLength(5)
  })

  it('listBuiltinRoles 返回 5 项', () => {
    expect(listBuiltinRoles()).toHaveLength(5)
  })

  it('getBuiltinRole 按 code 返回 fixture', () => {
    expect(getBuiltinRole('ADM').name).toBe('平台管理员')
    expect(getBuiltinRole('BRK').dataScope).toBe('self')
  })

  it('ADM 拥有全局权限；CSR 只能看脱敏手机号', () => {
    expect(getBuiltinRole('ADM').dataScope).toBe('global')
    // ADM 用通配符 '*' 表示全部字段权限（包括 phone:full）
    expect(getBuiltinRole('ADM').fieldPermissions).toContain('*')
    expect(getBuiltinRole('CSR').fieldPermissions).not.toContain('*')
    expect(getBuiltinRole('CSR').fieldPermissions).not.toContain('phone:full')
    expect(getBuiltinRole('CSR').fieldPermissions).toContain('phone:masked')
  })
})

describe('factory/teams', () => {
  it('覆盖 5 个城市', () => {
    const cities = new Set(Object.values(TEAMS).map((t) => t.city))
    expect(cities.size).toBe(5)
    expect(cities.has('shanghai')).toBe(true)
    expect(cities.has('beijing')).toBe(true)
    expect(cities.has('shenzhen')).toBe(true)
    expect(cities.has('hangzhou')).toBe(true)
    expect(cities.has('guangzhou')).toBe(true)
  })

  it('listUsersByRole 返回每角色至少 1 个用户', () => {
    for (const code of ['ADM', 'OPS', 'MGR', 'BRK', 'CSR'] as const) {
      const users = listUsersByRole(code)
      expect(users.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('BRK 至少有 3 个不同城市经纪人', () => {
    const brokers = listUsersByRole('BRK')
    const cities = new Set(brokers.map((b) => b.city))
    expect(cities.size).toBeGreaterThanOrEqual(3)
  })

  it('停用经纪人 sessionVersion>1（验证会话版本不变量）', () => {
    const inactiveBrokers = listUsersByRole('BRK').filter((b) => b.status === 'inactive')
    expect(inactiveBrokers.length).toBeGreaterThan(0)
    for (const b of inactiveBrokers) {
      expect(b.sessionVersion).toBeGreaterThan(1)
    }
  })

  it('listTeamMembers 包含主管 + 成员', () => {
    const members = listTeamMembers('team-shanghai-1')
    expect(members.length).toBeGreaterThanOrEqual(3) // 1 主管 + 2 经纪人
  })

  it('停用团队的成员都是 inactive', () => {
    const team = TEAMS['team-hangzhou-1']
    expect(team.status).toBe('inactive')
    const members = listTeamMembers('team-hangzhou-1')
    for (const m of members) {
      expect(m.status).toBe('inactive')
    }
  })
})

describe('factory/merchants', () => {
  it('覆盖 active / inactive / frozen 三种状态', () => {
    expect(listMerchantsByStatus('active').length).toBeGreaterThan(0)
    expect(listMerchantsByStatus('inactive').length).toBeGreaterThan(0)
    expect(listMerchantsByStatus('frozen').length).toBeGreaterThan(0)
  })

  it('覆盖 valid / expired / pending 三种资质状态', () => {
    expect(listMerchantsByQualification('valid').length).toBeGreaterThan(0)
    expect(listMerchantsByQualification('expired').length).toBeGreaterThan(0)
    expect(listMerchantsByQualification('pending').length).toBeGreaterThan(0)
  })

  it('canEstablishSupplyRelation：active+城市覆盖+资质有效 → 通过', () => {
    const m = MERCHANTS['merchant-active-shanghai']
    const r = canEstablishSupplyRelation(m, 'shanghai', new Date('2026-06-01T00:00:00.000Z'))
    expect(r.ok).toBe(true)
  })

  it('canEstablishSupplyRelation：商户停用 → 拒绝', () => {
    const m = MERCHANTS['merchant-inactive']
    const r = canEstablishSupplyRelation(m, 'shanghai', new Date('2026-06-01T00:00:00.000Z'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('merchant_status_inactive')
  })

  it('canEstablishSupplyRelation：城市不匹配 → 拒绝', () => {
    const m = MERCHANTS['merchant-active-shanghai']
    const r = canEstablishSupplyRelation(m, 'beijing', new Date('2026-06-01T00:00:00.000Z'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('service_city_not_covered')
  })

  it('canEstablishSupplyRelation：资质过期 → 拒绝', () => {
    const m = MERCHANTS['merchant-qual-expired']
    const r = canEstablishSupplyRelation(m, 'shenzhen', new Date('2026-07-01T00:00:00.000Z'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('qualification_expired')
  })

  it('canEstablishSupplyRelation：资质待审 → 拒绝', () => {
    const m = MERCHANTS['merchant-qual-pending']
    const r = canEstablishSupplyRelation(m, 'guangzhou', new Date('2026-09-01T00:00:00.000Z'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('qualification_pending')
  })
})

describe('factory/listings', () => {
  it('房源状态矩阵覆盖 publication × review × supply_hold 关键组合', () => {
    // 至少覆盖以下关键场景：
    // - 正常上架（有效供给）
    expect(listListingsByState({ publication: 'published', review: 'approved', supplyHold: 'normal' }).length).toBeGreaterThan(0)
    // - 草稿（未提交审核）
    expect(listListingsByState({ publication: 'draft', review: 'unsubmitted', supplyHold: 'normal' }).length).toBeGreaterThan(0)
    // - 待审核
    expect(listListingsByState({ publication: 'draft', review: 'pending', supplyHold: 'normal' }).length).toBeGreaterThan(0)
    // - 审核通过未上架（验证不变量：审核通过不自动上架）
    expect(listListingsByState({ publication: 'draft', review: 'approved', supplyHold: 'normal' }).length).toBeGreaterThan(0)
    // - 已驳回
    expect(listListingsByState({ publication: 'draft', review: 'rejected', supplyHold: 'normal' }).length).toBeGreaterThan(0)
    // - 举报暂停
    expect(listListingsByState({ publication: 'published', review: 'approved', supplyHold: 'pending_recheck' }).length).toBeGreaterThan(0)
    // - 已下架
    expect(listListingsByState({ publication: 'unpublished', review: 'approved', supplyHold: 'normal' }).length).toBeGreaterThan(0)
    // - 已出租
    expect(listListingsByState({ publication: 'leased', review: 'approved', supplyHold: 'normal' }).length).toBeGreaterThan(0)
  })

  it('isListingEligibleForSupply：正常上架房源通过', () => {
    const l = LISTINGS['listing-published-clean']
    const r = isListingEligibleForSupply(l)
    expect(r.ok).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('isListingEligibleForSupply：逻辑删除 → 拒绝', () => {
    const l = LISTINGS['listing-deleted']
    const r = isListingEligibleForSupply(l)
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('listing_deleted')
  })

  it('isListingEligibleForSupply：草稿 → 拒绝', () => {
    const l = LISTINGS['listing-draft']
    const r = isListingEligibleForSupply(l)
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('publication_draft')
  })

  it('isListingEligibleForSupply：待审核 → 拒绝', () => {
    const l = LISTINGS['listing-pending-review']
    const r = isListingEligibleForSupply(l)
    expect(r.ok).toBe(false)
    expect(r.reasons.some((x) => x.startsWith('review_'))).toBe(true)
  })

  it('isListingEligibleForSupply：举报暂停 → 拒绝', () => {
    const l = LISTINGS['listing-published-pending-recheck']
    const r = isListingEligibleForSupply(l)
    expect(r.ok).toBe(false)
    expect(r.reasons).toContain('supply_hold_pending_recheck')
  })

  it('isListingEligibleForSupply：媒体不足 3 张 → 拒绝', () => {
    const l = LISTINGS['listing-draft']
    const r = isListingEligibleForSupply(l)
    expect(r.reasons).toContain('media_incomplete')
  })

  it('isLegalStateTransition：审核 unsubmitted → pending 合法', () => {
    const r = isLegalStateTransition(
      { publication: 'draft', review: 'unsubmitted', supplyHold: 'normal' },
      { publication: 'draft', review: 'pending', supplyHold: 'normal' },
    )
    expect(r.ok).toBe(true)
  })

  it('isLegalStateTransition：审核 pending → approved 合法', () => {
    const r = isLegalStateTransition(
      { publication: 'draft', review: 'pending', supplyHold: 'normal' },
      { publication: 'draft', review: 'approved', supplyHold: 'normal' },
    )
    expect(r.ok).toBe(true)
  })

  it('isLegalStateTransition：审核 approved → unsubmitted（撤回审核）合法', () => {
    const r = isLegalStateTransition(
      { publication: 'draft', review: 'approved', supplyHold: 'normal' },
      { publication: 'draft', review: 'unsubmitted', supplyHold: 'normal' },
    )
    expect(r.ok).toBe(true)
  })

  it('isLegalStateTransition：审核 rejected → approved 非法', () => {
    const r = isLegalStateTransition(
      { publication: 'draft', review: 'rejected', supplyHold: 'normal' as const },
      { publication: 'draft', review: 'approved', supplyHold: 'normal' as const },
    )
    expect(r.ok).toBe(false)
  })

  it('isLegalStateTransition：未审核直接发布非法', () => {
    const r = isLegalStateTransition(
      { publication: 'draft', review: 'unsubmitted', supplyHold: 'normal' },
      { publication: 'published', review: 'unsubmitted', supplyHold: 'normal' },
    )
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('publish_requires_approved_review')
  })

  it('isLegalStateTransition：发布已 leased → draft 非法（不可回草稿）', () => {
    const r = isLegalStateTransition(
      { publication: 'leased', review: 'approved', supplyHold: 'normal' },
      { publication: 'draft', review: 'approved', supplyHold: 'normal' },
    )
    expect(r.ok).toBe(false)
  })

  it('审核通过未上架 fixture 存在（验证不变量：审核通过不自动上架）', () => {
    const l = LISTINGS['listing-approved-not-published']
    expect(l.review).toBe('approved')
    expect(l.publication).toBe('draft') // 不自动上架
  })
})

describe('factory/time', () => {
  it('所有冻结时钟 fixture 的上海自然日边界推算正确', () => {
    for (const key of Object.keys(FROZEN_CLOCKS)) {
      const clock = getFrozenClock(key as keyof typeof FROZEN_CLOCKS)
      expect(() => assertShanghaiDayInvariant(clock)).not.toThrow()
    }
  })

  it('上海自然日开始：UTC 16:00 = 上海次日 00:00', () => {
    const c = getFrozenClock('shanghai-day-start')
    expect(c.utc).toBe('2026-03-15T16:00:00.000Z')
    expect(c.shanghaiDay).toBe('2026-03-16')
  })

  it('上海自然日结束前一秒仍属于当日', () => {
    const c = getFrozenClock('shanghai-day-end')
    expect(c.shanghaiDay).toBe('2026-03-16')
  })

  it('上海自然日结束下一秒属于次日', () => {
    const c = getFrozenClock('shanghai-next-day-start')
    expect(c.shanghaiDay).toBe('2026-03-17')
  })

  it('MVP-R1 参数快照与 AGENTS.md §5.4 一致', () => {
    expect(MVP_R1_POLICY.runtime_policy_version).toBe('MVP-R1')
    expect(MVP_R1_POLICY.assign_deadline_seconds).toBe(7200)
    expect(MVP_R1_POLICY.first_follow_up_deadline_seconds).toBe(14400)
    expect(MVP_R1_POLICY.claim_protection_seconds).toBe(86400)
    expect(MVP_R1_POLICY.no_follow_up_reclaim_seconds).toBe(259200)
    expect(MVP_R1_POLICY.duplicate_window_seconds).toBe(2592000)
    expect(MVP_R1_POLICY.daily_claim_limit).toBe(20)
    expect(MVP_R1_POLICY.active_lead_limit).toBe(100)
    expect(MVP_R1_POLICY.follow_up_correction_window_seconds).toBe(86400)
  })

  it('generateSlaAnchors 计算各时限到期 UTC 时刻', () => {
    const anchors = generateSlaAnchors('2026-03-15T10:00:00.000Z')
    expect(anchors.start).toBe('2026-03-15T10:00:00.000Z')
    // 分配时限 7200s = 2h
    expect(anchors.assignDeadline).toBe('2026-03-15T12:00:00.000Z')
    // 首次跟进 14400s = 4h
    expect(anchors.firstFollowUpDeadline).toBe('2026-03-15T14:00:00.000Z')
    // 公海回收 259200s = 72h = 3d
    expect(anchors.publicSeaReclaimDeadline).toBe('2026-03-18T10:00:00.000Z')
    // 30 天去重窗口
    expect(anchors.duplicateWindowEnd).toBe('2026-04-14T10:00:00.000Z')
  })
})

describe('factory/validity (PG EXCLUDE 约束模拟)', () => {
  it('fixture 矩阵预期与应用层校验结果一致', () => {
    expect(() => assertFixtureExpectationsInvariant()).not.toThrow()
  })

  it('同一 building + 同一 merchant 重叠 → 拒绝', () => {
    const existing = [BUILDING_MERCHANT_RELATIONS[0]] // rel-1
    const candidate = BUILDING_MERCHANT_RELATIONS[2] // rel-3 完全重叠
    const r = simulatePgExclude(candidate, existing)
    expect(r.accepted).toBe(false)
    expect(r.overlapWith).toContain('rel-1-active')
  })

  it('同一 building + 不同 merchant 不重叠 → 接受', () => {
    const existing = [BUILDING_MERCHANT_RELATIONS[0]] // rel-1 building-A, merchant-active-shanghai
    const candidate = BUILDING_MERCHANT_RELATIONS[6] // rel-7 building-A, merchant-multi-city
    const r = simulatePgExclude(candidate, existing)
    expect(r.accepted).toBe(true)
  })

  it('边界相接不重叠 → 接受', () => {
    const existing = [BUILDING_MERCHANT_RELATIONS[0]] // rel-1 [Jan 1, Jun 30]
    const candidate = BUILDING_MERCHANT_RELATIONS[1] // rel-2 [Jul 1, Dec 31]，与 rel-1 边界相接
    const r = simulatePgExclude(candidate, existing)
    expect(r.accepted).toBe(true)
  })

  it('无限期关系：与落在其内部的区间重叠 → 拒绝', () => {
    const existing = [BUILDING_MERCHANT_RELATIONS[5]] // rel-6 [Jan 1, null)
    // 构造一个落在 rel-6 内部的候选
    const candidate = {
      id: 'test-inside-rel-6',
      buildingId: 'building-B',
      merchantId: 'merchant-multi-city',
      validity: {
        startsAt: '2026-03-01T00:00:00.000Z',
        endsAt: '2026-04-01T00:00:00.000Z',
      },
      expectAccepted: false,
    }
    const r = simulatePgExclude(candidate, existing)
    expect(r.accepted).toBe(false)
    expect(r.overlapWith).toContain('rel-6-indefinite')
  })
})
