/**
 * P1 Task 6 纠错领域事件发布器
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 6
 *           tasks.md M6.3 / design §3 domain_events / R8
 *
 * 职责：
 *   - 纠错记录创建后生成 'correction.created' 领域事件
 *   - 调用 M6.3 publishEvent 生成完整 DomainEvent 对象
 *   - 返回事件对象，由 Collection afterChange hook 在同事务写入 Outbox
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 跨对象副作用使用事务 Outbox
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *
 * 不直接写库：返回 OperationResult<DomainEvent>，调用方在 Collection
 * afterChange hook 同事务调用 req.payload.create({ collection: 'domain-events' })
 * 写入 Outbox。
 */

import type { OperationResult } from '@/domain/shared/result'
import { publishEvent, type DomainEvent } from '@/domain/workflow/event-publisher'

/** 纠错创建事件 payload（写入 Outbox 后由消费器读取）。 */
export interface CorrectionCreatedEventPayload {
  [k: string]: unknown
  /** 纠错记录 ID */
  correctionId: string
  /** 目标类型 listing / building */
  targetType: string
  /** 目标 slug */
  targetSlug: string
  /** 类别枚举 */
  category: string
}

/** buildCorrectionCreatedEvent 入参。 */
export interface BuildCorrectionCreatedEventParams {
  /** 纠错记录 ID */
  correctionId: string | number
  /** 目标类型 */
  targetType: string
  /** 目标 slug */
  targetSlug: string
  /** 类别枚举 */
  category: string
  /**
   * 事件发生时间（可选，缺省由 publishEvent 取当前 UTC）。
   * 用于测试冻结时间或回放历史事件。
   */
  occurredAt?: string | Date
}

/**
 * 生成纠错创建领域事件。
 *
 * 映射：纠错记录创建 -> 'correction.created'（aggregateType='correction', version=1）。
 *
 * 不直接写库：返回 DomainEvent，由调用方在同事务写入 Outbox。
 * 返回 OperationResult，调用方必须解构 ok / error（AGENTS.md §11）。
 */
export function buildCorrectionCreatedEvent(
  params: BuildCorrectionCreatedEventParams,
): OperationResult<DomainEvent<CorrectionCreatedEventPayload>> {
  const aggregateId = String(params.correctionId)
  const payload: CorrectionCreatedEventPayload = {
    correctionId: aggregateId,
    targetType: params.targetType,
    targetSlug: params.targetSlug,
    category: params.category,
  }
  return publishEvent<CorrectionCreatedEventPayload>({
    eventType: 'correction.created',
    aggregateType: 'correction',
    aggregateId,
    aggregateVersion: 1,
    payload,
    occurredAt: params.occurredAt,
  })
}
