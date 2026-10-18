// 只软删除本项浏览器创建的草稿；核验迁移前已有九行保持原值。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'
const app = new URL('../../../payload-office-platform/', import.meta.url)
const require = createRequire(new URL('package.json', app))
const pg = require(require.resolve('pg', { paths: [require.resolve('@payloadcms/db-postgres')] }))
const local = parseEnv(fs.readFileSync(new URL('.env.local', app), 'utf8'))
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(local.DATABASE_URL).hostname))
const client = new pg.Client({ connectionString: local.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN')
  const fixture = (await client.query('SELECT id,name,grade::text,status,deleted_at FROM buildings WHERE id=$1 FOR UPDATE', [1762])).rows[0]
  assert.equal(fixture.name, 'OPT121 楼宇等级验收')
  assert.equal(fixture.status, 'draft')
  assert.equal(fixture.grade, 'ungraded')
  assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM listings WHERE building_id=$1', [1762])).rows[0].count, 0)
  if (!fixture.deleted_at) await client.query('UPDATE buildings SET deleted_at=now() WHERE id=$1 AND name=$2 AND status=$3', [1762, fixture.name, 'draft'])
  const before = JSON.parse(fs.readFileSync(new URL('./db-before.json', import.meta.url), 'utf8'))
  const originalRows = (await client.query('SELECT id,grade::text,deleted_at FROM buildings WHERE id=ANY($1::int[]) ORDER BY id', [before.rows.map(row => row.id)])).rows
  assert.deepEqual(JSON.parse(JSON.stringify(originalRows)), before.rows)
  const result = { fixtureId: 1762, softDeleted: true, originalRowsUnchanged: originalRows.length }
  await client.query('COMMIT')
  fs.writeFileSync(new URL('./cleanup.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} catch (error) { await client.query('ROLLBACK'); throw error } finally { await client.end() }
