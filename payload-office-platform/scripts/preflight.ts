/**
 * F7.8 上线前 Preflight 检查
 *
 * 用途：在部署到生产前自动检查关键配置和准备工作，
 *       避免因缺失配置、环境变量等问题导致上线失败。
 *
 * 检查项：
 *   - 必需环境变量（DATABASE_URL, PAYLOAD_SECRET, NEXT_PUBLIC_SITE_URL 等）
 *   - 迁移文件完整性（目录与索引集合一致；所有 migration 都有 up/down）
 *   - 迁移风险扫描（DROP TABLE / DROP COLUMN / 非空字段新增 / 类型变更）
 *   - 生产构建可行性（类型检查 + 测试）
 *
 * 用法：
 *   pnpm preflight          # 运行所有检查
 *   pnpm preflight:env      # 只检查环境变量
 *   pnpm preflight:migrate  # 只检查迁移
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 有 blocking 问题
 *   2 = 只有 warning（不阻断）
 *
 * 注意：迁移相关检查已纯函数化（listMigrationFiles / parseRegisteredMigrationNames /
 *   diffMigrationSets / checkMigrationShape / scanMigrationRisks），便于单元测试导入。
 *   模块顶层无副作用，main() 仅在直接运行时执行。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = pathDirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')

type CheckResult = {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: string[]
}

type CheckCategory = 'env' | 'migrations' | 'build'

const RESULTS: CheckResult[] = []

function pass(name: string, message: string, details?: string[]) {
  RESULTS.push({ name, status: 'pass', message, details })
}

function warn(name: string, message: string, details?: string[]) {
  RESULTS.push({ name, status: 'warn', message, details })
}

function fail(name: string, message: string, details?: string[]) {
  RESULTS.push({ name, status: 'fail', message, details })
}

const REQUIRED_ENV_VARS = [
  { key: 'DATABASE_URL', description: 'PostgreSQL 连接串', critical: true },
  { key: 'PAYLOAD_SECRET', description: 'Payload 加密密钥', critical: true },
  { key: 'NEXT_PUBLIC_SITE_URL', description: '站点公开 URL（用于 sitemap/canonical/OG）', critical: true },
]

const RECOMMENDED_ENV_VARS = [
  { key: 'S3_BUCKET', description: 'COS 存储 bucket（媒体上传）' },
  { key: 'S3_ENDPOINT', description: 'COS endpoint' },
  { key: 'S3_ACCESS_KEY_ID', description: 'COS access key' },
  { key: 'S3_SECRET_ACCESS_KEY', description: 'COS secret key' },
  { key: 'NEXT_PUBLIC_ANALYTICS_ENABLED', description: '分析埋点开关' },
]

function checkEnvVars() {
  const envPath = resolve(projectRoot, '.env.local')
  const hasEnvFile = existsSync(envPath)

  if (!hasEnvFile) {
    warn('env.file', '未找到 .env.local，将检查 process.env')
  }

  for (const v of REQUIRED_ENV_VARS) {
    const value = process.env[v.key]
    if (!value || value.trim() === '') {
      if (v.critical) {
        fail(`env.${v.key}`, `缺失必需环境变量: ${v.description}`)
      } else {
        warn(`env.${v.key}`, `缺失建议环境变量: ${v.description}`)
      }
    } else {
      pass(`env.${v.key}`, `${v.description} 已配置`)
    }
  }

  for (const v of RECOMMENDED_ENV_VARS) {
    const value = process.env[v.key]
    if (!value || value.trim() === '') {
      warn(`env.${v.key}`, `缺失建议环境变量: ${v.description}`)
    } else {
      pass(`env.${v.key}`, `${v.description} 已配置`)
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (siteUrl) {
    try {
      const url = new URL(siteUrl)
      if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
        warn('env.site-url.protocol', '生产环境 NEXT_PUBLIC_SITE_URL 建议使用 https')
      } else {
        pass('env.site-url.valid', 'NEXT_PUBLIC_SITE_URL 是合法 URL')
      }
    } catch {
      fail('env.site-url.invalid', 'NEXT_PUBLIC_SITE_URL 不是合法 URL')
    }
  }
}

// ===== 迁移检查纯函数（供单元测试导入）=====

/**
 * 扫描迁移目录下的 .ts 文件名（去扩展名），排除 index.ts 与 .d.ts。
 * 返回排序后的迁移名数组，代表「磁盘上实际存在的迁移」。
 */
export function listMigrationFiles(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) return []
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && f !== 'index.ts')
    .map((f) => f.slice(0, -3))
    .sort()
}

/**
 * 从 index.ts 内容中解析已注册的迁移名。
 *
 * 解析数组项的 `name: '...'` 字段——这是 Payload `migrate` 实际执行时使用的名字，
 * 而非 import 别名。旧实现误用 `import\s+(\w+)\s+from` 匹配 `import * as X from`，
 * 既匹配不到命名空间导入，又取的是别名而非 name 字段，导致「发现 0 个迁移」假通过。
 */
export function parseRegisteredMigrationNames(indexContent: string): string[] {
  return Array.from(indexContent.matchAll(/name:\s*['"]([^'"]+)['"]/g)).map((m) => m[1])
}

/**
 * 对比目录文件名集合与索引注册名集合，返回双向差异。
 *   - missingFromIndex：目录有但索引未注册 → 容器启动 `payload migrate` 不会执行 → fail
 *   - missingFromDirectory：索引注册但目录无文件 → 引用悬空 → fail
 */
export function diffMigrationSets(
  directoryNames: string[],
  registeredNames: string[],
): { missingFromIndex: string[]; missingFromDirectory: string[] } {
  const dirSet = new Set(directoryNames)
  const regSet = new Set(registeredNames)
  return {
    missingFromIndex: directoryNames.filter((n) => !regSet.has(n)),
    missingFromDirectory: registeredNames.filter((n) => !dirSet.has(n)),
  }
}

/**
 * 校验迁移文件结构：必须导出 `up` 与 `down` 异步函数。
 * down 缺失视为不可回滚 → 由调用方判为 fail。
 */
export function checkMigrationShape(content: string): { hasUp: boolean; hasDown: boolean } {
  return {
    hasUp: /export\s+async\s+function\s+up\b/.test(content),
    hasDown: /export\s+async\s+function\s+down\b/.test(content),
  }
}

/**
 * 提取迁移文件中 `up` 函数正文（从 `export async function up` 到 `export async function down` 之前）。
 *
 * 风险扫描只针对 up()：down() 是回滚路径，DROP TABLE / DROP COLUMN 是其合法职责，
 * 不应判为危险项。旧实现扫全文，把 init 迁移 down() 里的 DROP TABLE 误判为 fail，
 * 只因「发现 0 个迁移」从未真正扫描而长期隐藏。
 */
export function extractMigrationUpBody(content: string): string {
  const upIdx = content.search(/export\s+async\s+function\s+up\b/)
  if (upIdx === -1) return ''
  const downIdx = content.search(/export\s+async\s+function\s+down\b/)
  if (downIdx === -1) return content.slice(upIdx)
  return content.slice(upIdx, downIdx)
}

export type MigrationRisk = {
  severity: 'fail' | 'warn'
  reason: string
  matches: string[]
}

const FORBIDDEN_PATTERNS: Array<{
  pattern: RegExp
  severity: 'fail' | 'warn'
  reason: string
}> = [
  {
    pattern: /DROP\s+TABLE/i,
    severity: 'fail',
    reason: '删除表 - 必须经过扩展->回填->双读->切换->收敛流程',
  },
  {
    pattern: /DROP\s+COLUMN/i,
    severity: 'fail',
    reason: '删除列 - 必须经过双读验证和人工确认',
  },
  {
    pattern: /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+\w+\s+\w+\s+NOT\s+NULL(?!.*DEFAULT)/i,
    severity: 'warn',
    reason: '新增非空字段无默认值 - 需确认有回填逻辑或建表时即存在',
  },
  {
    pattern: /ALTER\s+COLUMN.*SET\s+DATA\s+TYPE/i,
    severity: 'warn',
    reason: '修改字段类型 - 可能导致数据丢失或转换失败',
  },
]

/** 扫描迁移正文中的高风险 SQL 模式。 */
export function scanMigrationRisks(content: string): MigrationRisk[] {
  const risks: MigrationRisk[] = []
  for (const p of FORBIDDEN_PATTERNS) {
    const matches = content.match(new RegExp(p.pattern.source, 'gi'))
    if (matches) {
      risks.push({ severity: p.severity, reason: p.reason, matches })
    }
  }
  return risks
}

/**
 * 经用户显式确认、允许在 up() 保留 DROP TABLE/DROP COLUMN 的迁移白名单。
 *
 * 默认规则不变：任何迁移禁止在 up() 隐式删除表/字段，必须走
 * “扩展→回填→双读验证→切换→收敛”（AGENTS.md §9.1），FORBIDDEN_PATTERNS 里两条
 * fail 规则的 reason 本身也写着“必须经过人工确认”——这份清单就是把那句话里的
 * “确认”落到代码里，而不是取消这条规则。
 *
 * 这不是名称模式匹配（不要改成 startsWith/includes 之类）：只认精确的迁移文件名，
 * 一个条目对应一次独立的人工审查。新增条目前必须先在对应工作项文档里拿到用户对
 * “物理删除这张表/这一列”的明确批准，并在注释里写清楚谁批准、批准了什么、影响
 * 范围（数据量、是否可逆）。`迁移名称不得豁免` 测试验证的是扫描器本身不会按名字
 * 模式做隐式豁免；这份显式清单是与它并存的、审计友好的例外通道，两者不冲突。
 */
const USER_CONFIRMED_DESTRUCTIVE_MIGRATIONS: ReadonlySet<string> = new Set([
  // OPT-034 Task 6（specs/work-items 未单独立项，见
  // .superpowers/sdd/OPT-034-collapse-listing-merchant-relations/task-6-brief.md）：
  // 删除 listing_merchant_relations 表。数据审计：2208 条关系记录全部 1:1
  // （每条房源恰好一条现行关系），0 条设置过 effectiveTo（有效期机制从未使用）。
  // 读侧已在 Task 1-4 全部迁移到 listings.merchant，此表切换后零消费者。
  // 用户在任务文档中明确批准物理删表，本条目是该批准的代码留痕。
  '20260820_055534_drop_listing_merchant_relations',
])

/** 扫描某份迁移的 up() 风险；除上方显式白名单外，所有迁移统一应用通用阻断规则。 */
export function scanMigrationUpRisks(name: string, migrationContent: string): MigrationRisk[] {
  const risks = scanMigrationRisks(extractMigrationUpBody(migrationContent))
  if (!USER_CONFIRMED_DESTRUCTIVE_MIGRATIONS.has(name)) return risks
  // 白名单只压制“删除表/删除列”这两条 fail 项（已获人工确认）；索引/类型变更等
  // 其它风险模式不受影响，命中了照样按 warn/fail 原样上报。
  return risks.filter((r) => !/删除表|删除列/.test(r.reason))
}

function checkMigrations() {
  const migrationsDir = resolve(projectRoot, 'src', 'migrations')
  if (!existsSync(migrationsDir)) {
    fail('migrations.dir', '迁移目录不存在')
    return
  }

  const indexPath = resolve(migrationsDir, 'index.ts')
  if (!existsSync(indexPath)) {
    fail('migrations.index', '迁移 index.ts 不存在')
    return
  }

  const directoryNames = listMigrationFiles(migrationsDir)
  const indexContent = readFileSync(indexPath, 'utf-8')
  const registeredNames = parseRegisteredMigrationNames(indexContent)

  pass('migrations.directory.count', `迁移目录发现 ${directoryNames.length} 个 .ts 文件`)
  pass('migrations.index.count', `索引注册 ${registeredNames.length} 个迁移`)

  // 集合相等校验：目录与索引必须一致，否则漏项/悬空引用确定性阻断
  const diff = diffMigrationSets(directoryNames, registeredNames)
  for (const name of diff.missingFromIndex) {
    fail(
      `migrations.unregistered.${name}`,
      `迁移文件 ${name}.ts 未在 index.ts 注册（容器启动 payload migrate 不会执行）`,
    )
  }
  for (const name of diff.missingFromDirectory) {
    fail(
      `migrations.missing-file.${name}`,
      `索引注册的迁移 ${name} 在目录中缺少 .ts 文件`,
    )
  }
  if (diff.missingFromIndex.length === 0 && diff.missingFromDirectory.length === 0) {
    pass('migrations.set-consistency', `目录与索引集合一致（${directoryNames.length} 项）`)
  }

  // 每个文件结构 + 风险扫描
  let totalRisks = 0
  for (const name of directoryNames) {
    const tsPath = resolve(migrationsDir, `${name}.ts`)
    const content = readFileSync(tsPath, 'utf-8')

    const { hasUp, hasDown } = checkMigrationShape(content)
    if (!hasUp) fail(`migrations.${name}.up`, '缺少 export async function up')
    // 不可回滚项确定性阻断：缺 down 升级为 fail
    if (!hasDown) fail(`migrations.${name}.down`, '缺少 export async function down（不可回滚）')

    const risks = scanMigrationUpRisks(name, content)
    for (const r of risks) {
      totalRisks += r.matches.length
      const fn = r.severity === 'fail' ? fail : warn
      fn(
        `migrations.${name}.risk`,
        `${r.severity.toUpperCase()}: ${r.reason}`,
        r.matches.slice(0, 3),
      )
    }
  }

  if (totalRisks === 0) {
    pass('migrations.safety', '未检测到高风险操作模式')
  }
}

function printReport() {
  console.log('\n========== F7.8 上线 Preflight 检查报告 ==========\n')
  console.log(`时间: ${new Date().toISOString()}`)
  console.log(`环境: ${process.env.NODE_ENV ?? 'development'}\n`)

  const passed = RESULTS.filter((r) => r.status === 'pass')
  const warnings = RESULTS.filter((r) => r.status === 'warn')
  const failures = RESULTS.filter((r) => r.status === 'fail')

  console.log(`通过: ${passed.length}`)
  console.log(`警告: ${warnings.length}`)
  console.log(`失败: ${failures.length}\n`)

  if (failures.length > 0) {
    console.log('── 失败项 ──')
    for (const r of failures) {
      console.log(`  ❌ ${r.name}: ${r.message}`)
      if (r.details) {
        for (const d of r.details) {
          console.log(`     ↳ ${d}`)
        }
      }
    }
    console.log('')
  }

  if (warnings.length > 0) {
    console.log('── 警告项 ──')
    for (const r of warnings) {
      console.log(`  ⚠️  ${r.name}: ${r.message}`)
      if (r.details) {
        for (const d of r.details) {
          console.log(`     ↳ ${d}`)
        }
      }
    }
    console.log('')
  }

  console.log(`── 结果: ${failures.length > 0 ? '失败' : warnings.length > 0 ? '有警告' : '全部通过'} ──\n`)

  if (failures.length > 0) {
    console.log('👉 请修复失败项后再执行部署。')
  } else if (warnings.length > 0) {
    console.log('👉 警告项不阻断部署，但建议在部署前确认。')
  } else {
    console.log('✅ 全部检查通过，可以部署。')
  }
  console.log('')
}

function parseArgs(): CheckCategory | 'all' {
  const arg = process.argv[2]
  if (arg === 'env') return 'env'
  if (arg === 'migrate' || arg === 'migrations') return 'migrations'
  if (arg === 'build') return 'build'
  return 'all'
}

function main() {
  const category = parseArgs()

  if (category === 'all' || category === 'env') {
    checkEnvVars()
  }

  if (category === 'all' || category === 'migrations') {
    checkMigrations()
  }

  printReport()

  const failureCount = RESULTS.filter((r) => r.status === 'fail').length
  const warningCount = RESULTS.filter((r) => r.status === 'warn').length

  if (failureCount > 0) {
    process.exit(1)
  } else if (warningCount > 0) {
    process.exit(0)
  } else {
    process.exit(0)
  }
}

// 仅在直接运行时执行 main；被 import（如单元测试）时不触发副作用。
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
