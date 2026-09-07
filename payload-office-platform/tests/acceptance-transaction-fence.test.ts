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
const DB_IDENTITY = {
  databaseName: 'sbh_staging',
  serverAddress: '10.0.0.4',
  serverPort: 5432,
} as const

type HarnessOptions = Readonly<{
  beginResult?: number | string | null
  lockResult?: unknown
  identityClockResult?: unknown
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
    events.push(call === 1 ? 'lock' : 'identity-clock')
    if (options.executeErrorAt === call) throw new Error(`executor-sensitive-${call}`)
    if (call === 1) return options.lockResult ?? { rows: [{ locked: true }] }
    return options.identityClockResult ?? {
      rows: [{ ...DB_IDENTITY, nowMs: String(DB_NOW_MS) }],
    }
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

type SharedFenceState = { owner: string | null }

function sharedFencePayload(
  transactionID: string,
  dbNowMs: number,
  shared: SharedFenceState,
) {
  let executeCalls = 0
  const execute = vi.fn(async () => {
    executeCalls += 1
    if (executeCalls === 1) {
      if (shared.owner !== null) return { rows: [{ locked: false }] }
      shared.owner = transactionID
      return { rows: [{ locked: true }] }
    }
    return { rows: [{ ...DB_IDENTITY, nowMs: String(dbNowMs) }] }
  })
  const release = () => {
    if (shared.owner === transactionID) shared.owner = null
  }
  const commitTransaction = vi.fn(async () => release())
  const rollbackTransaction = vi.fn(async () => release())
  const payload = {
    db: {
      sessions: { [transactionID]: { db: { execute } } },
      beginTransaction: vi.fn(async () => transactionID),
      commitTransaction,
      rollbackTransaction,
    },
  } as unknown as Payload
  return { payload, execute, commitTransaction, rollbackTransaction }
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
    const identityClock = compile(first.statements[1])
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
    expect(identityClock.sql.toLowerCase()).toContain('clock_timestamp')
    expect(identityClock.sql.toLowerCase()).toContain('current_database')
    expect(identityClock.sql.toLowerCase()).toContain('inet_server_addr')
    expect(identityClock.sql.toLowerCase()).toContain('inet_server_port')
    expect(identityClock.sql.toLowerCase()).not.toContain('pg_try_advisory_xact_lock')
    expect(identityClock.params).toEqual([])
    expect(JSON.stringify([lock, identityClock])).not.toContain(LOCATOR)
  })

  it('orders lock, same-connection database identity+clock, lease verification, action and commit', async () => {
    const fixture = harness()
    let actionReq: PayloadRequest | null = null

    const result = await runAcceptanceFencedTransaction({
      payload: fixture.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: (dbNowMs, databaseIdentity) => {
        fixture.events.push('verify-identity')
        expect(databaseIdentity).toEqual(DB_IDENTITY)
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
      'identity-clock',
      'verify-identity',
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
    expect(fixture.execute).toHaveBeenCalledOnce()
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

    expect(fixture.events).toEqual(['begin', 'lock', 'identity-clock', 'rollback'])
    expect(action).not.toHaveBeenCalled()
  })

  it('writer 持有同 locator xact lock 时 recovery 立即 busy 且零读取/删除', async () => {
    const shared: SharedFenceState = { owner: null }
    const writer = sharedFencePayload('writer-tx', DB_NOW_MS - 1, shared)
    const recovery = sharedFencePayload('recovery-tx', DB_NOW_MS, shared)
    let releaseWriter!: () => void
    let signalWriterStarted!: () => void
    const writerRelease = new Promise<void>((resolve) => { releaseWriter = resolve })
    const writerStarted = new Promise<void>((resolve) => { signalWriterStarted = resolve })
    const writerAction = vi.fn(async () => {
      signalWriterStarted()
      await writerRelease
      return 'writer-finished'
    })
    const recoveryAction = vi.fn(async () => 'must-not-run')

    const writerPromise = runAcceptanceFencedTransaction({
      payload: writer.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => ({ scope: 'write' as const }),
      action: writerAction,
    })
    await writerStarted

    await expect(runAcceptanceFencedTransaction({
      payload: recovery.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: () => ({ scope: 'recovery' as const }),
      action: recoveryAction,
    })).resolves.toEqual({ kind: 'busy' })
    expect(recoveryAction).not.toHaveBeenCalled()
    expect(recovery.execute).toHaveBeenCalledOnce()
    expect(recovery.rollbackTransaction).toHaveBeenCalledOnce()

    releaseWriter()
    await expect(writerPromise).resolves.toEqual({
      kind: 'committed',
      value: 'writer-finished',
    })
    expect(writerAction).toHaveBeenCalledOnce()
  })

  it('recovery 先 commit 释放同 locator lock 后，旧 writer 以 PG expiry 复验失败且零 create', async () => {
    const writerExp = DB_NOW_MS
    const shared: SharedFenceState = { owner: null }
    const recovery = sharedFencePayload('recovery-tx', writerExp, shared)
    const writer = sharedFencePayload('writer-tx', writerExp, shared)
    const recoveryDelete = vi.fn(async () => 'deleted')
    const writerCreate = vi.fn(async () => 'must-not-create')

    await expect(runAcceptanceFencedTransaction({
      payload: recovery.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: (dbNowMs) => dbNowMs >= writerExp
        ? { scope: 'recovery' as const }
        : null,
      action: recoveryDelete,
    })).resolves.toEqual({ kind: 'committed', value: 'deleted' })
    expect(recoveryDelete).toHaveBeenCalledOnce()
    expect(recovery.commitTransaction).toHaveBeenCalledOnce()
    expect(shared.owner).toBeNull()

    await expect(runAcceptanceFencedTransaction({
      payload: writer.payload,
      locator: LOCATOR,
      verifyLeaseAtDatabaseTime: (dbNowMs) => dbNowMs < writerExp
        ? { scope: 'write' as const }
        : null,
      action: writerCreate,
    })).resolves.toEqual({ kind: 'lease-invalid' })
    expect(writer.execute).toHaveBeenCalledTimes(2)
    expect(writerCreate).not.toHaveBeenCalled()
    expect(writer.rollbackTransaction).toHaveBeenCalledOnce()
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
    ['malformed identity+clock envelope', { identityClockResult: [{ ...DB_IDENTITY, nowMs: String(DB_NOW_MS) }] }],
    ['missing database identity', { identityClockResult: { rows: [{ nowMs: String(DB_NOW_MS) }] } }],
    ['invalid database identity', { identityClockResult: { rows: [{ ...DB_IDENTITY, serverAddress: 'not-an-ip', nowMs: String(DB_NOW_MS) }] } }],
    ['numeric clock value', { identityClockResult: { rows: [{ ...DB_IDENTITY, nowMs: DB_NOW_MS }] } }],
    ['leading-zero clock value', { identityClockResult: { rows: [{ ...DB_IDENTITY, nowMs: '01800000000000' }] } }],
    ['unsafe clock value', { identityClockResult: { rows: [{ ...DB_IDENTITY, nowMs: String(Number.MAX_SAFE_INTEGER + 1) }] } }],
    ['lock execution failure', { executeErrorAt: 1 }],
    ['identity+clock execution failure', { executeErrorAt: 2 }],
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

    expect(fixture.events).toEqual(['begin', 'lock', 'identity-clock', 'action', 'rollback'])
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
    expect(fixture.events).toEqual(['begin', 'lock', 'identity-clock', 'commit'])
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
