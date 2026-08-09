import type { CollectionAfterChangeHook, Payload, PayloadRequest, TaskConfig } from 'payload'

export const SUPPLY_SUBMISSION_NOTIFICATION_TASK = 'notify-supply-submission-created'
export const SUPPLY_SUBMISSION_NOTIFICATION_QUEUE = 'supply-submission-notifications'

// Product safety cap: prevents a malformed role assignment from fan-out writes.
// Queries are ID-sorted so retries always select the same capped recipient set.
const MAX_RECIPIENTS = 50
const QUERY_LIMIT = 100
const EVENT_TYPE = 'supply-submission.created'
const NOTIFICATION_TYPE = 'supply-submission-created'

type Identifier = string | number

type SubmissionNotificationDoc = {
  id: Identifier
  buildingName?: string | null
  areaSqm?: number | null
  commissionMonths?: string | null
}

type SupplyNotificationTask = {
  input: { eventId: string }
  output: { delivered: number }
}

function relationId(value: unknown): Identifier | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

function hasSupplySubmissionReadPermission(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string') &&
    (value.includes('supply_submission:read') || value.includes('*'))
  )
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

function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error
  for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as Record<string, unknown>
    if (record.code === '23505') return true
    candidate = record.cause
  }
  return false
}

function stableEventId(submissionId: Identifier): string {
  return `supply-submission-created:${String(submissionId)}`
}

async function findAllActiveRoles(
  payload: Payload,
  req: PayloadRequest | undefined,
): Promise<Array<{ id: Identifier; operationPermissions?: unknown }>> {
  const roles: Array<{ id: Identifier; operationPermissions?: unknown }> = []
  let page = 1

  while (true) {
    const result = await payload.find({
      collection: 'roles',
      where: { status: { equals: 'active' } },
      sort: 'id',
      page,
      limit: QUERY_LIMIT,
      depth: 0,
      overrideAccess: true,
      req,
    })
    roles.push(...result.docs.map((role) => ({
      id: role.id,
      operationPermissions: role.operationPermissions,
    })))

    const paginationMetadataMissing =
      result.page === undefined &&
      result.totalPages === undefined &&
      result.hasNextPage === undefined &&
      (result.nextPage === null || result.nextPage === undefined)
    if (paginationMetadataMissing) {
      if (result.docs.length < QUERY_LIMIT) return roles
      throw new Error('supply_notification_role_pagination_invalid')
    }

    const reportedPage = result.page
    const totalPages = result.totalPages
    if (
      typeof reportedPage !== 'number' ||
      !Number.isSafeInteger(reportedPage) ||
      reportedPage !== page ||
      typeof totalPages !== 'number' ||
      !Number.isSafeInteger(totalPages) ||
      totalPages < page ||
      typeof result.hasNextPage !== 'boolean'
    ) {
      throw new Error('supply_notification_role_pagination_invalid')
    }

    const expectsNextPage = page < totalPages
    if (result.hasNextPage !== expectsNextPage) {
      throw new Error('supply_notification_role_pagination_invalid')
    }
    if (!expectsNextPage) {
      if (result.nextPage !== null && result.nextPage !== undefined) {
        throw new Error('supply_notification_role_pagination_invalid')
      }
      return roles
    }

    if (result.nextPage !== page + 1) {
      throw new Error('supply_notification_role_pagination_invalid')
    }
    page += 1
  }
}

/**
 * Supply submission transactional outbox producer.
 *
 * Passing the original request to both Local API calls keeps the submission,
 * domain event, and durable job in one PostgreSQL transaction. Persistence
 * failures are deliberately not swallowed: the public request can safely retry
 * through its idempotency key. The event/job payload contains identifiers only.
 */
export const enqueueSupplySubmissionCreated: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc

  const submission = doc as SubmissionNotificationDoc
  const submissionId = String(submission.id)
  const eventId = stableEventId(submission.id)
  const existing = await req.payload.find({
    collection: 'domain-events',
    where: { eventId: { equals: eventId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })

  if (existing.docs.length === 0) {
    await req.payload.create({
      collection: 'domain-events',
      data: {
        eventId,
        eventType: EVENT_TYPE,
        aggregateType: 'supply-submission',
        aggregateId: submissionId,
        aggregateVersion: 1,
        payload: { submissionId },
        occurredAt: new Date().toISOString(),
      },
      overrideAccess: true,
      req,
    })
  }

  await req.payload.jobs.queue({
    task: SUPPLY_SUBMISSION_NOTIFICATION_TASK,
    queue: SUPPLY_SUBMISSION_NOTIFICATION_QUEUE,
    input: { eventId },
    overrideAccess: true,
    req,
  })

  return doc
}

async function updateAttempt(
  payload: Payload,
  req: PayloadRequest | undefined,
  eventDatabaseId: Identifier,
  data: { attemptCount: number; processedAt: string | null; lastError: string | null },
): Promise<void> {
  await payload.update({
    collection: 'domain-events',
    id: eventDatabaseId,
    data,
    overrideAccess: true,
    req,
  })
}

/** Retryable, idempotent consumer used by the dedicated Payload Jobs task. */
export async function consumeSupplySubmissionCreated(args: {
  eventId: string
  payload: Payload
  req?: PayloadRequest
}): Promise<{ delivered: number }> {
  const { eventId, payload, req } = args
  const events = await payload.find({
    collection: 'domain-events',
    where: { eventId: { equals: eventId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const event = events.docs[0]
  if (!event || event.eventType !== EVENT_TYPE || event.aggregateType !== 'supply-submission') {
    throw new Error('supply_submission_notification_event_invalid')
  }
  if (event.processedAt) return { delivered: 0 }

  const eventDatabaseId = event.id
  const attemptCount = (event.attemptCount ?? 0) + 1
  const submissionId = event.aggregateId

  try {
    const submission = (await payload.findByID({
      collection: 'supply-submissions',
      id: submissionId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as SubmissionNotificationDoc

    const roles = await findAllActiveRoles(payload, req)
    const roleIds = roles
      .filter((role) => hasSupplySubmissionReadPermission(role.operationPermissions))
      .map((role) => role.id)

    const users = roleIds.length
      ? await payload.find({
          collection: 'users',
          where: {
            and: [
              { status: { equals: 'active' } },
              { roles: { in: roleIds } },
            ],
          },
          sort: 'id',
          limit: QUERY_LIMIT,
          depth: 0,
          overrideAccess: true,
          req,
        })
      : { docs: [] }
    const recipients = Array.from(
      new Map(users.docs.map((user) => [String(user.id), user.id])).values(),
    ).slice(0, MAX_RECIPIENTS)

    const existingNotifications = recipients.length
      ? await payload.find({
          collection: 'notifications',
          where: {
            and: [
              { eventId: { equals: eventId } },
              { type: { equals: NOTIFICATION_TYPE } },
              { recipient: { in: recipients } },
            ],
          },
          limit: QUERY_LIMIT,
          depth: 0,
          overrideAccess: true,
          req,
        })
      : { docs: [] }
    const existingRecipientIds = new Set(
      existingNotifications.docs
        .map((notification) => relationId(notification.recipient))
        .filter((id): id is Identifier => id !== null)
        .map(String),
    )
    const missing = recipients.filter((recipient) => !existingRecipientIds.has(String(recipient)))
    const body = notificationBody(submission)
    let delivered = 0
    for (const recipient of missing) {
      try {
        await payload.create({
          collection: 'notifications',
          data: {
            recipient,
            type: NOTIFICATION_TYPE,
            title: '新的房源投放申请',
            body,
            sourceType: 'supply-submission',
            sourceId: String(submission.id),
            eventId,
          },
          overrideAccess: true,
        })
        delivered += 1
      } catch (error) {
        if (!isUniqueViolation(error)) throw new Error('notification_delivery_failed')

        // A 23505 aborts its own Local API transaction. Treat it as a replay
        // only after an independent exact read proves the winning row exists.
        const confirmed = await payload.find({
          collection: 'notifications',
          where: {
            and: [
              { eventId: { equals: eventId } },
              { type: { equals: NOTIFICATION_TYPE } },
              { recipient: { equals: recipient } },
            ],
          },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (confirmed.docs.length === 0) throw new Error('notification_delivery_failed')
      }
    }

    await updateAttempt(payload, req, eventDatabaseId, {
      attemptCount,
      processedAt: new Date().toISOString(),
      lastError: null,
    })
    return { delivered }
  } catch {
    await updateAttempt(payload, req, eventDatabaseId, {
      attemptCount,
      processedAt: null,
      lastError: 'notification_delivery_failed',
    })
    // Fixed, non-PII error text is all Payload Jobs will persist or log.
    throw new Error('supply_submission_notification_delivery_failed')
  }
}

export const supplySubmissionNotificationTask: TaskConfig<SupplyNotificationTask> = {
  slug: SUPPLY_SUBMISSION_NOTIFICATION_TASK,
  label: '投放申请通知',
  inputSchema: [{ name: 'eventId', type: 'text', required: true }],
  outputSchema: [{ name: 'delivered', type: 'number', required: true }],
  retries: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
  },
  handler: async ({ input, req }) => ({
    output: await consumeSupplySubmissionCreated({
      eventId: input.eventId,
      payload: req.payload,
      req,
    }),
  }),
}
