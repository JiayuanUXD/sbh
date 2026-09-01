import { PgDialect } from 'drizzle-orm/pg-core'
import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  createLocalReq: vi.fn(),
}))

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, createLocalReq: io.createLocalReq }
})

import {
  AcceptanceTransactionFenceError,
  runAcceptanceFencedTransaction,
} from '@/domain/mini-program/acceptance-transaction-fence'

const LOCATOR = 'a'.repeat(64)
const OTHER_LOCATOR = 'b'.repeat(64)
const DB_NOW_MS = 1_800_000_000_000

type HarnessOptions = Readonly<{
  beginResult?: number | string | null
  lockResult?: unknown
  clockResult?: unknown
  executeErrorAt?: 1 | 2
  commitError?: Error
  rollbackError?: Error
  missingSession?: boolean
  invalidExecutor?: boolean
}>

function harness(options: HarnessOptions = {}) {
  const events: string[] = []
  const statements: unknown[] = []
  const transactionID = options.beginResult === undefined ? 'tx-acceptance-1' : options.beginResult
  const execute = vi.fn(async (statement: unknown) => {
    const call = execute.mock.calls.length
    statements.push(statement)
    events.push(call === 1 ? 'lock' : 'clock')
    if (options.executeErrorAt === call) throw new Error(`executor-sensitive-${call}`)
    if (call === 1) return options.lockResult ?? { rows: [{ locked: true }] }
    return options.clockResult ?? { rows: [{ nowMs: String(DB_NOW_MS) }] }
  })
  const sessions: Record<string, unknown> = {}
  if (transactionID !== null && !options.missingSession) {
    sessions[String(transactionID)] = options.invalidExecutor
      ? { db: {} }
      : { db: { execute } }
  }
  const beginTransaction = vi.fn(async () => {
    events.push('begin')
    return transactionID
  })
  const commitTransaction = vi.fn(async () => {
    events.push('commit')
    if (options.commitError) throw options.commitError
  })
  const rollbackTransaction = vi.fn(async () => {
    events.push('rollback')
    if (options.rollbackError) throw options.rollbackError
  })
  const payload = {
    db: {
      sessions,
      beginTransaction,
      commitTransaction,
      rollbackTransaction,
    },
  } as unknown as Payload
  return {
    payload,
    events,
    statements,
    execute,
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

describe('acceptance transaction fence', () => {
  it.each([
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    `${'a'.repeat(63)}g`,
    'client-lock-key',
  ])('rejects a non-canonical server locator before opening a transaction: %s', async (locator) => {
    const fixture = harness()

    await expect(runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator,
      verifyLeaseAtDatabaseTime: () => true,
      action: async () => 'unused',
    })).rejects.toBeInstanceOf(AcceptanceTransactionFenceError)

    expect(fixture.beginTransaction).not.toHaveBeenCalled()
  })

  it('domain-separates a canonical locator into stable signed int32 SQL parameters', async () => {
    const first = harness()
    const second = harness()
    const other = harness()
    const run = (payload: Payload, locator: string) => runAcceptanceFencedTransaction({
      payload,
      locator,
      verifyLeaseAtDatabaseTime: () => ({ lease: true }),
      action: async () => 'done',
    })

    await run(first.payload, LOCATOR)
    await run(second.payload, LOCATOR)
    await run(other.payload, OTHER_LOCATOR)

    expect(first.statements).toHaveLength(2)
    const lock = compile(first.statements[0])
    const clock = compile(first.statements[1])
    const sameLock = compile(second.statements[0])
    const otherLock = compile(other.statements[0])
    expect(lock.sql.toLowerCase()).toContain('pg_try_advisory_xact_lock')
    expect(lock.sql.toLowerCase()).not.toContain('clock_timestamp')
    expect(lock.params).toHaveLength(2)
    expect(lock.params).toEqual([1_856_820_764, 1_227_836_102])
    for (const key of lock.params) {
      expect(Number.isInteger(key)).toBe(true)
      expect(key).toBeGreaterThanOrEqual(-2_147_483_648)
      expect(key).toBeLessThanOrEqual(2_147_483_647)
    }
    expect(sameLock.params).toEqual(lock.params)
    expect(otherLock.params).not.toEqual(lock.params)
    expect(clock.sql.toLowerCase()).toContain('clock_timestamp')
    expect(clock.sql.toLowerCase()).not.toContain('pg_try_advisory_xact_lock')
    expect(clock.params).toEqual([])
    expect(JSON.stringify([lock, clock])).not.toContain(LOCATOR)
  })

  it('orders lock, database clock, lease verification, action and commit on one request transaction', async () => {
    const fixture = harness()
    let actionReq: PayloadRequest | null = null

    const result = await runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: (dbNowMs) => {
        fixture.events.push(`verify:${dbNowMs}`)
        return { scope: 'acceptance-write' as const }
      },
      action: async ({ req, lease, dbNowMs, transactionID }) => {
        fixture.events.push('action')
        actionReq = req
        expect(lease).toEqual({ scope: 'acceptance-write' })
        expect(dbNowMs).toBe(DB_NOW_MS)
        expect(transactionID).toBe('tx-acceptance-1')
        expect(req.transactionID).toBe(transactionID)
        return { acceptedExisting: false }
      },
    })

    expect(result).toEqual({ kind: 'committed', value: { acceptedExisting: false } })
    expect(fixture.events).toEqual([
      'begin',
      'lock',
      'clock',
      `verify:${DB_NOW_MS}`,
      'action',
      'commit',
    ])
    expect(io.createLocalReq).toHaveBeenCalledWith({}, fixture.payload)
    expect(actionReq).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(actionReq, 'transactionID')).toBe(false)
    expect(fixture.rollbackTransaction).not.toHaveBeenCalled()
  })

  it('rolls back a busy lock without reading the clock, verifying a lease, or running the action', async () => {
    const fixture = harness({ lockResult: { rows: [{ locked: false }] } })
    const verifyLease = vi.fn()
    const action = vi.fn()

    await expect(runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: verifyLease,
      action,
    })).resolves.toEqual({ kind: 'busy' })

    expect(fixture.events).toEqual(['begin', 'lock', 'rollback'])
    expect(verifyLease).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
    expect(fixture.commitTransaction).not.toHaveBeenCalled()
  })

  it('rolls back a lease rejected at PostgreSQL time and performs zero action', async () => {
    const fixture = harness()
    const action = vi.fn()

    await expect(runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: (dbNowMs) => dbNowMs === DB_NOW_MS ? null : true,
      action,
    })).resolves.toEqual({ kind: 'lease-invalid' })

    expect(fixture.events).toEqual(['begin', 'lock', 'clock', 'rollback'])
    expect(action).not.toHaveBeenCalled()
  })

  it.each([
    ['null transaction', { beginResult: null }],
    ['empty transaction id', { beginResult: '' }],
    ['unsafe transaction id', { beginResult: 0 }],
    ['missing session', { missingSession: true }],
    ['missing executor', { invalidExecutor: true }],
    ['malformed lock envelope', { lockResult: [{ locked: true }] }],
    ['malformed lock value', { lockResult: { rows: [{ locked: 'true' }] } }],
    ['multiple lock rows', { lockResult: { rows: [{ locked: true }, { locked: true }] } }],
    ['malformed clock envelope', { clockResult: [{ nowMs: String(DB_NOW_MS) }] }],
    ['numeric clock value', { clockResult: { rows: [{ nowMs: DB_NOW_MS }] } }],
    ['leading-zero clock value', { clockResult: { rows: [{ nowMs: '01800000000000' }] } }],
    ['unsafe clock value', { clockResult: { rows: [{ nowMs: String(Number.MAX_SAFE_INTEGER + 1) }] } }],
    ['lock execution failure', { executeErrorAt: 1 }],
    ['clock execution failure', { executeErrorAt: 2 }],
  ] as const)('fails closed on transaction infrastructure: %s', async (_label, options) => {
    const fixture = harness(options)
    const verifyLease = vi.fn(() => true)
    const action = vi.fn(async () => 'unused')

    await expect(runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: verifyLease,
      action,
    })).rejects.toMatchObject({
      name: 'AcceptanceTransactionFenceError',
      message: 'acceptance transaction unavailable',
    })

    expect(fixture.commitTransaction).not.toHaveBeenCalled()
    expect(verifyLease).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('rolls back an action failure, rethrows it, and invalidates the callback request', async () => {
    const fixture = harness()
    const sensitive = new Error('domain-sensitive-action')
    let actionReq: PayloadRequest | null = null

    await expect(runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => true,
      action: async ({ req }) => {
        fixture.events.push('action')
        actionReq = req
        throw sensitive
      },
    })).rejects.toBe(sensitive)

    expect(fixture.events).toEqual(['begin', 'lock', 'clock', 'action', 'rollback'])
    expect(Object.prototype.hasOwnProperty.call(actionReq, 'transactionID')).toBe(false)
  })

  it('never returns committed or repeats the action after an observable commit failure', async () => {
    const fixture = harness({ commitError: new Error('commit-sensitive') })
    let actionReq: PayloadRequest | null = null
    const action = vi.fn(async ({ req }: { req: PayloadRequest }) => {
      actionReq = req
      return 'created'
    })

    await expect(runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => true,
      action,
    })).rejects.toBeInstanceOf(AcceptanceTransactionFenceError)

    expect(action).toHaveBeenCalledOnce()
    expect(fixture.events).toEqual(['begin', 'lock', 'clock', 'commit'])
    expect(fixture.rollbackTransaction).not.toHaveBeenCalled()
    expect(Object.prototype.hasOwnProperty.call(actionReq, 'transactionID')).toBe(false)
  })

  it('does not report busy or lease-invalid when their rollback outcome is unknown', async () => {
    const busy = harness({
      lockResult: { rows: [{ locked: false }] },
      rollbackError: new Error('rollback-sensitive'),
    })
    const invalid = harness({ rollbackError: new Error('rollback-sensitive') })

    await expect(runAcceptanceFencedTransaction({
      payload: busy.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => true,
      action: async () => 'unused',
    })).rejects.toBeInstanceOf(AcceptanceTransactionFenceError)
    await expect(runAcceptanceFencedTransaction({
      payload: invalid.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => null,
      action: async () => 'unused',
    })).rejects.toBeInstanceOf(AcceptanceTransactionFenceError)
  })

  it('rolls back and fails closed if request creation or lease verification throws', async () => {
    const requestFailure = harness()
    io.createLocalReq.mockRejectedValueOnce(new Error('request-sensitive'))
    await expect(runAcceptanceFencedTransaction({
      payload: requestFailure.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => true,
      action: async () => 'unused',
    })).rejects.toBeInstanceOf(AcceptanceTransactionFenceError)
    expect(requestFailure.rollbackTransaction).toHaveBeenCalledOnce()

    const verifyFailure = harness()
    await expect(runAcceptanceFencedTransaction({
      payload: verifyFailure.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => { throw new Error('verify-sensitive') },
      action: async () => 'unused',
    })).rejects.toBeInstanceOf(AcceptanceTransactionFenceError)
    expect(verifyFailure.rollbackTransaction).toHaveBeenCalledOnce()
  })
})
