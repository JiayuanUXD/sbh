import { createHash } from 'node:crypto'

import { sql, type SQL } from 'drizzle-orm'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'

const LOCATOR_PATTERN = /^[0-9a-f]{64}$/
const CLOCK_MILLISECONDS_PATTERN = /^(?:0|[1-9][0-9]*)$/
const LOCK_DOMAIN = 'sbh:mini-program:acceptance-lock:v1\0'

type TransactionIdentifier = number | string

type TransactionExecutor = Readonly<{
  execute(statement: SQL): Promise<unknown>
}>

export type AcceptanceFencedTransactionResult<T> =
  | Readonly<{ kind: 'committed'; value: T }>
  | Readonly<{ kind: 'busy' }>
  | Readonly<{ kind: 'lease-invalid' }>

type AcceptanceFencedTransactionArgs<TLease, TValue> = Readonly<{
  payload: Payload
  locator: string
  verifyLeaseAtDatabaseTime(dbNowMs: number): TLease | null
  action(args: Readonly<{
    req: PayloadRequest
    lease: TLease
    dbNowMs: number
    transactionID: TransactionIdentifier
  }>): Promise<TValue>
}>

export class AcceptanceTransactionFenceError extends Error {
  constructor() {
    super('acceptance transaction unavailable')
    this.name = 'AcceptanceTransactionFenceError'
  }
}

function unavailable(): AcceptanceTransactionFenceError {
  return new AcceptanceTransactionFenceError()
}

function transactionIdentifier(value: unknown): TransactionIdentifier | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  return typeof value === 'string' && value.trim() === value && value.length > 0
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function transactionExecutor(payload: Payload, transactionID: TransactionIdentifier): TransactionExecutor | null {
  const session = payload.db.sessions?.[String(transactionID)]
  if (!session || !isRecord(session.db) || typeof session.db.execute !== 'function') return null
  return session.db as TransactionExecutor
}

function oneRow(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.rows) || value.rows.length !== 1) return null
  return isRecord(value.rows[0]) ? value.rows[0] : null
}

function lockedFrom(value: unknown): boolean | null {
  const row = oneRow(value)
  return row && typeof row.locked === 'boolean' ? row.locked : null
}

function databaseNowFrom(value: unknown): number | null {
  const row = oneRow(value)
  const raw = row?.nowMs
  if (typeof raw !== 'string' || !CLOCK_MILLISECONDS_PATTERN.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function advisoryKeys(locator: string): readonly [number, number] {
  if (!LOCATOR_PATTERN.test(locator)) throw unavailable()
  const digest = createHash('sha256').update(LOCK_DOMAIN).update(locator).digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

/**
 * 在 Payload 当前 PostgreSQL transaction session 内取得 acceptance locator 的 xact lock。
 *
 * 这里只保证可观察的 begin/lock/rollback/commit 异常 fail-closed。Payload 3.86 的
 * Drizzle adapter 可能吞掉部分底层 commit 异常，因此调用方仍须用一笔全新的同锁
 * inspect transaction 对账，不能把本函数的 committed 结果单独当作最终落库证明。
 */
export async function runAcceptanceFencedTransaction<TLease, TValue>({
  payload,
  locator,
  verifyLeaseAtDatabaseTime,
  action,
}: AcceptanceFencedTransactionArgs<TLease, TValue>): Promise<AcceptanceFencedTransactionResult<TValue>> {
  const [key1, key2] = advisoryKeys(locator)
  let transactionID: TransactionIdentifier
  try {
    const candidate = await payload.db.beginTransaction()
    const parsed = transactionIdentifier(candidate)
    if (parsed === null) throw unavailable()
    transactionID = parsed
  } catch {
    throw unavailable()
  }

  let transactionReq: PayloadRequest | null = null
  let rollbackAttempted = false
  let commitAttempted = false
  let committed = false
  let actionFailure: unknown

  const rollback = async (): Promise<void> => {
    rollbackAttempted = true
    try {
      await payload.db.rollbackTransaction(transactionID)
    } catch {
      throw unavailable()
    }
  }

  try {
    const executor = transactionExecutor(payload, transactionID)
    if (!executor) throw unavailable()

    let locked: boolean | null
    try {
      locked = lockedFrom(await executor.execute(sql`
        SELECT pg_try_advisory_xact_lock(${key1}, ${key2}) AS "locked"
      `))
    } catch {
      throw unavailable()
    }
    if (locked === null) throw unavailable()
    if (!locked) {
      await rollback()
      return { kind: 'busy' }
    }

    let dbNowMs: number | null
    try {
      dbNowMs = databaseNowFrom(await executor.execute(sql`
        SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS "nowMs"
      `))
    } catch {
      throw unavailable()
    }
    if (dbNowMs === null) throw unavailable()

    let lease: TLease | null
    try {
      lease = verifyLeaseAtDatabaseTime(dbNowMs)
    } catch {
      throw unavailable()
    }
    if (lease === null) {
      await rollback()
      return { kind: 'lease-invalid' }
    }

    try {
      transactionReq = await createLocalReq({}, payload)
    } catch {
      throw unavailable()
    }
    transactionReq.transactionID = transactionID

    let value: TValue
    try {
      value = await action({
        req: transactionReq,
        lease,
        dbNowMs,
        transactionID,
      })
    } catch (error) {
      actionFailure = error
      throw error
    }

    try {
      commitAttempted = true
      await payload.db.commitTransaction(transactionID)
      committed = true
    } catch {
      throw unavailable()
    }
    return { kind: 'committed', value }
  } catch (error) {
    if (!committed && !rollbackAttempted && !commitAttempted) await rollback()
    if (actionFailure !== undefined && error === actionFailure) throw error
    throw unavailable()
  } finally {
    if (transactionReq) delete transactionReq.transactionID
  }
}
