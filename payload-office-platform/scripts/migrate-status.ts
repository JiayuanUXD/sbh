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
}

main().catch((err) => {
  console.error('[migrate:status] failed:', err)
  process.exitCode = 1
})
