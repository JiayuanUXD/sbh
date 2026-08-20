/**
 * 破坏性迁移（DROP TABLE / DROP COLUMN）批准清单的读取与匹配逻辑。
 *
 * 四处闸门共用这一个模块，进而共用同一份数据源
 * `payload-office-platform/DESTRUCTIVE_MIGRATION_APPROVALS.json`：
 *   - scripts/preflight.ts（`checkMigrations` / `pnpm exec tsx scripts/preflight.ts migrations`，CI 直接跑）
 *   - scripts/migrate-dry-run.ts（`pnpm migrate:dry-run`，CI 直接跑）
 *   - scripts/migrate-verify.ts（`pnpm migrate:verify`，CI 直接跑）
 *   - tests/preflight-migrations.test.ts（`pnpm test`，经由 preflight.ts 导出的函数间接调用本模块）
 *
 * 本文件本身不含任何具体迁移名——谁被批准、批准了什么，只在上面那份 JSON 数据
 * 文件里，改这个文件不需要认识任何一条具体迁移。
 *
 * 批准是真正的内容指纹，不是只认迁移名、也不是只认「出现次数」：
 * `isDestructiveMigrationApproved` 对整份迁移 `.ts` 文件的**完整内容**取
 * SHA-256，要求与批准时记录的摘要逐字节一致才放行。哪怕迁移文件只改了一个字节
 * ——包括把 `DROP TABLE "listing_merchant_relations"` 换成
 * `DROP TABLE "listings"`、调整 down()、改一行注释——摘要都会变，批准立即失效，
 * 必须重新审查并更新 approvedFileSha256。
 *
 * 之所以哈希整份文件而不是只哈希 up() 函数体：三处调用方（preflight.ts /
 * migrate-dry-run.ts / migrate-verify.ts）各自有独立实现的 up() 提取算法
 * （历史遗留，互相并不共享），让批准机制依赖某一份提取实现的输出，等于让批准
 * 匹配结果绑定到一个可能存在差异的中间步骤上。直接对调用方都能拿到的原始
 * `readFileSync` 结果取哈希，不经过任何提取逻辑，天然与提取算法是否一致无关，
 * 也顺带把 down() 与文件其它部分的改动一并纳入指纹——对这种不可逆操作，宁可
 * 偏保守。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const here = pathDirname(fileURLToPath(import.meta.url))

/** 批准清单文件路径：仓库顶层（payload-office-platform/ 目录下），四处闸门共读。 */
export const APPROVALS_FILE_PATH = resolve(here, '..', 'DESTRUCTIVE_MIGRATION_APPROVALS.json')

/** 风险类别——只有落在这两类之一的破坏性风险才可能被批准清单放行。 */
export type DestructiveRiskKind = 'DROP_TABLE' | 'DROP_COLUMN'

export type DestructiveMigrationApprovalEntry = {
  migrationName: string
  approvedIn: string
  approvedWhat: string
  impact: string
  /** 批准时该迁移 .ts 文件完整内容的 SHA-256（十六进制小写）。真正的内容指纹。 */
  approvedFileSha256: string
}

type ApprovalsFile = {
  purpose: string
  approvals: DestructiveMigrationApprovalEntry[]
}

/** 读取并解析批准清单；文件不存在或数组为空都视为「没有任何批准」，不是错误。 */
export function loadDestructiveMigrationApprovals(): DestructiveMigrationApprovalEntry[] {
  if (!existsSync(APPROVALS_FILE_PATH)) return []
  const raw = readFileSync(APPROVALS_FILE_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as ApprovalsFile
  return Array.isArray(parsed.approvals) ? parsed.approvals : []
}

/** 对文本取 SHA-256，返回十六进制小写摘要。 */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * 这份迁移文件的当前内容是否与批准清单里记录的内容逐字节一致。
 *
 * `fileContent` 必须是调用方对该迁移 `.ts` 文件 `readFileSync` 得到的原始内容
 * （不要传提取过的 up() 子串——各调用方的提取算法互相独立，传子串会让不同闸门
 * 对同一份批准算出不同结果）。
 *
 * `approvals` 参数可选，默认读真实清单文件；测试可以传入构造好的数组，
 * 不依赖磁盘 I/O 就能验证匹配逻辑本身。
 */
export function isDestructiveMigrationApproved(
  migrationName: string,
  fileContent: string,
  approvals: DestructiveMigrationApprovalEntry[] = loadDestructiveMigrationApprovals(),
): boolean {
  const entry = approvals.find((a) => a.migrationName === migrationName)
  if (!entry) return false
  return sha256Hex(fileContent) === entry.approvedFileSha256
}

/**
 * 四道闸门拦下 DROP TABLE / DROP COLUMN 时，统一追加在 fail/block 文案后面的
 * 「下一步做什么」。
 *
 * 为什么必须有这一段：闸门的原始文案只讲“禁止删除表 / 必须经过扩展→回填→双读”，
 * 完全没提批准机制的存在。而由于批准指纹绑定的是整份迁移 .ts 文件的 SHA-256，
 * **最常见的红灯原因根本不是“你想删表”，而是“批准还在、但迁移文件改过一个字节”**
 * ——在迁移头注释里加一个空格就足以让四道闸同时变红，此时原文案指向的
 * “扩展→回填→双读”流程与真实原因毫无关系。第一次撞上的人如果只看到原文案，
 * 最省事的反应恰恰是 SKIP_PREPUSH=1、删掉迁移重新生成、或者再造一个绕过口。
 */
export const DESTRUCTIVE_APPROVAL_HINT =
  '【下一步】这次删除若已获用户明确批准：登记进仓库顶层 DESTRUCTIVE_MIGRATION_APPROVALS.json' +
  '（四道闸共读这一份，登记即放行，该文件的 diff 就是批准留痕）。' +
  '若清单里已经有这条迁移却仍被拦，那是指纹过期而不是缺批准——批准绑定的是整份 .ts 文件的 SHA-256，' +
  '连注释里多一个空格都会失效；跑 `pnpm migrate:approval-hash` 会逐条比对并打印新摘要，' +
  '确认改动仍在批准范围内后把新摘要写回该条目的 approvedFileSha256 即可。' +
  '不要用 SKIP_PREPUSH=1 / --no-verify 绕过，也不要删掉迁移重新生成（重新生成的文件指纹一样对不上，' +
  '还会丢掉迁移头注释里的批准背景）。机制详见 .agent/migrations.md「破坏性迁移的批准机制」。'

const migrationsDir = resolve(here, '..', 'src', 'migrations')

function migrationFileSha256(migrationName: string): string | null {
  const tsPath = resolve(migrationsDir, `${migrationName}.ts`)
  if (!existsSync(tsPath)) return null
  return sha256Hex(readFileSync(tsPath, 'utf-8'))
}

/**
 * `pnpm migrate:approval-hash [迁移名]`
 *
 * 不带参数：逐条比对清单里每条批准记录的 approvedFileSha256 与该迁移文件的当前
 * 内容，指纹过期的直接打印可粘贴的新摘要（这是撞上红灯后最常需要的那一步）。
 * 带迁移名：只打印该迁移文件当前内容的 SHA-256。
 */
// biome-ignore lint/suspicious/noConsole: CLI script
function main() {
  const arg = process.argv[2]

  if (arg) {
    const name = arg.replace(/^.*[\\/]/, '').replace(/\.ts$/, '')
    const actual = migrationFileSha256(name)
    if (!actual) {
      console.error(`找不到迁移文件：src/migrations/${name}.ts`)
      process.exitCode = 1
      return
    }
    console.log(actual)
    return
  }

  const approvals = loadDestructiveMigrationApprovals()
  console.log(`批准清单：${APPROVALS_FILE_PATH}`)
  if (approvals.length === 0) {
    console.log('（清单为空——当前没有任何破坏性迁移获批，四道闸对所有 DROP TABLE / DROP COLUMN 一律拦截）')
    return
  }

  let stale = 0
  for (const entry of approvals) {
    const actual = migrationFileSha256(entry.migrationName)
    if (!actual) {
      console.log(`✗ ${entry.migrationName}：清单里有这条批准，但 src/migrations/ 下找不到对应 .ts 文件`)
      stale++
      continue
    }
    if (actual === entry.approvedFileSha256) {
      console.log(`✓ ${entry.migrationName}：指纹一致，批准有效`)
      continue
    }
    console.log(`✗ ${entry.migrationName}：指纹已过期——迁移文件在批准之后被改动过`)
    console.log(`    清单记录: ${entry.approvedFileSha256}`)
    console.log(`    当前实际: ${actual}`)
    console.log('    → 先复核改动仍在用户批准的范围内，再把「当前实际」写回该条目的 approvedFileSha256')
    stale++
  }

  if (stale > 0) process.exitCode = 1
}

// 仅在作为脚本直接运行时执行；被四道闸门与测试 import 时不产生任何输出。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
