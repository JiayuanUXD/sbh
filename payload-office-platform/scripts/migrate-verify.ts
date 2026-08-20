/**
 * M0 迁移后校验：核对 schema 完整性、关键 collection 行数和 PG 专属约束。
 *
 * 业务约束（AGENTS.md §9.2, §3.3）：
 *   - PostgreSQL 供给有效期关系必须使用数据库级约束防止重叠
 *   - 生产 PostgreSQL 专属约束必须在 PostgreSQL 环境验证
 *
 * 安全原则：
 *   - 只读，不写业务数据
 *   - PG：检查 payload_migrations 表 + 关键表存在性 + 行数
 *   - 实际连接 PostgreSQL 并查询每个已注册 Collection
 *
 * 运行：pnpm migrate:verify
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionSlug } from 'payload'

import {
  isDestructiveMigrationApproved,
  DESTRUCTIVE_APPROVAL_HINT,
  type DestructiveMigrationApprovalEntry,
  type DestructiveRiskKind,
} from './destructive-migration-approvals'

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

/**
 * 静态校验：迁移形状（up/down/json）+ up() 禁止操作扫描 + 批准清单分流。
 *
 * 导出是为了让 tests/migrate-verify.test.ts 能对**闸门逻辑本身**下断言，而不是
 * 只测 extractUpBody——这道闸此前零覆盖，而且它整整一段时间是死的（提取器 bug，
 * 见 extractUpBody 头注释）。把下面的 `f.kind && approved` 写反、或让 approved
 * 恒真，`pnpm test` 与 CI 都不会有任何反应，闸门会静默全放行。
 *
 * `approvals` 参数可选，默认读真实清单文件；测试传 `[]` 就能验证「没有批准时这道
 * 闸真的会拦」，传默认值则验证「有批准时不会误拦」，两个方向都锁住。
 */
export function verifyStatic(
  approvals?: DestructiveMigrationApprovalEntry[],
): VerifyResult['checks'] {
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

  // 3. 禁止操作静态扫描（只检查 up() 函数体；down() 是回滚入口，DROP 合理）。
  // DROP TABLE/DROP COLUMN 打了 kind 标签，才可能被批准清单放行；TRUNCATE
  // 没有 kind，这份批准清单永远管不到它。
  const FORBIDDEN: Array<{ pattern: RegExp; kind?: DestructiveRiskKind }> = [
    { pattern: /DROP\s+TABLE/i, kind: 'DROP_TABLE' },
    { pattern: /DROP\s+COLUMN/i, kind: 'DROP_COLUMN' },
    { pattern: /TRUNCATE/i },
  ]
  for (const name of names) {
    const tsPath = resolve(migrationsDir, `${name}.ts`)
    const ts = existsSync(tsPath) ? readFileSync(tsPath, 'utf8') : ''
    const upBody = extractUpBody(ts)
    // 批准清单是整份迁移 .ts 文件内容的 SHA-256——真正的内容指纹，不是只认
    // 迁移名。批准数据来自 DESTRUCTIVE_MIGRATION_APPROVALS.json，与
    // scripts/preflight.ts、scripts/migrate-dry-run.ts 共读同一份，本文件
    // 不写死任何具体迁移名。
    const approved = isDestructiveMigrationApproved(name, ts, approvals)
    for (const f of FORBIDDEN) {
      const m = upBody.match(f.pattern)
      if (m) {
        if (f.kind && approved) {
          checks.push({
            name: `migration:${name}:forbidden:${m[0]}`,
            status: 'pass',
            message: `迁移 ${name} 的 up() 包含 ${m[0]}，已获批准（见 DESTRUCTIVE_MIGRATION_APPROVALS.json）`,
          })
        } else {
          checks.push({
            name: `migration:${name}:forbidden:${m[0]}`,
            status: 'fail',
            message: f.kind
              ? `迁移 ${name} 的 up() 包含禁止操作：${m[0]}。${DESTRUCTIVE_APPROVAL_HINT}`
              : `迁移 ${name} 的 up() 包含禁止操作：${m[0]}（这一类不在批准清单的覆盖范围内，没有放行通道）`,
          })
        }
      }
    }
  }

  return checks
}

/**
 * 提取 up() 函数体。
 *
 * 2026-08-20 修复：旧实现签名闭合后直接找第一个 `{`，命中的是解构参数
 * `{ db, payload, req }` 而非真正的函数体——57 份迁移里 55 份用这种解构签名，
 * 全部只提取到形如 ` db, payload, req ` 的参数列表，DROP TABLE/DROP COLUMN 扫描
 * 对它们形同虚设（2026-07-25 migrate-dry-run.ts 的 extractFunctionBody 已经修过
 * 同一个 bug，当时没有同步到这里）。修法一致：先跳过参数列表——从签名的 `(`
 * 起按圆括号深度匹配到闭合 `)`，函数体真正的 `{` 在那之后。
 */
export function extractUpBody(source: string): string {
  const fnRegex = /export\s+async\s+function\s+up\s*\(/
  const start = source.search(fnRegex)
  if (start < 0) return ''
  const parenIdx = source.indexOf('(', start)
  if (parenIdx < 0) return ''
  let parenDepth = 0
  let sigEnd = -1
  for (let i = parenIdx; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(') parenDepth++
    else if (ch === ')') {
      parenDepth--
      if (parenDepth === 0) {
        sigEnd = i
        break
      }
    }
  }
  if (sigEnd < 0) return ''
  const openIdx = source.indexOf('{', sigEnd)
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

  const { getPayload } = await import('payload')
  const config = (await import('../src/payload.config')).default
  const payload = await getPayload({ config })

  try {
    // 1. 检查 payload_migrations 表。
    try {
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
    checks.push({
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

  console.log('=== Migration Verify ===')
  console.log(`Generated: ${new Date().toISOString()}`)
  console.log(`Database:  postgres`)
  console.log(`  URL: ${databaseUrl.replace(/:[^:@/]+@/, ':****@')}`)
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

// 仅在作为脚本直接运行时执行；被测试 import 时不触发数据库连接。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
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
}
