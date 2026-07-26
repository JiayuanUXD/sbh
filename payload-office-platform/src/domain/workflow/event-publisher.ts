/**
 * 领域事件发布器（tasks.md M6.3 / design §3 domain_events / R8）
 *
 * 职责：
 *   - 生成稳定 event_id（nanoid 风格，21 字符 URL 安全）
 *   - 设置 occurred_at 为当前 UTC 时间
 *   - 返回完整的 DomainEvent 对象，由调用方在同事务写入 Outbox Collection
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *   - 高风险操作的业务写入、事件和审计必须位于同一事务或可靠编排中
 *
 * 设计取舍：
 *   - publishEvent 不直接写库：保持纯函数特性，便于测试和同事务编排
 *   - event_id 使用 nanoid（21 字符，URL 安全，碰撞概率极低）
 *   - occurred_at 使用 UTC ISO 字符串（AGENTS.md §5.6 数据库存储 UTC）
 */

import { randomBytes } from 'node:crypto'

import { InvalidOperationError } from '@/domain/shared/errors'
import { ok, err, type OperationResult } from '@/domain/shared/result'
import {
  aggregateTypeFromEventType,
  isEventType,
  isAggregateType,
  type EventType,
} from './event-types'

/** nanoid 字母表（URL 安全，无歧义字符） */
const NANO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
/** nanoid 默认长度（21 字符，碰撞概率 < 1/10^15） */
const NANO_LENGTH = 21

/**
 * 生成稳定的事件 ID（nanoid 风格）。
 *
 * 不依赖第三方包：基于 node:crypto.randomBytes 生成 21 字符 URL 安全字符串。
 * 碰撞概率与 nanoid 默认配置一致（远低于 uuid v4）。
 */
export function buildEventId(): string {
  const bytes = randomBytes(NANO_LENGTH)
  let id = ''
  for (let i = 0; i < NANO_LENGTH; i++) {
    id += NANO_ALPHABET[bytes[i] % NANO_ALPHABET.length]
  }
  return id
}

/** 领域事件对象（与 domain_events Collection 字段对齐） */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  /** 稳定唯一 ID（nanoid 21 字符） */
  eventId: string
  /** 事件类型（如 'listing.published'） */
  eventType: EventType
  /** 聚合类型（如 'listing' / 'report' / 'lead'） */
  aggregateType: string
  /** 聚合 ID（字符串形式，兼容 number / string / uuid） */
  aggregateId: string
  /** 聚合版本号（乐观锁，每次状态变更 +1） */
  aggregateVersion: number
  /** 事件负载（JSON，事件数据） */
  payload: TPayload
  /** 事件发生时间（UTC ISO 字符串） */
  occurredAt: string
  /** 处理完成时间（消费器成功处理后写入；未处理为 null） */
  processedAt: string | null
  /** 处理尝试次数（默认 0，每次重试 +1） */
  attemptCount: number
  /** 最后处理错误（消费器失败时写入；成功后清空） */
  lastError: string | null
}

/** 发布事件入参（调用方提供，publishEvent 补充生成字段） */
export interface PublishEventParams<TPayload> {
  /** 事件类型（必须在 EVENT_TYPES 注册） */
  eventType: EventType
  /**
   * 聚合类型。
   * - 可选：缺省时按事件类型前缀推导（如 'listing.published' → 'listing'）
   * - 显式传入时必须为已注册聚合类型
   */
  aggregateType?: string
  /** 聚合 ID（字符串形式） */
  aggregateId: string | number
  /** 聚合版本号（≥ 1） */
  aggregateVersion: number
  /** 事件负载 */
  payload: TPayload
  /**
   * 事件发生时间。
   * - 可选：缺省时取当前 UTC 时间
   * - 用于回放历史事件或测试冻结时间
   */
  occurredAt?: string | Date
}

/**
 * 发布领域事件：生成 eventId、推导聚合类型、设置 occurredAt，
 * 返回完整 DomainEvent 对象。
 *
 * 不直接写库：调用方（业务 Collection 的 afterChange hook 或 endpoint）
 * 在同一事务中调用 req.payload.create({ collection: 'domain-events', ... })
 * 写入 Outbox。
 *
 * 返回 OperationResult，调用方必须解构 ok / error（AGENTS.md §11）。
 */
export function publishEvent<TPayload>(
  params: PublishEventParams<TPayload>,
): OperationResult<DomainEvent<TPayload>> {
  // 1. 校验事件类型已注册
  if (!isEventType(params.eventType)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_TYPE_NOT_REGISTERED',
        message: `事件类型未注册：${params.eventType}`,
        details: { eventType: params.eventType },
      }),
    )
  }

  // 2. 推导 / 校验聚合类型
  const aggregateType =
    params.aggregateType ?? aggregateTypeFromEventType(params.eventType)
  if (!aggregateType) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_TYPE_MISSING',
        message: '无法从事件类型推导聚合类型，需显式传入 aggregateType',
        details: { eventType: params.eventType },
      }),
    )
  }
  if (!isAggregateType(aggregateType)) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_TYPE_INVALID',
        message: `聚合类型未注册：${aggregateType}`,
        details: { aggregateType },
      }),
    )
  }

  // 3. 校验聚合 ID 非空
  const aggregateId = String(params.aggregateId)
  if (aggregateId.length === 0) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_ID_EMPTY',
        message: '聚合 ID 不能为空',
        details: { eventType: params.eventType },
      }),
    )
  }

  // 4. 校验聚合版本号 ≥ 1
  if (
    !Number.isInteger(params.aggregateVersion) ||
    params.aggregateVersion < 1
  ) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_VERSION_INVALID',
        message: '聚合版本号必须为 ≥ 1 的整数',
        details: { aggregateVersion: params.aggregateVersion },
      }),
    )
  }

  // 5. 校验 payload 为可序列化对象
  if (
    params.payload === null ||
    typeof params.payload !== 'object' ||
    Array.isArray(params.payload)
  ) {
    return err(
      new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_PAYLOAD_INVALID',
        message: '事件 payload 必须为 JSON 对象',
        details: { eventType: params.eventType },
      }),
    )
  }

  // 6. 推导 occurredAt（默认当前 UTC 时间）
  const occurredAt =
    params.occurredAt === undefined
      ? new Date().toISOString()
      : typeof params.occurredAt === 'string'
        ? params.occurredAt
        : params.occurredAt.toISOString()

  return ok({
    eventId: buildEventId(),
    eventType: params.eventType,
    aggregateType,
    aggregateId,
    aggregateVersion: params.aggregateVersion,
    payload: params.payload,
    occurredAt,
    processedAt: null,
    attemptCount: 0,
    lastError: null,
  })
}
