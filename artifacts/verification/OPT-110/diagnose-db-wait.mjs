import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require = createRequire(new URL('../../../payload-office-platform/package.json', import.meta.url))
const pg = createRequire(require.resolve('@payloadcms/db-postgres'))('pg')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
const records = []
await client.connect()
await client.query('SET default_transaction_read_only = on')
try {
  for (let i = 0; i < 12; i++) {
    const activity = (await client.query(`SELECT state, wait_event_type, wait_event,
      EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::int AS query_seconds,
      EXTRACT(EPOCH FROM (clock_timestamp() - xact_start))::int AS transaction_seconds,
      LEFT(query, 700) AS query
      FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND state IN ('active', 'idle in transaction')`)).rows
    const record = { at: new Date().toISOString(), activity }
    records.push(record)
    console.log(JSON.stringify(record))
    if (i < 11) await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  writeFileSync(new URL('./database-wait-profile.json', import.meta.url), JSON.stringify(records, null, 2))
} finally {
  await client.end()
}
