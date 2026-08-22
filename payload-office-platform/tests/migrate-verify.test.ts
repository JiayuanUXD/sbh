import { describe, expect, it } from 'vitest'

import { extractUpBody, verifyStatic } from '../scripts/migrate-verify'
import { loadDestructiveMigrationApprovals } from '../scripts/destructive-migration-approvals'

/**
 * migrate-verify 提取器回归测试。
 *
 * 这是 2026-07-25 已经在 migrate-dry-run.ts 里修过的同一个 bug（见
 * tests/migrate-dry-run.test.ts 顶部注释），当时没有同步到这个文件：
 * 旧实现签名闭合后直接找第一个 `{`，命中的是解构参数 `{ db, payload, req }`
 * 而非真正的函数体。复评实测：57 份真实迁移里 55 份用这种解构签名，全部只提取到
 * 形如 " db, payload, req " 的参数列表，DROP TABLE/DROP COLUMN/TRUNCATE 扫描对
 * 它们形同虚设——`pnpm migrate:verify` 这道闸此前实际上没有在拦任何东西。
 *
 * 本文件此前零测试覆盖；这些用例锁定修复，不再回归。
 */

const SAMPLE = `import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql\`DROP TABLE "listing_merchant_relations" CASCADE;\`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql\`CREATE TABLE "listing_merchant_relations" (id serial PRIMARY KEY);\`)
}`

const SINGLE_PARAM_SAMPLE = `import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up(args: MigrateUpArgs): Promise<void> {
  await args.db.execute(sql\`DROP COLUMN "legacy_field";\`)
}

export async function down(args: MigrateDownArgs): Promise<void> {}`

describe('extractUpBody', () => {
  it('提取解构参数签名 up({ db, payload, req }) 的真实函数体而非参数列表', () => {
    const body = extractUpBody(SAMPLE)
    // 修复前会得到 " db, payload, req "；修复后应包含 SQL 正文。
    expect(body).toContain('DROP TABLE "listing_merchant_relations"')
    expect(body).not.toMatch(/^\s*db,\s*payload,\s*req\s*$/)
  })

  it('单参数签名 up(args) 本就不受这个 bug 影响，修复后仍正确提取', () => {
    const body = extractUpBody(SINGLE_PARAM_SAMPLE)
    expect(body).toContain('DROP COLUMN "legacy_field"')
  })

  it('函数不存在时返回空串', () => {
    expect(extractUpBody('const x = 1')).toBe('')
  })

  it('只提取 up()，不会把 down() 的内容也算进去', () => {
    const body = extractUpBody(SAMPLE)
    expect(body).not.toContain('CREATE TABLE')
  })
})

/**
 * 第四道闸（`pnpm migrate:verify` 的静态扫描）本身的 blanket 断言。
 *
 * 与 tests/preflight-migrations.test.ts 里第 1、3 道闸的 blanket 断言对称：
 * 上面那组用例只测提取器，闸门逻辑（`if (f.kind && approved)` 这条分流）此前一条
 * 断言都没有——把条件写反、或让 approved 恒真，闸门会静默全放行而 `pnpm test`
 * 与 CI 全绿。这正是这道闸刚被修好的那个毛病（提取器 bug 让它长期是死的），不能
 * 在批准分支上重演一遍。
 *
 * 两个方向都锁：
 *   - 有批准（真实清单）→ 不得有任何 forbidden fail，写反条件立刻变红；
 *   - 无批准（传空清单）→ 已获批准的那几条迁移必须重新被拦下，approved 恒真、
 *     或提取器再次退化成只提取参数列表，都会立刻变红。
 */
describe('verifyStatic：破坏性迁移闸门（blanket 断言）', () => {
  const forbiddenFails = (checks: ReturnType<typeof verifyStatic>) =>
    checks.filter((c) => c.status === 'fail' && c.name.includes(':forbidden:'))

  it('按真实批准清单，迁移目录里没有任何迁移产生 forbidden fail', () => {
    // 失败信息带上具体 message，直接告诉撞红灯的人下一步做什么。
    expect(forbiddenFails(verifyStatic()).map((c) => c.message)).toEqual([])
  })

  it('清空批准清单后，清单里原本批准过的破坏性迁移必须重新被拦下', () => {
    const approvedNames = loadDestructiveMigrationApprovals().map((a) => a.migrationName)
    // 仓库当前至少有一条获批的破坏性迁移（OPT-034 删表）；迁移文件只增不减，
    // 这个前置条件不会自然消失。为 0 说明有人清空了清单却没同步这条哨兵。
    expect(approvedNames.length).toBeGreaterThan(0)

    const blocked = forbiddenFails(verifyStatic([]))
    for (const name of approvedNames) {
      expect(
        blocked.some((c) => c.name.startsWith(`migration:${name}:forbidden:`)),
        `${name} 已获批准，但撤掉批准后这道闸没有拦住它——闸门失效或 up() 提取失效`,
      ).toBe(true)
    }
  })
})
