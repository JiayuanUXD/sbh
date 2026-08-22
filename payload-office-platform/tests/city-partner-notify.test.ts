import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CityPartnerApplications } from '@/collections/CityPartnerApplications'
import {
  CITY_PARTNER_NOTIFICATION_QUEUE,
  CITY_PARTNER_NOTIFICATION_TASK,
  cityPartnerApplicationNotificationTask,
  cityPartnerNotificationOutboxTask,
  consumeCityPartnerApplicationCreated,
  enqueueCityPartnerApplicationCreated,
  reconcileCityPartnerNotificationOutbox,
  recoverStaleCityPartnerNotificationJobs,
} from '@/domain/city-partner-application/application-notify'
import {
  NOTIFICATION_SOURCE_TYPES,
  NOTIFICATION_TYPES,
} from '@/domain/workflow/notification-types'
import { up as notificationMigrationUp } from '@/migrations/20260813_022000_city_partner_notification_jobs'
import {
  down as outboxMigrationDown,
  up as outboxMigrationUp,
} from '@/migrations/20260813_060037_city_partner_notification_outbox_reconciler'

const { default: payloadConfigPromise } = await import('@/payload.config')

type Identifier = number | string

function applicationDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 321,
    city: { id: 11, name: '杭州', slug: 'hangzhou', type: 'city', status: 'active' },
    applicantName: 'sensitive-name',
    contactPhone: '13800003333',
    organizationName: 'sensitive-company',
    cooperationPlan: 'sensitive-free-text',
    ...overrides,
  }
}

function producerHarness(options: { failQueue?: boolean } = {}) {
  const creates: Array<Record<string, unknown>> = []
  const queues: Array<Record<string, unknown>> = []
  const finds: Array<Record<string, unknown>> = []
  const loggerError = vi.fn()
  const payload = {
    async find(args: Record<string, unknown>) {
      finds.push(args)
      if (args.collection === 'domain-events') return { docs: [] }
      if (args.collection === 'city-partner-applications') return { docs: [applicationDoc()] }
      return { docs: [] }
    },
    async create(args: Record<string, unknown>) {
      creates.push(args)
      return { id: 41 }
    },
    jobs: {
      async queue(args: Record<string, unknown>) {
        queues.push(args)
        if (options.failQueue) throw new Error('sensitive enqueue failure')
        return { id: 51 }
      },
    },
    logger: { error: loggerError },
  }
  return { payload, creates, queues, finds, loggerError }
}

async function runProducer(
  harness: ReturnType<typeof producerHarness>,
  operation: 'create' | 'update' = 'create',
) {
  return enqueueCityPartnerApplicationCreated({
    doc: applicationDoc(),
    operation,
    req: { payload: harness.payload, transactionID: 77 },
  } as never)
}

describe('city partner application notification producer', () => {
  afterEach(() => vi.useRealTimers())

  it('writes a PII-free event on create and queues only after an independent committed read', async () => {
    vi.useFakeTimers()
    const harness = producerHarness()

    await expect(runProducer(harness)).resolves.toEqual(applicationDoc())
    expect(harness.creates).toHaveLength(1)
    expect(harness.queues).toEqual([])
    expect(harness.creates[0]).toMatchObject({
      collection: 'domain-events',
      data: {
        eventId: 'city-partner-application-created:321',
        eventType: 'city-partner-application.created',
        aggregateType: 'city-partner-application',
        aggregateId: '321',
        payload: { applicationId: '321' },
      },
      req: expect.objectContaining({ transactionID: 77 }),
    })

    await vi.runAllTimersAsync()
    expect(harness.finds.some((call) =>
      call.collection === 'city-partner-applications' && call.req === undefined,
    )).toBe(true)
    expect(harness.queues).toEqual([expect.objectContaining({
      task: CITY_PARTNER_NOTIFICATION_TASK,
      queue: CITY_PARTNER_NOTIFICATION_QUEUE,
      input: { eventId: 'city-partner-application-created:321' },
      overrideAccess: true,
    })])
    expect(harness.queues[0]?.req).toBeUndefined()
    expect(JSON.stringify([harness.creates, harness.queues])).not.toMatch(
      /sensitive-name|13800003333|sensitive-company|sensitive-free-text/,
    )
  })

  it('is create-only and a deferred queue failure never rejects the committed create hook', async () => {
    vi.useFakeTimers()
    const updated = producerHarness()
    await runProducer(updated, 'update')
    await vi.runAllTimersAsync()
    expect(updated.creates).toEqual([])
    expect(updated.queues).toEqual([])

    const failed = producerHarness({ failQueue: true })
    await expect(runProducer(failed)).resolves.toEqual(applicationDoc())
    await vi.runAllTimersAsync()
    expect(failed.loggerError).toHaveBeenCalledWith(
      { errorCode: 'city_partner_notification_enqueue_failed' },
      'city_partner_notification_enqueue_failed',
    )
    expect(JSON.stringify(failed.loggerError.mock.calls)).not.toContain('sensitive enqueue failure')
  })
})

describe('city partner notification durable outbox reconciliation', () => {
  function outboxHarness(options: { failQueueOnce?: boolean; existingJob?: boolean } = {}) {
    const queued: Array<Record<string, unknown>> = []
    let queueFailed = false
    let jobExists = options.existingJob ?? false
    const event = {
      id: 41,
      eventId: 'city-partner-application-created:321',
      eventType: 'city-partner-application.created',
      aggregateType: 'city-partner-application',
      aggregateId: '321',
      payload: { applicationId: '321' },
      processedAt: null,
      occurredAt: '2026-08-13T00:00:00.000Z',
    }
    const payload = {
      async find(args: Record<string, unknown>): Promise<{
        docs: Array<Record<string, unknown>>
        page?: number
        totalPages?: number
        hasNextPage?: boolean
        nextPage?: number | null
      }> {
        if (args.collection === 'domain-events') return {
          docs: [event], page: 1, totalPages: 1, hasNextPage: false, nextPage: null,
        }
        if (args.collection === 'city-partner-applications') return { docs: [applicationDoc()] }
        if (args.collection === 'payload-jobs') return {
          docs: jobExists ? [{ id: 77, input: { eventId: event.eventId } }] : [],
        }
        return { docs: [] }
      },
      jobs: {
        async queue(args: Record<string, unknown>) {
          queued.push(args)
          if (options.failQueueOnce && !queueFailed) {
            queueFailed = true
            throw new Error('temporary sensitive queue failure')
          }
          if (jobExists) {
            const error = new Error('duplicate') as Error & { code: string }
            error.code = '23505'
            throw error
          }
          jobExists = true
          return { id: 77 }
        },
      },
      logger: { error: vi.fn() },
    }
    return { payload, queued, event, get jobExists() { return jobExists } }
  }

  it('recovers a committed event after the initial pre-commit read saw no application', async () => {
    vi.useFakeTimers()
    const producer = producerHarness()
    producer.payload.find = async (args: Record<string, unknown>) => {
      producer.finds.push(args)
      return { docs: [] }
    }
    await runProducer(producer)
    await vi.runAllTimersAsync()
    expect(producer.queues).toEqual([])

    const recovered = outboxHarness()
    await expect(reconcileCityPartnerNotificationOutbox(recovered.payload as never))
      .resolves.toEqual({ scanned: 1, queued: 1, failures: 0, quarantined: 0 })
    expect(recovered.queued).toHaveLength(1)
    expect(recovered.event.processedAt).toBeNull()
    vi.useRealTimers()
  })

  it('is idempotent across repeated and concurrent scans', async () => {
    const repeated = outboxHarness()
    await reconcileCityPartnerNotificationOutbox(repeated.payload as never)
    await reconcileCityPartnerNotificationOutbox(repeated.payload as never)
    expect(repeated.queued).toHaveLength(1)

    const concurrent = outboxHarness()
    await Promise.all([
      reconcileCityPartnerNotificationOutbox(concurrent.payload as never),
      reconcileCityPartnerNotificationOutbox(concurrent.payload as never),
    ])
    expect(concurrent.jobExists).toBe(true)
  })

  it('leaves the event unprocessed after a temporary queue failure so the next scan recovers it', async () => {
    const harness = outboxHarness({ failQueueOnce: true })
    await expect(reconcileCityPartnerNotificationOutbox(harness.payload as never))
      .resolves.toEqual({ scanned: 1, queued: 0, failures: 1, quarantined: 0 })
    expect(harness.event.processedAt).toBeNull()
    await expect(reconcileCityPartnerNotificationOutbox(harness.payload as never))
      .resolves.toEqual({ scanned: 1, queued: 1, failures: 0, quarantined: 0 })
  })

  function isolatedBatchHarness(options: { transientEventId?: string } = {}) {
    const events = [
      {
        id: 40,
        eventId: 'city-partner-application-created:320',
        eventType: 'city-partner-application.created',
        aggregateType: 'city-partner-application',
        aggregateId: '320',
        payload: { applicationId: '320' },
        processedAt: null as string | null,
        attemptCount: 0,
        lastError: null as string | null,
        occurredAt: '2026-08-13T00:00:00.000Z',
      },
      {
        id: 41,
        eventId: 'city-partner-application-created:321',
        eventType: 'city-partner-application.created',
        aggregateType: 'city-partner-application',
        aggregateId: '321',
        payload: { applicationId: '321' },
        processedAt: null as string | null,
        attemptCount: 0,
        lastError: null as string | null,
        occurredAt: '2026-08-13T00:00:01.000Z',
      },
    ]
    const applications = new Set(['320', '321'])
    const jobs = new Set<string>()
    const queueCalls: string[] = []
    const updates: Array<Record<string, unknown>> = []
    const finds: Array<Record<string, unknown>> = []
    const loggerError = vi.fn()
    let transientFailed = false
    const payload = {
      async find(args: Record<string, unknown>) {
        finds.push(args)
        if (args.collection === 'domain-events') return {
          docs: events.filter((event) => event.processedAt === null),
          page: 1, totalPages: 1, hasNextPage: false, nextPage: null,
        }
        if (args.collection === 'city-partner-applications') {
          const where = args.where as { id?: { equals?: unknown } }
          const id = String(where.id?.equals ?? '')
          return { docs: applications.has(id) ? [{ requestId: `safe-${id}` }] : [] }
        }
        if (args.collection === 'payload-jobs') {
          const serialized = JSON.stringify(args.where)
          const stableEventId = [...jobs].find((id) => serialized.includes(id))
          return { docs: stableEventId ? [{ id: stableEventId }] : [] }
        }
        return { docs: [] }
      },
      async update(args: Record<string, unknown>) {
        updates.push(args)
        const event = events.find((candidate) => candidate.id === args.id)
        if (!event) throw new Error('missing event update target')
        Object.assign(event, args.data)
        return event
      },
      jobs: {
        async queue(args: Record<string, unknown>) {
          const input = args.input as { eventId: string }
          queueCalls.push(input.eventId)
          if (
            input.eventId === options.transientEventId &&
            !transientFailed
          ) {
            transientFailed = true
            throw new Error('sensitive transient queue detail')
          }
          jobs.add(input.eventId)
          return { id: jobs.size }
        },
      },
      logger: { error: loggerError },
    }
    return { payload, events, applications, jobs, queueCalls, updates, finds, loggerError }
  }

  it('quarantines an orphan and still queues the following valid event without starvation', async () => {
    const harness = isolatedBatchHarness()
    harness.applications.delete('320')

    await expect(reconcileCityPartnerNotificationOutbox(harness.payload as never)).resolves.toEqual({
      scanned: 2, queued: 1, failures: 0, quarantined: 1,
    })
    expect(harness.jobs).toEqual(new Set(['city-partner-application-created:321']))
    expect(harness.events[0]).toMatchObject({
      processedAt: expect.any(String),
      attemptCount: 1,
      lastError: 'notification_application_missing_permanent',
    })

    await expect(reconcileCityPartnerNotificationOutbox(harness.payload as never)).resolves.toEqual({
      scanned: 1, queued: 0, failures: 0, quarantined: 0,
    })
    expect(harness.queueCalls).toEqual(['city-partner-application-created:321'])
  })

  it('isolates a transient queue failure, queues later events, and retries only the failed event', async () => {
    const harness = isolatedBatchHarness({
      transientEventId: 'city-partner-application-created:320',
    })

    await expect(reconcileCityPartnerNotificationOutbox(harness.payload as never)).resolves.toEqual({
      scanned: 2, queued: 1, failures: 1, quarantined: 0,
    })
    expect(harness.jobs).toEqual(new Set(['city-partner-application-created:321']))
    expect(harness.events[0]).toMatchObject({
      processedAt: null,
      attemptCount: 1,
      lastError: 'notification_job_enqueue_failed',
    })

    await expect(reconcileCityPartnerNotificationOutbox(harness.payload as never)).resolves.toEqual({
      scanned: 2, queued: 1, failures: 0, quarantined: 0,
    })
    expect(harness.jobs).toEqual(new Set([
      'city-partner-application-created:320',
      'city-partner-application-created:321',
    ]))
    expect(harness.queueCalls).toEqual([
      'city-partner-application-created:320',
      'city-partner-application-created:321',
      'city-partner-application-created:320',
    ])
    expect(harness.loggerError).toHaveBeenCalledWith(
      { errorCode: 'city_partner_notification_enqueue_failed' },
      'city_partner_notification_enqueue_failed',
    )
    expect(JSON.stringify(harness.loggerError.mock.calls)).not.toContain('sensitive transient queue detail')
  })

  it('reads up to two applications so an ambiguous identifier is quarantined fail-closed', async () => {
    const harness = isolatedBatchHarness()
    const originalFind = harness.payload.find.bind(harness.payload)
    harness.payload.find = async (args: Record<string, unknown>) => {
      if (args.collection === 'city-partner-applications') {
        harness.finds.push(args)
        const id = String((args.where as { id: { equals: unknown } }).id.equals)
        if (id === '320') return { docs: [{ requestId: 'one' }, { requestId: 'two' }] }
      }
      return originalFind(args)
    }

    await expect(reconcileCityPartnerNotificationOutbox(harness.payload as never)).resolves.toEqual({
      scanned: 2, queued: 1, failures: 0, quarantined: 1,
    })
    expect(harness.finds.find((call) => call.collection === 'city-partner-applications'))
      .toMatchObject({ limit: 2, select: { requestId: true } })
    expect(harness.events[0].lastError).toBe('notification_application_ambiguous_permanent')
  })

  it('uses bounded stable pagination and identifier-only job inputs', async () => {
    const harness = outboxHarness()
    const finds: Array<Record<string, unknown>> = []
    const originalFind = harness.payload.find.bind(harness.payload)
    harness.payload.find = async (args: Record<string, unknown>) => {
      finds.push(args)
      if (args.collection === 'domain-events' && args.page === 1) return {
        docs: Array.from({ length: 50 }, (_, index) => ({
          ...harness.event,
          id: 1000 + index,
          eventId: `city-partner-application-created:${1000 + index}`,
        })),
        page: 1,
        totalPages: 2,
        hasNextPage: true,
        nextPage: 2,
      }
      if (args.collection === 'domain-events' && args.page === 2) return {
        docs: [harness.event],
        page: 2,
        totalPages: 2,
        hasNextPage: false,
        nextPage: null,
      }
      return originalFind(args)
    }
    await reconcileCityPartnerNotificationOutbox(harness.payload as never)
    expect(finds[0]).toMatchObject({
      collection: 'domain-events',
      where: { and: [
        { eventType: { equals: 'city-partner-application.created' } },
        { aggregateType: { equals: 'city-partner-application' } },
        { processedAt: { exists: false } },
      ] },
      sort: ['occurredAt', 'id'],
      page: 1,
      limit: 50,
      depth: 0,
    })
    expect(finds.filter((call) => call.collection === 'domain-events').map((call) => call.page))
      .toEqual([1, 2])
    expect(harness.queued).not.toHaveLength(0)
    expect(JSON.stringify(harness.queued)).not.toMatch(
      /sensitive-name|13800003333|sensitive-company|sensitive-free-text/,
    )
  })
})

describe('city partner notification stale processing leases', () => {
  it('atomically releases only stale nonterminal notify and reconcile jobs', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = []
    const payload = {
      db: { pool: { async query(text: string, values?: unknown[]) {
        queries.push({ text, values })
        return { rowCount: 2, rows: [{ id: 91 }, { id: 92 }] }
      } } },
    }
    await expect(recoverStaleCityPartnerNotificationJobs(
      payload as never,
      new Date('2026-08-13T06:30:00.000Z'),
    )).resolves.toEqual({ recovered: 2 })
    expect(queries).toHaveLength(1)
    expect(queries[0]?.text).toMatch(/UPDATE payload_jobs[\s\S]+processing = false[\s\S]+updated_at <= \$2[\s\S]+RETURNING id/)
    expect(queries[0]?.values).toEqual([
      CITY_PARTNER_NOTIFICATION_QUEUE,
      '2026-08-13T06:15:00.000Z',
      'notify-city-partner-application-created',
      'reconcile-city-partner-notification-outbox',
    ])
  })

  it('runs lease recovery from cron preflight even when no reconciler job can start', async () => {
    const payloadConfig = await payloadConfigPromise
    const shouldAutoRun = payloadConfig.jobs?.shouldAutoRun
    expect(shouldAutoRun).toBeTypeOf('function')
    const queries: string[] = []
    const payload = {
      db: { pool: { async query(text: string) {
        queries.push(text)
        return { rowCount: 0, rows: [] }
      } } },
    }
    await expect(shouldAutoRun!(payload as never)).resolves.toBe(true)
    // OPT-041 Task 7：shouldAutoRun 里追加了 recoverStaleSupplyImportJobs 的
    // 陈旧租约恢复查询，与本测试原有的城市合伙人通知恢复查询各算一条。
    expect(queries).toHaveLength(2)
  })

  it('disables city scheduling and recovery writes when job autorun is killed', async () => {
    const previous = process.env.PAYLOAD_DISABLE_JOB_AUTORUN
    process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
    try {
      const payloadConfig = await payloadConfigPromise
      const autoRun = payloadConfig.jobs?.autoRun
      expect(autoRun).toBeTypeOf('function')
      if (typeof autoRun !== 'function') throw new Error('expected functional job autoRun config')

      const schedules = await autoRun({} as never)
      expect(schedules).toEqual(expect.arrayContaining([
        expect.objectContaining({
          queue: CITY_PARTNER_NOTIFICATION_QUEUE,
          disableScheduling: true,
        }),
      ]))
      const queries: string[] = []
      const shouldAutoRun = payloadConfig.jobs?.shouldAutoRun
      expect(shouldAutoRun).toBeTypeOf('function')
      await expect(shouldAutoRun!({
        db: { pool: { async query(text: string) {
          queries.push(text)
          return { rowCount: 0, rows: [] }
        } } },
      } as never)).resolves.toBe(false)
      expect(queries).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.PAYLOAD_DISABLE_JOB_AUTORUN
      else process.env.PAYLOAD_DISABLE_JOB_AUTORUN = previous
    }
  })
})

type ConsumerOptions = {
  cityRecipients?: Identifier[]
  admRecipients?: Identifier[]
  existingRecipients?: Identifier[]
  failRecipientOnce?: Identifier
  processedAt?: string | null
}

function consumerHarness(options: ConsumerOptions = {}) {
  const creates: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const finds: Array<Record<string, unknown>> = []
  const notificationRecipients = new Set((options.existingRecipients ?? []).map(String))
  let failed = false
  const payload = {
    async find(args: Record<string, unknown>) {
      finds.push(args)
      if (args.collection === 'domain-events') return {
        docs: [{
          id: 41,
          eventId: 'city-partner-application-created:321',
          eventType: 'city-partner-application.created',
          aggregateType: 'city-partner-application',
          aggregateId: '321',
          payload: { applicationId: '321' },
          attemptCount: updates.at(-1)?.data &&
            typeof (updates.at(-1)!.data as Record<string, unknown>).attemptCount === 'number'
            ? (updates.at(-1)!.data as Record<string, unknown>).attemptCount
            : 0,
          processedAt: options.processedAt ?? null,
        }],
      }
      if (args.collection === 'roles') return {
        docs: [
          { id: 10, code: 'OPS', status: 'active', operationPermissions: ['city_partner_application:read'] },
          { id: 11, code: 'ADM', status: 'active', operationPermissions: ['*'] },
          { id: 12, code: 'MGR', status: 'inactive', operationPermissions: ['city_partner_application:read'] },
        ],
      }
      if (args.collection === 'users') {
        const cityScoped = JSON.stringify(args.where).includes('cityScope')
        const recipients = !cityScoped
          ? options.admRecipients ?? [30]
          : options.cityRecipients ?? [20]
        return { docs: recipients.map((id) => ({ id })) }
      }
      if (args.collection === 'notifications') {
        return {
          docs: [...notificationRecipients].map((recipient) => ({ recipient: Number(recipient) })),
        }
      }
      return { docs: [] }
    },
    async findByID(args: Record<string, unknown>) {
      if (args.collection === 'city-partner-applications') return applicationDoc()
      throw new Error('unexpected findByID')
    },
    async create(args: Record<string, unknown>) {
      creates.push(args)
      if (args.collection === 'notifications') {
        const recipient = (args.data as Record<string, unknown>).recipient as Identifier
        if (String(recipient) === String(options.failRecipientOnce) && !failed) {
          failed = true
          throw new Error('sensitive delivery failure')
        }
        notificationRecipients.add(String(recipient))
      }
      return { id: creates.length }
    },
    async update(args: Record<string, unknown>) {
      updates.push(args)
      return { id: args.id }
    },
  }
  return { payload, creates, updates, finds, notificationRecipients }
}

describe('city partner application notification consumer', () => {
  it('notifies only active readable users whose trusted cityScope contains the application city', async () => {
    const harness = consumerHarness({ cityRecipients: [20] })
    await expect(consumeCityPartnerApplicationCreated({
      eventId: 'city-partner-application-created:321',
      payload: harness.payload as never,
    })).resolves.toEqual({ delivered: 1 })

    expect(harness.creates.filter((call) => call.collection === 'notifications'))
      .toEqual([expect.objectContaining({ data: expect.objectContaining({ recipient: 20 }) })])
    const userQuery = harness.finds.find((call) =>
      call.collection === 'users' && JSON.stringify(call.where).includes('cityScope'),
    )
    expect(userQuery).toMatchObject({
      where: { and: [
        { status: { equals: 'active' } },
        { roles: { in: [10, 11] } },
        { cityScope: { in: [11] } },
      ] },
    })
  })

  it('falls back to active ADM only when no city-scoped readable user exists', async () => {
    const harness = consumerHarness({ cityRecipients: [], admRecipients: [30] })
    await consumeCityPartnerApplicationCreated({
      eventId: 'city-partner-application-created:321',
      payload: harness.payload as never,
    })
    expect(harness.creates.filter((call) => call.collection === 'notifications'))
      .toEqual([expect.objectContaining({ data: expect.objectContaining({ recipient: 30 }) })])
    expect(harness.finds.filter((call) => call.collection === 'users')).toHaveLength(2)
  })

  it('finds readable roles beyond the first page before deciding whether ADM fallback is needed', async () => {
    const harness = consumerHarness({ cityRecipients: [20], admRecipients: [30] })
    const originalFind = harness.payload.find.bind(harness.payload)
    harness.payload.find = async (args: Record<string, unknown>) => {
      if (args.collection !== 'roles') return originalFind(args)
      harness.finds.push(args)
      if (args.page === 1) return {
        docs: Array.from({ length: 100 }, (_, index) => ({
          id: 1000 + index,
          code: 'BRK',
          status: 'active',
          operationPermissions: [],
        })),
        page: 1,
        totalPages: 2,
        hasNextPage: true,
        nextPage: 2,
      }
      return {
        docs: [
          { id: 10, code: 'OPS', status: 'active', operationPermissions: ['city_partner_application:read'] },
          { id: 11, code: 'ADM', status: 'active', operationPermissions: ['*'] },
        ],
        page: 2,
        totalPages: 2,
        hasNextPage: false,
        nextPage: null,
      }
    }

    await expect(consumeCityPartnerApplicationCreated({
      eventId: 'city-partner-application-created:321',
      payload: harness.payload as never,
    })).resolves.toEqual({ delivered: 1 })

    expect(harness.finds.filter((call) => call.collection === 'roles').map((call) => call.page))
      .toEqual([1, 2])
    expect(harness.creates.filter((call) => call.collection === 'notifications'))
      .toEqual([expect.objectContaining({ data: expect.objectContaining({ recipient: 20 }) })])
  })

  it('uses event/application/recipient identity, emits city+application only, and skips existing rows', async () => {
    const harness = consumerHarness({ cityRecipients: [20, 21], existingRecipients: [20] })
    await consumeCityPartnerApplicationCreated({
      eventId: 'city-partner-application-created:321',
      payload: harness.payload as never,
    })
    const notificationCreates = harness.creates.filter((call) => call.collection === 'notifications')
    expect(notificationCreates).toHaveLength(1)
    expect(notificationCreates[0]).toMatchObject({
      data: {
        recipient: 21,
        type: 'city-partner-application-created',
        title: expect.stringContaining('杭州'),
        body: expect.stringContaining('321'),
        sourceType: 'city-partner-application',
        sourceId: '321',
        eventId: 'city-partner-application-created:321',
      },
    })
    expect(JSON.stringify(notificationCreates)).not.toMatch(
      /sensitive-name|13800003333|sensitive-company|sensitive-free-text/,
    )
  })

  it('records a retryable fixed error, then creates only the missing recipient on retry', async () => {
    const harness = consumerHarness({ cityRecipients: [20, 21], failRecipientOnce: 21 })
    await expect(consumeCityPartnerApplicationCreated({
      eventId: 'city-partner-application-created:321',
      payload: harness.payload as never,
    })).rejects.toThrow('city_partner_notification_delivery_failed')
    expect(harness.updates.at(-1)).toMatchObject({ data: {
      attemptCount: 1,
      processedAt: null,
      lastError: 'notification_delivery_failed',
    } })

    await expect(consumeCityPartnerApplicationCreated({
      eventId: 'city-partner-application-created:321',
      payload: harness.payload as never,
    })).resolves.toEqual({ delivered: 1 })
    expect(harness.notificationRecipients).toEqual(new Set(['20', '21']))
    expect(harness.updates.at(-1)).toMatchObject({ data: {
      attemptCount: 2,
      processedAt: expect.any(String),
      lastError: null,
    } })
  })
})

describe('city partner notification registration', () => {
  it('registers collection hook, notification enums, retrying task, config, and explicit enum migration', async () => {
    expect(CityPartnerApplications.hooks?.afterChange).toContain(enqueueCityPartnerApplicationCreated)
    expect(NOTIFICATION_TYPES).toContain('city-partner-application-created')
    expect(NOTIFICATION_SOURCE_TYPES).toContain('city-partner-application')
    expect(cityPartnerApplicationNotificationTask).toMatchObject({
      slug: 'notify-city-partner-application-created',
      retries: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
    })
    expect(cityPartnerNotificationOutboxTask).toMatchObject({
      slug: 'reconcile-city-partner-notification-outbox',
      schedule: [{ cron: '*/30 * * * * *', queue: CITY_PARTNER_NOTIFICATION_QUEUE }],
      retries: { attempts: 5 },
    })
    const payloadConfig = await payloadConfigPromise
    expect(payloadConfig.jobs?.tasks).toContain(cityPartnerApplicationNotificationTask)
    expect(payloadConfig.jobs?.tasks).toContain(cityPartnerNotificationOutboxTask)
    const autoRun = payloadConfig.jobs?.autoRun
    expect(autoRun).toBeTypeOf('function')
    if (typeof autoRun !== 'function') throw new Error('expected functional job autoRun config')
    const schedules = await autoRun({} as never)
    expect(schedules).toEqual(expect.arrayContaining([
      expect.objectContaining({ queue: CITY_PARTNER_NOTIFICATION_QUEUE }),
    ]))
    const cityAutoRun = schedules.find((entry) => entry.queue === CITY_PARTNER_NOTIFICATION_QUEUE)
    expect(cityAutoRun).not.toHaveProperty('disableScheduling')

    const statements: unknown[] = []
    await notificationMigrationUp({
      db: { execute: async (statement: unknown) => { statements.push(statement) } },
    } as never)
    const sqlText = statements.map((statement) =>
      new PgDialect().sqlToQuery(statement as Parameters<PgDialect['sqlToQuery']>[0]).sql,
    ).join('\n')
    expect(sqlText).toContain('city-partner-application.created')
    expect(sqlText).toContain('city-partner-application-created')
    expect(sqlText).toContain('notify-city-partner-application-created')
  })

  it('adds only reconciler schema and active-event job uniqueness without undoing Task 3 enums', async () => {
    const statements: unknown[] = []
    await outboxMigrationUp({
      db: { execute: async (statement: unknown) => { statements.push(statement) } },
    } as never)
    const upSql = statements.map((statement) =>
      new PgDialect().sqlToQuery(statement as Parameters<PgDialect['sqlToQuery']>[0]).sql,
    ).join('\n')
    expect(upSql).toContain("ADD VALUE 'reconcile-city-partner-notification-outbox'")
    expect(upSql).toContain('CREATE TABLE "payload_jobs_stats"')
    expect(upSql).toContain('ALTER TABLE "payload_jobs" ADD COLUMN "meta" jsonb')
    expect(upSql).toContain('CREATE UNIQUE INDEX "payload_jobs_city_partner_notify_event_active_uq"')
    expect(upSql).toContain("(input ->> 'eventId')")
    expect(upSql).toMatch(/completed_at IS NULL\s+AND has_error IS NOT TRUE/)
    expect(upSql).not.toContain("ADD VALUE 'city-partner-application.created'")
    expect(upSql).not.toContain("ADD VALUE 'notify-city-partner-application-created'")

    statements.length = 0
    await outboxMigrationDown({
      db: { execute: async (statement: unknown) => { statements.push(statement) } },
    } as never)
    const downSql = statements.map((statement) =>
      new PgDialect().sqlToQuery(statement as Parameters<PgDialect['sqlToQuery']>[0]).sql,
    ).join('\n')
    expect(downSql.indexOf('DROP INDEX "payload_jobs_city_partner_notify_event_active_uq"'))
      .toBeLessThan(downSql.indexOf('DROP TABLE "payload_jobs_stats"'))
    expect(downSql).toContain("'notify-city-partner-application-created'")
    expect(downSql).not.toContain('ALTER TABLE "domain_events"')
    expect(downSql).not.toContain('ALTER TABLE "notifications"')
  })
})
