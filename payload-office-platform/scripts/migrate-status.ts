/**
 * M0 迁移状态报告：列出已应用 / 待应用迁移，并对比代码与数据库状态。
 *
 * 业务约束：
 *   - 本地/CI/生产统一 PostgreSQL，push: false，只走显式迁移
 *   - AGENTS.md §9：每次迁移必须提供 dry-run、影响数量、校验结果和回滚说明
 *
 * 安全原则：
 *   - 只读，不写数据
 *   - 通过 Payload Local API 读 payload_migrations 表
 *
 * 运行：pnpm migrate:status
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = pathDirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'src', 'migrations')

function listMigrationNames(): string[] {
  const indexTsPath = resolve(migrationsDir, 'index.ts')
  if (!existsSync(indexTsPath)) return []
  const entries = readFileSync(indexTsPath, 'utf8')
  return Array.from(entries.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+'\.\/([^']+)'/g)).map(
    (m) => m[1],
  )
}

type AppliedMigration = {
  name: string
  executedAt?: Date
  batch?: number
}

async function readAppliedFromPg(): Promise<AppliedMigration[] | null> {
  const databaseUrl = process.env.DATABASE_URL || ''
  if (!databaseUrl.startsWith('postgres')) return null

  // 动态加载 Payload 初始化（onInit 会校验 DATABASE_URL）
  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const payload = await getPayload({ config })

  try {
    // payload_migrations 表由 Payload 维护，drizzle schema 中作为隐式表存在
    const dbAny = payload.db as unknown as {
      drizzle?: {
        query?: {
          payload_migrations?: {
            findMany?: () => Promise<
              Array<{ name?: string; executed_at?: Date | string; batch?: number }>
            >
          }
        }
      }
    }
    const result = await dbAny?.drizzle?.query?.payload_migrations?.findMany?.()
    if (!Array.isArray(result)) return []
    return result.map((row) => ({
      name: String(row.name ?? ''),
      executedAt: row.executed_at ? new Date(row.executed_at as string) : undefined,
      batch: row.batch,
    }))
  } catch (err) {
    // 表可能不存在（首次部署）
    console.warn(
      `[migrate:status] 无法读取 payload_migrations 表：${(err as Error).message}（首次部署可能尚未创建表）`,
    )
    return []
  } finally {
    await payload.db.destroy?.()
  }
}

/**
 * `--assert-applied` 的判据（纯函数，与读库、打印分离，便于单测）。
 *
 * ── 为什么需要这条守卫 ────────────────────────────────────────────────────
 * `payload migrate` 存在**静默 no-op 且退出 0** 的形态。2026-09-04 PR #141 的
 * e2e job 实录：该步骤零输出（连 Payload init 的 "No email adapter" WARN 都没有）、
 * 3.5 秒退出 0、一条迁移都没跑。失败于是被推给下一步的 seed，报成
 * `relation "roles" does not exist`——排查要从 seed 一路倒推回 migrate 才看得出
 * 真凶。重跑即过，所以那不是代码问题；但**一个会静默什么都不做的步骤不该被判为成功**。
 *
 * ── 为什么不改默认行为 ────────────────────────────────────────────────────
 * `migrate:status` 默认是纯报告，有待应用迁移也退出 0——那是它作为人工巡检工具的
 * 正确语义。CI 要的是相反的语义，所以用显式开关分开，而不是让默认行为对两种
 * 调用方都半对。
 *
 * ── 两条判据缺一不可 ──────────────────────────────────────────────────────
 * - `appliedCount === 0`：那次故障的指纹（一条都没落库）；
 * - `pending` 非空：应用了一部分就中断，同样不该放行。
 *   只判前者会放过「跑了 3 条剩 54 条」；只判后者会放过「代码侧 0 条迁移」这种
 *   索引文件损坏的情形（此时 pending 恒空，看起来一切正常）。
 */
export function findUnappliedProblems({
  appliedCount,
  pending,
}: Readonly<{ appliedCount: number; pending: readonly string[] }>): string[] {
  const problems: string[] = []
  if (appliedCount === 0) {
    problems.push('payload_migrations 表里一条记录都没有——迁移根本没执行')
  }
  if (pending.length > 0) {
    problems.push(`还有 ${pending.length} 条待应用：${pending.join(', ')}`)
  }
  return problems
}

type StatusReport = {
  generatedAt: string
  database: { kind: 'postgres'; urlMasked: string }
  codeMigrations: string[]
  appliedMigrations: AppliedMigration[]
  pendingMigrations: string[]
}

// biome-ignore lint/suspicious/noConsole: CLI script
async function main() {
  const databaseUrl = process.env.DATABASE_URL || ''
  const codeMigrations = listMigrationNames()
  const appliedMigrations = (await readAppliedFromPg()) ?? []

  const appliedNames = new Set(appliedMigrations.map((m) => m.name))
  const pendingMigrations = codeMigrations.filter((n) => !appliedNames.has(n))

  const report: StatusReport = {
    generatedAt: new Date().toISOString(),
    database: { kind: 'postgres', urlMasked: databaseUrl.replace(/:[^:@/]+@/, ':****@') },
    codeMigrations,
    appliedMigrations,
    pendingMigrations,
  }

  console.log('=== Migration Status ===')
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Database:  ${report.database.kind}`)
  console.log(`  URL: ${report.database.urlMasked}`)
  console.log('')
  console.log(`Code migrations:   ${codeMigrations.length}`)
  console.log(`Applied migrations: ${appliedMigrations.length}`)
  console.log(`Pending migrations: ${pendingMigrations.length}`)

  console.log('')
  console.log('Code migrations:')
  for (const name of codeMigrations) {
    const applied = appliedNames.has(name)
    const tag = applied ? '✓ applied' : '○ pending'
    console.log(`  [${tag}] ${name}`)
  }

  if (pendingMigrations.length > 0) {
    console.log('')
    console.log('Pending migrations (PG):')
    for (const name of pendingMigrations) {
      console.log(`  - ${name}`)
    }
    console.log('')
    console.log('Next steps:')
    console.log('  1. Run `pnpm migrate:dry-run` to verify no forbidden operations')
    console.log('  2. Run `npx payload migrate` to apply pending migrations on PG')
    console.log('  3. Run `pnpm migrate:verify` to verify schema and data integrity')
  }

  if (process.argv.includes('--assert-applied')) {
    const problems = findUnappliedProblems({
      appliedCount: appliedMigrations.length,
      pending: pendingMigrations,
    })
    if (problems.length > 0) {
      console.error('')
      console.error('[migrate:assert-applied] 迁移未真正应用完毕：')
      for (const p of problems) console.error(`  - ${p}`)
      process.exitCode = 1
      return
    }
    console.log('')
    console.log(`[migrate:assert-applied] OK：${appliedMigrations.length} 条已应用，0 条待应用`)
  }
}

// 只在被直接执行时跑 main()——本文件现在还导出 findUnappliedProblems 供单测 import，
// 而 main() 会 getPayload() 连库（在测试进程里会挂住）。判据与 scripts/data-audit.ts、
// scripts/migrate-dry-run.ts 同款，不新造写法。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[migrate:status] failed:', err)
    process.exitCode = 1
  })
}
