/**
 * 通知权限守卫与 Collection 保护 hook（tasks.md M6.7 / design §3.7 / R6, R7, R8）
 *
 * 职责：
 *   - Notifications Collection 的 beforeChange hook：
 *     - create：初始化 read=false / readAt=null；校验 type / sourceType 合法
 *     - update：禁止修改 type / recipient / eventId / sourceType / sourceId / title / body
 *                禁止将已读回退为未读；标记 read=true 时自动填 readAt
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 通知只能由消费器创建（外部 HTTP create 由 access 收紧）
 *   - 通知字段一旦写入即不可变（除 read / readAt）
 *   - 已读通知不允许回退为未读
 *
 * 权限编码（permission-codes.ts）：
 *   - notification:read   读取通知列表 / 详情（数据范围收窄到 recipient=self）
 *   - notification:manage  标记已读 / 删除通知（管理动作）
 */

import type { CollectionBeforeChangeHook } from 'payload'

import { InvalidOperationError } from '@/domain/shared/errors'
import {
  isNotificationType,
  isNotificationSourceType,
} from './notification-types'

/** 不可变字段（写入后禁止修改） */
const NOTIFICATION_IMMUTABLE_FIELDS = [
  'type',
  'recipient',
  'eventId',
  'sourceType',
  'sourceId',
  'title',
  'body',
] as const

/**
 * beforeChange hook：通知写入前校验与初始化。
 *
 * create：
 *   - 校验 type / sourceType 合法（枚举守卫）
 *   - 初始化 read=false / readAt=null（防客户端篡改）
 *
 * update：
 *   - 禁止修改不可变字段（type / recipient / eventId / sourceType / sourceId / title / body）
 *   - 禁止将 read=true 回退为 read=false
 *   - 标记 read=true 时自动填 readAt（如果客户端未传）
 */
export const protectNotification: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
}) => {
  if (!data) return data

  if (operation === 'create') {
    // —— 枚举校验 ——
    if (data?.type !== undefined && !isNotificationType(data.type)) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_TYPE_INVALID',
        message: `通知类型未注册：${data.type}`,
        details: { type: data.type },
      })
    }
    if (
      data?.sourceType !== undefined &&
      !isNotificationSourceType(data.sourceType)
    ) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_SOURCE_TYPE_INVALID',
        message: `通知来源类型未注册：${data.sourceType}`,
        details: { sourceType: data.sourceType },
      })
    }

    // —— 初始化 read / readAt ——
    data.read = false
    data.readAt = null
    return data
  }

  // —— update 路径 ——
  if (operation === 'update' && originalDoc) {
    // 1. 禁止修改不可变字段
    for (const field of NOTIFICATION_IMMUTABLE_FIELDS) {
      const original = (originalDoc as Record<string, unknown>)[field]
      const next = (data as Record<string, unknown> | undefined)?.[field]
      if (next !== undefined && next !== original) {
        throw new InvalidOperationError({
          domain: 'workflow',
          code: 'NOTIFICATION_IMMUTABLE_FIELD',
          message: `通知字段不可变：${field}（通知写入后不可修改）`,
          details: { field, original, next },
        })
      }
    }

    // 2. 禁止将 read=true 回退为 read=false
    const originalRead = (originalDoc as { read?: boolean }).read
    const nextRead = data?.read
    if (
      originalRead === true &&
      (nextRead === false || nextRead === undefined) &&
      // 仅当客户端显式传 read=false 时才报错（未传 read 字段不算回退）
      nextRead === false
    ) {
      throw new InvalidOperationError({
        domain: 'workflow',
        code: 'NOTIFICATION_READ_ROLLBACK',
        message: '已读通知不允许回退为未读',
        details: { notificationId: originalDoc.id },
      })
    }

    // 3. 标记 read=true 时自动填 readAt（如果客户端未传）
    if (nextRead === true && originalRead !== true) {
      if (!data.readAt) {
        data.readAt = new Date().toISOString()
      }
    }
  }

  return data
}
