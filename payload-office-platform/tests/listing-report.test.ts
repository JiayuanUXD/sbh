import { describe, it, expect } from 'vitest'

import {
  REPORT_CONCLUSIONS,
  REPORT_REASONS,
  REPORT_STATUSES,
  allowedReportTransitions,
  canTransitionReport,
  isReportConclusion,
  isReportReason,
  isReportStatus,
  isTerminalStatus,
  requiresConclusion,
  type ReportStatus,
} from '@/domain/report/report-status'
import {
  assertReportVersion,
  transitionReportStatus,
  type ReportTransitionRequest,
} from '@/domain/report/report-transition'
import {
  buildSupplyPauseEffect,
  shouldPauseSupply,
} from '@/domain/report/report-supply-effect'
import { protectListingReport } from '@/domain/report/report-protect'
import {
  DomainError,
  IllegalStateTransitionError,
  InvalidOperationError,
  VersionConflictError,
} from '@/domain/shared/errors'
import {
  REPORT_FIXTURE_CLOSED_DISMISSED,
  REPORT_FIXTURE_CLOSED_PARTIAL,
  REPORT_FIXTURE_CLOSED_SUSTAINED,
  REPORT_FIXTURE_MINIMAL,
  REPORT_FIXTURE_WITH_EVIDENCE,
} from '@/test/factory/reports'

/**
 * M6.1 房源举报模型测试（design §3.5 / R5）
 *
 * 覆盖：
 *   - 状态机合法转换（主路径 + 分支）
 *   - 非法转换拒绝（终态、跳级、反向）
 *   - 供给暂停效果（sustained/dismissed/partial）
 *   - 关闭必须填写结论和结论原因
 *   - 状态版本号每次转换 +1
 *   - protect hook create / update 校验
 *   - 乐观锁版本冲突
 */

// ────────────────────────────────────────────────────────────
// 辅助：构造转换请求
// ────────────────────────────────────────────────────────────
function makeTransition(
  currentStatus: ReportStatus,
  targetStatus: ReportStatus,
  overrides: Partial<ReportTransitionRequest> = {},
): ReportTransitionRequest {
  return {
    reportId: 'report-1',
    currentStatus,
    currentVersion: 1,
    targetStatus,
    actorId: 'user-1',
    ...overrides,
  }
}

// ────────────────────────────────────────────────────────────
// 1. 状态枚举与守卫
// ────────────────────────────────────────────────────────────
describe('report-status — 枚举与守卫', () => {
  it('处理状态枚举含 6 个状态', () => {
    expect([...REPORT_STATUSES]).toEqual([
      'pending-triage',
      'assigned',
      'verifying',
      'awaiting-info',
      'submitted-review',
      'closed',
    ])
  })

  it('isReportStatus 守卫合法值', () => {
    expect(isReportStatus('pending-triage')).toBe(true)
    expect(isReportStatus('done')).toBe(false)
    expect(isReportStatus(undefined)).toBe(false)
  })

  it('isReportReason / isReportConclusion 守卫', () => {
    expect(isReportReason('false-info')).toBe(true)
    expect(isReportReason('unknown-reason')).toBe(false)
    expect(isReportConclusion('sustained')).toBe(true)
    expect(isReportConclusion('unknown')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 2. 状态机合法转换
// ────────────────────────────────────────────────────────────
describe('report-status — 合法转换表', () => {
  it('pending-triage → assigned 合法', () => {
    expect(canTransitionReport('pending-triage', 'assigned')).toBe(true)
  })

  it('主路径全链路合法：triage → assigned → verifying → awaiting-info → submitted-review → closed', () => {
    expect(canTransitionReport('pending-triage', 'assigned')).toBe(true)
    expect(canTransitionReport('assigned', 'verifying')).toBe(true)
    expect(canTransitionReport('verifying', 'awaiting-info')).toBe(true)
    expect(canTransitionReport('awaiting-info', 'submitted-review')).toBe(true)
    expect(canTransitionReport('submitted-review', 'closed')).toBe(true)
  })

  it('awaiting-info → verifying 可反向（资料未齐退回核实）', () => {
    expect(canTransitionReport('awaiting-info', 'verifying')).toBe(true)
  })

  it('submitted-review → verifying 可退回（复核不通过需补充调查）', () => {
    expect(canTransitionReport('submitted-review', 'verifying')).toBe(true)
  })

  it('任意非终态可直接 closed（提前关闭）', () => {
    expect(canTransitionReport('pending-triage', 'closed')).toBe(true)
    expect(canTransitionReport('assigned', 'closed')).toBe(true)
    expect(canTransitionReport('verifying', 'closed')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 3. 状态机非法转换
// ────────────────────────────────────────────────────────────
describe('report-status — 非法转换拒绝', () => {
  it('closed → pending-triage 非法（终态不可流转）', () => {
    expect(canTransitionReport('closed', 'pending-triage')).toBe(false)
  })

  it('closed 无任何合法目标状态', () => {
    expect(allowedReportTransitions('closed')).toEqual([])
  })

  it('pending-triage → submitted-review 跳级非法', () => {
    expect(canTransitionReport('pending-triage', 'submitted-review')).toBe(false)
  })

  it('pending-triage → verifying 跳级非法（必须先 assigned）', () => {
    expect(canTransitionReport('pending-triage', 'verifying')).toBe(false)
  })

  it('isTerminalStatus 仅 closed 为终态', () => {
    expect(isTerminalStatus('closed')).toBe(true)
    expect(isTerminalStatus('pending-triage')).toBe(false)
    expect(isTerminalStatus('submitted-review')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 4. transitionReportStatus — 合法转换 + 版本号自增
// ────────────────────────────────────────────────────────────
describe('transitionReportStatus — 合法转换与版本号', () => {
  it('pending-triage → assigned 成功，statusVersion +1', () => {
    const result = transitionReportStatus(
      makeTransition('pending-triage', 'assigned', {
        assigneeId: 'user-2',
        currentVersion: 1,
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.status).toBe('assigned')
      expect(result.data.statusVersion).toBe(2)
      expect(result.data.assigneeId).toBe('user-2')
    }
  })

  it('多次连续转换 statusVersion 递增', () => {
    // triage(v1) → assigned(v2)
    const r1 = transitionReportStatus(
      makeTransition('pending-triage', 'assigned', { currentVersion: 1 }),
    )
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.data.statusVersion).toBe(2)

    // assigned(v2) → verifying(v3)
    const r2 = transitionReportStatus(
      makeTransition('assigned', 'verifying', { currentVersion: 2 }),
    )
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.data.statusVersion).toBe(3)

    // verifying(v3) → closed(v4)
    const r3 = transitionReportStatus(
      makeTransition('verifying', 'closed', {
        currentVersion: 3,
        conclusion: 'sustained',
        conclusionReason: '核实属实',
      }),
    )
    expect(r3.ok).toBe(true)
    if (!r3.ok) return
    expect(r3.data.statusVersion).toBe(4)
    expect(r3.data.status).toBe('closed')
  })
})

// ────────────────────────────────────────────────────────────
// 5. transitionReportStatus — 非法转换拒绝
// ────────────────────────────────────────────────────────────
describe('transitionReportStatus — 非法转换拒绝', () => {
  it('closed → assigned 返回 IllegalStateTransitionError', () => {
    const result = transitionReportStatus(
      makeTransition('closed', 'assigned', { currentVersion: 6 }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(IllegalStateTransitionError)
      expect(result.error.code).toBe('ILLEGAL_TRANSITION')
    }
  })

  it('pending-triage → verifying 跳级返回 IllegalStateTransitionError', () => {
    const result = transitionReportStatus(
      makeTransition('pending-triage', 'verifying'),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(IllegalStateTransitionError)
    }
  })

  it('requiresConclusion(closed) === true，其余状态 === false', () => {
    expect(requiresConclusion('closed')).toBe(true)
    expect(requiresConclusion('pending-triage')).toBe(false)
    expect(requiresConclusion('verifying')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 6. 关闭必须填写结论和结论原因
// ────────────────────────────────────────────────────────────
describe('transitionReportStatus — 关闭结论校验', () => {
  it('关闭缺结论返回 InvalidOperationError', () => {
    const result = transitionReportStatus(
      makeTransition('submitted-review', 'closed', {
        conclusionReason: '已核实',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOperationError)
      expect(result.error.code).toBe('REPORT_CONCLUSION_REQUIRED')
    }
  })

  it('关闭缺结论原因返回 InvalidOperationError', () => {
    const result = transitionReportStatus(
      makeTransition('submitted-review', 'closed', {
        conclusion: 'sustained',
        conclusionReason: '   ',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOperationError)
      expect(result.error.code).toBe('REPORT_CONCLUSION_REASON_REQUIRED')
    }
  })

  it('关闭结论 + 原因齐全成功，conclusion 透传到结果', () => {
    const result = transitionReportStatus(
      makeTransition('submitted-review', 'closed', {
        conclusion: 'sustained',
        conclusionReason: '经核实举报属实',
        currentVersion: 5,
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.conclusion).toBe('sustained')
      expect(result.data.conclusionReason).toBe('经核实举报属实')
    }
  })

  it('非关闭状态转换不带 conclusion 也能成功', () => {
    const result = transitionReportStatus(
      makeTransition('pending-triage', 'assigned'),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.conclusion).toBeNull()
    }
  })
})

// ────────────────────────────────────────────────────────────
// 7. 供给暂停效果
// ────────────────────────────────────────────────────────────
describe('report-supply-effect — 供给暂停推导', () => {
  it('结论 sustained → shouldPauseSupply = true', () => {
    expect(shouldPauseSupply('closed', 'sustained')).toBe(true)
  })

  it('结论 dismissed → shouldPauseSupply = false', () => {
    expect(shouldPauseSupply('closed', 'dismissed')).toBe(false)
  })

  it('结论 partial → shouldPauseSupply = true（保守策略）', () => {
    expect(shouldPauseSupply('closed', 'partial')).toBe(true)
  })

  it('未关闭状态不暂停供给（结论仅 closed 时填）', () => {
    expect(shouldPauseSupply('verifying', 'sustained')).toBe(false)
    expect(shouldPauseSupply('pending-triage', null)).toBe(false)
  })

  it('buildSupplyPauseEffect 推导 sustained 效果', () => {
    const effect = buildSupplyPauseEffect({
      status: 'closed',
      conclusion: 'sustained',
      currentSupplyPaused: false,
    })
    expect(effect.shouldPause).toBe(true)
    expect(effect.reason).toBe('sustained')
  })

  it('buildSupplyPauseEffect 推导 dismissed 效果', () => {
    const effect = buildSupplyPauseEffect({
      status: 'closed',
      conclusion: 'dismissed',
      currentSupplyPaused: true,
    })
    expect(effect.shouldPause).toBe(false)
    expect(effect.reason).toBe('dismissed')
  })

  it('关闭 + sustained 转换结果 supplyEffect.shouldPause = true', () => {
    const result = transitionReportStatus(
      makeTransition('submitted-review', 'closed', {
        conclusion: 'sustained',
        conclusionReason: '举报成立',
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.supplyEffect.shouldPause).toBe(true)
    }
  })
})

// ────────────────────────────────────────────────────────────
// 8. protectListingReport hook
// ────────────────────────────────────────────────────────────
describe('protectListingReport — create 时初始化', () => {
  const run = (args: Record<string, unknown>) =>
    protectListingReport(args as never) as Promise<Record<string, unknown>>

  const create = (data: Record<string, unknown>) =>
    run({ operation: 'create', originalDoc: undefined, data })

  it('create 初始化 status=pending-triage、statusVersion=1、supplyPaused=false', async () => {
    const out = await create({
      targetListing: 42,
      reason: 'false-info',
    })
    expect(out.status).toBe('pending-triage')
    expect(out.statusVersion).toBe(1)
    expect(out.supplyPaused).toBe(false)
  })

  it('create 不接受客户端指定 status（强制初始化为 pending-triage）', async () => {
    const out = await create({
      targetListing: 42,
      reason: 'false-info',
      status: 'closed',
    })
    expect(out.status).toBe('pending-triage')
  })

  it('create 非法 reason 抛 DomainError', async () => {
    await expect(
      create({ targetListing: 42, reason: 'unknown-reason' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('create evidence 超过 5 张抛 InvalidOperationError', async () => {
    const evidence = Array.from({ length: 6 }, (_, i) => ({ image: i + 1 }))
    await expect(
      create({ targetListing: 42, reason: 'false-info', evidence }),
    ).rejects.toBeInstanceOf(InvalidOperationError)
  })
})

describe('protectListingReport — update 时状态转换校验', () => {
  const run = (args: Record<string, unknown>) =>
    protectListingReport(args as never) as Promise<Record<string, unknown>>

  const update = (
    data: Record<string, unknown>,
    originalDoc: Record<string, unknown>,
  ) => run({ operation: 'update', originalDoc, data })

  it('update 合法状态转换通过且 statusVersion 自增', async () => {
    const out = await update(
      { status: 'assigned', assignee: 5 },
      { status: 'pending-triage', statusVersion: 1 },
    )
    expect(out.status).toBe('assigned')
    expect(out.statusVersion).toBe(2)
  })

  it('update 非法跳级转换抛 InvalidOperationError', async () => {
    await expect(
      update(
        { status: 'submitted-review' },
        { status: 'pending-triage', statusVersion: 1 },
      ),
    ).rejects.toBeInstanceOf(InvalidOperationError)
  })

  it('update closed → 任意状态抛 InvalidOperationError（终态）', async () => {
    await expect(
      update(
        { status: 'assigned' },
        { status: 'closed', statusVersion: 6 },
      ),
    ).rejects.toBeInstanceOf(InvalidOperationError)
  })

  it('update 关闭缺结论抛 InvalidOperationError', async () => {
    await expect(
      update(
        { status: 'closed', conclusionReason: '已核实' },
        { status: 'submitted-review', statusVersion: 5 },
      ),
    ).rejects.toBeInstanceOf(InvalidOperationError)
  })

  it('update 关闭缺结论原因抛 InvalidOperationError', async () => {
    await expect(
      update(
        { status: 'closed', conclusion: 'sustained', conclusionReason: '' },
        { status: 'submitted-review', statusVersion: 5 },
      ),
    ).rejects.toBeInstanceOf(InvalidOperationError)
  })

  it('update 关闭结论 + 原因齐全通过', async () => {
    const out = await update(
      { status: 'closed', conclusion: 'sustained', conclusionReason: '核实属实' },
      { status: 'submitted-review', statusVersion: 5 },
    )
    expect(out.status).toBe('closed')
    expect(out.statusVersion).toBe(6)
  })
})

// ────────────────────────────────────────────────────────────
// 9. 乐观锁版本冲突
// ────────────────────────────────────────────────────────────
describe('assertReportVersion — 乐观锁', () => {
  it('版本一致时不抛错', () => {
    expect(() =>
      assertReportVersion({ expected: 3, actual: 3, reportId: 'r-1' }),
    ).not.toThrow()
  })

  it('版本不一致抛 VersionConflictError(409)', () => {
    expect(() =>
      assertReportVersion({ expected: 3, actual: 2, reportId: 'r-1' }),
    ).toThrow(VersionConflictError)
  })
})

// ────────────────────────────────────────────────────────────
// 10. fixture 一致性
// ────────────────────────────────────────────────────────────
describe('report fixture — 业务不变量一致性', () => {
  it('REPORT_FIXTURE_MINIMAL 初始状态为 pending-triage', () => {
    expect(REPORT_FIXTURE_MINIMAL.status).toBe('pending-triage')
    expect(REPORT_FIXTURE_MINIMAL.statusVersion).toBe(1)
    expect(REPORT_FIXTURE_MINIMAL.supplyPaused).toBe(false)
  })

  it('REPORT_FIXTURE_CLOSED_SUSTAINED 结论为 sustained 且 supplyPaused=true', () => {
    expect(REPORT_FIXTURE_CLOSED_SUSTAINED.conclusion).toBe('sustained')
    expect(REPORT_FIXTURE_CLOSED_SUSTAINED.supplyPaused).toBe(true)
    expect(REPORT_FIXTURE_CLOSED_SUSTAINED.conclusionReason).toBeTruthy()
  })

  it('REPORT_FIXTURE_CLOSED_DISMISSED 结论为 dismissed 且 supplyPaused=false', () => {
    expect(REPORT_FIXTURE_CLOSED_DISMISSED.conclusion).toBe('dismissed')
    expect(REPORT_FIXTURE_CLOSED_DISMISSED.supplyPaused).toBe(false)
  })

  it('REPORT_FIXTURE_CLOSED_PARTIAL 结论为 partial 且 supplyPaused=true', () => {
    expect(REPORT_FIXTURE_CLOSED_PARTIAL.conclusion).toBe('partial')
    expect(REPORT_FIXTURE_CLOSED_PARTIAL.supplyPaused).toBe(true)
  })

  it('REPORT_FIXTURE_WITH_EVIDENCE 含 3 张证据', () => {
    expect(REPORT_FIXTURE_WITH_EVIDENCE.evidence).toHaveLength(3)
  })

  it('全部 fixture reason / status / conclusion 枚举合法', () => {
    const all = [
      REPORT_FIXTURE_MINIMAL,
      REPORT_FIXTURE_WITH_EVIDENCE,
      REPORT_FIXTURE_CLOSED_SUSTAINED,
      REPORT_FIXTURE_CLOSED_DISMISSED,
      REPORT_FIXTURE_CLOSED_PARTIAL,
    ]
    for (const f of all) {
      expect(isReportReason(f.reason)).toBe(true)
      expect(isReportStatus(f.status)).toBe(true)
      if (f.conclusion) {
        expect(isReportConclusion(f.conclusion)).toBe(true)
      }
    }
  })
})
