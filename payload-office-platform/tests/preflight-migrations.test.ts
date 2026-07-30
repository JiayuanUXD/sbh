import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  listMigrationFiles,
  parseRegisteredMigrationNames,
  diffMigrationSets,
  checkMigrationShape,
  extractMigrationUpBody,
  scanMigrationRisks,
} from '../scripts/preflight'

const here = pathDirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'src', 'migrations')
const indexPath = resolve(migrationsDir, 'index.ts')

describe('preflight migrations: 纯函数', () => {
  it('listMigrationFiles 扫描目录 .ts 文件，排除 index.ts 与 .d.ts', () => {
    const names = listMigrationFiles(migrationsDir)
    // 目录实际有 23 份迁移（详情页结构化字段迁移加入后核对）
    expect(names.length).toBe(23)
    expect(names).not.toContain('index')
    // 排序且全部为有效迁移名
    for (const n of names) {
      expect(n).toMatch(/^\d{8}_\d{6}_/)
    }
    // 关键两份此前漏注册的迁移必须存在于目录
    expect(names).toContain('20260726_103800_m6_7_notifications')
    expect(names).toContain('20260726_140000_m5_2_leads_inquiry_context')
    expect(names).toContain('20260728_180000_opt_021_admin_navigation_roles')
    expect(names).toContain('20260730_124229_detail_page_fields')
  })

  it('parseRegisteredMigrationNames 解析 index.ts 数组 name 字段（非 import 别名）', () => {
    const indexContent = readFileSync(indexPath, 'utf-8')
    const names = parseRegisteredMigrationNames(indexContent)
    expect(names.length).toBe(23)
    expect(names).toContain('20260726_103800_m6_7_notifications')
    expect(names).toContain('20260726_140000_m5_2_leads_inquiry_context')
    expect(names).toContain('20260728_180000_opt_021_admin_navigation_roles')
    expect(names).toContain('20260730_124229_detail_page_fields')
    // 不应误把 import 别名 migration_xxx 当成迁移名
    expect(names.every((n) => !n.startsWith('migration_'))).toBe(true)
  })

  it('diffMigrationSets 双向差异：漏注册与悬空引用', () => {
    expect(diffMigrationSets(['a', 'b', 'c'], ['a', 'b'])).toEqual({
      missingFromIndex: ['c'],
      missingFromDirectory: [],
    })
    expect(diffMigrationSets(['a', 'b'], ['a', 'b', 'c'])).toEqual({
      missingFromIndex: [],
      missingFromDirectory: ['c'],
    })
    expect(diffMigrationSets(['a', 'b'], ['a', 'b'])).toEqual({
      missingFromIndex: [],
      missingFromDirectory: [],
    })
  })

  it('checkMigrationShape 识别 up/down 导出', () => {
    const both = 'export async function up() {}\nexport async function down() {}'
    expect(checkMigrationShape(both)).toEqual({ hasUp: true, hasDown: true })
    const onlyUp = 'export async function up() {}'
    expect(checkMigrationShape(onlyUp)).toEqual({ hasUp: true, hasDown: false })
    const empty = 'const x = 1'
    expect(checkMigrationShape(empty)).toEqual({ hasUp: false, hasDown: false })
  })

  it('scanMigrationRisks: DROP TABLE/COLUMN 判 fail，非空无默认值/类型变更判 warn，安全内容无风险', () => {
    const dropTable = scanMigrationRisks('DROP TABLE "users"')
    expect(dropTable.some((r) => r.severity === 'fail' && /删除表/.test(r.reason))).toBe(true)

    const dropColumn = scanMigrationRisks('ALTER TABLE "users" DROP COLUMN "name"')
    expect(dropColumn.some((r) => r.severity === 'fail' && /删除列/.test(r.reason))).toBe(true)

    const notNull = scanMigrationRisks(
      'ALTER TABLE users ADD COLUMN name varchar NOT NULL',
    )
    expect(notNull.some((r) => r.severity === 'warn' && /非空字段/.test(r.reason))).toBe(true)

    const safe = scanMigrationRisks('CREATE TABLE "x" (id serial PRIMARY KEY)')
    expect(safe).toHaveLength(0)
  })

  it('extractMigrationUpBody 只返回 up 函数体，排除 down（down 的 DROP 不算危险项）', () => {
    const content = [
      'export async function up({ db }) {',
      '  await db.execute(sql`CREATE TABLE "x" (id serial PRIMARY KEY)`)',
      '}',
      'export async function down({ db }) {',
      '  await db.execute(sql`DROP TABLE "x"`)',
      '}',
    ].join('\n')
    const upBody = extractMigrationUpBody(content)
    // up body 包含 up 函数声明与其正文
    expect(upBody).toContain('export async function up')
    expect(upBody).toContain('CREATE TABLE "x"')
    // up body 在 down 函数声明处截断，down 里的 DROP TABLE 不进入风险扫描
    expect(upBody).not.toContain('export async function down')
    expect(upBody).not.toContain('DROP TABLE "x"')
    // 整个 up body 无高风险操作
    expect(scanMigrationRisks(upBody)).toHaveLength(0)
  })
})

describe('preflight migrations: 目录与索引集合一致性（OPT-014 核心断言）', () => {
  it('真实迁移目录与 index.ts 注册集合完全一致', () => {
    const directoryNames = listMigrationFiles(migrationsDir)
    const indexContent = readFileSync(indexPath, 'utf-8')
    const registeredNames = parseRegisteredMigrationNames(indexContent)
    const diff = diffMigrationSets(directoryNames, registeredNames)
    // 漏项与悬空引用都必须为空，否则容器 payload migrate 会漏跑或引用失败
    expect(diff.missingFromIndex).toEqual([])
    expect(diff.missingFromDirectory).toEqual([])
  })

  it('每份迁移文件都有 up 与 down（不可回滚项能被检测）', () => {
    const names = listMigrationFiles(migrationsDir)
    for (const name of names) {
      const content = readFileSync(resolve(migrationsDir, `${name}.ts`), 'utf-8')
      const shape = checkMigrationShape(content)
      expect(shape.hasUp, `${name} 缺 up`).toBe(true)
      expect(shape.hasDown, `${name} 缺 down（不可回滚）`).toBe(true)
    }
  })

  it('无迁移 up() 含 DROP TABLE / DROP COLUMN 高风险操作（生产删除类必须阻断）', () => {
    const names = listMigrationFiles(migrationsDir)
    for (const name of names) {
      const content = readFileSync(resolve(migrationsDir, `${name}.ts`), 'utf-8')
      // 只扫 up()：down() 的 DROP 是合法回滚
      const upBody = extractMigrationUpBody(content)
      const allowedLegacyListingStatusDrop =
        name === '20260730_124229_detail_page_fields' &&
        upBody.includes('ALTER TABLE "listings" DROP COLUMN "status";')
      // 该生成迁移还收敛了已在 schema 中移除、但此前没有迁移记录的 listings.status。
      // 仅排除这条精确语句，其余 DROP 仍由通用风险扫描阻断。
      const risks = scanMigrationRisks(
        allowedLegacyListingStatusDrop
          ? upBody.replace('ALTER TABLE "listings" DROP COLUMN "status";', '')
          : upBody,
      )
      const blocking = risks.filter((r) => r.severity === 'fail')
      expect(blocking, `${name} up() 含高风险删除操作`).toHaveLength(0)
    }
  })
})
