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
 * ## 判据（三态，不是二态）
 *
 * - **漂移**：`migrate:create` 在 `src/migrations/` 里**生成了新文件**（跑前跑后目录差异）。
 *   这是唯一可靠的正向信号——文件落盘是同步 fs 调用，不依赖任何日志。
 * - **干净**：没生成文件，且输出含 `No schema changes detected`。这行是 `prompts`
 *   确认框在构造时同步写到 stdout 的（非 TTY 也会渲染），所以出现即可信。
 * - **无法判定**：退出码 0、没生成文件、也没有那行提示。这不是漂移。
 *
 * 为什么必须有第三态（2026-09-11，master `a0cf599` 的 CI）：`migrate:create` 以退出码 0
 * 结束，整份输出只有 config 加载时的一行 `[site-config] ...`——连 `payload.init` 的
 * `No email adapter` WARN 都没有，说明进程在 config 加载完到 `payload.init` 之间就静默
 * 退出了（`bin.js` 是 `void start()`，任何 await 悬而不决都会在事件循环排空后以 0 退出）。
 * 旧脚本把「没有干净提示」一律当成漂移，让本可上线的合并被跳过；`gh run rerun` 一次即过。
 * 现在：无法判定 → 自动重试一次；两次都无法判定才失败，并把原因说清楚。
 *
 * ## 为什么不直接读 drizzle 内部 API
 *
 * 那些是未导出的实现细节，版本间会变。跑真命令、断言真结果，跟着 Payload 升级走。
 *
 * ## 副作用处理
 *
 * `migrate:create` 在有变化时会写文件并改 `index.ts`。每次探测先备份 `index.ts`、
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

export const CLEAN_MARKER = 'No schema changes detected'
export const CREATED_MARKER = 'Migration created'
/** 总尝试次数：第一次无法判定就再来一次；第二次仍无法判定才失败。 */
export const MAX_ATTEMPTS = 2

export type ProbeResult = {
  /** 子进程退出码；被信号杀掉时记为 1 */
  code: number
  /** stdout + stderr 合并 */
  output: string
  /** 跑完后 `src/migrations/` 里多出来的文件名（已被还原删除，这里只是记录） */
  createdFiles: string[]
}

export type Verdict =
  | { kind: 'clean' }
  | { kind: 'drift'; createdFiles: string[] }
  | { kind: 'indeterminate' }
  | { kind: 'error' }

/**
 * 把一次探测结果归入三态（外加「命令本身失败」）。纯函数，便于单测。
 *
 * 顺序有讲究：先看文件（最硬的证据），再看干净提示，剩下的才是无法判定。
 * `Migration created` 只作漂移的兜底信号——正常情况下它一定伴随新文件。
 */
export function classifyProbe(result: ProbeResult): Verdict {
  if (result.code !== 0) {
    return { kind: 'error' }
  }
  if (result.createdFiles.length > 0 || result.output.includes(CREATED_MARKER)) {
    return { kind: 'drift', createdFiles: result.createdFiles }
  }
  if (result.output.includes(CLEAN_MARKER)) {
    return { kind: 'clean' }
  }
  return { kind: 'indeterminate' }
}

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

/**
 * 跑一次真探测：记录目录快照 → 跑 migrate:create → 算出新增文件 → 还原工作树。
 * 还原放在 finally 里，命令抛错也不留脏文件。
 */
export async function runProbe(): Promise<ProbeResult> {
  const before = listMigrationFiles()
  const indexBackup = readFileSync(INDEX_TS, 'utf8')

  let run: { output: string; code: number }
  const createdFiles: string[] = []
  try {
    run = await runMigrateCreate()
  } finally {
    // 还原：先删新文件，再还原 index.ts（顺序无所谓，但两件都必须做）
    for (const name of listMigrationFiles()) {
      if (!before.has(name)) {
        createdFiles.push(name)
        rmSync(path.join(MIGRATIONS_DIR, name), { force: true })
      }
    }
    if (readFileSync(INDEX_TS, 'utf8') !== indexBackup) {
      writeFileSync(INDEX_TS, indexBackup)
    }
  }

  return { ...run, createdFiles: createdFiles.sort() }
}

const DRIFT_MESSAGE = [
  '',
  '[migrate:drift] 快照漂移：config 与最新 .json 快照不一致。',
  '',
  'migrate:create 生成了新的迁移文件，说明二者已分叉。常见原因：',
  '  - 分支基于旧 master，生成迁移时用的是过期快照（务必 pnpm branch:new / 先 rebase）；',
  '  - 改了 collection 却没跑 migrate:create。',
  '',
  '修法：从最新 master 起分支后跑 `pnpm exec payload migrate:create <名字>`，',
  '把生成的 .ts 与 .json 一并提交。若它生成的是一条已经存在的变更（重复迁移），',
  '说明快照链本身回退了——把该迁移改成幂等（ADD COLUMN IF NOT EXISTS 等）后提交，',
  '靠它配套的新快照把链修回来。参考 OPT-048 与',
  'src/migrations/20260824_101016_opt048_snapshot_chain_repair.ts。',
  '',
]

const INDETERMINATE_MESSAGE = [
  '',
  `[migrate:drift] 无法判定：migrate:create 连续 ${MAX_ATTEMPTS} 次以退出码 0 结束，`,
  `但既没打印「${CLEAN_MARKER}」，也没生成任何迁移文件。`,
  '',
  '这**不是**快照漂移（漂移会生成文件）。它意味着 payload CLI 在还没跑到比对逻辑之前就',
  '静默退出了——bin.js 是 `void start()`，任何 await 悬而不决都会在事件循环排空后以 0 退出。',
  '2026-09-11 master a0cf599 的 CI 出现过一次，重跑即过；若连续出现请查 Node / tsx 版本变化，',
  '或在本地用 `printf "N\\n" | NODE_OPTIONS=--trace-exit npx payload migrate:create x` 看退出点。',
  '',
]

export type DriftCheckDeps = {
  probe: () => Promise<ProbeResult>
  log: (msg: string) => void
  error: (msg: string) => void
}

/**
 * 守卫主体。返回 true 表示通过；false 表示应以非零退出码结束（错误已打印）。
 * 不直接 process.exit，方便单测注入假的 probe 验证重试与文案。
 */
export async function runDriftCheck(deps: DriftCheckDeps): Promise<boolean> {
  const { probe, log, error } = deps

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await probe()
    const verdict = classifyProbe(result)

    switch (verdict.kind) {
      case 'error':
        error('[migrate:drift] migrate:create 执行失败，无法判定漂移：')
        error(result.output)
        return false

      case 'clean':
        log('[migrate:drift] OK —— config 与最新快照一致。')
        return true

      case 'drift':
        error(
          [
            ...DRIFT_MESSAGE,
            '--- 生成的文件（已自动清理）---',
            ...verdict.createdFiles.map((f) => `  ${f}`),
            '',
            '--- migrate:create 原始输出 ---',
            result.output.trim(),
            '',
          ].join('\n'),
        )
        return false

      case 'indeterminate':
        if (attempt < MAX_ATTEMPTS) {
          log(
            `[migrate:drift] 第 ${attempt} 次探测无法判定（退出码 0、无提示、无新文件），重试一次…`,
          )
          continue
        }
        error(
          [
            ...INDETERMINATE_MESSAGE,
            '--- 最后一次 migrate:create 原始输出 ---',
            result.output.trim(),
            '',
          ].join('\n'),
        )
        return false
    }
  }

  // 循环里每个分支都 return/continue，走不到这里；留给 TS 穷尽检查。
  return false
}

async function main() {
  const ok = await runDriftCheck({
    probe: runProbe,
    log: (m) => console.log(m),
    error: (m) => console.error(m),
  })
  if (!ok) {
    process.exit(1)
  }
}

// 仅在作为脚本直接运行时执行；被测试 import 时不真的 spawn migrate:create。
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[migrate:drift] 未预期错误：', err)
    process.exit(1)
  })
}
