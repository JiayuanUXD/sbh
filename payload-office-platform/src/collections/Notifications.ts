import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import {
  NOTIFICATION_SOURCE_TYPES,
  NOTIFICATION_SOURCE_TYPE_LABELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
} from '@/domain/workflow/notification-types'
import { protectNotification } from '@/domain/workflow/notification-protect'

/**
 * 站内通知（tasks.md M6.7 / design §3.7 / R6, R7, R8）
 *
 * 职责：
 *   - 存储领域事件驱动的站内通知（审核驳回 / 线索分配 / SLA 超时 / 待办变更）
 *   - 通知与业务状态解耦：由消费器从 Outbox 拉取事件后异步生成
 *   - 通知幂等键：eventId + recipient + type（重复事件不重复生成）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 通知只能由消费器创建（overrideAccess），外部 HTTP create 由
 *     protectNotification hook 拦截
 *   - 通知只能由收件人本人标记已读；不允许代签
 *   - 已读通知不允许回退为未读
 *
 * 权限：
 *   - read：notification:read（数据范围收窄到 recipient=self）
 *   - create：默认禁止（消费器内部 overrideAccess=true 创建）
 *   - update：notification:manage（仅允许标记 readAt，protect hook 双层校验）
 *   - delete：notification:manage（管理动作，常规不开放）
 */
export const Notifications: CollectionConfig = {
  slug: 'notifications',
  labels: {
    singular: '通知',
    plural: '消息通知',
  },
  admin: {
    group: false,
    useAsTitle: 'title',
    defaultColumns: [
      'title',
      'type',
      'recipient',
      'sourceType',
      'sourceId',
      'read',
      'createdAt',
    ],
    description:
      '站内通知：审核驳回 / 线索分配转派 / SLA 超时 / 待办变更。由领域事件消费器幂等生成，与业务状态解耦。',
  },
  access: {
    ...createCollectionAccess({
      read: 'notification:read',
      // create 收紧到 notification:manage：Collection 主要由消费器通过
      // overrideAccess 创建，外部 HTTP create 应禁止（防绕过 notification-service）
      create: 'notification:manage',
      update: 'notification:manage',
      delete: 'notification:manage',
    }),
  },
  hooks: {
    beforeChange: [protectNotification],
  },
  fields: [
    {
      name: 'recipient',
      label: '收件人',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: {
        description: '通知收件人（仅本人可读取 / 标记已读）。',
      },
    },
    {
      name: 'type',
      label: '通知类型',
      type: 'select',
      required: true,
      options: NOTIFICATION_TYPES.map((value) => ({
        value,
        label: NOTIFICATION_TYPE_LABELS[value],
      })),
      index: true,
      admin: {
        readOnly: true,
        description: '通知类型枚举，由触发事件派生。',
      },
    },
    {
      name: 'title',
      label: '标题',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: '通知标题（简洁中文文案）。',
      },
    },
    {
      name: 'body',
      label: '正文',
      type: 'textarea',
      admin: {
        readOnly: true,
        description: '通知正文（含业务上下文摘要）。',
      },
    },
    {
      name: 'sourceType',
      label: '来源类型',
      type: 'select',
      required: true,
      options: NOTIFICATION_SOURCE_TYPES.map((value) => ({
        value,
        label: NOTIFICATION_SOURCE_TYPE_LABELS[value],
      })),
      index: true,
      admin: {
        readOnly: true,
        description: '来源业务对象类型（listing-review / lead / followup / task）。',
      },
    },
    {
      name: 'sourceId',
      label: '来源 ID',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: '来源业务对象 ID，用于点击通知跳转到详情页。',
      },
    },
    {
      name: 'eventId',
      label: '事件 ID',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description:
          '触发通知的 Outbox event_id。与 recipient + type 共同构成幂等键。',
      },
    },
    {
      name: 'read',
      label: '已读',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description: '通知是否已读。已读后不允许回退为未读。',
      },
    },
    {
      name: 'readAt',
      label: '已读时间',
      type: 'date',
      admin: {
        readOnly: true,
        date: {
          displayFormat: 'yyyy-MM-dd HH:mm:ss',
        },
        description: '通知已读时间（UTC 存储，Asia/Shanghai 显示）。',
      },
    },
  ],
}
