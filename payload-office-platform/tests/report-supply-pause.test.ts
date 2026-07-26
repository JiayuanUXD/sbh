import { describe, it, expect } from 'vitest'

import {
  buildReportClosedEvent,
  type ReportClosedEventPayload,
} from '@/domain/report/report-event-publisher'
import {
  pauseSupplyForReport,
  resumeSupplyForReport,
  type ReportPermissionContext,
  type ReportSupplySnapshot,
} from '@/domain/report/report-supply-pause'
import { protectListingReport } from '@/domain/report/report-protect'
import {
  buildSupplyPauseEffect,
  shouldPauseSupply,
} from '@/domain/report/report-supply-effect'
import {
  DomainError,
  ForbiddenError,
  InvalidOperationError,
} from '@/domain/shared/errors'
import {
  REPORT_FIXTURE_CLOSED_DISMISSED,
  REPORT_FIXTURE_CLOSED_PARTIAL,
  REPORT_FIXTURE_CLOSED_SUSTAINED,
  REPORT_FIXTURE_MINIMAL,
} from '@/test/factory/reports'
import {
  extractPausedListingIds,
  getPausedListingIds,
  isListingPaused,
  listingReportPauseWhere,
  type PayloadQueryPort,
} from '@/domain/review/effective-supply'

/**
 * M6.2 房源举报供给暂停测试（design §3.5 / §5 第 5 条 / R4, R5, R8）
 *
 * 覆盖：
 *   - pauseSupplyForReport：合法 sustained / partial / 未关闭 / dismissed / 无权限
 *   - resumeSupplyForReport：合法恢复 / 缺 reason / 无权限 / 未暂停
 *   - buildReportClosedEvent：sustained / partial / dismissed / 未关闭 / payload 字段
 *   - listingReportPauseWhere / getPausedListingIds / extractPausedListingIds / isListingPaused
 *   - 集成：protectListingReport 关闭时自动推导 supplyPaused / 拒绝无权限修改
 *   - buildSupplyPauseEffect evidenceCount 字段
 */

// ────────────────────────────────────────────────────────────
// 辅助：构造权限上下文与举报快照
// ────────────────────────────────────────────────────────────
function ctxWith(perms: string[]): ReportPermissionContext {
  const set = new Set(perms)
  return {
    actorId: 'user-csr-1',
    hasPermission: (code: string) => set.has(code) || set.has('*'),
  }
}

function ctxNoPerm(): ReportPermissionContext {
  return { actorId: 'user-anon', hasPermission: () => false }
}

function snapshotFromFixture(
  f: typeof REPORT_FIXTURE_CLOSED_SUSTAINED,
): ReportSupplySnapshot {
  return {
    id: f.id,
    targetListingId: f.targetListingId,
    status: f.status,
    statusVersion: f.statusVersion,
    conclusion: f.conclusion ?? null,
    conclusionReason: f.conclusionReason ?? null,
    supplyPaused: f.supplyPaused,
    evidence: f.evidence,
  }
}

// ────────────────────────────────────────────────────────────
// 1. pauseSupplyForReport
// ────────────────────────────────────────────────────────────
describe('pauseSupplyForReport — 合法暂停路径', () => {
  it('合法关闭 sustained → supplyPaused=true、effect.shouldPause=true', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    // 重置 supplyPaused 为 false，模拟"刚关闭还未暂停"
    report.supplyPaused = false
    const r = pauseSupplyForReport(report, ctxWith(['report:resolve']))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.supplyPaused).toBe(true)
    expect(r.data.reportId).toBe(report.id)
    expect(r.data.targetListingId).toBe(report.targetListingId)
    expect(r.data.effect.shouldPause).toBe(true)
    expect(r.data.effect.reason).toBe('sustained')
    expect(r.data.effect.conclusion).toBe('sustained')
    expect(r.data.effect.evidenceCount).toBe(REPORT_FIXTURE_CLOSED_SUSTAINED.evidence.length)
    // operatedAt 为 ISO 字符串
    expect(typeof r.data.operatedAt).toBe('string')
    expect(r.data.operatedAt.length).toBeGreaterThan(0)
  })

  it('合法关闭 partial → supplyPaused=true、effect.reason=partial', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_PARTIAL)
    report.supplyPaused = false
    const r = pauseSupplyForReport(report, ctxWith(['report:resolve']))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.supplyPaused).toBe(true)
    expect(r.data.effect.shouldPause).toBe(true)
    expect(r.data.effect.reason).toBe('partial')
    expect(r.data.effect.conclusion).toBe('partial')
  })

  it('已暂停（supplyPaused=true）幂等：返回 ok 但 operatedAt 为空字符串', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    // supplyPaused 已为 true（fixture 默认值）
    const r = pauseSupplyForReport(report, ctxWith(['report:resolve']))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.supplyPaused).toBe(true)
    // 幂等：不更新时间戳
    expect(r.data.operatedAt).toBe('')
  })
})

describe('pauseSupplyForReport — 非法路径拒绝', () => {
  it('未关闭的 report 不能暂停（pending-triage）', () => {
    const report: ReportSupplySnapshot = {
      id: 'r-1',
      targetListingId: 'listing-1',
      status: 'pending-triage',
      statusVersion: 1,
      supplyPaused: false,
    }
    const r = pauseSupplyForReport(report, ctxWith(['report:resolve']))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(InvalidOperationError)
      expect((r.error as InvalidOperationError).code).toBe('REPORT_NOT_CLOSED')
    }
  })

  it('dismissed 结论不应暂停（返回 REPORT_DISMISSED_NO_PAUSE）', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_DISMISSED)
    const r = pauseSupplyForReport(report, ctxWith(['report:resolve']))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(InvalidOperationError)
      expect((r.error as InvalidOperationError).code).toBe('REPORT_DISMISSED_NO_PAUSE')
    }
  })

  it('缺少 report:resolve 权限拒绝（ForbiddenError）', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    report.supplyPaused = false
    const r = pauseSupplyForReport(report, ctxNoPerm())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(ForbiddenError)
    }
  })

  it('结论缺失（null）拒绝（REPORT_CONCLUSION_INVALID）', () => {
    const report: ReportSupplySnapshot = {
      id: 'r-2',
      targetListingId: 'listing-1',
      status: 'closed',
      statusVersion: 3,
      conclusion: null,
      conclusionReason: null,
      supplyPaused: false,
    }
    const r = pauseSupplyForReport(report, ctxWith(['report:resolve']))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect((r.error as InvalidOperationError).code).toBe('REPORT_CONCLUSION_INVALID')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 2. resumeSupplyForReport
// ────────────────────────────────────────────────────────────
describe('resumeSupplyForReport — 合法恢复路径', () => {
  it('合法恢复 → supplyPaused=false、operatedAt 设置', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    // supplyPaused 已为 true（fixture 默认值）
    const r = resumeSupplyForReport(report, {
      reason: '核实已整改，恢复供给',
      ctx: ctxWith(['report:resolve']),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.supplyPaused).toBe(false)
    expect(r.data.reportId).toBe(report.id)
    expect(typeof r.data.operatedAt).toBe('string')
    expect(r.data.operatedAt.length).toBeGreaterThan(0)
  })

  it('恢复后 effect.shouldPause=false', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    const r = resumeSupplyForReport(report, {
      reason: '已整改',
      ctx: ctxWith(['report:resolve']),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.effect.shouldPause).toBe(false)
  })
})

describe('resumeSupplyForReport — 非法路径拒绝', () => {
  it('缺少 reason 拒绝（REPORT_RESUME_REASON_REQUIRED）', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    const r = resumeSupplyForReport(report, {
      reason: '   ',
      ctx: ctxWith(['report:resolve']),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect((r.error as InvalidOperationError).code).toBe('REPORT_RESUME_REASON_REQUIRED')
    }
  })

  it('无权限拒绝（ForbiddenError）', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    const r = resumeSupplyForReport(report, {
      reason: '已整改',
      ctx: ctxNoPerm(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(ForbiddenError)
    }
  })

  it('未暂停状态拒绝（REPORT_NOT_PAUSED）', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_DISMISSED)
    // fixture 默认 supplyPaused=false
    const r = resumeSupplyForReport(report, {
      reason: '已整改',
      ctx: ctxWith(['report:resolve']),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect((r.error as InvalidOperationError).code).toBe('REPORT_NOT_PAUSED')
    }
  })
})

// ────────────────────────────────────────────────────────────
// 3. buildReportClosedEvent
// ────────────────────────────────────────────────────────────
describe('buildReportClosedEvent — 事件类型映射', () => {
  it('sustained → report.sustained 事件', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    const r = buildReportClosedEvent({
      report,
      actorId: 'user-csr-1',
      supplyPaused: true,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.eventType).toBe('report.sustained')
    expect(r.data.aggregateType).toBe('report')
  })

  it('partial → report.sustained 事件（部分成立也走 sustained）', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_PARTIAL)
    const r = buildReportClosedEvent({
      report,
      actorId: 'user-csr-1',
      supplyPaused: true,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.eventType).toBe('report.sustained')
  })

  it('dismissed → report.dismissed 事件', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_DISMISSED)
    const r = buildReportClosedEvent({
      report,
      actorId: 'user-csr-1',
      supplyPaused: false,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.eventType).toBe('report.dismissed')
  })
})

describe('buildReportClosedEvent — 字段完整性', () => {
  it('事件包含正确的 aggregateId / aggregateVersion / payload', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    const r = buildReportClosedEvent({
      report,
      actorId: 42,
      supplyPaused: true,
      occurredAt: '2026-07-26T10:00:00.000Z',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.aggregateId).toBe(String(report.id))
    expect(r.data.aggregateVersion).toBe(report.statusVersion)
    expect(r.data.occurredAt).toBe('2026-07-26T10:00:00.000Z')
    const payload = r.data.payload as ReportClosedEventPayload
    expect(payload.reportId).toBe(String(report.id))
    expect(payload.targetListingId).toBe(String(report.targetListingId))
    expect(payload.conclusion).toBe('sustained')
    expect(payload.supplyPaused).toBe(true)
    expect(payload.evidenceCount).toBe(REPORT_FIXTURE_CLOSED_SUSTAINED.evidence.length)
    expect(payload.actorId).toBe('42')
  })

  it('payload.conclusionReason 透传 fixture 的结论原因', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_PARTIAL)
    const r = buildReportClosedEvent({
      report,
      actorId: 'user-1',
      supplyPaused: true,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const payload = r.data.payload as ReportClosedEventPayload
    expect(payload.conclusionReason).toBe(report.conclusionReason)
  })

  it('未关闭拒绝（REPORT_NOT_CLOSED_FOR_EVENT）', () => {
    const report: ReportSupplySnapshot = {
      id: 'r-x',
      targetListingId: 'listing-1',
      status: 'submitted-review',
      statusVersion: 5,
      conclusion: null,
      conclusionReason: null,
      supplyPaused: false,
    }
    const r = buildReportClosedEvent({
      report,
      actorId: 'user-1',
      supplyPaused: false,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect((r.error as InvalidOperationError).code).toBe('REPORT_NOT_CLOSED_FOR_EVENT')
    }
  })

  it('eventId 唯一（连续调用生成不同 ID）', () => {
    const report = snapshotFromFixture(REPORT_FIXTURE_CLOSED_SUSTAINED)
    const r1 = buildReportClosedEvent({ report, actorId: 'u1', supplyPaused: true })
    const r2 = buildReportClosedEvent({ report, actorId: 'u1', supplyPaused: true })
    expect(r1.ok && r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return
    expect(r1.data.eventId).not.toBe(r2.data.eventId)
    expect(r1.data.eventId.length).toBeGreaterThanOrEqual(21)
  })
})

// ────────────────────────────────────────────────────────────
// 4. listingReportPauseWhere / getPausedListingIds / isListingPaused
// ────────────────────────────────────────────────────────────
describe('listingReportPauseWhere — where 片段', () => {
  it('返回 fail-closed 正向谓词 supplyPaused equals true', () => {
    const where = listingReportPauseWhere()
    expect(where.supplyPaused).toEqual({ equals: true })
  })

  it('不使用 not_equals（避免 NULL 漏网）', () => {
    const json = JSON.stringify(listingReportPauseWhere())
    expect(json).not.toContain('not_equals')
  })
})

describe('extractPausedListingIds — 从 reports 数组提取 IDs', () => {
  it('处理 targetListing 为 number 形态（depth=0）', () => {
    const reports = [{ targetListing: 101 }, { targetListing: 202 }]
    const ids = extractPausedListingIds(reports)
    expect(ids).toEqual([101, 202])
  })

  it('处理 targetListing 为对象形态（depth≥1）', () => {
    const reports = [
      { targetListing: { id: 'listing-a' } },
      { targetListing: { id: 'listing-b' } },
    ]
    const ids = extractPausedListingIds(reports)
    expect(ids).toEqual(['listing-a', 'listing-b'])
  })

  it('跳过 targetListing=null / undefined', () => {
    const reports = [
      { targetListing: null },
      { targetListing: undefined },
      { targetListing: 303 },
    ]
    const ids = extractPausedListingIds(reports)
    expect(ids).toEqual([303])
  })

  it('去重：相同 listing ID 只保留一个', () => {
    const reports = [
      { targetListing: 1 },
      { targetListing: 1 },
      { targetListing: 2 },
    ]
    const ids = extractPausedListingIds(reports)
    expect(ids).toEqual([1, 2])
  })
})

describe('getPausedListingIds — 异步查询', () => {
  it('调用 payload.find 并返回 listing IDs', async () => {
    const mockPayload: PayloadQueryPort = {
      async find(params) {
        expect(params.collection).toBe('listing-reports')
        expect(params.where.supplyPaused).toEqual({ equals: true })
        expect(params.depth).toBe(0)
        expect(params.overrideAccess).toBe(true)
        return {
          docs: [
            { targetListing: 11 },
            { targetListing: 22 },
            { targetListing: { id: 33 } },
          ],
        }
      },
    }
    const ids = await getPausedListingIds(mockPayload)
    expect(ids).toEqual([11, 22, 33])
  })

  it('空结果返回空数组', async () => {
    const mockPayload: PayloadQueryPort = {
      async find() {
        return { docs: [] }
      },
    }
    const ids = await getPausedListingIds(mockPayload)
    expect(ids).toEqual([])
  })
})

describe('isListingPaused — 判断 listing 是否在暂停列表', () => {
  it('命中返回 true', () => {
    expect(isListingPaused([1, 2, 3], 2)).toBe(true)
  })

  it('未命中返回 false', () => {
    expect(isListingPaused([1, 2, 3], 4)).toBe(false)
  })

  it('空列表始终返回 false', () => {
    expect(isListingPaused([], 1)).toBe(false)
    expect(isListingPaused([], 'any')).toBe(false)
  })

  it('string ID 与 number ID 跨类型比较', () => {
    expect(isListingPaused([1, 2], '2')).toBe(true)
    expect(isListingPaused(['1', '2'], 2)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 5. buildSupplyPauseEffect evidenceCount
// ────────────────────────────────────────────────────────────
describe('buildSupplyPauseEffect — evidenceCount 字段', () => {
  it('不传 evidence 时 evidenceCount=0', () => {
    const effect = buildSupplyPauseEffect({
      status: 'closed',
      conclusion: 'sustained',
      currentSupplyPaused: false,
    })
    expect(effect.evidenceCount).toBe(0)
  })

  it('传 evidence 数组时 evidenceCount=数组长度', () => {
    const effect = buildSupplyPauseEffect({
      status: 'closed',
      conclusion: 'partial',
      currentSupplyPaused: false,
      evidence: [{ image: 1 }, { image: 2 }, { image: 3 }],
    })
    expect(effect.evidenceCount).toBe(3)
  })

  it('shouldPauseSupply 仍按 conclusion 判定，不受 evidenceCount 影响', () => {
    expect(shouldPauseSupply('closed', 'sustained')).toBe(true)
    expect(shouldPauseSupply('closed', 'partial')).toBe(true)
    expect(shouldPauseSupply('closed', 'dismissed')).toBe(false)
    expect(shouldPauseSupply('verifying', 'sustained')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 6. 集成：protectListingReport 关闭时自动推导 supplyPaused
// ────────────────────────────────────────────────────────────
describe('protectListingReport — 关闭时自动推导 supplyPaused（M6.2 集成）', () => {
  const run = (args: Record<string, unknown>) =>
    protectListingReport(args as never) as Promise<Record<string, unknown>>

  const update = (
    data: Record<string, unknown>,
    originalDoc: Record<string, unknown>,
    req?: Record<string, unknown>,
  ) => run({ operation: 'update', originalDoc, data, req })

  it('关闭 sustained 自动设置 supplyPaused=true 和 supplyPausedAt', async () => {
    const out = await update(
      { status: 'closed', conclusion: 'sustained', conclusionReason: '核实属实' },
      { status: 'submitted-review', statusVersion: 5 },
    )
    expect(out.status).toBe('closed')
    expect(out.statusVersion).toBe(6)
    expect(out.supplyPaused).toBe(true)
    expect(out.supplyPausedAt).toBeTruthy()
    expect(out.supplyResumedAt).toBeNull()
  })

  it('关闭 partial 自动设置 supplyPaused=true', async () => {
    const out = await update(
      { status: 'closed', conclusion: 'partial', conclusionReason: '部分成立' },
      { status: 'submitted-review', statusVersion: 5 },
    )
    expect(out.supplyPaused).toBe(true)
    expect(out.supplyPausedAt).toBeTruthy()
  })

  it('关闭 dismissed 自动设置 supplyPaused=false 并清除时间戳', async () => {
    const out = await update(
      { status: 'closed', conclusion: 'dismissed', conclusionReason: '不成立' },
      { status: 'submitted-review', statusVersion: 5 },
    )
    expect(out.supplyPaused).toBe(false)
    expect(out.supplyPausedAt).toBeNull()
    expect(out.supplyResumedAt).toBeNull()
  })

  it('非关闭转换不修改 supplyPaused 字段', async () => {
    const out = await update(
      { status: 'assigned', assignee: 5 },
      { status: 'pending-triage', statusVersion: 1, supplyPaused: false },
    )
    expect(out.status).toBe('assigned')
    // 非关闭转换不主动设置 supplyPaused
    expect(out.supplyPaused).toBeUndefined()
  })
})

describe('protectListingReport — 供给暂停字段权限校验（M6.2 集成）', () => {
  const run = (args: Record<string, unknown>) =>
    protectListingReport(args as never) as Promise<Record<string, unknown>>

  it('修改 supplyPaused 字段无 req.user 时跳过权限校验（兼容测试 / overrideAccess）', async () => {
    // 不传 req；protect hook 应跳过权限校验直接通过
    const out = await run({
      operation: 'update',
      originalDoc: { status: 'closed', statusVersion: 6, supplyPaused: false },
      data: { supplyPaused: true },
    })
    // 跳过权限校验：data 不变
    expect(out.supplyPaused).toBe(true)
  })

  it('修改 supplyResumedAt 字段时无权限抛 ForbiddenError', async () => {
    // 模拟登录用户但无 report:resolve 权限
    // 由于 getPermissionContext 会调用 req.payload.find，这里用最简 mock
    const req = {
      user: { id: 1, roles: [] },
      payload: {
        find: async () => ({ docs: [] }), // 无角色文档
      },
      transactionID: null,
    }
    await expect(
      run({
        operation: 'update',
        originalDoc: {
          status: 'closed',
          statusVersion: 6,
          supplyPaused: true,
          supplyResumedAt: null,
        },
        data: { supplyResumedAt: '2026-07-26T10:00:00.000Z' },
        req,
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

// ────────────────────────────────────────────────────────────
// 7. fixture 一致性
// ────────────────────────────────────────────────────────────
describe('fixture — M6.2 一致性', () => {
  it('REPORT_FIXTURE_CLOSED_SUSTAINED 证据数与 effect.evidenceCount 一致', () => {
    const f = REPORT_FIXTURE_CLOSED_SUSTAINED
    const effect = buildSupplyPauseEffect({
      status: f.status,
      conclusion: f.conclusion ?? null,
      currentSupplyPaused: f.supplyPaused,
      evidence: f.evidence,
    })
    expect(effect.evidenceCount).toBe(f.evidence.length)
  })

  it('REPORT_FIXTURE_MINIMAL 状态非 closed，不应暂停', () => {
    expect(shouldPauseSupply(REPORT_FIXTURE_MINIMAL.status, null)).toBe(false)
  })
})
