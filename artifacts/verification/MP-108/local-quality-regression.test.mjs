// 仅内存反例；不执行 pnpm、不写捕获证据、不改变构建产物。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as cp from 'node:child_process'
import * as crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dir, '../../..')
const scriptPath = path.join(dir, 'local-quality.mjs')
const evidencePath = path.join(dir, 'local-quality.json')
const original = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
// 这是独立反例测试夹具，绝不写回真实证据或冒充门禁输出。
const dryFixture = 'Total migrations: 81\nBlocking hits: 0\nWarning hits: 4\n'

function subject(options = {}) {
  const fixture = structuredClone(original)
  fixture.commands[7].output = dryFixture
  if (options.invalidEnvironment) fixture.environment.cosConfigured = true
  const writes = [], launches = []
  const source = fs.readFileSync(scriptPath, 'utf8')
  const mainStart = source.lastIndexOf('\ntry {')
  assert(mainStart > 0, '需找到 CLI 入口，避免测试执行门禁')
  // 只剥 ESM 导入和 CLI 入口，函数体保持原样；模拟最底层进程/写盘边界。
  const code = source.slice(0, mainStart).replace(/^import .*\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('./local-quality.mjs', import.meta.url).href))
  const context = vm.createContext({
    assert, path, URL, fileURLToPath, createHash: crypto.createHash, randomBytes: crypto.randomBytes,
    existsSync: fs.existsSync, readdirSync: fs.readdirSync, statSync: fs.statSync,
    readFileSync: (p, encoding) => {
      if (path.resolve(p) === evidencePath) return JSON.stringify(fixture)
      if (options.manifestFailure && String(p).endsWith('/server/app-paths-manifest.json')) throw new Error('fixture manifest missing')
      return fs.readFileSync(p, encoding)
    },
    writeFileSync: (p, data) => writes.push({ path: p, data: JSON.parse(data) }),
    execFileSync: (command, args, opts) => {
      if (command === 'pnpm') { assert.deepEqual(Array.from(args), ['--version']); return '8.6.1\n' }
      if (options.identityFailure && launches.length === 11) throw new Error('fixture identity failed')
      return cp.execFileSync(command, Array.from(args), opts)
    },
    spawnSync: (command, args, opts) => {
      assert.equal(command, 'pnpm')
      const index = launches.length
      const entry = fixture.commands[index]
      assert.equal(`pnpm ${Array.from(args).join(' ')}`, entry.command)
      assert.equal(opts.cwd, path.join(root, entry.cwd))
      launches.push(entry.command)
      return { status: 0, signal: null, stdout: entry.output ?? '', stderr: '' }
    },
    process: { version: 'v22.23.2', env: { ...process.env, MP108_LOCAL_DATABASE_URL: ['postgres:', '//liujiayuan@127.0.0.1:5432/sbh_dev_mp108_prod'].join('') } },
    console: { log() {}, error() {} },
    fixtureText: JSON.stringify(fixture),
  })
  vm.runInContext(`${code}\nglobalThis.subject = { validate, capture }; globalThis.fixture = JSON.parse(fixtureText)`, context)
  return { api: context.subject, fixture: context.fixture, context, writes, launches }
}

for (const [index, replacements] of [[7, [['Total migrations: 81', 'Total migrations: 82'], ['Blocking hits: 0', 'Blocking hits: 7'], ['Warning hits: 4', 'Warning hits: 5']]], [8, [['通过: 3', '通过: 4'], ['警告: 1', '警告: 2'], ['失败: 0', '失败: 9']]]]) {
  for (const [from, to] of replacements) test(`verify 拒绝 output/字段矛盾：${to}`, () => {
    const s = subject()
    s.fixture.commands[index].output = s.fixture.commands[index].output.replace(from, to)
    assert.throws(() => s.api.validate(s.fixture), /输出|output|汇总|不一致|不等/)
  })
  test(`verify 拒绝门禁 ${index + 1} 缺少 output`, () => {
    const s = subject(); delete s.fixture.commands[index].output
    assert.throws(() => s.api.validate(s.fixture), /输出|output|汇总/)
  })
}

for (const reason of ['manifestFailure', 'invalidEnvironment', 'identityFailure']) test(`capture ${reason} 必须持久化 FAILED`, async () => {
  const s = subject({ [reason]: true })
  await assert.rejects(s.api.capture())
  assert.equal(s.launches.length, 11)
  assert.equal(s.writes.length, 1, '即使收尾失败也必须留失败记录')
  assert.equal(s.writes[0].data.status, 'FAILED')
  assert(s.writes[0].data.failureReasons.length > 0, '失败原因必须明确且脱敏')
  assert(!JSON.stringify(s.writes).includes('fixture identity failed'), '不保存未经脱敏的异常原文')
})

test('capture 所有检查成功后才保存 PASS', async () => {
  const s = subject()
  await s.api.capture()
  assert.equal(s.launches.length, 11)
  assert.equal(s.writes.length, 1)
  assert.equal(s.writes[0].data.status, 'PASS_WITH_WARNINGS_AND_EXPLICIT_SKIPS')
  assert.deepEqual(s.writes[0].data.failureReasons, [])
})
