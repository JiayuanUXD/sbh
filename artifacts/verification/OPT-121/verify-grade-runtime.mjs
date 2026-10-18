// 仅对浏览器创建的 OPT121 本地草稿验证真实 REST / Hook / PostgreSQL 链路。
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
const origin = 'http://localhost:3717'
const id = 1762
const originalName = 'OPT121 楼宇等级验收'
await client.connect()
try {
  const fixture = (await client.query('SELECT id,name,status,deleted_at FROM buildings WHERE id=$1', [id])).rows[0]
  assert.ok(fixture.name.startsWith(originalName))
  assert.equal(fixture.status, 'draft')
  assert.equal(fixture.deleted_at, null)
  const login = await fetch(`${origin}/api/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'e2e-adm@example.com', password: 'Test1234!' }) })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  assert.ok(token)
  const headers = { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' }
  const read = async () => {
    const response = await fetch(`${origin}/api/buildings/${id}?depth=0`, { headers })
    assert.equal(response.status, 200)
    return response.json()
  }
  const rawGrade = async () => (await client.query('SELECT grade::text FROM buildings WHERE id=$1', [id])).rows[0].grade
  const patch = async (data) => {
    const current = await read()
    const response = await fetch(`${origin}/api/buildings/${id}?depth=0`, { method: 'PATCH', headers, body: JSON.stringify({ ...data, version: current.version }) })
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body.errors))
    return body.doc
  }
  const results = []
  for (const grade of ['creative-park', 'serviced-office', null]) {
    await client.query('UPDATE buildings SET grade=$1 WHERE id=$2 AND status=$3', [grade, id, 'draft'])
    assert.equal((await read()).grade, 'ungraded')
    const doc = await patch({ name: `${originalName} ${grade ?? 'null'}` })
    assert.equal(doc.grade, 'ungraded')
    assert.equal(await rawGrade(), grade, '不提交等级的PATCH必须保留原始等级')
    results.push({ input: grade, read: doc.grade, partialUpdateRawGrade: await rawGrade() })
  }
  for (const grade of ['super-grade-a', 'grade-a', 'grade-b', 'ungraded', 'creative-park', 'serviced-office', null]) {
    const expected = ['super-grade-a', 'grade-a', 'grade-b', 'ungraded'].includes(grade) ? grade : 'ungraded'
    const doc = await patch({ grade })
    assert.equal(doc.grade, expected)
    assert.equal(await rawGrade(), expected)
    assert.equal((await read()).grade, expected)
    results.push({ input: grade, saved: expected, refreshed: expected })
  }
  for (const grade of ['garbage', 42, {}, []]) {
    const before = await rawGrade()
    const current = await read()
    const response = await fetch(`${origin}/api/buildings/${id}?depth=0`, { method: 'PATCH', headers, body: JSON.stringify({ grade, version: current.version }) })
    assert.equal(response.status, 400)
    assert.equal(await rawGrade(), before)
    results.push({ invalidInput: grade, status: response.status })
  }
  await patch({ name: originalName, grade: 'ungraded' })
  fs.writeFileSync(new URL('./runtime-results.json', import.meta.url), JSON.stringify({ fixtureId: id, results }, null, 2) + '\n')
  console.log(JSON.stringify({ fixtureId: id, passed: results.length, results }, null, 2))
} finally { await client.end() }
