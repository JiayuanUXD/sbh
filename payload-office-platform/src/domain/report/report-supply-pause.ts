/**
 * 房源举报供给暂停服务（tasks.md M6.2 / design §3.5 / R4, R5, R8）
 *
 * 在 M6.1 状态机之上编排"供给暂停"语义：
 *   - pauseSupplyForReport：举报关闭且结论为 sustained/partial 时设置 supplyPaused=true
 *   - resumeSupplyForReport：手动恢复供给，要求权限、原因和审计
 *   - buildSupplyPauseEffect：M6.1 预留，本任务完善（已挪至 report-supply-effect.ts）
 *
 * 业务不变量（AGENTS.md §5.2, §10）：
 *   - 有效举报暂停只影响统一有效供给谓词
 *   - 不改写审核状态和发布状态（业务不变量）
 *   - 恢复和关闭要求权限、原因和审计
 *   - 跨对象副作用使用事务 Outbox（M6.3 已完成）
 *
 * 不直接写库：返回 OperationResult<SupplyPauseResult>，由 Collection hook /
 * endpoint 在同事务内落库（业务状态 + 事件 + 审计同事务，AGENTS.md §10）。
 */

import {
  ForbiddenError,
  InvalidOperationError,
} from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'
import { toUtcIso } from '@/domain/shared/time'
import {
  isReportConclusion,
  type ReportConclusion,
} from './report-status'
import { buildSupplyPauseEffect, type SupplyPauseEffect } from './report-supply-effect'

/**
 * 举报最小快照：供给暂停服务只关心这些字段。
 *
 * 与 ReportSnapshot（report-transition.ts）相比：
 *   - 增加 targetListingId（事件 payload 需要）
 *   - 增加 evidence（evidenceCount 透传）
 *   - 不需要 assigneeId（暂停动作不依赖负责人）
 */
export interface ReportSupplySnapshot {
  /** 举报记录 ID */
  id: string | number
  /** 被举报房源 ID（事件 payload / 暂停目标） */
  targetListingId: string | number
  /** 当前处理状态 */
  status: string
  /** 当前状态版本号（事件 aggregateVersion 用） */
  statusVersion: number
  /** 结论（仅 closed 时填） */
  conclusion?: ReportConclusion | null
  /** 结论原因（仅 closed 时填） */
  conclusionReason?: string | null
  /** 当前供给暂停状态 */
  supplyPaused: boolean
  /** 证据数组（计算 evidenceCount 用） */
  evidence?: ReadonlyArray<unknown> | null
}

/** 供给暂停操作结果（落库时由调用方写入的字段集合）。 */
export interface SupplyPauseResult {
  /** 举报记录 ID */
  reportId: string | number
  /** 被举报房源 ID */
  targetListingId: string | number
  /** 操作后 supplyPaused 字段值 */
  supplyPaused: boolean
  /** 操作时间（UTC ISO 字符串，写入 supplyPausedAt / supplyResumedAt） */
  operatedAt: string
  /** 供给暂停效果（含 shouldPause / reason / evidenceCount） */
  effect: SupplyPauseEffect
}

/** 权限上下文最小接口（避免依赖完整 PermissionContext）。 */
export interface ReportPermissionContext {
  /** 当前操作用户 ID（审计用） */
  actorId: string | number
  /** 是否拥有指定操作权限 */
  hasPermission: (code: string) => boolean
}

/** 恢复供给入参（resumeSupplyForReport 调用）。 */
export interface ResumeSupplyRequest {
  /** 恢复原因（必填，写入审计与事件 payload） */
  reason: string
  /** 操作上下文（含权限与 actorId） */
  ctx: ReportPermissionContext
}

/**
 * 暂停房源供给（举报关闭且结论为 sustained/partial 时调用）。
 *
 * 校验顺序：
 *   1. 举报状态必须为 closed
 *   2. 结论必须为 sustained 或 partial（dismissed 不应暂停）
 *   3. 调用方必须持有 'report:resolve' 权限
 *
 * 幂等性：如果 supplyPaused 已为 true，返回成功结果但不更新时间戳
 * （避免重复 close 操作覆盖原始暂停时刻）。
 */
export function pauseSupplyForReport(
  report: ReportSupplySnapshot,
  ctx: ReportPermissionContext,
): OperationResult<SupplyPauseResult> {
  // 1. 权限校验
  if (!ctx.hasPermission('report:resolve')) {
    return err(
      new ForbiddenError({
        domain: 'report',
        message: '缺少操作权限：report:resolve',
        details: { requiredOperation: 'report:resolve', actorId: ctx.actorId },
      }),
    )
  }

  // 2. 状态校验：必须已关闭
  if (report.status !== 'closed') {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_NOT_CLOSED',
        message: '举报未关闭，不能暂停供给',
        details: { reportId: report.id, status: report.status },
      }),
    )
  }

  // 3. 结论校验：sustained 或 partial 才暂停
  if (!isReportConclusion(report.conclusion)) {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_CONCLUSION_INVALID',
        message: '举报结论缺失或非法，不能暂停供给',
        details: { reportId: report.id, conclusion: report.conclusion },
      }),
    )
  }
  if (report.conclusion === 'dismissed') {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_DISMISSED_NO_PAUSE',
        message: '举报结论为不成立，不应暂停供给',
        details: { reportId: report.id, conclusion: 'dismissed' },
      }),
    )
  }

  // 4. 推导暂停效果（含 evidenceCount）
  const effect = buildSupplyPauseEffect({
    status: 'closed',
    conclusion: report.conclusion,
    currentSupplyPaused: report.supplyPaused,
    evidence: report.evidence,
  })

  // 5. 幂等：已暂停则不更新时间戳
  const operatedAt = report.supplyPaused ? '' : toUtcIso(new Date())

  return ok({
    reportId: report.id,
    targetListingId: report.targetListingId,
    supplyPaused: true,
    operatedAt,
    effect,
  })
}

/**
 * 恢复房源供给（手动恢复，要求权限和原因）。
 *
 * 校验顺序：
 *   1. 调用方必须持有 'report:resolve' 权限
 *   2. reason 必须非空（恢复必须填写原因，AGENTS.md §5.2）
 *   3. 当前 supplyPaused 必须为 true（未暂停无需恢复）
 *
 * 返回结果包含 supplyResumedAt（UTC ISO 字符串），由调用方写入。
 */
export function resumeSupplyForReport(
  report: ReportSupplySnapshot,
  req: ResumeSupplyRequest,
): OperationResult<SupplyPauseResult> {
  const { reason, ctx } = req

  // 1. 权限校验
  if (!ctx.hasPermission('report:resolve')) {
    return err(
      new ForbiddenError({
        domain: 'report',
        message: '缺少操作权限：report:resolve',
        details: { requiredOperation: 'report:resolve', actorId: ctx.actorId },
      }),
    )
  }

  // 2. 原因非空校验（恢复必须填写原因）
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_RESUME_REASON_REQUIRED',
        message: '恢复供给必须填写原因',
        details: { reportId: report.id },
      }),
    )
  }

  // 3. 当前必须处于暂停状态
  if (!report.supplyPaused) {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_NOT_PAUSED',
        message: '举报未暂停供给，无需恢复',
        details: { reportId: report.id, supplyPaused: false },
      }),
    )
  }

  // 4. 推导效果（恢复后 shouldPause=false）
  // buildSupplyPauseEffect 根据 status+conclusion 会返回 shouldPause=true，
  // 但恢复操作已显式解除暂停，因此覆盖 shouldPause=false。
  // 其他字段（reason/conclusion/evidenceCount）保留用于审计日志。
  const baseEffect = buildSupplyPauseEffect({
    status: report.status as 'closed',
    conclusion: report.conclusion ?? null,
    currentSupplyPaused: false,
    evidence: report.evidence,
  })
  const effect: SupplyPauseEffect = {
    ...baseEffect,
    shouldPause: false,
  }

  return ok({
    reportId: report.id,
    targetListingId: report.targetListingId,
    supplyPaused: false,
    operatedAt: toUtcIso(new Date()),
    effect,
  })
}
