/**
 * 房源举报状态转换服务（tasks.md M6.1 / design §3.5 / R5, R8）
 *
 * 承接 report-status.ts 之上的跨字段编排：
 *   - 校验合法转换（canTransitionReport）
 *   - 关闭必须填写结论和结论原因（requiresConclusion）
 *   - 生成状态版本号（statusVersion，每次转换 +1，AGENTS.md §5.5 关键状态变更记录）
 *   - 推导供给暂停副作用（report-supply-effect，M6.2 复用）
 *
 * 不直接写库：返回纯结果对象，由 Collection hook / endpoint 落库。
 * 高风险操作的业务写入、事件和审计必须位于同一事务（AGENTS.md §10），
 * M6.3 Outbox 未实现前，本服务预留事件钩子但不发布事件。
 */

import {
  IllegalStateTransitionError,
  InvalidOperationError,
  VersionConflictError,
} from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'
import {
  allowedReportTransitions,
  canTransitionReport,
  isReportConclusion,
  isReportStatus,
  isTerminalStatus,
  requiresConclusion,
  type ReportConclusion,
  type ReportStatus,
} from './report-status'
import { buildSupplyPauseEffect, type SupplyPauseEffect } from './report-supply-effect'

/** 当前举报快照（转换前的最小必要字段）。 */
export interface ReportSnapshot {
  id: string | number
  status: ReportStatus
  statusVersion: number
  conclusion?: ReportConclusion | null
  conclusionReason?: string | null
  assigneeId?: string | number | null
  supplyPaused: boolean
}

/** 转换请求（驱动状态流转的输入）。 */
export interface ReportTransitionRequest {
  /** 举报记录 ID */
  reportId: string | number
  /** 当前状态（来自数据库快照，不接受客户端传入的"目标当前态"） */
  currentStatus: ReportStatus
  /** 当前状态版本号（乐观锁，AGENTS.md §6） */
  currentVersion: number
  /** 目标状态 */
  targetStatus: ReportStatus
  /** 领取 / 转派时指定的负责人（target=assigned 时可选） */
  assigneeId?: string | number | null
  /** 关闭时填写的结论（target=closed 必填） */
  conclusion?: ReportConclusion | null
  /** 关闭时填写的结论原因（target=closed 必填） */
  conclusionReason?: string | null
  /** 操作人 ID（用于审计，本服务不落审计，仅透传） */
  actorId: string | number
}

/** 转换结果（落库时由调用方写入的字段集合）。 */
export interface ReportTransitionResult {
  reportId: string | number
  status: ReportStatus
  /** 新版本号 = currentVersion + 1 */
  statusVersion: number
  conclusion?: ReportConclusion | null
  conclusionReason?: string | null
  assigneeId?: string | number | null
  /** 供给暂停副作用（M6.2 supply pause 使用） */
  supplyEffect: SupplyPauseEffect
}

/**
 * 执行举报状态转换。
 *
 * 校验顺序：
 *   1. 状态枚举合法
 *   2. 非终态（closed 不可再流转）
 *   3. 合法转换表
 *   4. 关闭必须有 conclusion + conclusionReason
 *
 * 返回 OperationResult，调用方必须解构 ok / error（AGENTS.md §11）。
 */
export function transitionReportStatus(
  req: ReportTransitionRequest,
): OperationResult<ReportTransitionResult> {
  const { currentStatus, targetStatus, currentVersion } = req

  // 1. 枚举校验（防御性：调用方应已用 isReportStatus 守卫，此处兜底）
  if (!isReportStatus(currentStatus) || !isReportStatus(targetStatus)) {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_STATUS_INVALID',
        message: '举报状态枚举非法',
        details: { currentStatus, targetStatus },
      }),
    )
  }

  // 2. 终态不可再流转（AGENTS.md §5.5 不可变历史）
  if (isTerminalStatus(currentStatus)) {
    return err(
      new IllegalStateTransitionError({
        domain: 'report',
        resource: '房源举报',
        from: currentStatus,
        to: targetStatus,
        allowedTransitions: allowedReportTransitions(currentStatus),
        details: { reason: 'terminal_status' },
      }),
    )
  }

  // 3. 合法转换表
  if (!canTransitionReport(currentStatus, targetStatus)) {
    return err(
      new IllegalStateTransitionError({
        domain: 'report',
        resource: '房源举报',
        from: currentStatus,
        to: targetStatus,
        allowedTransitions: allowedReportTransitions(currentStatus),
      }),
    )
  }

  // 4. 关闭必须有结论和结论原因（design §3.5 resolution + resolution_reason）
  if (requiresConclusion(targetStatus)) {
    if (!isReportConclusion(req.conclusion)) {
      return err(
        new InvalidOperationError({
          domain: 'report',
          code: 'REPORT_CONCLUSION_REQUIRED',
          message: '关闭举报必须填写结论',
          details: { reportId: req.reportId },
        }),
      )
    }
    if (typeof req.conclusionReason !== 'string' || req.conclusionReason.trim().length === 0) {
      return err(
        new InvalidOperationError({
          domain: 'report',
          code: 'REPORT_CONCLUSION_REASON_REQUIRED',
          message: '关闭举报必须填写结论原因',
          details: { reportId: req.reportId },
        }),
      )
    }
  }

  // 5. 版本号自增（每次状态变更 +1）
  const nextVersion = currentVersion + 1

  // 6. 推导供给暂停副作用
  const supplyEffect = buildSupplyPauseEffect({
    status: targetStatus,
    conclusion: req.conclusion ?? null,
    currentSupplyPaused: false, // 由调用方在更上层合并当前快照；此处只算本次转换的增量
  })

  return ok({
    reportId: req.reportId,
    status: targetStatus,
    statusVersion: nextVersion,
    conclusion: targetStatus === 'closed' ? (req.conclusion ?? null) : null,
    conclusionReason:
      targetStatus === 'closed' ? (req.conclusionReason ?? null) : null,
    assigneeId: req.assigneeId ?? null,
    supplyEffect,
  })
}

/**
 * 乐观锁校验：调用方提交的 currentVersion 必须与库内一致。
 *
 * 单独抽出便于 endpoint 在调用 transitionReportStatus 前先校验版本，
 * 旧版本写入返回 409（AGENTS.md §6）。
 */
export function assertReportVersion(params: {
  expected: number
  actual: number
  reportId: string | number
}): void {
  if (params.expected !== params.actual) {
    throw new VersionConflictError({
      domain: 'report',
      resource: '房源举报',
      expectedVersion: params.expected,
      actualVersion: params.actual,
      details: { reportId: params.reportId },
    })
  }
}
