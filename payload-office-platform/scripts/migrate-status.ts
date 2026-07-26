/**
 * M0 迁移状态报告：列出已应用 / 待应用迁移，并对比代码与数据库状态。
 *
 * 业务约束：
 *   - PG 共享库 push: false，只走显式迁移
 *   - SQLite 本地 dev 模式自动同步 schema，迁移跟踪主要给 PG 生产用
 *   - AGENTS.md §9：每次迁移必须提供 dry-run、影响数量、校验结果和回滚说明
 *
 * 安全原则：
 *   - 只读，不写数据
 *   - PG 环境：通过 Payload Local API 读 payload_migrations 表
 *   - SQLite 环境：列出代码迁移清单，提示本地 dev 模式不严格跟踪
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

  // 动态加载 Payload，避免在 SQLite / 未设置 DATABASE_URL 时初始化
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

type StatusReport = {
  generatedAt: string
  database:
    | { kind: 'sqlite'; note: string }
    | { kind: 'postgres'; urlMasked: string }
  codeMigrations: string[]
  appliedMigrations: AppliedMigration[]
  pendingMigrations: string[]
}

// biome-ignore lint/suspicious/noConsole: CLI script
async function main() {
  const databaseUrl = process.env.DATABASE_URL || ''
  const isPg = databaseUrl.startsWith('postgres')
  const codeMigrations = listMigrationNames()
  const appliedMigrations = isPg ? (await readAppliedFromPg()) ?? [] : []

  const appliedNames = new Set(appliedMigrations.map((m) => m.name))
  const pendingMigrations = codeMigrations.filter((n) => !appliedNames.has(n))

  const report: StatusReport = {
    generatedAt: new Date().toISOString(),
    database: isPg
      ? { kind: 'postgres', urlMasked: databaseUrl.replace(/:[^:@/]+@/, ':****@') }
      : {
          kind: 'sqlite',
          note: '本地 SQLite dev 模式自动同步 schema；不严格跟踪已应用迁移。请用 PG 环境验证',
        },
    codeMigrations,
    appliedMigrations,
    pendingMigrations,
  }

  console.log('=== Migration Status ===')
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Database:  ${report.database.kind}`)
  if (report.database.kind === 'postgres') {
    console.log(`  URL: ${report.database.urlMasked}`)
  } else {
    console.log(`  ${report.database.note}`)
  }
  console.log('')
  console.log(`Code migrations:   ${codeMigrations.length}`)
  if (isPg) {
    console.log(`Applied migrations: ${appliedMigrations.length}`)
    console.log(`Pending migrations: ${pendingMigrations.length}`)
  } else {
    console.log(`Applied migrations: n/a (SQLite dev mode)`)
    console.log(`Pending migrations: n/a (SQLite dev mode)`)
  }

  console.log('')
  console.log('Code migrations:')
  for (const name of codeMigrations) {
    const applied = appliedNames.has(name)
    const tag = isPg ? (applied ? '✓ applied' : '○ pending') : '? unknown (SQLite)'
    console.log(`  [${tag}] ${name}`)
  }

  if (isPg && pendingMigrations.length > 0) {
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
}

main().catch((err) => {
  console.error('[migrate:status] failed:', err)
  process.exitCode = 1
})
