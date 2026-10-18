// 明确加载本地环境后执行固定的 Payload 迁移命令，不接受任意 shell 命令。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const app = new URL('../../../payload-office-platform/', import.meta.url)
const local = parseEnv(fs.readFileSync(new URL('.env.local', app), 'utf8'))
const target = new URL(local.DATABASE_URL)
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
assert.ok(!Object.entries(local).some(([key, value]) => key.startsWith('COS_') && value.trim()))
const commands = {
  create: 'pnpm exec payload migrate:create opt_121_building_grade_options_expand',
  migrate: 'pnpm exec payload migrate',
  drift: 'pnpm migrate:drift',
  verify: 'pnpm migrate:verify',
  postgres: 'pnpm exec vitest run tests/building-query-postgres.test.ts --no-file-parallelism',
}
const command = commands[process.argv[2]]
assert.ok(command, '仅允许 create / migrate / drift / verify')
console.log(`本地目标：${target.hostname}:${target.port || 5432}${target.pathname}；${command}`)
const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command], {
  cwd: fileURLToPath(app),
  stdio: 'inherit',
  env: { ...process.env, ...local, PAYLOAD_DISABLE_JOB_AUTORUN: '1' },
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
