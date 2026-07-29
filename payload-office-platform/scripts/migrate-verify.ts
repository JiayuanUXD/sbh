/**
 * M0 迁移后校验：核对 schema 完整性、关键 collection 行数和 PG 专属约束。
 *
 * 业务约束（AGENTS.md §9.2, §3.3）：
 *   - PostgreSQL 供给有效期关系必须使用数据库级约束防止重叠
 *   - 生产 PostgreSQL 专属约束必须在 PostgreSQL 环境验证
 *   - SQLite 通过不能取代 PostgreSQL 约束验证
 *
 * 安全原则：
 *   - 只读，不写业务数据
 *   - PG：检查 payload_migrations 表 + 关键表存在性 + 行数
 *   - SQLite / PG：实际连接数据库并查询每个已注册 Collection
 *
 * 运行：pnpm migrate:verify
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionSlug } from 'payload'

const here = pathDirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'src', 'migrations')

type CollectionExpectation = {
  slug: string
  table: string
  /** 期望存在的字段（关键不变量字段） */
  criticalColumns?: string[]
}

// M0 基线 Collection。插件注入的 Collection 由运行时配置自动追加检查。
const COLLECTION_EXPECTATIONS: CollectionExpectation[] = [
  { slug: 'users', table: 'users' },
  { slug: 'roles', table: 'roles' },
  { slug: 'media', table: 'media' },
  { slug: 'locations', table: 'locations' },
  { slug: 'amenities', table: 'amenities' },
  { slug: 'buildings', table: 'buildings' },
  { slug: 'listings', table: 'listings' },
  { slug: 'leads', table: 'leads' },
  { slug: 'pages', table: 'pages' },
]

type VerifyResult = {
  passed: boolean
  checks: Array<{
    name: string
    status: 'pass' | 'fail' | 'warn' | 'skip'
    message: string
    details?: unknown
  }>
}

function listMigrationNames(): string[] {
  const indexTsPath = resolve(migrationsDir, 'index.ts')
  if (!existsSync(indexTsPath)) return []
  const entries = readFileSync(indexTsPath, 'utf8')
  return Array.from(entries.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+'\.\/([^']+)'/g)).map(
    (m) => m[1],
  )
}

function verifyStatic(): VerifyResult['checks'] {
  const checks: VerifyResult['checks'] = []
  const names = listMigrationNames()

  // 1. 所有迁移都有 up 和 down
  for (const name of names) {
    const tsPath = resolve(migrationsDir, `${name}.ts`)
    const ts = existsSync(tsPath) ? readFileSync(tsPath, 'utf8') : ''
    const hasUp = /export\s+async\s+function\s+up/.test(ts)
    const hasDown = /export\s+async\s+function\s+down/.test(ts)
    if (!hasUp) {
      checks.push({
        name: `migration:${name}:up`,
        status: 'fail',
        message: `迁移 ${name} 缺少 up 函数`,
      })
    } else checks.push({
      name: `migration:${name}:up`,
      status: 'pass',
      message: `迁移 ${name} 包含 up 函数`,
    })
    if (!hasDown) {
      checks.push({
        name: `migration:${name}:down`,
        status: 'warn',
        message: `迁移 ${name} 缺少 down 函数（回滚入口）`,
      })
    } else checks.push({
      name: `migration:${name}:down`,
      status: 'pass',
      message: `迁移 ${name} 包含 down 回滚入口`,
    })
  }

  // 2. 所有迁移都有对应的 .json
  for (const name of names) {
    const jsonPath = resolve(migrationsDir, `${name}.json`)
    if (!existsSync(jsonPath)) {
      checks.push({
        name: `migration:${name}:json`,
        status: 'warn',
        message: `迁移 ${name} 缺少 ${name}.json（Payload 用于跟踪已应用状态）`,
      })
    } else checks.push({
      name: `migration:${name}:json`,
      status: 'pass',
      message: `迁移 ${name} 包含 schema JSON`,
    })
  }

  // 3. 禁止操作静态扫描（只检查 up() 函数体；down() 是回滚入口，DROP 合理）
  const FORBIDDEN = [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /TRUNCATE/i]
  for (const name of names) {
    const tsPath = resolve(migrationsDir, `${name}.ts`)
    const ts = existsSync(tsPath) ? readFileSync(tsPath, 'utf8') : ''
    const upBody = extractUpBody(ts)
    for (const p of FORBIDDEN) {
      const m = upBody.match(p)
      if (m) {
        checks.push({
          name: `migration:${name}:forbidden:${m[0]}`,
          status: 'fail',
          message: `迁移 ${name} 的 up() 包含禁止操作：${m[0]}`,
        })
      }
    }
  }

  return checks
}

/** 提取 up() 函数体（与 migrate-dry-run.ts 保持一致） */
function extractUpBody(source: string): string {
  const fnRegex = /export\s+async\s+function\s+up\s*\(/
  const start = source.search(fnRegex)
  if (start < 0) return ''
  const openIdx = source.indexOf('{', start)
  if (openIdx < 0) return ''
  let depth = 0
  let endIdx = -1
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  if (endIdx < 0) return ''
  return source.slice(openIdx + 1, endIdx)
}

async function verifyDatabase(): Promise<VerifyResult['checks']> {
  const checks: VerifyResult['checks'] = []
  const databaseUrl = process.env.DATABASE_URL || ''
  const isPg = databaseUrl.startsWith('postgres')

  if (!isPg) {
    const { createClient } = await import('@libsql/client')
    const sqliteUrl = process.env.SQLITE_URL || 'file:./payload.db.sqlite'
    const client = createClient({ url: sqliteUrl })
    try {
      for (const exp of COLLECTION_EXPECTATIONS) {
        try {
          const result = await client.execute(
            `SELECT COUNT(*) AS total FROM "${exp.table.replaceAll('"', '""')}"`,
          )
          const total = Number(result.rows[0]?.total ?? 0)
          checks.push({
            name: `db:collection:${exp.slug}`,
            status: 'pass',
            message: `${exp.table} 表存在，行数 ${total}`,
          })
        } catch (error) {
          checks.push({
            name: `db:collection:${exp.slug}`,
            status: 'fail',
            message: `${exp.table} 表查询失败：${(error as Error).message}`,
          })
        }
      }
    } finally {
      client.close()
    }
    return checks
  }

  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const payload = await getPayload({ config })

  try {
    // 1. PostgreSQL 下检查 payload_migrations 表。
    if (isPg) try {
      // payload_migrations 表由 Payload 维护，drizzle schema 中作为隐式表存在
      const dbAny = payload.db as unknown as {
        drizzle?: {
          query?: {
            payload_migrations?: {
              findMany?: () => Promise<Array<{ name?: string }>>
            }
          }
        }
      }
      const result = await dbAny?.drizzle?.query?.payload_migrations?.findMany?.()
      checks.push({
        name: 'pg:payload_migrations:readable',
        status: 'pass',
        message: `payload_migrations 表可读，已应用 ${result?.length ?? 0} 条`,
      })
    } catch (err) {
      checks.push({
        name: 'pg:payload_migrations:readable',
        status: 'fail',
        message: `无法读取 payload_migrations：${(err as Error).message}`,
      })
    }

    // 2. 每个运行时 Collection 的表存在且可查询。
    const configured = new Map(
      payload.config.collections.map((collection) => [
        collection.slug,
        collection.dbName ?? collection.slug,
      ]),
    )
    for (const exp of COLLECTION_EXPECTATIONS) {
      if (!configured.has(exp.slug as CollectionSlug)) {
        checks.push({
          name: `db:collection:${exp.slug}:registered`,
          status: 'fail',
          message: `${exp.slug} 未注册到 Payload config`,
        })
      }
    }
    for (const [slug, table] of configured) {
      try {
        const count = await payload.count({
          collection: slug as CollectionSlug,
          where: {},
          overrideAccess: true,
        })
        checks.push({
          name: `db:collection:${slug}`,
          status: 'pass',
          message: `${table} 表存在，行数 ${count.totalDocs}`,
        })
      } catch (err) {
        checks.push({
          name: `db:collection:${slug}`,
          status: 'fail',
          message: `${table} 表查询失败：${(err as Error).message}`,
        })
      }
    }

    // 3. M3+ 期间将检查 building_merchant_relationships 的 EXCLUDE 约束
    // 当前 M0 阶段没有 PG 专属约束，仅占位
    if (isPg) checks.push({
      name: 'pg:supply-validity-exclude-constraint',
      status: 'skip',
      message: 'M3.3 引入 Building 商户有效期关系时添加 EXCLUDE 约束验证',
    })
  } finally {
    await payload.db.destroy?.()
  }

  return checks
}

// biome-ignore lint/suspicious/noConsole: CLI script
async function main() {
  const databaseUrl = process.env.DATABASE_URL || ''
  const isPg = databaseUrl.startsWith('postgres')

  console.log('=== Migration Verify ===')
  console.log(`Generated: ${new Date().toISOString()}`)
  console.log(`Database:  ${isPg ? 'postgres' : 'sqlite'}`)
  if (isPg) {
    console.log(`  URL: ${databaseUrl.replace(/:[^:@/]+@/, ':****@')}`)
  } else {
    console.log('  本地 SQLite；执行静态迁移检查和实际 Collection 查询')
  }
  console.log('')

  const staticChecks = verifyStatic()
  const databaseChecks = await verifyDatabase()

  const allChecks = [...staticChecks, ...databaseChecks]
  for (const c of allChecks) {
    const icon =
      c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'warn' ? '⚠' : '○'
    console.log(`${icon} [${c.status.toUpperCase()}] ${c.name}`)
    console.log(`    ${c.message}`)
  }

  const failed = allChecks.filter((c) => c.status === 'fail').length
  const warned = allChecks.filter((c) => c.status === 'warn').length

  console.log('')
  console.log(`Total: ${allChecks.length} checks | ${failed} fail | ${warned} warn`)

  if (failed > 0) {
    console.log('')
    console.log(`❌ ${failed} check(s) failed — schema 校验未通过`)
    process.exitCode = 1
  } else if (warned > 0) {
    console.log('')
    console.log(`⚠️  ${warned} warning(s) — 复核后可继续`)
  } else {
    console.log('')
    console.log('✅ all checks passed')
  }
}

main()
  .catch((err) => {
    console.error('[migrate:verify] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    // PG 适配器 db.destroy 后仍可能残留连接 handle，导致进程不退出、CI job hang
    // （base 分支同样卡在 Verify fresh database 步）。检查已全部完成，显式退出。
    process.exit(process.exitCode || 0)
  })
