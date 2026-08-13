import { describe, expect, it } from 'vitest'

import { Notifications } from '@/collections/Notifications'
import {
  SUPPLY_SUBMISSION_NOTIFICATION_QUEUE,
  SUPPLY_SUBMISSION_NOTIFICATION_TASK,
  consumeSupplySubmissionCreated,
  enqueueSupplySubmissionCreated,
  supplySubmissionNotificationTask,
} from '@/domain/supply-submission/submission-notify'

const { default: payloadConfigPromise } = await import('@/payload.config')

type Identifier = string | number

function submissionDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 321,
    buildingName: '虹桥商务中心',
    address: '敏感地址不得入事件',
    areaSqm: 280,
    commissionMonths: '1',
    contactPhone: '13800003333',
    submitterIpHash: 'sensitive-ip-hash',
    ...overrides,
  }
}

function enqueueHarness(options?: { failEvent?: boolean | 'unique'; failQueue?: boolean }) {
  const creates: Array<Record<string, unknown>> = []
  const queues: Array<Record<string, unknown>> = []
  const payload = {
    async find() {
      return { docs: [] }
    },
    async create(args: Record<string, unknown>) {
      creates.push(args)
      if (options?.failEvent) {
        const error = new Error('outbox unavailable') as Error & { code?: string }
        if (options.failEvent === 'unique') error.code = '23505'
        throw error
      }
      return { id: 1 }
    },
    jobs: {
      async queue(args: Record<string, unknown>) {
        queues.push(args)
        if (options?.failQueue) throw new Error('queue unavailable')
        return { id: 2 }
      },
    },
  }
  return { payload, creates, queues }
}

async function runEnqueue(
  harness: ReturnType<typeof enqueueHarness>,
  operation: 'create' | 'update' = 'create',
) {
  return enqueueSupplySubmissionCreated({
    doc: submissionDoc(),
    operation,
    req: { payload: harness.payload, transactionID: 77 },
  } as never)
}

describe('supply submission outbox producer', () => {
  it('only emits on create and writes stable PII-free event before queuing with the same request', async () => {
    const harness = enqueueHarness()

    await runEnqueue(harness)

    expect(harness.creates).toHaveLength(1)
    expect(harness.queues).toHaveLength(1)
    expect(harness.creates[0]).toMatchObject({
      collection: 'domain-events',
      data: {
        eventId: 'supply-submission-created:321',
        eventType: 'supply-submission.created',
        aggregateType: 'supply-submission',
        aggregateId: '321',
        aggregateVersion: 1,
        payload: { submissionId: '321' },
      },
      overrideAccess: true,
    })
    expect(harness.queues[0]).toMatchObject({
      task: SUPPLY_SUBMISSION_NOTIFICATION_TASK,
      queue: SUPPLY_SUBMISSION_NOTIFICATION_QUEUE,
      input: { eventId: 'supply-submission-created:321' },
      overrideAccess: true,
    })
    expect(harness.creates[0]?.req).toBe(harness.queues[0]?.req)
    const persisted = JSON.stringify([harness.creates, harness.queues])
    expect(persisted).not.toContain('13800003333')
    expect(persisted).not.toContain('敏感地址')
    expect(persisted).not.toContain('sensitive-ip-hash')
  })

  it('does nothing for updates', async () => {
    const harness = enqueueHarness()
    await runEnqueue(harness, 'update')
    expect(harness.creates).toEqual([])
    expect(harness.queues).toEqual([])
  })

  it.each(['failEvent', 'failQueue'] as const)(
    'does not swallow %s persistence failures so the submission transaction can retry',
    async (failure) => {
      const harness = enqueueHarness({ [failure]: true })
      await expect(runEnqueue(harness)).rejects.toThrow()
    },
  )

  it('lets a same-request event 23505 abort the parent transaction instead of swallowing it', async () => {
    const harness = enqueueHarness({ failEvent: 'unique' })
    await expect(runEnqueue(harness)).rejects.toMatchObject({ code: '23505' })
    expect(harness.queues).toEqual([])
  })
})

function consumerHarness(options?: {
  recipients?: Identifier[]
  existingRecipients?: Identifier[]
  failRecipients?: Identifier[]
  uniqueConflictRecipients?: Identifier[]
  confirmUniqueConflicts?: boolean
  rolePages?: Array<Array<{ id: Identifier; operationPermissions: string[] }>>
  rolePaginationLoop?: boolean
  rolePaginationStalePage?: boolean
  rolePaginationSkipPage?: boolean
  rolePaginationMissingMetadata?: boolean
  processedAt?: string | null
}) {
  const creates: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const finds: Array<Record<string, unknown>> = []
  const recipients = options?.recipients ?? [20, 21]
  const existingRecipients = options?.existingRecipients ?? []
  const conflictedRecipients = new Set<Identifier>()
  let inFlightCreates = 0
  let maxInFlightCreates = 0
  let roleFindCount = 0
  const payload = {
    async find(args: { collection: string }) {
      finds.push(args)
      if (args.collection === 'domain-events') {
        return {
          docs: [{
            id: 41,
            eventId: 'supply-submission-created:321',
            eventType: 'supply-submission.created',
            aggregateType: 'supply-submission',
            aggregateId: '321',
            payload: { submissionId: '321' },
            processedAt: options?.processedAt ?? null,
            attemptCount: 0,
          }],
        }
      }
      if (args.collection === 'roles') {
        if (options?.rolePages) {
          roleFindCount += 1
          if (options.rolePaginationStalePage && roleFindCount > 2) {
            throw new Error('test_role_pagination_runaway')
          }
          const page = Number((args as { page?: number }).page ?? 1)
          const totalPages = options.rolePages.length
          if (options.rolePaginationMissingMetadata) {
            return { docs: options.rolePages[page - 1] ?? [] }
          }
          return {
            docs: options.rolePages[page - 1] ?? [],
            page: options.rolePaginationStalePage && page === 2 ? 1 : page,
            totalPages,
            hasNextPage: page < totalPages,
            nextPage: page < totalPages
              ? (
                  options.rolePaginationLoop
                    ? page
                    : options.rolePaginationSkipPage && page === 1
                      ? page + 2
                      : page + 1
                )
              : null,
          }
        }
        return {
          docs: [
            { id: 10, status: 'active', operationPermissions: ['supply_submission:read'] },
            { id: 11, status: 'active', operationPermissions: ['lead:read'] },
          ],
        }
      }
      if (args.collection === 'users') return { docs: recipients.map((id) => ({ id })) }
      if (args.collection === 'notifications') {
        const confirmed = options?.confirmUniqueConflicts === false
          ? []
          : [...conflictedRecipients]
        return {
          docs: [...new Set([...existingRecipients, ...confirmed])]
            .map((recipient) => ({ recipient })),
        }
      }
      throw new Error(`unexpected find ${args.collection}`)
    },
    async findByID(args: { collection: string }) {
      if (args.collection === 'supply-submissions') return submissionDoc()
      throw new Error(`unexpected findByID ${args.collection}`)
    },
    async create(args: Record<string, unknown>) {
      creates.push(args)
      const data = args.data as { recipient: Identifier }
      inFlightCreates += 1
      maxInFlightCreates = Math.max(maxInFlightCreates, inFlightCreates)
      try {
        await Promise.resolve()
        if (options?.uniqueConflictRecipients?.includes(data.recipient)) {
          conflictedRecipients.add(data.recipient)
          const error = new Error('duplicate key') as Error & { code: string }
          error.code = '23505'
          throw error
        }
        if (options?.failRecipients?.includes(data.recipient)) {
          throw new Error('sensitive failure content 13800003333')
        }
        return { id: creates.length }
      } finally {
        inFlightCreates -= 1
      }
    },
    async update(args: Record<string, unknown>) {
      updates.push(args)
      return { id: 41 }
    },
  }
  return { payload, creates, updates, finds, maxInFlightCreates: () => maxInFlightCreates }
}

describe('supply submission notification job consumer', () => {
  it('keeps the notification database unique key as the final concurrency guard', () => {
    expect(Notifications.indexes).toContainEqual({
      fields: ['eventId', 'recipient', 'type'],
      unique: true,
    })
  })

  it('registers a retrying dedicated task with event-only input', () => {
    expect(supplySubmissionNotificationTask).toMatchObject({
      slug: SUPPLY_SUBMISSION_NOTIFICATION_TASK,
      retries: { attempts: 5 },
      inputSchema: [{ name: 'eventId', type: 'text', required: true }],
    })
  })

  it('registers the task and dedicated auto-run queue while external job access stays closed', async () => {
    const config = await payloadConfigPromise
    expect(config.jobs?.tasks?.map((task) => task.slug)).toContain(
      SUPPLY_SUBMISSION_NOTIFICATION_TASK,
    )
    const autoRun = config.jobs?.autoRun
    expect(autoRun).toBeTypeOf('function')
    if (typeof autoRun !== 'function') throw new Error('expected functional job autoRun config')
    const schedules = await autoRun({} as never)
    expect(schedules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        // 30 秒：投放申请是低频事件，而每个实例都各自轮询同一个共享生产库。
        cron: '*/30 * * * * *',
        queue: SUPPLY_SUBMISSION_NOTIFICATION_QUEUE,
        disableScheduling: true,
      }),
    ]))
    await expect(
      Promise.resolve(config.jobs?.access?.queue?.({ req: {} as never })),
    ).resolves.toBe(false)
    await expect(
      Promise.resolve(config.jobs?.access?.run?.({ req: {} as never })),
    ).resolves.toBe(false)
    await expect(
      Promise.resolve(
        config.jobs?.access?.run?.({ req: { payloadAPI: 'local' } as never }),
      ),
    ).resolves.toBe(true)
  })

  it('delivers to exact active-role recipients and marks the event processed only after success', async () => {
    const harness = consumerHarness()

    await expect(
      consumeSupplySubmissionCreated({
        eventId: 'supply-submission-created:321',
        payload: harness.payload as never,
      }),
    ).resolves.toEqual({ delivered: 2 })

    expect(harness.creates.map((call) => (call.data as { recipient: Identifier }).recipient)).toEqual([
      20,
      21,
    ])
    expect(JSON.stringify(harness.creates)).not.toContain('13800003333')
    expect(JSON.stringify(harness.creates)).not.toContain('敏感地址')
    expect(harness.updates.at(-1)).toMatchObject({
      collection: 'domain-events',
      id: 41,
      data: { processedAt: expect.any(String), attemptCount: 1, lastError: null },
      overrideAccess: true,
    })
  })

  it('selects the capped recipient set in stable ID order', async () => {
    const harness = consumerHarness()
    await consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: harness.payload as never,
    })

    expect(harness.finds.find((call) => call.collection === 'roles')).toMatchObject({ sort: 'id' })
    expect(harness.finds.find((call) => call.collection === 'users')).toMatchObject({ sort: 'id' })
  })

  it('reads every active-role page before selecting the stable capped users', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      operationPermissions: ['lead:read'],
    }))
    const harness = consumerHarness({
      recipients: [20],
      rolePages: [
        firstPage,
        [{ id: 101, operationPermissions: ['supply_submission:read'] }],
      ],
    })

    await expect(consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: harness.payload as never,
    })).resolves.toEqual({ delivered: 1 })
    expect(harness.finds
      .filter((call) => call.collection === 'roles')
      .map((call) => call.page)).toEqual([1, 2])
  })

  it('fails retryably instead of looping when role pagination does not advance', async () => {
    const harness = consumerHarness({
      rolePages: [
        [{ id: 10, operationPermissions: ['lead:read'] }],
        [{ id: 11, operationPermissions: ['supply_submission:read'] }],
      ],
      rolePaginationLoop: true,
    })

    await expect(consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: harness.payload as never,
    })).rejects.toThrow('supply_submission_notification_delivery_failed')
    expect(harness.finds.filter((call) => call.collection === 'roles')).toHaveLength(1)
  })

  it('rejects a stale response page before it can repeat the same request', async () => {
    const harness = consumerHarness({
      rolePages: [
        [{ id: 10, operationPermissions: ['lead:read'] }],
        [{ id: 11, operationPermissions: ['supply_submission:read'] }],
      ],
      rolePaginationStalePage: true,
    })

    await expect(consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: harness.payload as never,
    })).rejects.toThrow('supply_submission_notification_delivery_failed')
    expect(harness.finds.filter((call) => call.collection === 'roles')).toHaveLength(2)
  })

  it('rejects a full role page when every pagination metadata field is missing', async () => {
    const harness = consumerHarness({
      rolePages: [Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        operationPermissions: ['lead:read'],
      }))],
      rolePaginationMissingMetadata: true,
    })

    await expect(consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: harness.payload as never,
    })).rejects.toThrow('supply_submission_notification_delivery_failed')
  })

  it('rejects nextPage metadata that skips an active-role page', async () => {
    const harness = consumerHarness({
      rolePages: [
        [{ id: 10, operationPermissions: ['lead:read'] }],
        [{ id: 11, operationPermissions: ['supply_submission:read'] }],
        [{ id: 12, operationPermissions: ['supply_submission:read'] }],
      ],
      rolePaginationSkipPage: true,
    })

    await expect(consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: harness.payload as never,
    })).rejects.toThrow('supply_submission_notification_delivery_failed')
    expect(harness.finds
      .filter((call) => call.collection === 'roles')
      .map((call) => call.page)).toEqual([1])
  })

  it('creates recipient notifications sequentially in independent Local API transactions', async () => {
    const harness = consumerHarness()
    const jobRequest = { transactionID: 77 }
    await consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: harness.payload as never,
      req: jobRequest as never,
    })

    expect(harness.maxInFlightCreates()).toBe(1)
    expect(harness.creates.every((call) => call.req === undefined)).toBe(true)
    expect(harness.updates.at(-1)?.req).toBe(jobRequest)
  })

  it('throws after partial failure, leaves the event unprocessed, then fills only missing recipients on retry', async () => {
    const failed = consumerHarness({ failRecipients: [21] })
    await expect(
      consumeSupplySubmissionCreated({
        eventId: 'supply-submission-created:321',
        payload: failed.payload as never,
      }),
    ).rejects.toThrow('supply_submission_notification_delivery_failed')
    expect(failed.updates.at(-1)).toMatchObject({
      data: { processedAt: null, attemptCount: 1, lastError: 'notification_delivery_failed' },
    })
    expect(JSON.stringify(failed.updates)).not.toContain('13800003333')

    const retried = consumerHarness({ existingRecipients: [20] })
    await consumeSupplySubmissionCreated({
      eventId: 'supply-submission-created:321',
      payload: retried.payload as never,
    })
    expect(retried.creates.map((call) => (call.data as { recipient: Identifier }).recipient)).toEqual([
      21,
    ])
  })

  it('treats notification 23505 races and already-processed event replays as success', async () => {
    const concurrent = consumerHarness({ uniqueConflictRecipients: [20, 21] })
    await expect(
      consumeSupplySubmissionCreated({
        eventId: 'supply-submission-created:321',
        payload: concurrent.payload as never,
      }),
    ).resolves.toEqual({ delivered: 0 })
    expect(concurrent.updates.at(-1)).toMatchObject({ data: { processedAt: expect.any(String) } })

    const replay = consumerHarness({ processedAt: '2026-08-10T00:00:00.000Z' })
    await expect(
      consumeSupplySubmissionCreated({
        eventId: 'supply-submission-created:321',
        payload: replay.payload as never,
      }),
    ).resolves.toEqual({ delivered: 0 })
    expect(replay.creates).toEqual([])
    expect(replay.updates).toEqual([])
  })

  it('does not swallow a 23505 unless an independent exact lookup confirms the notification', async () => {
    const unconfirmed = consumerHarness({
      recipients: [20],
      uniqueConflictRecipients: [20],
      confirmUniqueConflicts: false,
    })
    await expect(
      consumeSupplySubmissionCreated({
        eventId: 'supply-submission-created:321',
        payload: unconfirmed.payload as never,
      }),
    ).rejects.toThrow('supply_submission_notification_delivery_failed')
    expect(unconfirmed.updates.at(-1)).toMatchObject({
      data: { processedAt: null, lastError: 'notification_delivery_failed' },
    })
  })
})
