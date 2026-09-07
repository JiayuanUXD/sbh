#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DIR = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(DIR, '../../..')
export const WEB = path.join(ROOT, 'payload-office-platform')
export const SHA = 'e2d2666eaf8d6d1ec1850c7d0fff8eb8f3d4e09f'
const PROD = 'sbh_dev_mp108_prod', FRESH = 'sbh_dev_mp108_fresh'
const FINAL = '20260907_050043_mp108_mini_user_assets'
const BASE = '20260906_064958_opt_073_featured_district_count'
const EVIDENCE = path.join(DIR, 'local-postgres.json')

export function assertDatabase(value, name) {
  assert([PROD, FRESH].includes(name), '库名超出 Task 5 范围')
  const url = new URL(value)
  assert(url.protocol === 'postgres:' && url.username === 'liujiayuan' && !url.password && url.hostname === '127.0.0.1' && url.port === '5432' && url.pathname === `/${name}` && !url.search && !url.hash, '数据库身份不匹配')
  return value
}
export function assertUpgradeState(state) {
  assert.equal(state.count, 80, '升级前必须恰好80迁移')
  assert.equal(state.last, BASE, '升级前末项错误')
  assert.equal(state.assetTable, null, '资产表已存在，停止升级')
}
export function assertFreshAbsent(names) { assert(!names.includes(FRESH), 'fresh 已存在，禁止复用或删除') }
export function baseEnvironment() {
  const env = {}
  for (const key of ['HOME', 'USER', 'TMPDIR', 'LANG', 'TZ']) if (process.env[key]) env[key] = process.env[key]
  env.PATH = `/Users/liujiayuan/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin:${process.env.PATH}`
  return env
}
export function databaseEnvironment(name, extra = {}) {
  const url = assertDatabase(['postgres:', `//liujiayuan@127.0.0.1:5432/${name}`].join(''), name)
  return { ...baseEnvironment(), ...extra, DATABASE_URL: url, PAYLOAD_SECRET: randomBytes(48).toString('hex') }
}
export function redact(raw, env = {}) {
  let output = String(raw)
  for (const key of ['DATABASE_URL', 'PAYLOAD_SECRET']) if (env[key]) output = output.replaceAll(env[key], `[REDACTED_${key}]`)
  return output.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, '[REDACTED_DATABASE]').replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]').replace(/(lead(?:Id|_id)|openid)\s*[:=]\s*[^\s,}]+/gi, '$1=[REDACTED]').replaceAll(`${ROOT}/`, '').replace(/\u001b\[[0-9;]*m/g, '')
}
export function identity({ root = ROOT, exec = execFileSync } = {}) {
  assert.equal(process.version, 'v22.23.2')
  const git = args => exec('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(git(['rev-parse', 'HEAD']).trim(), SHA)
  const allowed = p => ['artifacts/verification/MP-108/', '.planning/', '.superpowers/'].some(prefix => p.startsWith(prefix))
  for (const args of [['diff', '--cached', '--name-only', '-z', SHA], ['diff', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) assert(git(args).split('\0').filter(Boolean).every(allowed), '索引/工作树/未跟踪候选源码身份改变，禁止继续')
  for (const dir of [root, path.join(root, 'payload-office-platform'), path.join(root, 'sbh-miniprogram')]) assert(!readdirSync(dir).some((p) => /^\.env($|\.)/.test(p) && p !== '.env.example'), '存在未知 env 文件')
  assert.equal(exec('pnpm', ['--version'], { cwd: path.join(root, 'payload-office-platform'), env: baseEnvironment(), encoding: 'utf8' }).trim(), '8.6.1')
}
export function sql(name, statement, write = false) {
  assert(['postgres', PROD, FRESH].includes(name))
  const env = baseEnvironment()
  if (!write) env.PGOPTIONS = '-c default_transaction_read_only=on'
  const r = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5432', '-U', 'liujiayuan', '-d', name, '-Atc', statement], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, `本地SQL失败：${redact(r.stderr).slice(0, 200)}`)
  return r.stdout.trim()
}
function databases() { return sql('postgres', "SELECT datname FROM pg_database WHERE datname IN ('sbh_dev_mp108_prod','sbh_dev_mp108_fresh') ORDER BY datname").split('\n') }
export function migrationState(name) {
  return JSON.parse(sql(name, "SELECT json_build_object('count',(SELECT count(*) FROM payload_migrations),'last',(SELECT name FROM payload_migrations ORDER BY id DESC LIMIT 1),'assetTable',to_regclass('public.mini_user_assets')::text)"))
}
function baselineCounts(name) {
  const old = JSON.parse(readFileSync(path.join(WEB, '.baseline/snapshot.json'), 'utf8'))
  const tables = old.collections.map((x) => x.slug.replaceAll('-', '_')).filter((x) => x !== 'mini_user_assets')
  assert(tables.every((x) => /^[a-z_]+$/.test(x)))
  const rows = sql(name, tables.map((table) => `SELECT '${table}',count(*) FROM "${table}"`).join(' UNION ALL ')).split('\n').map((line) => { const [table, count] = line.split('|'); return { table, count: Number(count) } })
  return { legacySnapshotRecords: old.totals.records, legacyMeaning: '旧脚本每collection最多3条的有界口径，不是全库总记录', tables: rows, boundedSameTables: rows.reduce((sum, row) => sum + Math.min(row.count, 3), 0), trueSameTablesTotal: rows.reduce((sum, row) => sum + row.count, 0) }
}
export function run(command, args, env, entries, cwd = WEB) {
  console.log(`[Task5] ${path.basename(cwd)}: ${command} ${args.join(' ')}`)
  const startedAt = new Date().toISOString()
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60 * 1000 })
  const item = { command: `${command} ${args.join(' ')}`, startedAt, finishedAt: new Date().toISOString(), exitCode: r.status ?? 1, output: redact(`${r.stdout ?? ''}${r.stderr ?? ''}`, env) }
  entries.push(item)
  console.log(`[Task5] exit=${item.exitCode}; ${item.output.trim().split('\n').slice(-3).join(' | ')}`)
  assert.equal(item.exitCode, 0, `命令失败：${item.command}`)
  return item
}
async function pg(mode) {
  identity()
  const all = existsSync(EVIDENCE) ? JSON.parse(readFileSync(EVIDENCE, 'utf8')) : { task: 5, candidateSha: SHA }
  const result = { status: 'FAILED', recordedAt: new Date().toISOString(), commands: [] }
  try {
    if (mode === 'preflight') {
      result.postgresVersion = sql('postgres', 'SELECT version()')
      result.databases = databases(); result.upgradeState = migrationState(PROD)
      assertUpgradeState(result.upgradeState); assertFreshAbsent(result.databases)
      result.baselineBefore = baselineCounts(PROD)
      result.port3717 = spawnSync('lsof', ['-nP', '-iTCP:3717', '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim() || 'free'
      result.devtoolsCliExists = existsSync('/Applications/wechatwebdevtools.app/Contents/MacOS/cli')
      result.node = process.version; result.pnpm = '8.6.1'
    } else if (mode === 'upgrade') {
      assertUpgradeState(migrationState(PROD))
      result.before = baselineCounts(PROD)
      const env = databaseEnvironment(PROD)
      for (const args of [['exec', 'payload', 'migrate'], ['migrate:assert-applied'], ['migrate:verify'], ['exec', 'payload', 'migrate']]) run('pnpm', args, env, result.commands)
      result.afterState = migrationState(PROD)
      assert.deepEqual(result.afterState, { count: 81, last: FINAL, assetTable: 'mini_user_assets' })
      result.after = baselineCounts(PROD)
      for (const before of result.before.tables) assert(result.after.tables.find((row) => row.table === before.table).count >= before.count, '升级后记录减少')
      assert(result.after.boundedSameTables >= 49)
    } else if (mode === 'fresh') {
      const names = databases(); assertFreshAbsent(names)
      result.provedAbsentBeforeCreate = true
      sql('postgres', 'CREATE DATABASE "sbh_dev_mp108_fresh" OWNER "liujiayuan"', true)
      result.created = true
      const env = databaseEnvironment(FRESH, { CI: '1', SEED_MEDIA_OFFLINE: '1', NEXT_PUBLIC_SITE_URL: 'https://mp108.local.test', MULTI_CITY_ROUTING_ENABLED: 'false' })
      for (const args of [['exec', 'payload', 'migrate'], ['migrate:assert-applied'], ['migrate:verify'], ['seed'], ['seed:media'], ['exec', 'payload', 'migrate'], ['migrate:verify'], ['baseline:capture']]) run('pnpm', args, env, result.commands)
      result.beforeTests = baselineCounts(FRESH)
      const files = readdirSync(path.join(WEB, 'tests')).filter((p) => p.endsWith('-postgres.test.ts')).sort().map((p) => `tests/${p}`)
      assert.equal(files.length, 8)
      const tested = run('pnpm', ['exec', 'vitest', 'run', ...files], env, result.commands)
      assert(/Test Files\s+8 passed \(8\)/.test(tested.output), '真实PG测试文件未全部通过')
      assert(/Tests\s+41 passed \(41\)/.test(tested.output), '真实PG用例未全部通过或发生skip')
      result.tests = { filesPassed: 8, passed: 41, skipped: 0, failed: 0 }
      result.afterState = migrationState(FRESH); result.afterTests = baselineCounts(FRESH)
      assert.deepEqual(result.afterState, { count: 81, last: FINAL, assetTable: 'mini_user_assets' })
    } else throw new Error('未知 PostgreSQL 模式')
    result.status = 'PASS'
  } catch (error) { result.failure = redact(String(error.message)); process.exitCode = 1 }
  all[mode] = result
  writeFileSync(EVIDENCE, `${JSON.stringify(all, null, 2)}\n`)
  console.log(`[Task5] ${mode}: ${result.status}${result.failure ? ` — ${result.failure}` : ''}`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (mode === 'verify') {
    const checked = spawnSync(process.execPath, [path.join(DIR, 'task5-verify.mjs'), 'verify'], { env: baseEnvironment(), encoding: 'utf8' })
    process.stdout.write(checked.stdout ?? ''); process.stderr.write(checked.stderr ?? '')
    process.exitCode = checked.status ?? 1
  } else await pg(mode)
}
