import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'

const io = vi.hoisted(() => ({
  createLocalReq: vi.fn(),
}))

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, createLocalReq: io.createLocalReq }
})

import {
  createPayloadMiniUserAssetStore,
  upsertFavorite,
  type MiniUserAssetCreate,
} from '@/domain/mini-program/user-assets'

type HarnessOptions = Readonly<{
  beginResult?: number | string | null
  commitError?: Error
  swallowedCommitFailure?: boolean
  confirmationError?: Error
  confirmationOverride?: Record<string, unknown>
  createError?: Error
  lockError?: Error
  lockResult?: unknown
  missingSession?: boolean
  rollbackError?: Error
}>

function harness(options: HarnessOptions = {}) {
  let pendingDocument: Record<string, unknown> | null = null
  let committedDocument: Record<string, unknown> | null = null
  const events: string[] = []
  const calls: Array<Readonly<{ operation: string; transactionID: unknown }>> = []
  const statements: unknown[] = []
  const transactionID = options.beginResult === undefined ? 'favorite-tx-1' : options.beginResult
  const execute = vi.fn(async (statement: unknown) => {
    events.push('lock')
    statements.push(statement)
    if (options.lockError) throw options.lockError
    return options.lockResult ?? { rows: [{ locked: true }] }
  })
  const sessions: Record<string, unknown> = {}
  if (transactionID !== null && !options.missingSession) {
    sessions[String(transactionID)] = { db: { execute } }
  }
  const beginTransaction = vi.fn(async () => {
    events.push('begin')
    return transactionID
  })
  const commitTransaction = vi.fn(async () => {
    events.push('commit')
    if (options.commitError) throw options.commitError
    if (!options.swallowedCommitFailure) committedDocument = pendingDocument
  })
  const rollbackTransaction = vi.fn(async () => {
    events.push('rollback')
    if (options.rollbackError) throw options.rollbackError
  })
  const payload = {
    db: { sessions, beginTransaction, commitTransaction, rollbackTransaction },
    find: vi.fn(async ({ req }: { req?: PayloadRequest }) => {
      events.push('find')
      calls.push({ operation: 'find', transactionID: req?.transactionID })
      if (!req?.transactionID) {
        if (options.confirmationError) throw options.confirmationError
        return { docs: committedDocument ? [{ ...committedDocument, ...options.confirmationOverride }] : [] }
      }
      return { docs: pendingDocument ? [pendingDocument] : [] }
    }),
    count: vi.fn(async ({ req }: { req?: PayloadRequest }) => {
      events.push('count')
      calls.push({ operation: 'count', transactionID: req?.transactionID })
      return { totalDocs: 199 }
    }),
    create: vi.fn(async ({ data, req }: { data: MiniUserAssetCreate; req?: PayloadRequest }) => {
      events.push('create')
      calls.push({ operation: 'create', transactionID: req?.transactionID })
      if (options.createError) throw options.createError
      pendingDocument = {
        id: 201,
        ...data,
        lead: null,
        createdAt: '2026-09-07T08:00:00.000Z',
      }
      return pendingDocument
    }),
    delete: vi.fn(),
  } as unknown as Payload
  return {
    payload,
    events,
    calls,
    statements,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
  }
}

function compile(statement: unknown) {
  return new PgDialect().sqlToQuery(statement as Parameters<PgDialect['sqlToQuery']>[0])
}

beforeEach(() => {
  io.createLocalReq.mockReset()
  io.createLocalReq.mockResolvedValue({ context: {} } as PayloadRequest)
})

describe('mini favorite subject transaction', () => {
  it('fails closed when commit fulfills after swallowing failure but the asset is invisible outside the transaction', async () => {
    const fixture = harness({ swallowedCommitFailure: true })

    await expect(upsertFavorite(
      createPayloadMiniUserAssetStore(fixture.payload),
      'subject-a',
      { targetType: 'listing', targetSlug: 'target-a' },
    )).rejects.toThrow('mini_user_asset_transaction_unavailable')

    expect(fixture.commitTransaction).toHaveBeenCalledOnce()
    expect(fixture.rollbackTransaction).not.toHaveBeenCalled()
    expect(fixture.payload.create).toHaveBeenCalledOnce()
  })

  it.each([
    ['read error', { confirmationError: new Error('confirmation-sensitive') }],
    ['wrong key', { confirmationOverride: { assetKey: 'wrong-key' } }],
    ['wrong subject', { confirmationOverride: { subject: 'other-subject' } }],
    ['wrong kind', { confirmationOverride: { kind: 'favorite-building' } }],
    ['wrong target type', { confirmationOverride: { targetType: 'building' } }],
    ['wrong target slug', { confirmationOverride: { targetSlug: 'other-target' } }],
    ['invalid timestamp', { confirmationOverride: { createdAt: 'invalid' } }],
    ['invalid database id', { confirmationOverride: { id: 0 } }],
    ['different persisted row', { confirmationOverride: { id: 202 } }],
    ['different creation time', { confirmationOverride: { createdAt: '2026-09-07T09:00:00.000Z' } }],
    ['unexpected lead', { confirmationOverride: { lead: 1 } }],
  ] as const)('fails closed without replay or rollback on post-commit %s', async (_label, options) => {
    const fixture = harness(options)

    await expect(upsertFavorite(
      createPayloadMiniUserAssetStore(fixture.payload),
      'subject-a',
      { targetType: 'listing', targetSlug: 'target-a' },
    )).rejects.toThrow('mini_user_asset_transaction_unavailable')

    expect(fixture.commitTransaction).toHaveBeenCalledOnce()
    expect(fixture.rollbackTransaction).not.toHaveBeenCalled()
    expect(fixture.payload.create).toHaveBeenCalledOnce()
  })

  it('locks a domain-separated subject key and binds find, count and create to one transaction', async () => {
    const first = harness()
    const subject = 'subject-never-sent-to-postgres'

    await expect(upsertFavorite(
      createPayloadMiniUserAssetStore(first.payload),
      subject,
      { targetType: 'listing', targetSlug: 'target-a' },
    )).resolves.toMatchObject({ created: true })

    expect(first.events).toEqual(['begin', 'lock', 'find', 'count', 'create', 'commit', 'find'])
    expect(first.calls).toHaveLength(4)
    expect(first.calls.slice(0, 3).every((call) => call.transactionID === 'favorite-tx-1')).toBe(true)
    expect(first.calls[3]).toEqual({ operation: 'find', transactionID: undefined })
    expect(first.statements).toHaveLength(1)
    const firstLock = compile(first.statements[0])
    expect(firstLock.sql.toLowerCase()).toContain('pg_advisory_xact_lock')
    expect(firstLock.params).toHaveLength(2)
    expect(firstLock.params.every((key) => Number.isInteger(key))).toBe(true)
    expect(JSON.stringify(firstLock)).not.toContain(subject)

    const same = harness()
    const other = harness()
    await upsertFavorite(
      createPayloadMiniUserAssetStore(same.payload),
      subject,
      { targetType: 'listing', targetSlug: 'target-b' },
    )
    await upsertFavorite(
      createPayloadMiniUserAssetStore(other.payload),
      'subject-other',
      { targetType: 'listing', targetSlug: 'target-c' },
    )
    expect(compile(same.statements[0]).params).toEqual(firstLock.params)
    expect(compile(other.statements[0]).params).not.toEqual(firstLock.params)
  })

  it('fails closed after an observable commit failure and does not attempt a replay or rollback', async () => {
    const fixture = harness({ commitError: new Error('commit-sensitive') })

    await expect(upsertFavorite(
      createPayloadMiniUserAssetStore(fixture.payload),
      'subject-a',
      { targetType: 'listing', targetSlug: 'target-a' },
    )).rejects.toThrow('mini_user_asset_transaction_unavailable')

    expect(fixture.events).toEqual(['begin', 'lock', 'find', 'count', 'create', 'commit'])
    expect(fixture.commitTransaction).toHaveBeenCalledOnce()
    expect(fixture.rollbackTransaction).not.toHaveBeenCalled()
  })

  it('rolls back an action failure but reports transaction unavailable if rollback is unknown', async () => {
    const actionError = new Error('create-sensitive')
    const rolledBack = harness({ createError: actionError })

    await expect(upsertFavorite(
      createPayloadMiniUserAssetStore(rolledBack.payload),
      'subject-a',
      { targetType: 'listing', targetSlug: 'target-a' },
    )).rejects.toBe(actionError)
    expect(rolledBack.events).toEqual(['begin', 'lock', 'find', 'count', 'create', 'find', 'rollback'])

    const rollbackUnknown = harness({
      createError: actionError,
      rollbackError: new Error('rollback-sensitive'),
    })
    await expect(upsertFavorite(
      createPayloadMiniUserAssetStore(rollbackUnknown.payload),
      'subject-a',
      { targetType: 'listing', targetSlug: 'target-a' },
    )).rejects.toThrow('mini_user_asset_transaction_unavailable')
    expect(rollbackUnknown.rollbackTransaction).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing transaction', { beginResult: null }],
    ['missing transaction session', { missingSession: true }],
    ['lock execution failure', { lockError: new Error('lock-sensitive') }],
    ['malformed lock result', { lockResult: { rows: [{ locked: 'true' }] } }],
  ] as const)('fails closed before reads and writes on %s', async (_label, options) => {
    const fixture = harness(options)

    await expect(upsertFavorite(
      createPayloadMiniUserAssetStore(fixture.payload),
      'subject-a',
      { targetType: 'listing', targetSlug: 'target-a' },
    )).rejects.toThrow('mini_user_asset_transaction_unavailable')

    expect(fixture.calls).toHaveLength(0)
    expect(fixture.commitTransaction).not.toHaveBeenCalled()
  })
})
