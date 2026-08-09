import { describe, expect, it } from 'vitest'

import { Notifications } from '@/collections/Notifications'
import { notifySupplySubmissionCreated } from '@/domain/supply-submission/submission-notify'

type Identifier = string | number

interface FindCall {
  collection: string
  where?: unknown
  limit?: number
  depth?: number
  overrideAccess?: boolean
}

interface CreateCall {
  collection: string
  data: Record<string, unknown>
  overrideAccess?: boolean
}

function submissionDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 321,
    buildingName: '虹桥商务中心',
    areaSqm: 280,
    commissionMonths: '1',
    contactPhone: '13800003333',
    ...overrides,
  }
}

function createHarness(options?: {
  roles?: Array<{ id: Identifier; operationPermissions?: unknown }>
  users?: Array<{ id: Identifier }>
  existingNotifications?: Array<{
    recipient: Identifier | { id: Identifier }
    eventId?: string
    type?: string
  }>
  failFindCollection?: 'roles' | 'users' | 'notifications'
  failCreateRecipient?: Identifier
  synchronizeNotificationFinds?: number
  enforceNotificationUnique?: boolean
}) {
  const findCalls: FindCall[] = []
  const createCalls: CreateCall[] = []
  const errors: unknown[][] = []
  const roles = options?.roles ?? [
    { id: 10, operationPermissions: ['supply_submission:read'] },
  ]
  const users = options?.users ?? [{ id: 20 }]
  const notifications = [...(options?.existingNotifications ?? [])]
  const notificationKeys = new Set(
    notifications.map(
      (notification) =>
        `${notification.eventId}:${String(
          typeof notification.recipient === 'object'
            ? notification.recipient.id
            : notification.recipient,
        )}:${notification.type}`,
    ),
  )
  let notificationFindCount = 0
  let releaseNotificationFinds: (() => void) | undefined
  const notificationFindBarrier = new Promise<void>((resolve) => {
    releaseNotificationFinds = resolve
  })

  const payload = {
    async find(args: FindCall) {
      findCalls.push(args)
      if (options?.failFindCollection === args.collection) {
        throw new Error('13800003333 must never reach logs')
      }
      if (args.collection === 'roles') return { docs: roles }
      if (args.collection === 'users') return { docs: users }
      if (args.collection === 'notifications') {
        const snapshot = [...notifications]
        if (options?.synchronizeNotificationFinds) {
          notificationFindCount += 1
          if (notificationFindCount >= options.synchronizeNotificationFinds) {
            releaseNotificationFinds?.()
          }
          await notificationFindBarrier
        }
        return { docs: snapshot }
      }
      throw new Error(`unexpected collection: ${args.collection}`)
    },
    async create(args: CreateCall) {
      createCalls.push(args)
      if (String(args.data.recipient) === String(options?.failCreateRecipient)) {
        throw new Error('notification create failed')
      }
      const notificationKey = `${args.data.eventId}:${String(args.data.recipient)}:${args.data.type}`
      if (options?.enforceNotificationUnique && notificationKeys.has(notificationKey)) {
        throw new Error('duplicate key value violates unique constraint')
      }
      notificationKeys.add(notificationKey)
      notifications.push({
        recipient: args.data.recipient as Identifier,
        eventId: args.data.eventId as string,
        type: args.data.type as string,
      })
      return { id: createCalls.length, ...args.data }
    },
    logger: {
      error(...args: unknown[]) {
        errors.push(args)
      },
    },
  }

  return { payload, findCalls, createCalls, errors, notifications }
}

async function runHook(
  harness: ReturnType<typeof createHarness>,
  operation: 'create' | 'update' = 'create',
  doc = submissionDoc(),
) {
  return notifySupplySubmissionCreated({
    doc,
    operation,
    req: { payload: harness.payload },
  } as never)
}

describe('notifySupplySubmissionCreated', () => {
  it('declares the database unique key used by notification replay protection', () => {
    expect(Notifications.indexes).toContainEqual({
      fields: ['eventId', 'recipient', 'type'],
      unique: true,
    })
  })

  it('skips updates without querying recipients', async () => {
    const harness = createHarness()
    const doc = submissionDoc()

    await expect(runHook(harness, 'update', doc)).resolves.toBe(doc)

    expect(harness.findCalls).toEqual([])
    expect(harness.createCalls).toEqual([])
  })

  it('silently skips when no enabled role has read permission', async () => {
    const harness = createHarness({ roles: [] })
    const doc = submissionDoc()

    await expect(runHook(harness, 'create', doc)).resolves.toBe(doc)

    expect(harness.findCalls).toHaveLength(1)
    expect(harness.createCalls).toEqual([])
  })

  it('silently skips when matching roles have no enabled users', async () => {
    const harness = createHarness({ users: [] })
    const doc = submissionDoc()

    await expect(runHook(harness, 'create', doc)).resolves.toBe(doc)

    expect(harness.findCalls).toHaveLength(2)
    expect(harness.createCalls).toEqual([])
  })

  it('notifies enabled users of enabled exact-or-wildcard read roles', async () => {
    const harness = createHarness({
      roles: [
        { id: 10, operationPermissions: ['supply_submission:read'] },
        { id: 'adm-role', operationPermissions: ['*'] },
      ],
      users: [{ id: 20 }, { id: 'user-21' }],
    })

    await runHook(harness)

    expect(harness.findCalls).toEqual([
      {
        collection: 'roles',
        where: { status: { equals: 'active' } },
        limit: 100,
        depth: 0,
        overrideAccess: true,
      },
      {
        collection: 'users',
        where: {
          and: [
            { status: { equals: 'active' } },
            { roles: { in: [10, 'adm-role'] } },
          ],
        },
        limit: 100,
        depth: 0,
        overrideAccess: true,
      },
      {
        collection: 'notifications',
        where: {
          and: [
            { eventId: { equals: 'supply-submission-created:321' } },
            { type: { equals: 'supply-submission-created' } },
            { recipient: { in: [20, 'user-21'] } },
          ],
        },
        limit: 100,
        depth: 0,
        overrideAccess: true,
      },
    ])
    expect(harness.createCalls).toEqual([
      {
        collection: 'notifications',
        data: {
          recipient: 20,
          type: 'supply-submission-created',
          title: '新的房源投放申请',
          body: '虹桥商务中心，280㎡，悬赏 1 个月佣金',
          sourceType: 'supply-submission',
          sourceId: '321',
          eventId: 'supply-submission-created:321',
        },
        overrideAccess: true,
      },
      {
        collection: 'notifications',
        data: {
          recipient: 'user-21',
          type: 'supply-submission-created',
          title: '新的房源投放申请',
          body: '虹桥商务中心，280㎡，悬赏 1 个月佣金',
          sourceType: 'supply-submission',
          sourceId: '321',
          eventId: 'supply-submission-created:321',
        },
        overrideAccess: true,
      },
    ])
  })

  it('filters mixed role JSON values using exact string-array permissions only', async () => {
    const harness = createHarness({
      roles: [
        { id: 10, operationPermissions: ['supply_submission:read'] },
        { id: 11, operationPermissions: ['*'] },
        { id: 12, operationPermissions: ['lead:read'] },
        { id: 13, operationPermissions: { permission: 'supply_submission:read' } },
        { id: 14, operationPermissions: 'supply_submission:read' },
        { id: 15, operationPermissions: null },
        { id: 16, operationPermissions: [123, 'supply_submission:read'] },
        { id: 17, operationPermissions: ['not_supply_submission:read'] },
      ],
      users: [{ id: 20 }],
    })

    await runHook(harness)

    expect(harness.findCalls[1]).toEqual({
      collection: 'users',
      where: {
        and: [
          { status: { equals: 'active' } },
          { roles: { in: [10, 11] } },
        ],
      },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
  })

  it('never includes the submitted phone number in notification content or logs', async () => {
    const harness = createHarness()
    const phone = '13800003333'

    await runHook(harness, 'create', submissionDoc({ contactPhone: phone }))

    expect(JSON.stringify(harness.createCalls)).not.toContain(phone)
    expect(JSON.stringify(harness.errors)).not.toContain(phone)
  })

  it('deduplicates recipients and caps one submission fan-out at 50 users', async () => {
    const users = Array.from({ length: 60 }, (_, index) => ({ id: index + 1 }))
    users.splice(25, 0, { id: 5 }, { id: 25 })
    const harness = createHarness({ users })

    await runHook(harness)

    expect(harness.createCalls).toHaveLength(50)
    expect(new Set(harness.createCalls.map((call) => call.data.recipient)).size).toBe(50)
  })

  it('does not create duplicate notifications when the same submission hook is replayed', async () => {
    const harness = createHarness({ users: [{ id: 20 }, { id: 21 }] })
    const doc = submissionDoc()

    await runHook(harness, 'create', doc)
    await runHook(harness, 'create', doc)

    expect(harness.createCalls.map((call) => call.data.recipient)).toEqual([20, 21])
  })

  it('creates only missing recipients when part of the submission fan-out already exists', async () => {
    const harness = createHarness({
      users: [{ id: 20 }, { id: 21 }],
      existingNotifications: [
        {
          recipient: { id: 20 },
          eventId: 'supply-submission-created:321',
          type: 'supply-submission-created',
        },
      ],
    })

    await runHook(harness)

    expect(harness.createCalls.map((call) => call.data.recipient)).toEqual([21])
  })

  it('isolates unique conflicts during concurrent replay without persisting duplicates', async () => {
    const harness = createHarness({
      users: [{ id: 20 }, { id: 21 }],
      synchronizeNotificationFinds: 2,
      enforceNotificationUnique: true,
    })
    const doc = submissionDoc()

    await Promise.all([runHook(harness, 'create', doc), runHook(harness, 'create', doc)])

    expect(harness.notifications).toHaveLength(2)
    expect(
      new Set(
        harness.notifications.map((notification) =>
          typeof notification.recipient === 'object'
            ? notification.recipient.id
            : notification.recipient,
        ),
      ),
    ).toEqual(new Set([20, 21]))
    expect(harness.errors).toHaveLength(1)
  })

  it.each(['roles', 'users', 'notifications'] as const)(
    'returns the created submission when the %s recipient query fails',
    async (collection) => {
      const harness = createHarness({ failFindCollection: collection })
      const doc = submissionDoc()

      await expect(runHook(harness, 'create', doc)).resolves.toBe(doc)

      expect(harness.createCalls).toEqual([])
      expect(harness.errors).toHaveLength(1)
      expect(JSON.stringify(harness.errors)).not.toContain('13800003333')
    },
  )

  it('attempts every recipient and returns the submission when one notification create fails', async () => {
    const harness = createHarness({
      users: [{ id: 20 }, { id: 21 }, { id: 22 }],
      failCreateRecipient: 21,
    })
    const doc = submissionDoc()

    await expect(runHook(harness, 'create', doc)).resolves.toBe(doc)

    expect(harness.createCalls.map((call) => call.data.recipient)).toEqual([20, 21, 22])
    expect(harness.errors).toHaveLength(1)
  })
})
