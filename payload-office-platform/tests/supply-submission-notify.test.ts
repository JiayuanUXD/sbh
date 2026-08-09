import { describe, expect, it } from 'vitest'

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
  roles?: Array<{ id: Identifier }>
  users?: Array<{ id: Identifier }>
  failFindCollection?: 'roles' | 'users'
  failCreateRecipient?: Identifier
}) {
  const findCalls: FindCall[] = []
  const createCalls: CreateCall[] = []
  const errors: unknown[][] = []
  const roles = options?.roles ?? [{ id: 10 }]
  const users = options?.users ?? [{ id: 20 }]

  const payload = {
    async find(args: FindCall) {
      findCalls.push(args)
      if (options?.failFindCollection === args.collection) {
        throw new Error('13800003333 must never reach logs')
      }
      if (args.collection === 'roles') return { docs: roles }
      if (args.collection === 'users') return { docs: users }
      throw new Error(`unexpected collection: ${args.collection}`)
    },
    async create(args: CreateCall) {
      createCalls.push(args)
      if (String(args.data.recipient) === String(options?.failCreateRecipient)) {
        throw new Error('notification create failed')
      }
      return { id: createCalls.length, ...args.data }
    },
    logger: {
      error(...args: unknown[]) {
        errors.push(args)
      },
    },
  }

  return { payload, findCalls, createCalls, errors }
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
      roles: [{ id: 10 }, { id: 'adm-role' }],
      users: [{ id: 20 }, { id: 'user-21' }],
    })

    await runHook(harness)

    expect(harness.findCalls).toEqual([
      {
        collection: 'roles',
        where: {
          and: [
            { status: { equals: 'active' } },
            {
              or: [
                { operationPermissions: { contains: 'supply_submission:read' } },
                { operationPermissions: { contains: '*' } },
              ],
            },
          ],
        },
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

  it.each(['roles', 'users'] as const)(
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
