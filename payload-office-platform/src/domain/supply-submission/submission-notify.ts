import type { CollectionAfterChangeHook } from 'payload'

const MAX_RECIPIENTS = 50
const QUERY_LIMIT = 100

type SubmissionNotificationDoc = {
  id: string | number
  buildingName?: string | null
  areaSqm?: number | null
  commissionMonths?: string | null
}

function notificationBody(submission: SubmissionNotificationDoc): string {
  const buildingName = submission.buildingName?.trim() || '未填写楼盘名'
  const areaText =
    submission.areaSqm === null || submission.areaSqm === undefined
      ? '面积未填'
      : `${submission.areaSqm}㎡`
  const commissionText =
    submission.commissionMonths && submission.commissionMonths !== 'none'
      ? `，悬赏 ${submission.commissionMonths} 个月佣金`
      : ''

  return `${buildingName}，${areaText}${commissionText}`
}

function logFailureSafely(log: () => void): void {
  try {
    log()
  } catch {
    // 日志系统故障也不能反向阻断公开投放申请落库。
  }
}

function relationId(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (!value || typeof value !== 'object') return null

  const id = (value as { id?: unknown }).id
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

function hasSupplySubmissionReadPermission(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return false
  }

  return value.includes('supply_submission:read') || value.includes('*')
}

/**
 * 新投放申请站内通知。
 *
 * 仅在创建时通知拥有 supply_submission:read（或通配符）权限的启用用户。
 * 通知属于旁路副作用：查询、单个写入乃至日志失败都不能影响申请落库。
 * 写前批量查重避免串行重放，Notifications 复合唯一索引兜底跨进程竞态；唯一冲突
 * 作为单个投递失败由 allSettled 隔离。
 */
export const notifySupplySubmissionCreated: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc

  try {
    const submission = doc as SubmissionNotificationDoc
    const roles = await req.payload.find({
      collection: 'roles',
      where: { status: { equals: 'active' } },
      limit: QUERY_LIMIT,
      depth: 0,
      overrideAccess: true,
    })
    const roleIds = roles.docs
      .filter((role) => hasSupplySubmissionReadPermission(role.operationPermissions))
      .map((role) => role.id)
    if (roleIds.length === 0) return doc

    const users = await req.payload.find({
      collection: 'users',
      where: {
        and: [
          { status: { equals: 'active' } },
          { roles: { in: roleIds } },
        ],
      },
      limit: QUERY_LIMIT,
      depth: 0,
      overrideAccess: true,
    })

    const recipientIds = Array.from(
      new Map(users.docs.map((user) => [String(user.id), user.id])).values(),
    ).slice(0, MAX_RECIPIENTS)
    if (recipientIds.length === 0) return doc

    const sourceId = String(submission.id)
    const eventId = `supply-submission-created:${sourceId}`
    const existingNotifications = await req.payload.find({
      collection: 'notifications',
      where: {
        and: [
          { eventId: { equals: eventId } },
          { type: { equals: 'supply-submission-created' } },
          { recipient: { in: recipientIds } },
        ],
      },
      limit: QUERY_LIMIT,
      depth: 0,
      overrideAccess: true,
    })
    const existingRecipientIds = new Set(
      existingNotifications.docs
        .map((notification) => relationId(notification.recipient))
        .filter((id): id is string | number => id !== null)
        .map(String),
    )
    const missingRecipientIds = recipientIds.filter(
      (recipientId) => !existingRecipientIds.has(String(recipientId)),
    )
    if (missingRecipientIds.length === 0) return doc

    const body = notificationBody(submission)
    const results = await Promise.allSettled(
      missingRecipientIds.map((recipient) =>
        req.payload.create({
          collection: 'notifications',
          data: {
            recipient,
            type: 'supply-submission-created',
            title: '新的房源投放申请',
            body,
            sourceType: 'supply-submission',
            sourceId,
            eventId,
          },
          overrideAccess: true,
        }),
      ),
    )

    if (results.some((result) => result.status === 'rejected')) {
      logFailureSafely(() => {
        req.payload.logger?.error?.('[supply-submission] notification delivery failed')
      })
    }
  } catch {
    logFailureSafely(() => {
      req.payload.logger?.error?.('[supply-submission] notification dispatch failed')
    })
  }

  return doc
}
