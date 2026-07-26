import { describe, expect, it } from 'vitest'

import { extractFunctionBody } from '../scripts/migrate-dry-run'

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
