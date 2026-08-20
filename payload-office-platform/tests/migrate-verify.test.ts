import { describe, expect, it } from 'vitest'

import { extractUpBody } from '../scripts/migrate-verify'

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
