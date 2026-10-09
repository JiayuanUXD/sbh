#!/usr/bin/env node
// MP-108：capture 执行门禁；verify 仅检查证据与本地产物。无需第三方依赖。
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '../../..')
const WEB = 'payload-office-platform'
const MINI = 'sbh-miniprogram'
const SHA = '7fdd91afb24891a8ad0d9560ccf8927c0c055e72'
const MANIFEST = `${WEB}/.next/server/app-paths-manifest.json`
const NODE_BIN = '/Users/liujiayuan/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin'
const GATES = [
  [MINI, ['install', '--frozen-lockfile']], [MINI, ['test']],
  [MINI, ['typecheck']], [MINI, ['project:check']],
  [WEB, ['typecheck']], [WEB, ['lint']], [WEB, ['test']],
  [WEB, ['migrate:dry-run']], [WEB, ['exec', 'tsx', 'scripts/preflight.ts', 'migrations']],
  [WEB, ['migrate:drift']], [WEB, ['build']],
]
const read = (p) => readFileSync(path.resolve(ROOT, p), 'utf8')
const json = (p) => JSON.parse(read(p))
const hash = (s) => createHash('sha256').update(s).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim()
const processOrEvidence = (p) => /^(?:\.planning\/|\.superpowers\/|artifacts\/verification\/MP-108\/)/.test(p)
const lines = (s) => s.split('\n').filter(Boolean)

function identity() {
  assert.equal(git('rev-parse', '--show-toplevel'), ROOT, '工作树根不匹配')
  assert.equal(git('rev-parse', `${SHA}^{commit}`), SHA, '候选提交不存在')
  git('merge-base', '--is-ancestor', SHA, 'HEAD')
  // 允许后续仅证据提交；当前索引、工作树与候选的业务源码必须相等。
  const changed = lines(git('diff', '--name-only', SHA, '--')).filter((p) => !processOrEvidence(p))
  const staged = lines(git('diff', '--cached', '--name-only', SHA, '--')).filter((p) => !processOrEvidence(p))
  const untracked = lines(git('ls-files', '--others', '--exclude-standard')).filter((p) => !processOrEvidence(p))
  assert.equal(changed.length + staged.length + untracked.length, 0, '存在候选之外的源码修改/未跟踪文件')
  return { candidateSha: SHA, currentHead: git('rev-parse', 'HEAD'), sourceMatchesCandidate: true }
}

function sourceKeys() {
  return lines(git('ls-files', `${WEB}/src/app/api/mini/v1/**/route.ts`))
    .map((p) => p.replace(`${WEB}/src/app`, '').replace(/\.ts$/, '')).sort()
}

function manifestEvidence(buildOutput) {
  const raw = read(MANIFEST), map = JSON.parse(raw), keys = Object.keys(map).filter((p) => p.startsWith('/api/mini/v1/')).sort()
  const source = sourceKeys()
  assert.equal(source.length, 12, '候选源码 Mini API 路由数量不为 12')
  assert.deepEqual(keys, source, '源码/manifest 路由集合不等')
  const prerender = json(`${WEB}/.next/prerender-manifest.json`)
  const staticKeys = [...Object.keys(prerender.routes), ...Object.keys(prerender.dynamicRoutes)]
  const dynamicOutput = new Set(lines(buildOutput).map((s) => s.match(/ƒ\s+(\/api\/mini\/v1\/\S+)\s*$/)?.[1]).filter(Boolean))
  const routes = keys.map((key) => {
    const route = key.replace(/\/route$/, '')
    assert(dynamicOutput.has(route), `构建输出缺少动态标记：${route}`)
    assert(!staticKeys.includes(route), `Mini 路由被预渲染：${route}`)
    assert.equal(typeof map[key], 'string')
    assert.equal(map[key], `app${key}.js`, 'bundle 路径不符合约定')
    assert(statSync(path.resolve(ROOT, WEB, '.next/server', map[key])).isFile(), 'bundle 缺失')
    return { path: route, manifestKey: key, bundle: map[key], bundleExists: true }
  })
  return { manifest: MANIFEST, sha256: hash(raw), buildId: read(`${WEB}/.next/BUILD_ID`).trim(), count: 12, sourceCount: 12, allSourceRoutesPresent: true, routes }
}

function number(value, label) { assert(Number.isInteger(value) && value >= 0, `${label} 不是非负整数`) }
function testCounts(output, label) {
  const line = lines(output).find((s) => s.trim().startsWith(label))
  assert(line, `缺少 ${label} 汇总`)
  const count = (word) => Number(line.match(new RegExp(`(\\d+) ${word}`))?.[1] ?? 0)
  const total = Number(line.match(/\((\d+)\)/)?.[1])
  const stats = { passed: count('passed'), skipped: count('skipped'), failed: count('failed'), total }
  number(total, label)
  assert.equal(stats.passed + stats.skipped + stats.failed, total, `${label} 汇总不一致`)
  return stats
}

function migrationCounts(command, output) {
  assert(typeof output === 'string' && output.trim(), `${command} 缺少原始 output`)
  const labels = command === 'pnpm migrate:dry-run'
    ? [['migrations', 'Total migrations'], ['blockingHits', 'Blocking hits'], ['warningHits', 'Warning hits']]
    : [['passed', '通过'], ['warnings', '警告'], ['failed', '失败']]
  return Object.fromEntries(labels.map(([key, label]) => {
    const matches = [...output.matchAll(new RegExp(`^\\s*${label}:\\s*(\\d+)\\s*$`, 'gm'))]
    assert.equal(matches.length, 1, `${command} 原始输出缺少或重复 ${label} 汇总`)
    return [key, Number(matches[0][1])]
  }))
}

function validate(data) {
  assert(data && typeof data === 'object' && !Array.isArray(data), '证据根必须为对象')
  assert.equal(data.schemaVersion, 1)
  assert.equal(data.status, 'PASS_WITH_WARNINGS_AND_EXPLICIT_SKIPS')
  assert.equal(data.workItem, 'MP-108'); assert.equal(data.task, 4)
  assert.equal(data.candidateSha, SHA)
  assert(Number.isFinite(Date.parse(data.recordedAt)), 'recordedAt 无效')
  assert(/^v22\./.test(data.toolchain?.node)); assert.equal(data.toolchain?.pnpm, '8.6.1')
  assert(Array.isArray(data.commands)); assert.equal(data.commands.length, GATES.length)
  for (const [index, [cwd, args]] of GATES.entries()) {
    const item = data.commands[index]
    assert.equal(item.cwd, cwd); assert.equal(item.command, `pnpm ${args.join(' ')}`)
    assert.equal(item.exitCode, 0, `门禁 ${index + 1} 未通过`)
    if (args[0] === 'test') {
      assert.equal(typeof item.output, 'string')
      for (const [field, label] of [['testFiles', 'Test Files'], ['tests', 'Tests']]) {
        const parsed = testCounts(item.output, label)
        assert.equal(parsed.failed, 0)
        for (const key of ['passed', 'skipped', 'total']) {
          number(item[field]?.[key] ?? (key === 'skipped' ? 0 : undefined), `${field}.${key}`)
          assert.equal(item[field]?.[key] ?? 0, parsed[key], `${field}.${key} 与输出不等`)
        }
      }
    }
  }
  number(data.commands[5].warnings, 'lint warnings'); assert.equal(data.commands[5].errors, 0)
  const lint = data.commands[5].output.match(/(\d+) problems \((\d+) errors, (\d+) warnings\)/)
  if (lint) { assert.equal(Number(lint[2]), 0); assert.equal(Number(lint[3]), data.commands[5].warnings) }
  else assert.equal(data.commands[5].warnings, 0, 'lint warnings 缺少输出支持')
  number(data.commands[7].migrations, 'migration count'); assert.equal(data.commands[7].blockingHits, 0)
  number(data.commands[7].warningHits, 'migration warnings')
  number(data.commands[8].passed, 'preflight passed'); number(data.commands[8].warnings, 'preflight warnings'); assert.equal(data.commands[8].failed, 0)
  for (const index of [7, 8]) {
    const item = data.commands[index]
    for (const [key, value] of Object.entries(migrationCounts(item.command, item.output))) {
      assert.equal(item[key], value, `${item.command} ${key} 与原始输出不一致`)
    }
  }
  assert(data.commands[9].output.includes('config 与最新快照一致'))
  assert(data.commands[10].output.includes('Compiled successfully'))
  assert.equal(data.environment?.cosConfigured, false)
  assert.equal(data.environment?.quality?.DATABASE_URL, '未设置')
  assert.deepEqual(data.environment?.build?.database, { host: '127.0.0.1', port: 5432, name: 'sbh_dev_mp108_prod' })
  assert.equal(data.environment.build.CI, '1')
  assert.equal(data.environment.build.NEXT_PUBLIC_SITE_URL, 'https://mp108.local.test')
  assert.equal(data.environment.build.MULTI_CITY_ROUTING_ENABLED, 'false')
  assert(!/postgres(?:ql)?:\/\//.test(JSON.stringify(data)), '证据包含完整数据库连接串')
  identity()
  const current = manifestEvidence(data.commands[10].output)
  assert.match(data.manifest.sha256, /^[a-f0-9]{64}$/)
  for (const key of ['manifest', 'sha256', 'buildId', 'count', 'sourceCount', 'allSourceRoutesPresent', 'routes']) {
    assert.deepEqual(data.manifest[key], current[key], `构建指纹或路由字段不一致：${key}`)
  }
  return current
}

function localDatabase() {
  const value = process.env.MP108_LOCAL_DATABASE_URL
  let url
  try { url = new URL(value) } catch { throw new Error('capture 需要 MP108_LOCAL_DATABASE_URL（值不打印）') }
  assert(url.protocol === 'postgres:' && url.hostname === '127.0.0.1' && url.port === '5432' && url.pathname === '/sbh_dev_mp108_prod' && url.username === 'liujiayuan' && !url.password && !url.search && !url.hash, '拒绝非指定本地隔离数据库（值不打印）')
  return value
}

function baseEnvironment() {
  // 白名单避免继承数据库、COS、云端凭据、Node 注入参数和部署开关。
  const result = {}
  for (const key of ['HOME', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key]) result[key] = process.env[key]
  }
  result.PATH = `${NODE_BIN}:${process.env.PATH ?? '/usr/bin:/bin'}`
  return result
}

function metrics(item) {
  const output = item.output
  if (item.command === 'pnpm test') {
    item.testFiles = testCounts(output, 'Test Files'); item.tests = testCounts(output, 'Tests')
  }
  if (item.command === 'pnpm lint') {
    const match = output.match(/(\d+) problems \((\d+) errors, (\d+) warnings\)/)
    item.errors = Number(match?.[2] ?? 0); item.warnings = Number(match?.[3] ?? 0)
  }
  if (item.command === 'pnpm migrate:dry-run') {
    Object.assign(item, migrationCounts(item.command, output))
  }
  if (item.command === 'pnpm exec tsx scripts/preflight.ts migrations') {
    Object.assign(item, migrationCounts(item.command, output))
  }
  item.warningLines = lines(output).filter((s) => /\bWARN(?:ING)?\b|\bwarning\b|⚠️/i.test(s))
}

async function capture() {
  const data = { schemaVersion: 1, workItem: 'MP-108', task: 4, candidateSha: SHA, recordedAt: new Date().toISOString(), status: 'FAILED', failureReasons: [], commands: [] }
  let stage = 'capture_preflight'
  try {
  const before = identity(), database = localDatabase(), base = baseEnvironment()
  for (const dir of [ROOT, path.join(ROOT, WEB), path.join(ROOT, MINI)]) {
    assert(!readdirSync(dir).some((name) => /^\.env(?:$|\.)/.test(name) && name !== '.env.example'), 'capture 拒绝自动加载的 env 文件')
  }
  assert.equal(execFileSync('pnpm', ['--version'], { env: base, encoding: 'utf8' }).trim(), '8.6.1')
  const prior = json(path.relative(ROOT, path.join(DIR, 'local-quality.json')))
  const environment = { ...prior.environment, inheritedSensitiveEnvironmentKeys: [], networkScope: '仅执行固定本地门禁；包源下载数量见本次 install 输出，不继承旧轮计数。' }
  Object.assign(data, { toolchain: { node: process.version, pnpm: '8.6.1', nodeBin: NODE_BIN }, environment, candidateBoundary: before, warningAssessment: { note: '本次计数来自真实输出；既有/新增需基于候选差异另行复核，不继承旧归因。' }, uncovered: prior.uncovered, reproducibility: { script: 'local-quality.mjs', mode: 'capture' } })
  for (const [index, [cwd, args]] of GATES.entries()) {
    stage = `gate_${index + 1}_execution`
    const secret = randomBytes(48).toString('hex'), env = { ...base }
    if (cwd === WEB) env.PAYLOAD_SECRET = secret
    if (args[0] === 'build') Object.assign(env, { DATABASE_URL: database, CI: '1', NEXT_PUBLIC_SITE_URL: 'https://mp108.local.test', MULTI_CITY_ROUTING_ENABLED: 'false' })
    const startedAt = new Date().toISOString()
    console.log(`[capture ${index + 1}/11] ${cwd}: pnpm ${args.join(' ')}`)
    // 先完整收集，再脱敏；子进程不能将 secret 或连接串直接写到终端。
    const result = spawnSync('pnpm', args, { cwd: path.join(ROOT, cwd), env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30 * 60 * 1000 })
    const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const output = raw.replaceAll(secret, '[REDACTED_SECRET]').replaceAll(database, '[REDACTED_DATABASE]').replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, '[REDACTED_DATABASE]').replaceAll(`${ROOT}/`, '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    const item = { cwd, command: `pnpm ${args.join(' ')}`, exitCode: result.status ?? 1, signal: result.signal, startedAt, finishedAt: new Date().toISOString(), output }
    try { metrics(item) } catch { item.metricsError = '未能解析完整门禁汇总；不视为通过' }
    data.commands.push(item)
    if (item.exitCode !== 0 || item.metricsError) data.failureReasons.push(`gate_${index + 1}: exitCode=${item.exitCode}${item.metricsError ? '；原始输出汇总解析失败' : ''}`)
    console.log(`[capture ${index + 1}/11] exitCode=${item.exitCode}${item.metricsError ? ' metricsError' : ''}`)
  }
  stage = 'candidate_identity_after'
  data.candidateBoundary.after = identity()
  stage = 'gate_results'
  assert.equal(data.failureReasons.length, 0, '门禁失败')
  stage = 'manifest_and_dynamic_routes'
  data.manifest = manifestEvidence(data.commands[10].output)
  stage = 'final_schema_output_fingerprint_validation'
  // 对独立候选对象做完整验证；真实记录始终保持 FAILED，直到验证返回。
  validate({ ...data, status: 'PASS_WITH_WARNINGS_AND_EXPLICIT_SKIPS' })
  data.status = 'PASS_WITH_WARNINGS_AND_EXPLICIT_SKIPS'
  } catch {
    data.status = 'FAILED'
    data.failureReasons.push(`${stage}: 未通过；异常原文不保存，门禁详情见脱敏 output`)
  }
  // 新捕获结果单独保存，绝不冒充或覆盖原始人工捕获证据。
  writeFileSync(path.join(DIR, 'local-quality.capture.json'), `${JSON.stringify(data, null, 2)}\n`)
  if (data.status === 'FAILED') throw new Error(`capture FAILED: ${data.failureReasons.join('；')}`)
  console.log('CAPTURE PASS: 11 gates recorded; verify checks passed; local-quality.capture.json')
}

try {
  assert.equal(process.versions.node.split('.')[0], '22', '必须使用 Node 22')
  const [mode, evidence = 'local-quality.json', ...extra] = process.argv.slice(2)
  assert(extra.length === 0 && ['local-quality.json', 'local-quality.capture.json'].includes(evidence), '证据参数只允许固定文件名')
  if (mode === 'verify') {
    validate(json(path.relative(ROOT, path.join(DIR, evidence))))
    console.log(`VERIFY PASS: schema; 11/11 exit codes; candidate ${SHA}; clean candidate source; 12/12 dynamic Mini routes and bundles; manifest SHA-256 and BUILD_ID match. No tests/build/database/network writes executed.`)
  } else if (mode === 'capture') {
    assert.equal(process.argv.length, 3, 'capture 不接收额外参数')
    await capture()
  } else throw new Error('用法：node local-quality.mjs verify [local-quality.capture.json] | capture')
} catch (error) {
  // AssertionError 的实际值可能包含输入；仅输出我们定义的 message 首行。
  console.error(`FAIL: ${String(error.message).split('\n')[0]}`)
  process.exitCode = 1
}
