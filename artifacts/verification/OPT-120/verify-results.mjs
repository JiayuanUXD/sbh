// 从真实浏览器请求与本地 PostgreSQL 复核结果；--cleanup 只软删除本次两个测试草稿。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const app = new URL('../../../payload-office-platform/', import.meta.url)
const require = createRequire(new URL('package.json', app))
const pg = require(require.resolve('pg', { paths: [require.resolve('@payloadcms/db-postgres')] }))
const config = parseEnv(fs.readFileSync(new URL('.env.local', app), 'utf8'))
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname))
const records = fs.readFileSync(new URL('./browser-requests.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map(JSON.parse)
const saved = records.filter((record) => record.responseStatus >= 200 && record.responseStatus < 300)
assert.equal(saved.length, 3)
const summary = saved.map((record) => {
  const data = JSON.parse(record.requestBody.match(/name="_payload"\r\n\r\n([\s\S]*?)\r\n--/)[1])
  assert.equal(Object.hasOwn(data, 'slug'), false, '表单未提交 slug，应由服务端生成或恢复')
  const { doc } = JSON.parse(record.responseBody)
  assert.equal(doc.status, 'draft')
  return { method: record.method, status: record.responseStatus, id: doc.id, name: doc.name, slug: doc.slug }
})
assert.deepEqual(summary.map((row) => row.status), [201, 200, 201])
assert.deepEqual(summary.map((row) => row.slug), [
  'opt120-yan-zheng-da-sha-b7e41a',
  'opt120-yan-zheng-da-sha-b7e41a',
  'opt120-yan-zheng-da-sha-b7e41a-2',
])
assert.equal(summary[0].id, summary[1].id)
const ids = [summary[0].id, summary[2].id]

const client = new pg.Client({ connectionString: config.DATABASE_URL })
await client.connect()
try {
  const cleanup = process.argv.includes('--cleanup')
  await client.query(cleanup ? 'BEGIN' : 'BEGIN READ ONLY')
  const before = (await client.query(
    'SELECT id,name,slug,status,deleted_at FROM buildings WHERE id=ANY($1::int[]) ORDER BY id', [ids],
  )).rows
  assert.equal(before.length, 2)
  assert.equal(before[0].name, 'OPT120 改名验证大厦 b7e41a')
  assert.equal(before[1].name, 'OPT120 验证大厦 b7e41a')
  assert.deepEqual(before.map((row) => row.slug), [summary[1].slug, summary[2].slug])
  if (cleanup) {
    const result = await client.query(
      `UPDATE buildings SET deleted_at=CURRENT_TIMESTAMP
       WHERE id=ANY($1::int[]) AND name LIKE 'OPT120 %b7e41a' AND status='draft'
       RETURNING id,slug,deleted_at`, [ids],
    )
    assert.equal(result.rowCount, 2)
  }
  const after = (await client.query(
    'SELECT id,name,slug,status,deleted_at FROM buildings WHERE id=ANY($1::int[]) ORDER BY id', [ids],
  )).rows
  await client.query('COMMIT')
  const evidence = { requests: summary, database: after, cleanup: after.every((row) => row.deleted_at !== null) }
  fs.writeFileSync(fileURLToPath(new URL('./results.json', import.meta.url)), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
