// 只读本地数据库，记录并比较迁移前后的等级数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'

const app = new URL('../../../payload-office-platform/', import.meta.url)
const require = createRequire(new URL('package.json', app))
const pg = require(require.resolve('pg', { paths: [require.resolve('@payloadcms/db-postgres')] }))
const config = parseEnv(fs.readFileSync(new URL('.env.local', app), 'utf8'))
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname))
const client = new pg.Client({ connectionString: config.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN READ ONLY')
  const rows = (await client.query('SELECT id,grade::text,deleted_at FROM buildings ORDER BY id')).rows
  const values = (await client.query("SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid WHERE t.typname='enum_buildings_grade' ORDER BY e.enumsortorder")).rows.map((row) => row.enumlabel)
  const counts = (await client.query('SELECT grade::text,COUNT(*)::int AS count FROM buildings GROUP BY grade ORDER BY grade')).rows
  const applied = new Set((await client.query('SELECT name FROM payload_migrations')).rows.map((row) => row.name))
  const names = [...fs.readFileSync(new URL('src/migrations/index.ts', app), 'utf8').matchAll(/import\s+\*\s+as\s+\w+\s+from\s+'\.\/([^']+)'/g)].map((match) => match[1])
  const pending = names.filter((name) => !applied.has(name))
  const snapshot = { rows, values, counts, pending }
  if (process.argv.includes('--before')) fs.writeFileSync(new URL('./db-before.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n')
  if (process.argv.includes('--after')) {
    const before = JSON.parse(fs.readFileSync(new URL('./db-before.json', import.meta.url), 'utf8'))
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), before.rows, '扩展迁移不能改变存量楼盘等级数据')
    assert.deepEqual(pending, [], '迁移必须全部应用')
    for (const value of ['super-grade-a', 'grade-a', 'grade-b', 'ungraded', 'creative-park', 'serviced-office']) assert.ok(values.includes(value))
    fs.writeFileSync(new URL('./db-after.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n')
  }
  console.log(JSON.stringify({ rowCount: rows.length, values, counts, pending }, null, 2))
  await client.query('ROLLBACK')
} finally { await client.end() }
