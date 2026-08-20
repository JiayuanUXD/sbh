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
