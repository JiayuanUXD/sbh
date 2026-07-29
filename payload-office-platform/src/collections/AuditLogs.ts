import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getAuditMaskRules } from '@/domain/auth/field-mask'
import {
  protectAuditLog,
  forbidAuditLogDelete,
  auditLogAfterRead,
} from '@/domain/audit/audit-protect'
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_RESULTS,
  AUDIT_RESULT_LABELS,
} from '@/domain/audit/audit-types'

/**
 * 审计日志（tasks.md M8.1 / design §3 audit_logs / R8）
 *
 * 职责：
 *   - 追加式记录高风险业务动作（审核 / 发布 / 下架 / 商户冻结 / 举报 / 分配 /
 *     认领 / 转派 / 权限和账号停用 等）
 *   - 保存主体 / 角色 / 组织快照、对象版本、前后值、请求上下文和结果
 *   - 对日志详情、敏感值查看和导出本身再次审计
 *
 * 业务不变量（AGENTS.md §10 / design §3.6）：
 *   - 审计日志只允许追加和读取，不提供 update / delete
 *   - 高风险操作审计失败时业务操作必须失败（M8.2 接入）
 *   - 主体 / 角色 / 组织快照在写入时锁定，不随后续权限变更漂移
 *
 * 权限编码（permission-codes.ts）：
 *   - audit:view         查看审计日志列表 / 详情
 *   - audit:export       导出审计日志
 *   - audit:before_after 查看 before / after 字段值（敏感变更前后内容）
 *   - audit-logs         菜单可见性
 *
 * 写入方式：
 *   业务侧通过 writeAudit / writeAuditSuccess / writeAuditFailed 工具写入，
 *   由 protectAuditLog hook 兜底校验字段并强制服务端覆盖主体快照。
 */
export const AuditLogs: CollectionConfig = {
  slug: 'audit-logs',
  labels: {
    singular: '审计日志',
    plural: '审计日志',
  },
  admin: {
    group: false,
    useAsTitle: 'action',
    defaultColumns: [
      'action',
      'result',
      'objectCollection',
      'objectId',
      'subjectUserId',
      'occurredAt',
    ],
    description:
      '追加式审计日志：记录所有高风险业务动作。只允许查看和追加，禁止修改或删除。查看详情和导出本身也会被审计。',
  },
  access: {
    ...createCollectionAccess({
      read: 'audit:view',
      create: 'audit:view',
    }),
    // 审计日志不可修改 / 不可删除（append-only）
    update: () => false,
    delete: () => false,
  },
  versions: false,
  hooks: {
    beforeChange: [protectAuditLog],
    beforeDelete: [forbidAuditLogDelete],
    afterRead: [...createFieldMaskHooks(getAuditMaskRules()), auditLogAfterRead],
  },
  fields: [
    {
      name: 'auditId',
      label: '审计日志 ID',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: '稳定唯一 ID（aud_ 前缀，nanoid 风格）。',
      },
    },
    {
      name: 'action',
      label: '动作',
      type: 'select',
      required: true,
      options: AUDIT_ACTIONS.map((value) => ({
        value,
        label: AUDIT_ACTION_LABELS[value],
      })),
      index: true,
      admin: {
        readOnly: true,
        description: '审计动作类型枚举。',
      },
    },
    {
      name: 'result',
      label: '结果',
      type: 'select',
      required: true,
      options: AUDIT_RESULTS.map((value) => ({
        value,
        label: AUDIT_RESULT_LABELS[value],
      })),
      index: true,
      admin: {
        readOnly: true,
        description: '操作结果：success / failed。',
      },
    },
    {
      name: 'objectCollection',
      label: '对象集合',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: '被操作对象所属 Collection（listings / buildings / leads ...）。',
      },
    },
    {
      name: 'objectId',
      label: '对象 ID',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: '被操作对象 ID（字符串形式，兼容 number / uuid）。',
      },
    },
    {
      name: 'objectVersion',
      label: '对象版本',
      type: 'number',
      required: true,
      admin: {
        readOnly: true,
        description: '操作时对象的版本号（乐观锁）。',
      },
    },
    {
      name: 'before',
      label: '变更前',
      type: 'json',
      admin: {
        readOnly: true,
        description: '变更前对象快照（update / delete 时有值）。需 audit:before_after 权限可见。',
        position: 'sidebar',
      },
    },
    {
      name: 'after',
      label: '变更后',
      type: 'json',
      admin: {
        readOnly: true,
        description: '变更后对象快照（create / update 时有值）。需 audit:before_after 权限可见。',
        position: 'sidebar',
      },
    },
    {
      name: 'changedFields',
      label: '变更字段',
      type: 'json',
      admin: {
        readOnly: true,
        description: '本次变更的字段路径列表（如 ["stage", "assigneeId"]）。',
      },
    },
    {
      name: 'subjectUserId',
      label: '操作人 ID',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: '操作人账号 ID。系统动作时为 null。',
      },
    },
    {
      name: 'subjectRoleCodes',
      label: '操作人角色',
      type: 'json',
      admin: {
        readOnly: true,
        description: '操作时的角色编码列表（写入时锁定，不随后续权限变更漂移）。',
      },
    },
    {
      name: 'subjectTeamId',
      label: '操作人团队',
      type: 'text',
      admin: {
        readOnly: true,
        description: '操作时的所属团队 ID（如有）。',
      },
    },
    {
      name: 'subjectCityScope',
      label: '操作人城市范围',
      type: 'json',
      admin: {
        readOnly: true,
        description: '操作时的城市范围快照（"all" 或城市 ID 数组）。',
      },
    },
    {
      name: 'requestId',
      label: '请求 ID',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: '请求追踪 ID（x-request-id），用于跨日志关联同一请求内的多次操作。',
      },
    },
    {
      name: 'ip',
      label: '客户端 IP',
      type: 'text',
      admin: {
        readOnly: true,
        description: '客户端 IP（x-forwarded-for 第一跳）。',
      },
    },
    {
      name: 'userAgent',
      label: '客户端 UA',
      type: 'textarea',
      admin: {
        readOnly: true,
        description: '客户端 User-Agent。',
      },
    },
    {
      name: 'method',
      label: 'HTTP 方法',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'HTTP 请求方法（GET / POST / PUT / DELETE）。',
      },
    },
    {
      name: 'path',
      label: '请求路径',
      type: 'text',
      admin: {
        readOnly: true,
        description: '请求 URL 路径（不含 query）。',
      },
    },
    {
      name: 'errorCode',
      label: '错误码',
      type: 'text',
      admin: {
        readOnly: true,
        description: '操作失败时的错误码（result=failed 时有值）。',
      },
    },
    {
      name: 'errorMessage',
      label: '错误信息',
      type: 'textarea',
      admin: {
        readOnly: true,
        description: '操作失败时的错误信息（result=failed 时有值）。',
      },
    },
    {
      name: 'eventId',
      label: '关联事件 ID',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: '关联的领域事件 ID（如已写入 Outbox）。',
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
        description: '操作发生时间（UTC 存储，Asia/Shanghai 显示）。',
      },
    },
    {
      name: 'version',
      label: '版本',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '审计日志版本（append-only，恒为 1）。',
        position: 'sidebar',
      },
    },
  ],
}
