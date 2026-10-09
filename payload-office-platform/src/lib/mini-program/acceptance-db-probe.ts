import {
  databaseFingerprint,
  isAllowedDatabaseFingerprint,
  validateDatabaseIdentity,
  validateDatabaseIdentityWithClock,
  type DatabaseIdentity,
} from '@/domain/mini-program/acceptance-attestation'
import type { PoolLike } from '@/lib/rate-limit-pg'

export const ACCEPTANCE_DB_PROBE_SQL =
  'SELECT current_database() AS "databaseName", host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort"'
export const ACCEPTANCE_DB_IDENTITY_CLOCK_SQL =
  'SELECT current_database() AS "databaseName", host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort", floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text AS "nowMs"'

export async function probeAcceptanceDatabase(
  pool: PoolLike,
  secret: Uint8Array,
  allowlist: readonly string[],
): Promise<{ identity: DatabaseIdentity; fingerprint: string }> {
  const result = await pool.query({ text: ACCEPTANCE_DB_PROBE_SQL, values: [] })
  if (result.rows.length !== 1) throw new Error('probe invalid')
  const identity = validateDatabaseIdentity(result.rows[0])
  if (!identity) throw new Error('probe invalid')
  const fingerprint = databaseFingerprint(identity, secret)
  if (!isAllowedDatabaseFingerprint(fingerprint, allowlist)) throw new Error('fingerprint mismatch')
  return { identity, fingerprint }
}

export async function probeAcceptanceDatabaseWithClock(
  pool: PoolLike,
  secret: Uint8Array,
  allowlist: readonly string[],
): Promise<{ identity: DatabaseIdentity; fingerprint: string; nowMs: number }> {
  const result = await pool.query({ text: ACCEPTANCE_DB_IDENTITY_CLOCK_SQL, values: [] })
  if (result.rows.length !== 1) throw new Error('probe invalid')
  const snapshot = validateDatabaseIdentityWithClock(result.rows[0])
  if (!snapshot) throw new Error('probe invalid')
  const fingerprint = databaseFingerprint(snapshot.identity, secret)
  if (!isAllowedDatabaseFingerprint(fingerprint, allowlist)) throw new Error('fingerprint mismatch')
  return { identity: snapshot.identity, fingerprint, nowMs: snapshot.nowMs }
}
