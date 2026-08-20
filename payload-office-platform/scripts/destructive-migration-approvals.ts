/**
 * 破坏性迁移（DROP TABLE / DROP COLUMN）批准清单的读取与匹配逻辑。
 *
 * 三处闸门共用这一个模块，进而共用同一份数据源
 * `payload-office-platform/DESTRUCTIVE_MIGRATION_APPROVALS.json`：
 *   - scripts/preflight.ts（`checkMigrations` / `pnpm exec tsx scripts/preflight.ts migrations`，CI 直接跑）
 *   - scripts/migrate-dry-run.ts（`pnpm migrate:dry-run`，CI 直接跑）
 *   - tests/preflight-migrations.test.ts（`pnpm test`，经由 preflight.ts 导出的函数间接调用本模块）
 *
 * 本文件本身不含任何具体迁移名——谁被批准、批准了什么，只在上面那份 JSON 数据
 * 文件里，改这个文件不需要认识任何一条具体迁移。
 *
 * 批准不是只认迁移名：`isDestructiveRiskApproved` 要求「迁移名 + 风险类别 + 出现
 * 次数」三者同时精确匹配（内容指纹）。`approvedRiskCounts` 记录的是批准当时
 * up() 里该类别风险的确切出现次数；之后如果同一份迁移文件又新增了同类风险（例如
 * 再加一条 DROP TABLE），次数对不上，新增的那条不会被静默放行——必须重新审查并
 * 更新批准记录里的次数。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = pathDirname(fileURLToPath(import.meta.url))

/** 批准清单文件路径：仓库顶层（payload-office-platform/ 目录下），三处闸门共读。 */
export const APPROVALS_FILE_PATH = resolve(here, '..', 'DESTRUCTIVE_MIGRATION_APPROVALS.json')

/** 风险类别——只有落在这两类之一的 fail/block 级风险才可能被批准清单放行。 */
export type DestructiveRiskKind = 'DROP_TABLE' | 'DROP_COLUMN'

export type DestructiveMigrationApprovalEntry = {
  migrationName: string
  approvedIn: string
  approvedWhat: string
  impact: string
  approvedRiskCounts: Partial<Record<DestructiveRiskKind, number>>
}

type ApprovalsFile = {
  purpose: string
  approvals: DestructiveMigrationApprovalEntry[]
}

/** 读取并解析批准清单；文件不存在或为空数组都视为「没有任何批准」，不是错误。 */
export function loadDestructiveMigrationApprovals(): DestructiveMigrationApprovalEntry[] {
  if (!existsSync(APPROVALS_FILE_PATH)) return []
  const raw = readFileSync(APPROVALS_FILE_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as ApprovalsFile
  return Array.isArray(parsed.approvals) ? parsed.approvals : []
}

/**
 * 某条迁移里「风险类别 kind」命中 matchCount 次，是否恰好被批准清单覆盖。
 *
 * 必须完全相等（不是 >=）：批准记录的是批准当时的真实次数，出现次数变了（不管
 * 增加还是减少）都说明当前代码和当时被批准的那份不是同一件事，一律视为未批准，
 * 交由默认规则继续拦截。
 *
 * `approvals` 参数可选，默认读真实清单文件；测试可以传入构造好的数组，
 * 不依赖磁盘 I/O 就能验证匹配逻辑本身。
 */
export function isDestructiveRiskApproved(
  migrationName: string,
  kind: DestructiveRiskKind,
  matchCount: number,
  approvals: DestructiveMigrationApprovalEntry[] = loadDestructiveMigrationApprovals(),
): boolean {
  const entry = approvals.find((a) => a.migrationName === migrationName)
  if (!entry) return false
  return entry.approvedRiskCounts[kind] === matchCount
}
