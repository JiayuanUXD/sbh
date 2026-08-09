/**
 * 领域事件 Collection 权限守卫与保护 hook（tasks.md M6.3 / design §3 / R8）
 *
 * 职责：
 *   - DomainEvents Collection 的 beforeChange hook：
 *     - create：自动生成 eventId（缺省时）、设置 occurredAt 默认值、初始化 attemptCount=0
 *     - update：禁止外部修改 processedAt / attemptCount 之外的字段（防篡改事件 payload）
 *   - 业务调用方在 afterChange 同事务写入事件时，可使用 events:write 权限
 *   - update / delete 默认禁止，仅 events:manage 可管理
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *   - Outbox 只追加，不允许原地改写历史事件 payload
 *
 * 权限编码（permission-codes.ts）：
 *   - events:read    读取事件列表 / 详情
 *   - events:write   业务操作同事务写入（已认证用户即可）
 *   - events:manage  修改 / 删除（默认禁止，仅平台管理员）
 */

import type { CollectionBeforeChangeHook } from 'payload'
import { isDeepStrictEqual } from 'node:util'

import { InvalidOperationError } from '@/domain/shared/errors'
import { isEventType, isAggregateType } from './event-types'
import { buildEventId } from './event-publisher'

/**
 * beforeChange hook：领域事件写入前校验与初始化。
 *
 * create：
 *   - 校验 eventType 已注册
 *   - 校验 aggregateType 已注册
 *   - 校验 aggregateId 非空
 *   - 校验 aggregateVersion ≥ 1
 *   - 自动生成 eventId（如果未提供）
 *   - 设置 occurredAt 默认值（当前 UTC 时间）
 *   - 初始化 attemptCount=0、processedAt=null、lastError=null
 *   - 删除客户端可能传入的 processedAt / attemptCount / lastError（防篡改）
 *
 * update：
 *   - 禁止修改 eventType / aggregateType / aggregateId / aggregateVersion / payload / occurredAt
 *   - 允许修改 processedAt / attemptCount / lastError（消费器使用）
 *   - 事件追加语义：payload 字段一旦写入即不可变
 */
export const protectDomainEvent: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation === 'create') {
    // 1. eventType 必须已注册
    if (!isEventType(data?.eventType)) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_TYPE_INVALID',
        message: '事件类型未注册',
        details: { eventType: data?.eventType },
      })
    }

    // 2. aggregateType 必须已注册
    if (!isAggregateType(data?.aggregateType)) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_TYPE_INVALID',
        message: '聚合类型未注册',
        details: { aggregateType: data?.aggregateType },
      })
    }

    // 3. aggregateId 非空
    const aggregateId = data?.aggregateId
    if (
      typeof aggregateId !== 'string' &&
      typeof aggregateId !== 'number'
    ) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_ID_INVALID',
        message: '聚合 ID 必须为字符串或数字',
        details: { aggregateId },
      })
    }
    if (String(aggregateId).length === 0) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_ID_EMPTY',
        message: '聚合 ID 不能为空',
      })
    }

    // 4. aggregateVersion ≥ 1
    const aggregateVersion = data?.aggregateVersion
    if (
      typeof aggregateVersion !== 'number' ||
      !Number.isInteger(aggregateVersion) ||
      aggregateVersion < 1
    ) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_AGGREGATE_VERSION_INVALID',
        message: '聚合版本号必须为 ≥ 1 的整数',
        details: { aggregateVersion },
      })
    }

    // 5. payload 必须为对象
    if (
      data?.payload === undefined ||
      data?.payload === null ||
      typeof data?.payload !== 'object' ||
      Array.isArray(data?.payload)
    ) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'EVENT_PAYLOAD_INVALID',
        message: '事件 payload 必须为 JSON 对象',
      })
    }

    // 6. 自动生成 eventId（缺省时）
    if (!data.eventId || typeof data.eventId !== 'string' || data.eventId.length === 0) {
      data.eventId = buildEventId()
    }

    // 7. 设置 occurredAt 默认值
    if (!data.occurredAt) {
      data.occurredAt = new Date().toISOString()
    }

    // 8. 初始化处理状态字段（防客户端篡改）
    data.processedAt = null
    data.attemptCount = 0
    data.lastError = null

    return data
  }

  // —— update 路径：只允许修改处理状态字段 ——
  if (operation === 'update' && originalDoc) {
    const immutableFields = [
      'eventId',
      'eventType',
      'aggregateType',
      'aggregateId',
      'aggregateVersion',
      'payload',
      'occurredAt',
    ] as const

    for (const field of immutableFields) {
      const original = (originalDoc as Record<string, unknown>)[field]
      const next = (data as Record<string, unknown> | undefined)?.[field]
      const changed =
        field === 'payload'
          ? !isDeepStrictEqual(next, original)
          : next !== original
      if (next !== undefined && changed) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'EVENT_IMMUTABLE_FIELD',
          message: `事件字段不可变：${field}（Outbox 追加语义）`,
          details: { field, original, next },
        })
      }
    }

    return data
  }

  return data
}
