import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { protectDomainEvent } from '@/domain/workflow/workflow-protect'
import {
  AGGREGATE_TYPES,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
} from '@/domain/workflow/event-types'

/**
 * 领域事件 / 事务 Outbox（tasks.md M6.3 / design §3 domain_events / R8）
 *
 * 职责：
 *   - 存储业务事件（不可变 append-only），与业务状态、审计在同一事务写入
 *   - 消费器按 event_id + aggregate_version 幂等处理
 *   - 高风险操作的业务写入、事件和审计位于同一事务（AGENTS.md §10）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *   - 重复事件不会生成重复待办或通知（M6 验收门）
 *   - Outbox 只追加，不允许原地改写历史事件 payload
 *
 * 权限编码（permission-codes.ts）：
 *   - events:read    读取事件列表 / 详情
 *   - events:write   业务操作同事务写入（已认证用户即可）
 *   - events:manage  修改 / 删除（默认禁止，仅平台管理员）
 *
 * 同事务写入模式：
 *   1. 业务 Collection 的 afterChange hook 计算 publishEvent(params)
 *   2. 同事务调用 req.payload.create({ collection: 'domain-events', data })
 *   3. 消费器异步拉取未处理事件并执行幂等副作用
 */
export const DomainEvents: CollectionConfig = {
  slug: 'domain-events',
  labels: {
    singular: '领域事件',
    plural: '领域事件',
  },
  admin: {
    useAsTitle: 'eventType',
    defaultColumns: [
      'eventType',
      'aggregateType',
      'aggregateId',
      'aggregateVersion',
      'occurredAt',
      'processedAt',
      'attemptCount',
    ],
    description:
      '事务 Outbox：业务事件 append-only。消费器按 event_id + aggregate_version 幂等处理，重复投递不生成重复待办/通知/审计。',
    group: 'workflow',
  },
  // Outbox 只追加：不允许删除（trash: false），update/delete 由 events:manage 控制
  // 默认 createCollectionAccess 不配置 update/delete 时要求登录态，但 Outbox
  // 业务上要求"禁止外部修改"，故 update/delete 显式返回 false。
  access: {
    ...createCollectionAccess({
      read: 'events:read',
      create: 'events:write',
    }),
    // update / delete 默认禁止：仅消费器内部通过 overrideAccess 更新处理状态
    update: () => false,
    delete: () => false,
  },
  // Outbox 不支持 trash（业务上不可删除）
  versions: false,
  hooks: {
    beforeChange: [protectDomainEvent],
  },
  fields: [
    {
      name: 'eventId',
      label: '事件 ID',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: '稳定唯一 ID（nanoid 21 字符）。Outbox 主键，消费器幂等键。',
      },
    },
    {
      name: 'eventType',
      label: '事件类型',
      type: 'select',
      required: true,
      options: EVENT_TYPES.map((value) => ({
        value,
        label: EVENT_TYPE_LABELS[value],
      })),
      index: true,
      admin: {
        readOnly: true,
        description: '事件类型枚举（如 listing.published / report.sustained）。',
      },
    },
    {
      name: 'aggregateType',
      label: '聚合类型',
      type: 'select',
      required: true,
      options: AGGREGATE_TYPES.map((value) => ({ value, label: value })),
      index: true,
      admin: {
        readOnly: true,
        description: '聚合根类型（listing / report / lead / followup / sla）。',
      },
    },
    {
      name: 'aggregateId',
      label: '聚合 ID',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: '聚合根 ID 字符串形式（兼容 number / uuid）。',
      },
    },
    {
      name: 'aggregateVersion',
      label: '聚合版本',
      type: 'number',
      required: true,
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '聚合版本号（乐观锁，每次状态变更 +1）。与 event_id 共同构成幂等键。',
      },
    },
    {
      name: 'payload',
      label: '事件负载',
      type: 'json',
      required: true,
      admin: {
        readOnly: true,
        description: '事件 JSON 负载。Outbox 追加语义：写入后不可变。',
      },
    },
    {
      name: 'occurredAt',
      label: '发生时间',
      type: 'date',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        date: {
          displayFormat: 'yyyy-MM-dd HH:mm:ss',
        },
        description: '事件发生时间（UTC 存储，Asia/Shanghai 显示）。',
      },
    },
    {
      name: 'processedAt',
      label: '处理完成时间',
      type: 'date',
      index: true,
      admin: {
        readOnly: true,
        date: {
          displayFormat: 'yyyy-MM-dd HH:mm:ss',
        },
        description: '消费器处理完成时间。null 表示未处理；非 null 表示已幂等处理。',
      },
    },
    {
      name: 'attemptCount',
      label: '尝试次数',
      type: 'number',
      defaultValue: 0,
      admin: {
        readOnly: true,
        description: '消费器处理尝试次数。达到上限后标记为死信，不再自动重试。',
      },
    },
    {
      name: 'lastError',
      label: '最后错误',
      type: 'textarea',
      admin: {
        readOnly: true,
        description: '消费器最后处理错误。成功后清空。',
      },
    },
  ],
}
