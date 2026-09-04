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
  scanMigrationUpRisks,
  applyDestructiveMigrationOverride,
} from '../scripts/preflight'

const here = pathDirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'src', 'migrations')
const indexPath = resolve(migrationsDir, 'index.ts')

describe('preflight migrations: 纯函数', () => {
  it('listMigrationFiles 扫描目录 .ts 文件，排除 index.ts 与 .d.ts', () => {
    const names = listMigrationFiles(migrationsDir)
    // 目录实际迁移份数。新增迁移时同步 +1（本行与下方 parseRegisteredMigrationNames 断言必须一致，
    // 二者不等即说明有迁移文件漏注册进 index.ts）。
    // 最近一批：OPT-035 的 opt035_city_profile_avg_response_hours（1 份），
    // 与 OPT-041 的 4 份（supply_import_batches / unique_indexes / role_permissions / job_task）。
    // 其中 job_task 那份说明了一件容易误判的事：把 task 注册进 jobs.tasks **需要迁移**——
    // payload_jobs(_log).task_slug 是真实 Postgres 枚举，不是「纯 config 改动」。
    // OPT-048 又加了 1 份 opt048_snapshot_chain_repair：它 **不改 schema**（ADD COLUMN
    // IF NOT EXISTS，任何库上都是空操作），存在的意义是它配套的 .json 快照——
    // 用来把被旧基线带偏的快照链修回与 config 对齐。详见该迁移的文件头注释与 OPT-048。
    // OPT-045 再加 1 份 opt045_import_publishable_fields：merchants.is_platform_default
    // （D2 平台自营商户标识）+ buildings.sale_unit_price（D1 在售单价，单值）。
    // OPT-053 再加 1 份 opt_053_site_settings：新建 site_settings 主表 + valueProps /
    // typeCards 两张 array 子表，另给 city_site_profiles 加 hero_video_id 与
    // hero_video_enabled 两个可空列（后者带 DEFAULT true，存量行由 PG 回填——
    // 否则迁移一跑，已开城首页的背景视频当场消失）。
    // OPT-054 再加 1 份 opt_054_nav_config：main_nav / footer_columns(_links) 三张
    // array 子表 + 两个目标枚举。**枚举意味着往 NAV_TARGETS 里加目标要配
    // ALTER TYPE ADD VALUE 迁移**，不能只改代码（见 nav-targets.ts 文件头）。
    expect(names.length).toBe(67)
    expect(names).not.toContain('index')
    // 排序且全部为有效迁移名
    for (const n of names) {
      expect(n).toMatch(/^\d{8}_\d{6}_/)
    }
    // 关键两份此前漏注册的迁移必须存在于目录
    expect(names).toContain('20260726_103800_m6_7_notifications')
    expect(names).toContain('20260726_140000_m5_2_leads_inquiry_context')
    expect(names).toContain('20260728_180000_opt_021_admin_navigation_roles')
    expect(names).toContain('20260730_125851_detail_page_fields')
    expect(names).toContain('20260730_134600_inquiry_detail_context')
    expect(names).toContain('20260803_104120_add_articles')
    expect(names).toContain('20260808_224000_articles_menu_for_ops')
    expect(names).toContain('20260809_142444_supply_submissions_and_entrust_source')
    expect(names).toContain('20260809_180000_supply_notification_duplicates_preflight')
    expect(names).toContain('20260809_183327_supply_submission_notification_unique')
    expect(names).toContain('20260809_203911_supply_submission_notification_jobs')
    expect(names).toContain('20260810_090000_supply_submission_role_permissions')
    expect(names).toContain('20260810_153500_landing_hero_media_assets')
    expect(names).toContain('20260810_170000_public_page_performance_indexes')
    expect(names).toContain('20260810_200000_backfill_location_city')
    expect(names).toContain('20260813_010000_city_site_profiles')
    expect(names).toContain('20260813_011000_seed_city_site_profiles')
    expect(names).toContain('20260813_020000_city_partner_applications')
    expect(names).toContain('20260813_021000_city_partner_permissions')
    expect(names).toContain('20260821_161534_supply_import_batches')
    expect(names).toContain('20260822_001600_supply_import_unique_indexes')
    expect(names).toContain('20260822_001700_supply_import_role_permissions')
    expect(names).toContain('20260822_010308_supply_import_job_task')
    expect(names).toContain('20260824_101016_opt048_snapshot_chain_repair')
    expect(names).toContain('20260824_110612_opt045_import_publishable_fields')
  })

  it('parseRegisteredMigrationNames 解析 index.ts 数组 name 字段（非 import 别名）', () => {
    const indexContent = readFileSync(indexPath, 'utf-8')
    const names = parseRegisteredMigrationNames(indexContent)
    expect(names.length).toBe(67)
    expect(names).toContain('20260904_141252_mp109_mini_user_assets')
    expect(names).toContain('20260810_003111_align_listings_data_source_with_production')
    expect(names).toContain('20260726_103800_m6_7_notifications')
    expect(names).toContain('20260726_140000_m5_2_leads_inquiry_context')
    expect(names).toContain('20260728_180000_opt_021_admin_navigation_roles')
    expect(names).toContain('20260730_125851_detail_page_fields')
    expect(names).toContain('20260730_134600_inquiry_detail_context')
    expect(names).toContain('20260803_104120_add_articles')
    expect(names).toContain('20260808_224000_articles_menu_for_ops')
    expect(names).toContain('20260809_142444_supply_submissions_and_entrust_source')
    expect(names).toContain('20260809_180000_supply_notification_duplicates_preflight')
    expect(names).toContain('20260809_183327_supply_submission_notification_unique')
    expect(names).toContain('20260809_203911_supply_submission_notification_jobs')
    expect(names).toContain('20260810_090000_supply_submission_role_permissions')
    expect(names).toContain('20260810_153500_landing_hero_media_assets')
    expect(names).toContain('20260810_170000_public_page_performance_indexes')
    expect(names).toContain('20260810_200000_backfill_location_city')
    expect(names).toContain('20260813_010000_city_site_profiles')
    expect(names).toContain('20260813_011000_seed_city_site_profiles')
    expect(names).toContain('20260813_020000_city_partner_applications')
    expect(names).toContain('20260813_021000_city_partner_permissions')
    expect(names).toContain('20260822_010308_supply_import_job_task')
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

  it('迁移名称不得豁免 up() 中的 legacy listings.status 删除', () => {
    const content = [
      'export async function up({ db }) {',
      '  await db.execute(sql`',
      '    ALTER TABLE "listings" DROP COLUMN "status";',
      '  `)',
      '}',
      'export async function down() {}',
    ].join('\n')

    const risks = scanMigrationUpRisks('20260730_125851_detail_page_fields', content)
    expect(risks.filter((risk) => risk.severity === 'fail')).toHaveLength(1)
    expect(risks[0]?.matches).toEqual(['DROP COLUMN'])
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

  it('通知重复数据只读预检严格位于复合唯一索引之前', () => {
    const names = parseRegisteredMigrationNames(readFileSync(indexPath, 'utf-8'))
    expect(names.indexOf('20260809_180000_supply_notification_duplicates_preflight')).toBeLessThan(
      names.indexOf('20260809_183327_supply_submission_notification_unique'),
    )
  })

  it('listings data_source 对齐迁移可重复执行，兼容半应用本地库', () => {
    const content = readFileSync(
      resolve(migrationsDir, '20260810_003111_align_listings_data_source_with_production.ts'),
      'utf-8',
    )
    const up = extractMigrationUpBody(content)

    expect(up).toContain('to_regtype')
    expect(up).toContain('ADD COLUMN IF NOT EXISTS "data_source_source"')
    expect(up).toContain('ADD COLUMN IF NOT EXISTS "data_source_external_id"')
    expect(up).toContain('ADD COLUMN IF NOT EXISTS "data_source_source_url"')
    expect(up).toContain('ADD COLUMN IF NOT EXISTS "data_source_synced_at"')
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
    // 这条断言默认对目录里的每份迁移都成立，包括已获批准的破坏性迁移——批准不
    // 体现在这个测试文件里（那样就是把例外藏进测试），而是走
    // scripts/preflight.ts 的 applyDestructiveMigrationOverride，经
    // scripts/destructive-migration-approvals.ts 读取顶层
    // DESTRUCTIVE_MIGRATION_APPROVALS.json——是否放行由那份数据文件决定，且要求
    // 整份迁移文件内容的 SHA-256 与批准记录逐字节一致（真正的内容指纹，不是只认
    // 迁移名、也不是只认出现次数）。新增/修改一条批准 = 那份 JSON 的一处 diff，
    // 就是对 PR 评审者可见的记录；清单里没有的迁移、或内容对不上的迁移，
    // 本测试必须照样把它拦下来。
    const names = listMigrationFiles(migrationsDir)
    for (const name of names) {
      const content = readFileSync(resolve(migrationsDir, `${name}.ts`), 'utf-8')
      // 只扫 up()：down() 的 DROP 是合法回滚
      const risks = applyDestructiveMigrationOverride(name, scanMigrationUpRisks(name, content), content)
      const blocking = risks.filter((r) => r.severity === 'fail')
      expect(
        blocking,
        `${name} up() 含高风险删除操作。若这次删除已获用户批准，登记进仓库顶层 ` +
          'DESTRUCTIVE_MIGRATION_APPROVALS.json；清单里已有这条迁移却仍在这里红，' +
          '说明迁移文件在批准之后改过内容（指纹是整份 .ts 文件的 SHA-256），' +
          '跑 pnpm migrate:approval-hash 重算后更新 approvedFileSha256。' +
          '不要用 SKIP_PREPUSH=1 绕过。机制详见 .agent/migrations.md。',
      ).toHaveLength(0)
    }
  })

  it('详情页字段迁移自身不包含前向破坏操作', () => {
    const content = readFileSync(
      resolve(migrationsDir, '20260730_125851_detail_page_fields.ts'),
      'utf-8',
    )
    const blocking = scanMigrationRisks(extractMigrationUpBody(content)).filter(
      (risk) => risk.severity === 'fail',
    )

    expect(blocking).toHaveLength(0)
  })
})
