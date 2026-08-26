/**
 * 迁移快照漂移守卫（OPT-048）。
 *
 * ## 守的是什么
 *
 * `payload migrate:create` 比对「当前 config」与「最后一份 `.json` 快照」，
 * **从不看真实数据库**。所以只要有人在旧基线上生成迁移，新快照就会丢掉旧快照已有的列，
 * 而这件事**没有任何现成信号**——直到下一个人跑 `migrate:create`，凭空多出一条重复迁移。
 *
 * 真实教训（OPT-046 §7.5 → OPT-048）：OPT-041 的分支基于早于
 * `20260820_110024` 的基线，快照丢掉了 `city_site_profiles.avg_response_hours`。
 * 此后任何人跑 `migrate:create` 都会得到一条重复的
 * `ALTER TABLE ... ADD COLUMN "avg_response_hours"`，**且没有 `IF NOT EXISTS`**。
 * 误提交并部署 → 在早有该列的生产库上失败 → 容器 CMD `migrate-locked.ts && pnpm start`
 * 短路 → 服务起不来。与 2026-08-23 那次部署失败是同一种死法。
 *
 * ## 判据
 *
 * 干净时 `migrate:create` 会打印 `No schema changes detected`。打印别的就说明
 * config 与快照已分叉，此时**必须**由改动者补一条迁移（哪怕是空操作），
 * 让快照重新对齐——而不是把问题留给下一个人。
 *
 * ## 为什么不直接读 drizzle 内部 API
 *
 * 那些是未导出的实现细节，版本间会变。跑真命令、断言真输出，跟着 Payload 升级走。
 *
 * ## 副作用处理
 *
 * `migrate:create` 在有变化时会写文件并改 `index.ts`。本脚本先备份 `index.ts`、
 * 记录目录快照，跑完无论成败都还原，保证守卫本身不污染工作树。
 */

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = path.join(ROOT, 'src', 'migrations')
const INDEX_TS = path.join(MIGRATIONS_DIR, 'index.ts')
const PROBE_NAME = 'ci_drift_probe'
const CLEAN_MARKER = 'No schema changes detected'

function listMigrationFiles(): Set<string> {
  return new Set(readdirSync(MIGRATIONS_DIR))
}

function runMigrateCreate(): Promise<{ output: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['payload', 'migrate:create', PROBE_NAME], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows 上直接 spawn npx / npx.cmd 会 EINVAL（Node 对 .cmd 的安全限制）。
      // 参数全是本文件里的常量，不吃外部输入，走 shell 没有注入面。
      shell: true,
    })
    let output = ''
    child.stdout.on('data', (c) => (output += String(c)))
    child.stderr.on('data', (c) => (output += String(c)))
    // 「要不要建空迁移」一律回答 N；CI 无 tty，不喂会挂住。
    child.stdin.write('N\n')
    child.stdin.end()
    child.on('close', (code) => resolve({ output, code: code ?? 1 }))
  })
}

async function main() {
  const before = listMigrationFiles()
  const indexBackup = readFileSync(INDEX_TS, 'utf8')

  let result: { output: string; code: number }
  try {
    result = await runMigrateCreate()
  } finally {
    // 还原：先删新文件，再还原 index.ts（顺序无所谓，但两件都必须做）
    for (const name of listMigrationFiles()) {
      if (!before.has(name)) {
        rmSync(path.join(MIGRATIONS_DIR, name), { force: true })
      }
    }
    if (readFileSync(INDEX_TS, 'utf8') !== indexBackup) {
      writeFileSync(INDEX_TS, indexBackup)
    }
  }

  if (result.code !== 0) {
    console.error('[migrate:drift] migrate:create 执行失败，无法判定漂移：')
    console.error(result.output)
    process.exit(1)
  }

  if (result.output.includes(CLEAN_MARKER)) {
    console.log('[migrate:drift] OK —— config 与最新快照一致。')
    return
  }

  console.error(
    [
      '',
      '[migrate:drift] 快照漂移：config 与最新 .json 快照不一致。',
      '',
      'migrate:create 认为还有 schema 变更要生成，说明二者已分叉。常见原因：',
      '  - 分支基于旧 master，生成迁移时用的是过期快照（务必 pnpm branch:new / 先 rebase）；',
      '  - 改了 collection 却没跑 migrate:create。',
      '',
      '修法：从最新 master 起分支后跑 `pnpm exec payload migrate:create <名字>`，',
      '把生成的 .ts 与 .json 一并提交。若它生成的是一条已经存在的变更（重复迁移），',
      '说明快照链本身回退了——把该迁移改成幂等（ADD COLUMN IF NOT EXISTS 等）后提交，',
      '靠它配套的新快照把链修回来。参考 OPT-048 与',
      'src/migrations/20260824_101016_opt048_snapshot_chain_repair.ts。',
      '',
      '--- migrate:create 原始输出 ---',
      result.output.trim(),
      '',
    ].join('\n'),
  )
  process.exit(1)
}

main().catch((err) => {
  console.error('[migrate:drift] 未预期错误：', err)
  process.exit(1)
})
