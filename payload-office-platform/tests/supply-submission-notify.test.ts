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

function enqueueHarness(options?: { failEvent?: boolean; failQueue?: boolean }) {
  const creates: Array<Record<string, unknown>> = []
  const queues: Array<Record<string, unknown>> = []
  const payload = {
    async find() {
      return { docs: [] }
    },
    async create(args: Record<string, unknown>) {
      creates.push(args)
      if (options?.failEvent) throw new Error('outbox unavailable')
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
})

function consumerHarness(options?: {
  recipients?: Identifier[]
  existingRecipients?: Identifier[]
  failRecipients?: Identifier[]
  uniqueConflictRecipients?: Identifier[]
  processedAt?: string | null
}) {
  const creates: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const recipients = options?.recipients ?? [20, 21]
  const existingRecipients = options?.existingRecipients ?? []
  const payload = {
    async find(args: { collection: string }) {
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
        return {
          docs: [
            { id: 10, status: 'active', operationPermissions: ['supply_submission:read'] },
            { id: 11, status: 'active', operationPermissions: ['lead:read'] },
          ],
        }
      }
      if (args.collection === 'users') return { docs: recipients.map((id) => ({ id })) }
      if (args.collection === 'notifications') {
        return { docs: existingRecipients.map((recipient) => ({ recipient })) }
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
      if (options?.uniqueConflictRecipients?.includes(data.recipient)) {
        const error = new Error('duplicate key') as Error & { code: string }
        error.code = '23505'
        throw error
      }
      if (options?.failRecipients?.includes(data.recipient)) {
        throw new Error('sensitive failure content 13800003333')
      }
      return { id: creates.length }
    },
    async update(args: Record<string, unknown>) {
      updates.push(args)
      return { id: 41 }
    },
  }
  return { payload, creates, updates }
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
    expect(config.jobs?.autoRun).toEqual([
      expect.objectContaining({
        cron: '*/5 * * * * *',
        queue: SUPPLY_SUBMISSION_NOTIFICATION_QUEUE,
        disableScheduling: true,
      }),
    ])
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
})
