import { describe, expect, it } from 'vitest'

import {
  analyzeMigration,
  extractFunctionBody,
  listMigrationNames,
} from '../scripts/migrate-dry-run'
import { loadDestructiveMigrationApprovals } from '../scripts/destructive-migration-approvals'

/**
 * migrate-dry-run 提取器回归测试。
 * 修复前 extractFunctionBody 会命中解构参数 `{ db, payload, req }` 而非函数体，
 * 导致 SQL 正文从不被扫描、危险 DDL 永远误报 clean（见 memory: migrate-dry-run-bug）。
 */

const SAMPLE = `import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql\`ALTER TABLE "locations" ADD COLUMN "immutable_code" varchar NOT NULL;\`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql\`DROP TABLE "teams" CASCADE;\`)
}`

describe('extractFunctionBody', () => {
  it('提取 up() 的真实函数体而非解构参数', () => {
    const body = extractFunctionBody(SAMPLE, 'up')
    // 修复前会得到 " db, payload, req "；修复后应包含 SQL 正文。
    expect(body).toContain('ALTER TABLE "locations"')
    expect(body).not.toMatch(/^\s*db,\s*payload,\s*req\s*$/)
  })

  it('提取的 up() 正文可被禁止模式命中（ADD COLUMN … NOT NULL 无 DEFAULT）', () => {
    const body = extractFunctionBody(SAMPLE, 'up')
    expect(/ADD COLUMN(?!.*DEFAULT)[\s\S]*NOT NULL/i.test(body)).toBe(true)
  })

  it('提取 down() 的真实函数体', () => {
    const body = extractFunctionBody(SAMPLE, 'down')
    expect(body).toContain('DROP TABLE "teams"')
  })

  it('函数不存在时返回空串', () => {
    expect(extractFunctionBody('const x = 1', 'up')).toBe('')
  })
})

/**
 * 第二道闸（`pnpm migrate:dry-run`）本身的 blanket 断言。
 *
 * 与 tests/preflight-migrations.test.ts 里第 1、3 道闸的 blanket 断言对称：
 * 上面那组用例只测提取器，闸门逻辑（analyzeMigration 里 forbiddenHits /
 * approvedHits 的分流）此前一条断言都没有——把条件写反、或让 approved 恒真，
 * 闸门会静默全放行而 `pnpm test` 与 CI 全绿。
 *
 * 两个方向都锁：
 *   - 有批准（真实清单）→ 任何迁移都不得留下 block 级 forbiddenHit；
 *   - 无批准（传空清单）→ 已获批准的那几条迁移必须重新变成 block，approved 恒真、
 *     或提取器再次退化成只提取参数列表，都会立刻变红。
 */
describe('analyzeMigration：破坏性迁移闸门（blanket 断言）', () => {
  const blockingHits = (name: string, approvals?: Parameters<typeof analyzeMigration>[1]) =>
    analyzeMigration(name, approvals).forbiddenHits.filter((h) => h.severity === 'block')

  it('按真实批准清单，迁移目录里没有任何迁移产生 block 级 forbidden 命中', () => {
    for (const name of listMigrationNames()) {
      const blocking = blockingHits(name)
      expect(blocking.map((h) => h.reason), `${name} up() 含未获批准的阻断级操作`).toEqual([])
    }
  })

  it('清空批准清单后，清单里原本批准过的破坏性迁移必须重新被拦下', () => {
    const approvedNames = loadDestructiveMigrationApprovals().map((a) => a.migrationName)
    expect(approvedNames.length).toBeGreaterThan(0)

    for (const name of approvedNames) {
      const blocking = blockingHits(name, [])
      expect(
        blocking.length,
        `${name} 已获批准，但撤掉批准后这道闸没有拦住它——闸门失效或 up() 提取失效`,
      ).toBeGreaterThan(0)
      // 放行的命中不该凭空消失：撤批准后 approvedHits 必须清空，命中全部回到阻断侧。
      expect(analyzeMigration(name, []).approvedHits).toEqual([])
    }
  })

  it('每条 DROP TABLE / DROP COLUMN 阻断文案都指向批准清单与重算指纹的下一步', () => {
    const approvedNames = loadDestructiveMigrationApprovals().map((a) => a.migrationName)
    const reasons = approvedNames.flatMap((name) => blockingHits(name, []).map((h) => h.reason))
    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of reasons) {
      expect(reason).toContain('DESTRUCTIVE_MIGRATION_APPROVALS.json')
      expect(reason).toContain('approvedFileSha256')
      expect(reason).toContain('pnpm migrate:approval-hash')
    }
  })
})
