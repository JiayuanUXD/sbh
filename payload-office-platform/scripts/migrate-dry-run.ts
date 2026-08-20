/**
 * M0 迁移 dry-run：静态分析待应用迁移，检测禁止操作并估算影响行数。
 *
 * 业务不变量（AGENTS.md §9.1）：
 *   - 任何 Collection / 字段 / 索引 / 约束 / 关系变更都必须生成并提交显式迁移
 *   - 迁移采用“扩展 → 回填 → 双读验证 → 切换 → 收敛”
 *   - 未经用户明确确认，不得删除旧字段、表、索引或历史数据
 *   - 每次迁移必须提供 dry-run、影响数量、校验结果和回滚说明
 *   - 禁止迁移隐式删除旧字段或将旧房源自动视为审核通过（tasks.md M0.3）
 *
 * 安全原则：
 *   - 完全静态分析，不连接数据库
 *   - 不写任何数据
 *   - 输出待应用迁移清单 + 风险标记 + 回滚提示
 *
 * 运行：pnpm migrate:dry-run
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isDestructiveMigrationApproved,
  DESTRUCTIVE_APPROVAL_HINT,
  type DestructiveMigrationApprovalEntry,
  type DestructiveRiskKind,
} from './destructive-migration-approvals'

const here = pathDirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'src', 'migrations')

type ForbiddenPattern = {
  pattern: RegExp
  severity: 'block' | 'warn'
  reason: string
  /** 只有 DROP TABLE/DROP COLUMN 才带这个字段，才可能被批准清单放行；本文件不写死任何具体迁移名。 */
  kind?: DestructiveRiskKind
}

// 禁止操作模式（block = 必须人工确认后才能放行；warn = 提醒）
const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  {
    pattern: /DROP\s+TABLE/i,
    severity: 'block',
    reason: `禁止删除表；旧表应通过“扩展 → 回填 → 双读 → 切换 → 收敛”流程处理。${DESTRUCTIVE_APPROVAL_HINT}`,
    kind: 'DROP_TABLE',
  },
  {
    pattern: /DROP\s+COLUMN/i,
    severity: 'block',
    reason: `禁止删除字段（AGENTS.md §9.1）；旧字段保留双读，待用户明确确认后单独迁移。${DESTRUCTIVE_APPROVAL_HINT}`,
    kind: 'DROP_COLUMN',
  },
  {
    pattern: /DROP\s+INDEX/i,
    severity: 'warn',
    reason: '删除索引需确认是否影响查询性能；建议先停用再删除',
  },
  {
    pattern: /ALTER\s+COLUMN.*TYPE/i,
    severity: 'warn',
    reason: '修改字段类型可能丢数据；建议新增字段 + 回填 + 双读 + 切换',
  },
  {
    pattern: /ADD\s+COLUMN(?!.*DEFAULT).*NOT\s+NULL/i,
    severity: 'block',
    reason: '已有表新增无默认值的非空字段会导致升级失败；必须先可空扩展、回填，再设置 NOT NULL',
  },
  {
    pattern: /TRUNCATE/i,
    severity: 'block',
    reason: '禁止 TRUNCATE（AGENTS.md §5.5：不可变历史不得物理删除）',
  },
  {
    pattern: /DELETE\s+FROM/i,
    severity: 'warn',
    reason: 'DELETE 需要白名单条件；不可变历史不得物理删除',
  },
  // 业务级语义检测：旧房源不能自动视为审核通过
  {
    pattern: /UPDATE\s+listings\s+SET\s+review_status\s*=\s*'approved'/i,
    severity: 'block',
    reason: '禁止迁移隐式将旧房源自动审核通过（tasks.md M0.3）',
  },
  {
    pattern: /UPDATE\s+listings\s+SET\s+publication_status\s*=\s*'published'/i,
    severity: 'block',
    reason: '禁止迁移隐式将旧房源自动上架（AGENTS.md §5.1：只有显式发布动作才能上架）',
  },
]

type ForbiddenHit = {
  severity: 'block' | 'warn'
  pattern: string
  reason: string
  line: number
  snippet: string
  kind?: DestructiveRiskKind
}

type MigrationAnalysis = {
  name: string
  hasUp: boolean
  hasDown: boolean
  hasJson: boolean
  /** 未获批准、仍然阻断的命中项。 */
  forbiddenHits: ForbiddenHit[]
  /** 命中了 DROP TABLE/DROP COLUMN 但经批准清单精确匹配放行的命中项——
   * 不计入 blockingCount，但保留下来打印，方便审查者一眼看到"这里本来会拦，
   * 因为批准了才放行"，而不是让它悄悄消失。 */
  approvedHits: ForbiddenHit[]
}

type DryRunReport = {
  generatedAt: string
  database: { kind: 'postgres'; urlMasked: string }
  totalMigrations: number
  migrations: MigrationAnalysis[]
  blockingCount: number
  warningCount: number
  /** dry-run 不写数据；此字段用于未来按行估算影响行数（PG 环境下可扩展） */
  impactRowsEstimate: 'not-applicable-static-analysis'
  rollbackGuidance: string
}

function getDatabaseMeta() {
  const databaseUrl = process.env.DATABASE_URL || ''
  return { kind: 'postgres' as const, urlMasked: databaseUrl.replace(/:[^:@/]+@/, ':****@') }
}

/**
 * 分析单份迁移：提取 up() 正文、按 FORBIDDEN_PATTERNS 扫描、再按批准清单分流。
 *
 * 导出是为了让 tests/migrate-dry-run.test.ts 能对**闸门逻辑本身**下断言，而不是
 * 只测提取器——这道闸此前零覆盖：把下面的批准分流条件写反、或让 approved 恒真，
 * `pnpm test` 与 CI 都不会有任何反应，闸门会静默全放行。
 *
 * `approvals` 参数可选，默认读真实清单文件；测试传 `[]` 就能验证「没有批准时这道
 * 闸真的会拦」，传默认值则验证「有批准时不会误拦」，两个方向都锁住。
 */
export function analyzeMigration(
  name: string,
  approvals?: DestructiveMigrationApprovalEntry[],
): MigrationAnalysis {
  const tsPath = resolve(migrationsDir, `${name}.ts`)
  const jsonPath = resolve(migrationsDir, `${name}.json`)
  const ts = existsSync(tsPath) ? readFileSync(tsPath, 'utf8') : ''

  const rawHits: ForbiddenHit[] = []

  // 只检查 up() 函数体：forward 迁移禁止破坏性操作
  // down() 是回滚入口，DROP 是合法操作；AGENTS.md §9.1 的禁令针对 forward 迁移
  const upBody = extractFunctionBody(ts, 'up')
  const allLines = ts.split('\n')
  const upStartLine = allLines.findIndex((l) => /export\s+async\s+function\s+up/.test(l))
  const upLines = upBody.split('\n')

  for (let i = 0; i < upLines.length; i++) {
    const line = upLines[i]
    for (const p of FORBIDDEN_PATTERNS) {
      const m = line.match(p.pattern)
      if (m) {
        rawHits.push({
          severity: p.severity,
          pattern: m[0],
          reason: p.reason,
          line: upStartLine >= 0 ? upStartLine + 1 + i : i + 1,
          snippet: line.trim().slice(0, 120),
          kind: p.kind,
        })
      }
    }
  }

  // 批准清单是整份迁移 .ts 文件内容的 SHA-256——真正的内容指纹，不是只认
  // 迁移名、也不是只认出现次数：文件内容哪怕改一个字节（换掉 DROP TABLE 的
  // 目标表名、调整 down()）都会让批准失效，不会被静默放行。批准数据来自
  // DESTRUCTIVE_MIGRATION_APPROVALS.json，这个函数本身不含任何具体迁移名。
  const approved = isDestructiveMigrationApproved(name, ts, approvals)
  const forbiddenHits = rawHits.filter((h) => !(approved && h.kind))
  const approvedHits = rawHits.filter((h) => approved && h.kind)

  return {
    name,
    hasUp: /export\s+async\s+function\s+up/.test(ts),
    hasDown: /export\s+async\s+function\s+down/.test(ts),
    hasJson: existsSync(jsonPath),
    forbiddenHits,
    approvedHits,
  }
}

/** 提取指定函数体（从 `export async function name(` 开始到匹配的 `}` 结束） */
export function extractFunctionBody(source: string, name: 'up' | 'down'): string {
  const fnRegex = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`)
  const start = source.search(fnRegex)
  if (start < 0) return ''
  // 先跳过参数列表：从签名的 ( 起按圆括号深度匹配到闭合 )，
  // 否则解构参数 `{ db, payload, req }` 的 { 会被误当作函数体起点。
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
  // 函数体第一个 { 在签名闭合 ) 之后，按花括号深度匹配到最后一个 }
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

/** 本闸门的扫描范围来源：index.ts 里注册的迁移名。导出供 blanket 测试遍历同一批。 */
export function listMigrationNames(): string[] {
  const indexTsPath = resolve(migrationsDir, 'index.ts')
  if (!existsSync(indexTsPath)) return []
  const entries = readFileSync(indexTsPath, 'utf8')
  return Array.from(entries.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+'\.\/([^']+)'/g)).map(
    (m) => m[1],
  )
}

function generateReport(): DryRunReport {
  const names = listMigrationNames()
  // 显式单参调用：analyzeMigration 第二参是可选的 approvals，直接传给 map 会把
  // 下标当成批准清单传进去。
  const migrations = names.map((name) => analyzeMigration(name))
  const blockingCount = migrations.reduce(
    (acc, m) => acc + m.forbiddenHits.filter((h) => h.severity === 'block').length,
    0,
  )
  const warningCount = migrations.reduce(
    (acc, m) => acc + m.forbiddenHits.filter((h) => h.severity === 'warn').length,
    0,
  )

  return {
    generatedAt: new Date().toISOString(),
    database: getDatabaseMeta(),
    totalMigrations: migrations.length,
    migrations,
    blockingCount,
    warningCount,
    impactRowsEstimate: 'not-applicable-static-analysis',
    rollbackGuidance:
      '每个迁移必须提供 down() 函数；回滚前先在 PG 数据副本验证。' +
      '高风险回滚（含 DELETE / DROP）需用户明确确认。' +
      '回滚后立即执行 migrate:verify 校验数据完整性。',
  }
}

// biome-ignore lint/suspicious/noConsole: CLI script
function main() {
  const report = generateReport()
  console.log('=== Migration Dry-Run Report ===')
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Database:  ${report.database.kind}`)
  console.log(`Total migrations: ${report.totalMigrations}`)
  console.log(`Blocking hits:    ${report.blockingCount}`)
  console.log(`Warning hits:     ${report.warningCount}`)
  console.log('')

  for (const m of report.migrations) {
    console.log(`- ${m.name}`)
    console.log(`    up: ${m.hasUp}, down: ${m.hasDown}, json: ${m.hasJson}`)
    if (m.forbiddenHits.length === 0 && m.approvedHits.length === 0) {
      console.log('    no forbidden patterns')
      continue
    }
    for (const h of m.forbiddenHits) {
      const tag = h.severity === 'block' ? 'BLOCK' : 'WARN'
      console.log(`    [${tag}] L${h.line}: ${h.pattern}`)
      console.log(`      reason:  ${h.reason}`)
      console.log(`      snippet: ${h.snippet}`)
    }
    for (const h of m.approvedHits) {
      console.log(`    [APPROVED] L${h.line}: ${h.pattern} —— 见 DESTRUCTIVE_MIGRATION_APPROVALS.json`)
      console.log(`      reason:  ${h.reason}`)
      console.log(`      snippet: ${h.snippet}`)
    }
  }

  console.log('')
  console.log('Rollback guidance:')
  console.log(`  ${report.rollbackGuidance}`)

  if (report.blockingCount > 0) {
    console.log('')
    console.log(`❌ ${report.blockingCount} blocking issue(s) — 必须人工确认后才能执行迁移`)
    process.exitCode = 1
  } else if (report.warningCount > 0) {
    console.log('')
    console.log(`⚠️  ${report.warningCount} warning(s) — 复核后可继续`)
  } else {
    console.log('')
    console.log('✅ static analysis passed — no forbidden patterns detected')
  }
}

// 仅在作为脚本直接运行时执行；被测试 import 时不触发全库扫描。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
