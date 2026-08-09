import type { CollectionAfterChangeHook, Payload, PayloadRequest, TaskConfig } from 'payload'

export const SUPPLY_SUBMISSION_NOTIFICATION_TASK = 'notify-supply-submission-created'
export const SUPPLY_SUBMISSION_NOTIFICATION_QUEUE = 'supply-submission-notifications'

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
    try {
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
    } catch (error) {
      // Concurrent replay can observe the same stable event after its initial
      // read. The unique event key makes that replay successful.
      if (!isUniqueViolation(error)) throw error
    }
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

    const roles = await payload.find({
      collection: 'roles',
      where: { status: { equals: 'active' } },
      limit: QUERY_LIMIT,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const roleIds = roles.docs
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
    const outcomes = await Promise.allSettled(
      missing.map((recipient) =>
        payload.create({
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
          req,
        }),
      ),
    )
    const failures = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected' && !isUniqueViolation(outcome.reason),
    )
    if (failures.length > 0) throw new Error('notification_delivery_failed')

    await updateAttempt(payload, req, eventDatabaseId, {
      attemptCount,
      processedAt: new Date().toISOString(),
      lastError: null,
    })
    return { delivered: outcomes.filter((outcome) => outcome.status === 'fulfilled').length }
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
