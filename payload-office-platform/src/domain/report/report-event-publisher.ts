/**
 * 房源举报领域事件发布器（tasks.md M6.2 / design §3 domain_events / R8）
 *
 * 职责：
 *   - 根据"举报关闭"动作的结论生成对应领域事件
 *     - conclusion=sustained / partial → 'report.sustained'
 *     - conclusion=dismissed            → 'report.dismissed'
 *   - 调用 M6.3 publishEvent 生成完整 DomainEvent 对象
 *   - 返回事件对象，由 Collection hook 在同事务写入 Outbox
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 跨对象副作用使用事务 Outbox
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *   - 高风险操作的业务写入、事件和审计位于同一事务
 *
 * 不直接写库：返回 OperationResult<DomainEvent>，调用方在 Collection
 * afterChange hook 同事务调用 req.payload.create({ collection: 'domain-events' })
 * 写入 Outbox。
 */

import { InvalidOperationError } from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'
import {
  publishEvent,
  type DomainEvent,
} from '@/domain/workflow/event-publisher'
import { isReportConclusion, type ReportConclusion } from './report-status'
import type { ReportSupplySnapshot } from './report-supply-pause'

/** 举报关闭事件 payload（写入 Outbox 后由消费器读取）。 */
export interface ReportClosedEventPayload {
  [k: string]: unknown
  /** 举报记录 ID */
  reportId: string
  /** 被举报房源 ID */
  targetListingId: string
  /** 结论（sustained / partial / dismissed） */
  conclusion: ReportConclusion
  /** 结论原因（关闭时填写） */
  conclusionReason: string | null
  /** 供给是否被暂停（sustained/partial=true，dismissed=false） */
  supplyPaused: boolean
  /** 证据数量（供审计与诊断） */
  evidenceCount: number
  /** 操作人 ID */
  actorId: string
}

/** buildReportClosedEvent 入参。 */
export interface BuildReportClosedEventParams {
  /** 举报快照（必须已 closed） */
  report: ReportSupplySnapshot
  /** 操作人 ID（写入事件 payload.actorId） */
  actorId: string | number
  /** 当前供给暂停效果（决定 payload.supplyPaused） */
  supplyPaused: boolean
  /**
   * 事件发生时间（可选，缺省由 publishEvent 取当前 UTC）。
   * 用于测试冻结时间或回放历史事件。
   */
  occurredAt?: string | Date
}

/**
 * 根据"举报关闭"动作的结论生成领域事件。
 *
 * 映射规则：
 *   - conclusion=sustained → 'report.sustained'
 *   - conclusion=partial   → 'report.sustained'（部分成立也走 sustained 事件，
 *     payload.conclusion 区分；供给暂停效果一致）
 *   - conclusion=dismissed → 'report.dismissed'
 *
 * 不直接写库：返回 DomainEvent，由调用方在同事务写入 Outbox。
 *
 * 返回 OperationResult，调用方必须解构 ok / error（AGENTS.md §11）。
 */
export function buildReportClosedEvent(
  params: BuildReportClosedEventParams,
): OperationResult<DomainEvent<ReportClosedEventPayload>> {
  const { report, actorId, supplyPaused, occurredAt } = params

  // 1. 举报必须已关闭
  if (report.status !== 'closed') {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_NOT_CLOSED_FOR_EVENT',
        message: '举报未关闭，不能生成关闭事件',
        details: { reportId: report.id, status: report.status },
      }),
    )
  }

  // 2. 结论必须合法
  if (!isReportConclusion(report.conclusion)) {
    return err(
      new InvalidOperationError({
        domain: 'report',
        code: 'REPORT_CONCLUSION_INVALID_FOR_EVENT',
        message: '举报结论缺失或非法，不能生成关闭事件',
        details: { reportId: report.id, conclusion: report.conclusion },
      }),
    )
  }

  const conclusion: ReportConclusion = report.conclusion
  // sustained / partial → 'report.sustained'；dismissed → 'report.dismissed'
  const eventType = conclusion === 'dismissed' ? 'report.dismissed' : 'report.sustained'

  // 3. 聚合版本号：使用举报 statusVersion（已自增至关闭后版本）
  const aggregateVersion = report.statusVersion

  // 4. 证据数量
  const evidenceCount = Array.isArray(report.evidence) ? report.evidence.length : 0

  // 5. 构造 payload
  const payload: ReportClosedEventPayload = {
    reportId: String(report.id),
    targetListingId: String(report.targetListingId),
    conclusion,
    conclusionReason: report.conclusionReason ?? null,
    supplyPaused,
    evidenceCount,
    actorId: String(actorId),
  }

  // 6. 调用 publishEvent 生成完整 DomainEvent
  return publishEvent<ReportClosedEventPayload>({
    eventType,
    aggregateType: 'report',
    aggregateId: String(report.id),
    aggregateVersion,
    payload,
    occurredAt,
  })
}
