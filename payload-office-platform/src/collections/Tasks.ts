import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import {
  onTaskChanged,
  protectTask,
  validateTaskIdempotency,
} from '@/domain/workflow/task-protect'
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '@/domain/workflow/task-status'
import {
  TASK_SOURCE_TYPES,
  TASK_SOURCE_TYPE_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
} from '@/domain/workflow/task-types'
import { createBatchTaskClaimEndpoint } from '@/endpoints/my-tasks-endpoint'
import { createBatchTaskTransferEndpoint } from '@/endpoints/my-tasks-endpoint'
import { createMyTasksListEndpoint } from '@/endpoints/my-tasks-endpoint'
import { createTaskClaimEndpoint } from '@/endpoints/my-tasks-endpoint'
import { createTaskTransferEndpoint } from '@/endpoints/my-tasks-endpoint'

/**
 * 待办记录（tasks.md M6.4 / design.md §3.7 tasks / §4.3 待办状态机 / R6, R7, R8）
 *
 * 处理流程：pending → in_progress → completed；pending/in_progress → cancelled
 * 由领域事件 / SLA 扫描驱动创建，状态变更由 task-service.completeTask/cancelTask 推进。
 * protectTask hook 在 beforeChange 兜底校验状态转换合法性，并阻止客户端绕过
 * task-service 直接 PATCH status。
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *   - 重复事件不会生成重复待办（幂等键：taskType + sourceId + sourceVersion）
 *   - 跨对象副作用使用事务 Outbox（M6.3 已完成；任务状态变更不入 Outbox）
 *   - 逾期是计算属性，不新增持久化状态
 *
 * 权限：
 *   - read：task:read（数据范围由上层收窄到 assignee=self 或 team 成员）
 *   - create：默认禁止（task:read 通过但 Collection 主要由系统创建）
 *     外部 create 走 validateTaskIdempotency 校验幂等键
 *   - update / delete：task:manage（管理动作）
 *   - 状态转换业务动作权限（task:assign / task:complete）由 protect hook 双层校验
 */
export const Tasks: CollectionConfig = {
  slug: 'tasks',
  labels: {
    singular: '待办',
    plural: '我的待办',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'taskType',
    defaultColumns: [
      'taskType',
      'sourceId',
      'status',
      'priority',
      'dueAt',
      'assignee',
    ],
    description:
      '工作流待办：审核 / 举报 / 线索 / 跟进 / 房源维护。待处理 → 进行中 → 已完成，未完成的可取消。由来源业务事件驱动创建与闭环。',
  },
  access: {
    ...createCollectionAccess({
      read: 'task:read',
      // create 收紧到 task:manage：Collection 主要由系统（消费器 / 扫描器）通过
      // overrideAccess 创建，外部 HTTP create 应禁止（防绕过 task-service）
      create: 'task:manage',
      update: 'task:manage',
      delete: 'task:manage',
    }),
  },
  // M6.6 我的待办端点：列表 / 单条领取 / 单条转派 / 批量领取 / 批量转派
  endpoints: [
    createMyTasksListEndpoint(),
    createTaskClaimEndpoint(),
    createTaskTransferEndpoint(),
    createBatchTaskClaimEndpoint(),
    createBatchTaskTransferEndpoint(),
  ],
  hooks: {
    beforeValidate: [validateTaskIdempotency],
    beforeChange: [protectTask],
    afterChange: [onTaskChanged],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'taskType',
          label: '任务类型',
          type: 'select',
          required: true,
          options: TASK_TYPES.map((value) => ({
            value,
            label: TASK_TYPE_LABELS[value],
          })),
          index: true,
          admin: {
            description: '6 种任务类型：审核 / 举报分诊 / 未分配线索 / 首次跟进 / 下次跟进 / 房源维护。',
          },
        },
        {
          name: 'sourceId',
          label: '来源 ID',
          type: 'text',
          required: true,
          index: true,
          admin: {
            description: '来源业务对象 ID（如审核记录 ID / 举报 ID / 线索 ID / 跟进 ID / 房源 ID）。',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'sourceVersion',
          label: '来源版本',
          type: 'number',
          required: true,
          defaultValue: 1,
          index: true,
          admin: {
            readOnly: true,
            description: '来源版本号（系统防重标识）。',
          },
        },
        {
          name: 'sourceType',
          label: '来源类型',
          type: 'select',
          required: true,
          options: TASK_SOURCE_TYPES.map((value) => ({
            value,
            label: TASK_SOURCE_TYPE_LABELS[value],
          })),
          index: true,
          admin: {
            readOnly: true,
            description: '来源业务对象类型，由 taskType 派生（系统自动填充）。',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'assignee',
          label: '负责人',
          type: 'relationship',
          relationTo: 'users',
          index: true,
          admin: {
            description: '任务负责人（领取 / 转派后指派）。',
          },
        },
        {
          name: 'team',
          label: '团队',
          type: 'relationship',
          relationTo: 'teams',
          index: true,
          admin: {
            description: '任务所属团队（用于团队数据范围收窄）。',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'priority',
          label: '优先级',
          type: 'select',
          required: true,
          defaultValue: 'normal',
          options: TASK_PRIORITIES.map((value) => ({
            value,
            label: TASK_PRIORITY_LABELS[value],
          })),
          index: true,
          admin: {
            description: 'urgent > high > normal > low，决定排序和处理紧急度。',
          },
        },
        {
          name: 'status',
          label: '状态',
          type: 'select',
          defaultValue: 'pending',
          options: TASK_STATUSES.map((value) => ({
            value,
            label: TASK_STATUS_LABELS[value],
          })),
          index: true,
          admin: {
            readOnly: true,
            description: '由 task-service 推导，不接受外部直接指定。',
          },
        },
      ],
    },
    {
      name: 'dueAt',
      label: '截止时间',
      type: 'date',
      required: true,
      index: true,
      admin: {
        date: {
          displayFormat: 'yyyy-MM-dd HH:mm:ss',
        },
        description: '截止时间（UTC 存储，Asia/Shanghai 显示）。逾期是计算属性，不新增持久化状态。',
      },
    },
    {
      // 只读闭环信息默认折叠：日常处理任务不需要看，排查时展开
      type: 'collapsible',
      label: '完成与取消记录（只读）',
      admin: { initCollapsed: true },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'completedAt',
              label: '完成时间',
              type: 'date',
              admin: {
                readOnly: true,
                date: {
                  displayFormat: 'yyyy-MM-dd HH:mm:ss',
                },
                description: '任务完成时间（completed 状态时填写）。',
              },
            },
            {
              name: 'cancelledAt',
              label: '取消时间',
              type: 'date',
              admin: {
                readOnly: true,
                date: {
                  displayFormat: 'yyyy-MM-dd HH:mm:ss',
                },
                description: '任务取消时间（cancelled 状态时填写）。',
              },
            },
          ],
        },
        {
          name: 'cancellationReason',
          label: '取消原因',
          type: 'textarea',
          admin: {
            readOnly: true,
            description: '取消任务时必填，记录来源取消事件或人工取消原因。',
          },
        },
        {
          name: 'completionEventId',
          label: '完成事件 ID',
          type: 'text',
          index: true,
          admin: {
            readOnly: true,
            description: '完成时关联的来源 domain event ID，用于审计回溯。',
          },
        },
      ],
    },
    {
      // 只读扩展元数据默认折叠：仅审计与下钻时需要
      type: 'collapsible',
      label: '扩展元数据（只读）',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'metadata',
          label: '扩展元数据',
          type: 'json',
          admin: {
            readOnly: true,
            description: '系统产出的扩展字段（如 listingId / leadId / eventId），用于审计与下钻。',
          },
        },
      ],
    },
  ],
}
