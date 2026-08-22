import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isDestructiveMigrationApproved,
  loadDestructiveMigrationApprovals,
  sha256Hex,
  APPROVALS_FILE_PATH,
  type DestructiveMigrationApprovalEntry,
} from '../scripts/destructive-migration-approvals'

const here = pathDirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'src', 'migrations')

/**
 * 批准清单的匹配逻辑是整份迁移文件内容的 SHA-256——真正的内容指纹，不是只认
 * 迁移名，也不是只认「出现次数」（出现次数指纹的漏洞：把 DROP TABLE 的目标表名
 * 从 A 换成 B，次数不变，之前的实现会误放行）。这些用例全部用构造好的
 * approvals 数组跑，不碰真实的 DESTRUCTIVE_MIGRATION_APPROVALS.json，纯函数、
 * 不依赖磁盘状态。
 */
const SAMPLE_CONTENT_A = 'export async function up() { /* DROP TABLE "a" */ }'
const SAMPLE_CONTENT_B = 'export async function up() { /* DROP TABLE "b" */ }'

const fixture: DestructiveMigrationApprovalEntry[] = [
  {
    migrationName: '20260101_000000_example_drop',
    approvedIn: 'TEST-000',
    approvedWhat: '测试用例',
    impact: '测试用例，无实际影响',
    approvedFileSha256: sha256Hex(SAMPLE_CONTENT_A),
  },
]

describe('isDestructiveMigrationApproved：内容指纹（整份文件 SHA-256）匹配', () => {
  it('迁移名对上、文件内容与批准时逐字节一致才放行', () => {
    expect(
      isDestructiveMigrationApproved('20260101_000000_example_drop', SAMPLE_CONTENT_A, fixture),
    ).toBe(true)
  })

  it('文件内容变了（哪怕只是把 DROP TABLE 的目标表名从 a 换成 b）不再放行', () => {
    // 这正是「出现次数」指纹的漏洞：换个表名，DROP TABLE 出现次数仍是 1，
    // 旧实现会误放行。整份文件哈希能正确拒绝。
    expect(
      isDestructiveMigrationApproved('20260101_000000_example_drop', SAMPLE_CONTENT_B, fixture),
    ).toBe(false)
  })

  it('文件内容只多了一个空白字符也不再放行——逐字节比较，不是语义比较', () => {
    expect(
      isDestructiveMigrationApproved(
        '20260101_000000_example_drop',
        SAMPLE_CONTENT_A + ' ',
        fixture,
      ),
    ).toBe(false)
  })

  it('迁移名对不上不放行，即便文件内容逐字节相同', () => {
    expect(isDestructiveMigrationApproved('some_other_migration', SAMPLE_CONTENT_A, fixture)).toBe(
      false,
    )
  })

  it('批准清单为空数组：任何迁移都不放行', () => {
    expect(isDestructiveMigrationApproved('20260101_000000_example_drop', SAMPLE_CONTENT_A, [])).toBe(
      false,
    )
  })
})

describe('sha256Hex', () => {
  it('对相同内容返回相同摘要（十六进制，64 位）', () => {
    const h1 = sha256Hex('hello')
    const h2 = sha256Hex('hello')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('对不同内容返回不同摘要', () => {
    expect(sha256Hex('hello')).not.toBe(sha256Hex('hellp'))
  })
})

describe('loadDestructiveMigrationApprovals：真实清单文件', () => {
  it('清单文件路径指向仓库顶层 DESTRUCTIVE_MIGRATION_APPROVALS.json', () => {
    expect(APPROVALS_FILE_PATH.replace(/\\/g, '/')).toMatch(
      /DESTRUCTIVE_MIGRATION_APPROVALS\.json$/,
    )
  })

  it('真实清单里，OPT-034 Task 6 的删表迁移条目字段齐全', () => {
    const approvals = loadDestructiveMigrationApprovals()
    const entry = approvals.find(
      (a) => a.migrationName === '20260820_055534_drop_listing_merchant_relations',
    )
    expect(entry).toBeDefined()
    expect(entry?.approvedIn).toMatch(/OPT-034/)
    expect(entry?.approvedWhat.length).toBeGreaterThan(0)
    expect(entry?.impact.length).toBeGreaterThan(0)
    expect(entry?.approvedFileSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('真实清单里的哈希与该迁移文件当前的真实内容一致——批准没有过期', () => {
    // 这条用例保证：只要仓库里那份迁移文件不变，批准就一直有效；
    // 一旦有人改动了那份迁移文件（哪怕是笔误），这里会先于其它三道闸红。
    const approvals = loadDestructiveMigrationApprovals()
    const entry = approvals.find(
      (a) => a.migrationName === '20260820_055534_drop_listing_merchant_relations',
    )
    const migrationPath = resolve(
      migrationsDir,
      '20260820_055534_drop_listing_merchant_relations.ts',
    )
    const realContent = readFileSync(migrationPath, 'utf-8')
    expect(
      sha256Hex(realContent),
      '批准指纹已过期：迁移文件在批准之后被改动过（改一行注释、多一个空格都算）。' +
        '这不是"你想删表被禁止"，四道闸此刻报的"必须经过扩展→回填→双读"文案与真实原因无关。' +
        '下一步：跑 pnpm migrate:approval-hash 拿到新摘要，复核改动仍在用户批准范围内后，' +
        '写回 DESTRUCTIVE_MIGRATION_APPROVALS.json 里该条目的 approvedFileSha256。',
    ).toBe(entry?.approvedFileSha256)
    expect(
      isDestructiveMigrationApproved(
        '20260820_055534_drop_listing_merchant_relations',
        realContent,
        approvals,
      ),
    ).toBe(true)
  })
})
