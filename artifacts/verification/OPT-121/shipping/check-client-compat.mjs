// 使用冻结旧版源码中的真实解析器验证 HTTP 响应；不写业务数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const root = new URL('../../../../', import.meta.url)
const require = createRequire(new URL('sbh-miniprogram/package.json', root))
const ts = require('typescript')
const baseline = '4067918eb847e5e4a669ebdcc29d70df82e56845'
const origin = process.argv[2] ?? 'http://localhost:3717'
assert.ok(['http://localhost:3717', 'https://shangban.cc'].includes(origin))
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')
const oldSource = path => execFileSync('git', ['show', `${baseline}:sbh-miniprogram/miniprogram/${path}`], { cwd: root, encoding: 'utf8' })
const queryUrl = dataUrl(oldSource('domain/listing-query.ts'))
const load = source => import(dataUrl(source.replaceAll('../domain/listing-query.js', queryUrl)))
const oldParser = await load(oldSource('services/catalog-contracts.ts'))
const currentParser = await load(fs.readFileSync(new URL('sbh-miniprogram/miniprogram/services/catalog-contracts.ts', root), 'utf8'))
const basePath = '/api/mini/v1/buildings?city=shanghai'
const results = []
for (const schema of [null, 'quality-v1', 'unknown-version', null]) {
  const path = basePath + (schema ? `&gradeSchema=${schema}` : '')
  const response = await fetch(origin + path)
  assert.equal(response.status, 200)
  const envelope = await response.json()
  assert.equal(envelope.ok, true)
  const cards = [...envelope.data.items, ...envelope.data.inactiveItems]
  assert.ok(cards.length > 0)
  const grades = [...new Set(cards.map(card => card.grade))]
  if (schema === 'quality-v1') {
    currentParser.parseMiniBuildingsData(envelope.data)
    if (grades.includes('ungraded') || grades.includes('grade-b')) assert.throws(() => oldParser.parseMiniBuildingsData(envelope.data))
  } else {
    oldParser.parseMiniBuildingsData(envelope.data)
    assert.ok(grades.every(grade => grade === null || grade === 'grade-a' || grade === 'super-grade-a'))
  }
  results.push({ path, status: response.status, grades, parser: schema === 'quality-v1' ? 'current' : baseline })
}
const target = origin.startsWith('https:') ? 'client-compat-production.json' : 'client-compat-local.json'
fs.writeFileSync(new URL(target, import.meta.url), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
