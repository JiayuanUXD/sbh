import {
  databaseFingerprint,
  isAllowedDatabaseFingerprint,
  validateDatabaseIdentity,
  type DatabaseIdentity,
} from '@/domain/mini-program/acceptance-attestation'
import type { PoolLike } from '@/lib/rate-limit-pg'

export const ACCEPTANCE_DB_PROBE_SQL =
  'SELECT current_database() AS "databaseName", host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort"'

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
