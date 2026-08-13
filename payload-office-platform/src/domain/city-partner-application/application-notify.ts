import { createLocalReq, type CollectionAfterChangeHook, type Payload, type PayloadRequest, type TaskConfig } from 'payload'

export const CITY_PARTNER_NOTIFICATION_TASK = 'notify-city-partner-application-created'
export const CITY_PARTNER_NOTIFICATION_QUEUE = 'city-partner-application-notifications'

const EVENT_TYPE = 'city-partner-application.created'
const AGGREGATE_TYPE = 'city-partner-application'
const NOTIFICATION_TYPE = 'city-partner-application-created'
const MAX_RECIPIENTS = 50
const QUERY_LIMIT = 100

type Identifier = number | string
type ApplicationDoc = Readonly<{
  id: Identifier
  city?: unknown
}>
type NotificationTask = {
  input: { eventId: string }
  output: { delivered: number }
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

function isUniqueViolation(error: unknown): boolean {
  let candidate = error
  for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as Record<string, unknown>
    if (record.code === '23505') return true
    candidate = record.cause
  }
  return false
}

function eventId(applicationId: Identifier): string {
  return `city-partner-application-created:${String(applicationId)}`
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
        await args.payload.jobs.queue({
          task: CITY_PARTNER_NOTIFICATION_TASK,
          queue: CITY_PARTNER_NOTIFICATION_QUEUE,
          input: { eventId: args.eventId },
          overrideAccess: true,
        })
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
        if (!isUniqueViolation(error)) throw error
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
