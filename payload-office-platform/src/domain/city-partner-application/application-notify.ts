import { createLocalReq, type CollectionAfterChangeHook, type Payload, type PayloadRequest, type TaskConfig } from 'payload'
import type { DomainEvent } from '@/payload-types'
import { isUniqueViolation } from '@/domain/shared/unique-violation'

export const CITY_PARTNER_NOTIFICATION_TASK = 'notify-city-partner-application-created'
export const CITY_PARTNER_NOTIFICATION_QUEUE = 'city-partner-application-notifications'
export const CITY_PARTNER_NOTIFICATION_RECONCILE_TASK = 'reconcile-city-partner-notification-outbox'

const EVENT_TYPE = 'city-partner-application.created'
const AGGREGATE_TYPE = 'city-partner-application'
const NOTIFICATION_TYPE = 'city-partner-application-created'
const MAX_RECIPIENTS = 50
const QUERY_LIMIT = 100
export const CITY_PARTNER_JOB_LEASE_MS = 15 * 60 * 1_000

type Identifier = number | string
type ApplicationDoc = Readonly<{
  id: Identifier
  city?: unknown
}>
type NotificationTask = {
  input: { eventId: string }
  output: { delivered: number }
}
type ReconcileTask = {
  input: Record<string, never>
  output: { queued: number; scanned: number }
}

/**
 * Releases only expired processing leases. The where clause is part of the
 * update itself, so concurrent reapers are idempotent and a fresh worker whose
 * updatedAt is newer than the cutoff cannot be claimed.
 */
export async function recoverStaleCityPartnerNotificationJobs(
  payload: Payload,
  now = new Date(),
): Promise<{ recovered: number }> {
  const cutoff = new Date(now.getTime() - CITY_PARTNER_JOB_LEASE_MS).toISOString()
  const result = await payload.db.pool.query<{ id: number }>(`
    UPDATE payload_jobs
    SET processing = false, updated_at = NOW()
    WHERE queue = $1
      AND updated_at <= $2
      AND task_slug IN ($3, $4)
      AND processing = true
      AND completed_at IS NULL
      AND has_error IS NOT TRUE
    RETURNING id
  `, [
    CITY_PARTNER_NOTIFICATION_QUEUE,
    cutoff,
    CITY_PARTNER_NOTIFICATION_TASK,
    CITY_PARTNER_NOTIFICATION_RECONCILE_TASK,
  ])
  return { recovered: result.rowCount ?? result.rows.length }
}

function relationId(value: unknown): Identifier | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

function relationName(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('name' in value)) return null
  const name = (value as { name?: unknown }).name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

function hasPermission(value: unknown, code: string): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') &&
    (value.includes(code) || value.includes('*'))
}

/**
 * 入队时撞上 `payload_jobs_city_partner_notify_event_active_uq`
 *（迁移自建的局部表达式唯一索引：task_slug + input->>'eventId'，仅限未完成且无错误的 job）。
 *
 * 判定实现见 `domain/shared/unique-violation.ts`：本项目的 drizzle 适配器会把
 * 23505 转成 `ValidationError`，只查 `cause.code` 的老写法恒为 false。
 * 该索引是自建的，适配器映射不回字段，实测 `path` 恒为 `null`，故只按表名收窄；
 * 调用点随后会 `confirmNotificationJob` 再读一次确认，误判不会被静默吞掉。
 * 不传 `column`：该索引建在表达式 `input ->> 'eventId'` 上，pg 的 detail 里是
 * 驼峰 `eventId` 而非某个物理列名，表名已包含在约束名里，足够收窄。
 */
function isJobEnqueueUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, { tableName: 'payload_jobs' })
}

/**
 * 写通知时撞上 `eventId_recipient_type_idx`（复合唯一索引：event_id + recipient_id + type）。
 *
 * 同上：复合索引映射不回字段，`path` 恒为 `null`，按表名收窄；
 * 调用点随后按 eventId + type + recipient 精确读一次确认。
 */
function isNotificationUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, { tableName: 'notifications', column: 'event_id' })
}

function eventId(applicationId: Identifier): string {
  return `city-partner-application-created:${String(applicationId)}`
}

async function confirmNotificationJob(payload: Payload, stableEventId: string): Promise<boolean> {
  const jobs = await payload.find({
    collection: 'payload-jobs',
    where: { and: [
      { taskSlug: { equals: CITY_PARTNER_NOTIFICATION_TASK } },
      { queue: { equals: CITY_PARTNER_NOTIFICATION_QUEUE } },
      { 'input.eventId': { equals: stableEventId } },
      { completedAt: { exists: false } },
      { hasError: { not_equals: true } },
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return jobs.docs.length === 1
}

async function queueNotificationJob(payload: Payload, stableEventId: string): Promise<boolean> {
  if (await confirmNotificationJob(payload, stableEventId)) return false
  try {
    await payload.jobs.queue({
      task: CITY_PARTNER_NOTIFICATION_TASK,
      queue: CITY_PARTNER_NOTIFICATION_QUEUE,
      input: { eventId: stableEventId },
      overrideAccess: true,
    })
    return true
  } catch (error) {
    if (isJobEnqueueUniqueViolation(error) && await confirmNotificationJob(payload, stableEventId)) return false
    throw error
  }
}

/**
 * Durable outbox recovery. The event remains unprocessed until delivery succeeds;
 * therefore queue and consumer failures are both discoverable on the next scan.
 */
export async function reconcileCityPartnerNotificationOutbox(
  payload: Payload,
): Promise<{ queued: number; scanned: number; failures: number; quarantined: number }> {
  const eventDocs: DomainEvent[] = []
  let page = 1
  while (eventDocs.length < 200) {
    const result = await payload.find({
      collection: 'domain-events',
      where: { and: [
        { eventType: { equals: EVENT_TYPE } },
        { aggregateType: { equals: AGGREGATE_TYPE } },
        { processedAt: { exists: false } },
      ] },
      sort: ['occurredAt', 'id'],
      page,
      limit: 50,
      depth: 0,
      overrideAccess: true,
    })
    eventDocs.push(...result.docs.slice(0, 200 - eventDocs.length))
    if (!result.hasNextPage) break
    if (result.page !== page || result.nextPage !== page + 1) {
      throw new Error('city_partner_notification_reconcile_pagination_invalid')
    }
    page += 1
  }
  let queued = 0
  let failures = 0
  let quarantined = 0
  for (const event of eventDocs) {
    if (event.eventType !== EVENT_TYPE || event.aggregateType !== AGGREGATE_TYPE || event.processedAt) {
      failures += 1
      payload.logger.error(
        { errorCode: 'city_partner_notification_event_invalid' },
        'city_partner_notification_event_invalid',
      )
      continue
    }
    try {
      const application = await payload.find({
        collection: 'city-partner-applications',
        where: { id: { equals: event.aggregateId } },
        select: { requestId: true },
        limit: 2,
        depth: 0,
        overrideAccess: true,
      })
      if (application.docs.length !== 1) {
        const errorCode = application.docs.length === 0
          ? 'notification_application_missing_permanent'
          : 'notification_application_ambiguous_permanent'
        await payload.update({
          collection: 'domain-events',
          id: event.id,
          data: {
            processedAt: new Date().toISOString(),
            attemptCount: (event.attemptCount ?? 0) + 1,
            lastError: errorCode,
          },
          overrideAccess: true,
        })
        quarantined += 1
        payload.logger.error(
          { errorCode: `city_partner_${errorCode}` },
          `city_partner_${errorCode}`,
        )
        continue
      }
      if (await queueNotificationJob(payload, event.eventId)) queued += 1
    } catch {
      failures += 1
      try {
        await payload.update({
          collection: 'domain-events',
          id: event.id,
          data: {
            processedAt: null,
            attemptCount: (event.attemptCount ?? 0) + 1,
            lastError: 'notification_job_enqueue_failed',
          },
          overrideAccess: true,
        })
      } catch {
        // The durable event stays pending even if fixed retry metadata cannot be recorded.
      }
      payload.logger.error(
        { errorCode: 'city_partner_notification_enqueue_failed' },
        'city_partner_notification_enqueue_failed',
      )
    }
  }
  return { scanned: eventDocs.length, queued, failures, quarantined }
}

function scheduleAfterCommit(args: {
  applicationId: Identifier
  eventId: string
  payload: Payload
}): void {
  setTimeout(() => {
    void (async () => {
      try {
        const committed = await args.payload.find({
          collection: 'city-partner-applications',
          where: { id: { equals: args.applicationId } },
          select: { requestId: true },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (committed.docs.length !== 1) return
        await queueNotificationJob(args.payload, args.eventId)
      } catch {
        args.payload.logger.error(
          { errorCode: 'city_partner_notification_enqueue_failed' },
          'city_partner_notification_enqueue_failed',
        )
      }
    })()
  }, 0)
}

export const enqueueCityPartnerApplicationCreated: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc
  const application = doc as ApplicationDoc
  const stableEventId = eventId(application.id)
  const existing = await req.payload.find({
    collection: 'domain-events',
    where: { eventId: { equals: stableEventId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (existing.docs.length === 0) {
    await req.payload.create({
      collection: 'domain-events',
      data: {
        eventId: stableEventId,
        eventType: EVENT_TYPE,
        aggregateType: AGGREGATE_TYPE,
        aggregateId: String(application.id),
        aggregateVersion: 1,
        payload: { applicationId: String(application.id) },
        occurredAt: new Date().toISOString(),
      },
      overrideAccess: true,
      req,
    })
  }
  scheduleAfterCommit({
    applicationId: application.id,
    eventId: stableEventId,
    payload: req.payload,
  })
  return doc
}

async function updateAttempt(args: {
  payload: Payload
  req?: PayloadRequest
  eventDatabaseId: Identifier
  attemptCount: number
  processedAt: string | null
  lastError: string | null
}): Promise<void> {
  await args.payload.update({
    collection: 'domain-events',
    id: args.eventDatabaseId,
    data: {
      attemptCount: args.attemptCount,
      processedAt: args.processedAt,
      lastError: args.lastError,
    },
    overrideAccess: true,
    req: args.req,
  })
}

async function recipients(args: {
  payload: Payload
  req?: PayloadRequest
  cityId: Identifier
}): Promise<number[]> {
  const activeRoles: Array<{
    id: Identifier
    code?: string | null
    status?: string | null
    operationPermissions?: unknown
  }> = []
  let page = 1
  while (true) {
    const result = await args.payload.find({
      collection: 'roles',
      where: { status: { equals: 'active' } },
      sort: 'id',
      page,
      limit: QUERY_LIMIT,
      depth: 0,
      overrideAccess: true,
      req: args.req,
    })
    activeRoles.push(...result.docs.map((role) => ({
      id: role.id,
      code: role.code,
      status: role.status,
      operationPermissions: role.operationPermissions,
    })))
    const hasNoMetadata = result.page === undefined && result.totalPages === undefined &&
      result.hasNextPage === undefined && (result.nextPage === null || result.nextPage === undefined)
    if (hasNoMetadata) {
      if (result.docs.length < QUERY_LIMIT) break
      throw new Error('city_partner_notification_role_pagination_invalid')
    }
    if (
      result.page !== page || !Number.isSafeInteger(result.totalPages) ||
      (result.totalPages ?? 0) < page || typeof result.hasNextPage !== 'boolean'
    ) throw new Error('city_partner_notification_role_pagination_invalid')
    const expectsNext = page < (result.totalPages ?? 0)
    if (result.hasNextPage !== expectsNext) {
      throw new Error('city_partner_notification_role_pagination_invalid')
    }
    if (!expectsNext) {
      if (result.nextPage !== null && result.nextPage !== undefined) {
        throw new Error('city_partner_notification_role_pagination_invalid')
      }
      break
    }
    if (result.nextPage !== page + 1) {
      throw new Error('city_partner_notification_role_pagination_invalid')
    }
    page += 1
  }
  const readableRoleIds = activeRoles
    .filter((role) => role.status === 'active' &&
      hasPermission(role.operationPermissions, 'city_partner_application:read'))
    .map((role) => role.id)
  const admRoleIds = activeRoles
    .filter((role) => role.status === 'active' && role.code === 'ADM')
    .map((role) => role.id)

  if (readableRoleIds.length > 0) {
    const cityUsers = await args.payload.find({
      collection: 'users',
      where: { and: [
        { status: { equals: 'active' } },
        { roles: { in: readableRoleIds } },
        { cityScope: { in: [args.cityId] } },
      ] },
      sort: 'id',
      limit: MAX_RECIPIENTS,
      depth: 0,
      overrideAccess: true,
      req: args.req,
    })
    if (cityUsers.docs.length > 0) return cityUsers.docs.map((user) => user.id)
  }
  if (admRoleIds.length === 0) return []
  const fallback = await args.payload.find({
    collection: 'users',
    where: { and: [
      { status: { equals: 'active' } },
      { roles: { in: admRoleIds } },
    ] },
    sort: 'id',
    limit: MAX_RECIPIENTS,
    depth: 0,
    overrideAccess: true,
    req: args.req,
  })
  return fallback.docs.map((user) => user.id)
}

export async function consumeCityPartnerApplicationCreated(args: {
  eventId: string
  payload: Payload
  req?: PayloadRequest
}): Promise<{ delivered: number }> {
  const events = await args.payload.find({
    collection: 'domain-events',
    where: { eventId: { equals: args.eventId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req: args.req,
  })
  const event = events.docs[0]
  if (!event || event.eventType !== EVENT_TYPE || event.aggregateType !== AGGREGATE_TYPE) {
    throw new Error('city_partner_notification_event_invalid')
  }
  if (event.processedAt) return { delivered: 0 }
  const attemptCount = (event.attemptCount ?? 0) + 1

  try {
    const application = await args.payload.findByID({
      collection: 'city-partner-applications',
      id: event.aggregateId,
      depth: 1,
      overrideAccess: true,
      req: args.req,
    })
    const cityId = relationId(application.city)
    const cityName = relationName(application.city)
    if (cityId === null || cityName === null) throw new Error('city_identity_invalid')
    const recipientIds = await recipients({
      payload: args.payload,
      req: args.req,
      cityId,
    })
    const existing = recipientIds.length > 0
      ? await args.payload.find({
          collection: 'notifications',
          where: { and: [
            { eventId: { equals: args.eventId } },
            { type: { equals: NOTIFICATION_TYPE } },
            { recipient: { in: recipientIds } },
          ] },
          limit: MAX_RECIPIENTS,
          depth: 0,
          overrideAccess: true,
          req: args.req,
        })
      : { docs: [] }
    const existingRecipients = new Set(existing.docs
      .map((notification) => relationId(notification.recipient))
      .filter((id): id is Identifier => id !== null)
      .map(String))
    let delivered = 0
    for (const recipient of recipientIds) {
      if (existingRecipients.has(String(recipient))) continue
      try {
        await args.payload.create({
          collection: 'notifications',
          data: {
            recipient,
            type: NOTIFICATION_TYPE,
            title: `${cityName}新的城市合伙人申请`,
            body: `申请编号：${String(application.id)}`,
            sourceType: AGGREGATE_TYPE,
            sourceId: String(application.id),
            eventId: args.eventId,
          },
          overrideAccess: true,
        })
        delivered += 1
      } catch (error) {
        if (!isNotificationUniqueViolation(error)) throw error
        const confirmation = await args.payload.find({
          collection: 'notifications',
          where: { and: [
            { eventId: { equals: args.eventId } },
            { type: { equals: NOTIFICATION_TYPE } },
            { recipient: { equals: recipient } },
          ] },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (confirmation.docs.length !== 1) throw error
      }
    }
    await updateAttempt({
      payload: args.payload,
      req: args.req,
      eventDatabaseId: event.id,
      attemptCount,
      processedAt: new Date().toISOString(),
      lastError: null,
    })
    return { delivered }
  } catch {
    await updateAttempt({
      payload: args.payload,
      req: args.req,
      eventDatabaseId: event.id,
      attemptCount,
      processedAt: null,
      lastError: 'notification_delivery_failed',
    })
    throw new Error('city_partner_notification_delivery_failed')
  }
}

export const cityPartnerApplicationNotificationTask: TaskConfig<NotificationTask> = {
  slug: CITY_PARTNER_NOTIFICATION_TASK,
  label: '城市合伙人申请通知',
  inputSchema: [{ name: 'eventId', type: 'text', required: true }],
  outputSchema: [{ name: 'delivered', type: 'number', required: true }],
  retries: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
  },
  handler: async ({ input, req }) => ({
    output: await consumeCityPartnerApplicationCreated({
      eventId: input.eventId,
      payload: req.payload,
      req,
    }),
  }),
}

export const cityPartnerNotificationOutboxTask: TaskConfig<ReconcileTask> = {
  slug: CITY_PARTNER_NOTIFICATION_RECONCILE_TASK,
  label: '城市合伙人通知发件箱恢复',
  inputSchema: [],
  outputSchema: [
    { name: 'scanned', type: 'number', required: true },
    { name: 'queued', type: 'number', required: true },
    { name: 'failures', type: 'number', required: true },
    { name: 'quarantined', type: 'number', required: true },
  ],
  retries: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
  },
  schedule: [{ cron: '*/30 * * * * *', queue: CITY_PARTNER_NOTIFICATION_QUEUE }],
  handler: async ({ req }) => ({
    output: await reconcileCityPartnerNotificationOutbox(req.payload),
  }),
}
